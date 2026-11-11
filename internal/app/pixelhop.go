package app

import (
	"bytes"
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/url"
	"strings"
	"time"

	"github.com/navi-crwn/FileHop/internal/hop"
)

// "Save to PixelHop": the one case where a converted file leaves the browser, and only when the
// person presses the button. The page posts that one result file to FileHop (same origin); FileHop
// signs it as the signed-in member (their HOP ID as actor) and forwards it to PixelHop's
// POST /hop/media. The file is held in memory only as long as the call takes (PixelHop's signature
// covers the body's hash, so it has to be read before it is sent) and is never written to disk,
// logged or kept. The store secret is FileHop's own secret for PixelHop's store, never the SSO secret.

const (
	pixelDefaultMax = 20 << 20 // PixelHop's PIXELHOP_MAX_UPLOAD_MB default
	pixelPerMinute  = 20       // saves one person may start per minute
	pixelTimeout    = 40 * time.Second
	pixelNameMax    = 200
)

// PixelHopURLFor is the address of PixelHop in the family the hub belongs to: pixel.<the hub's
// parent domain>, so no second host has to be configured. Empty for a local hub.
func PixelHopURLFor(sso string) string {
	u, err := url.Parse(sso)
	if err != nil || u.Scheme != "https" || u.Hostname() == "" {
		return ""
	}
	parts := strings.Split(u.Hostname(), ".")
	if len(parts) < 2 {
		return ""
	}
	if len(parts) > 2 {
		parts = parts[len(parts)-2:]
	}
	return "https://pixel." + strings.Join(parts, ".")
}

func (a *App) pixelEnabled() bool {
	return a.cfg.PixelHopURL != "" && len(a.cfg.PixelHopSecret) >= 32 && a.cfg.PixelHopSecret != a.cfg.SSOSecret
}

func (a *App) pixelMax() int64 {
	if a.cfg.PixelHopMaxBytes > 0 {
		return a.cfg.PixelHopMaxBytes
	}
	return pixelDefaultMax
}

// sniffPixelType names the type of the bytes when PixelHop accepts it: JPEG, PNG, GIF, WebP, BMP or PDF.
func sniffPixelType(b []byte) string {
	switch {
	case bytes.HasPrefix(b, []byte("\x89PNG\r\n\x1a\n")):
		return "image/png"
	case bytes.HasPrefix(b, []byte("\xff\xd8\xff")):
		return "image/jpeg"
	case bytes.HasPrefix(b, []byte("GIF87a")), bytes.HasPrefix(b, []byte("GIF89a")):
		return "image/gif"
	case len(b) >= 12 && bytes.Equal(b[:4], []byte("RIFF")) && bytes.Equal(b[8:12], []byte("WEBP")):
		return "image/webp"
	case bytes.HasPrefix(b, []byte("BM")) && len(b) > 14:
		return "image/bmp"
	case bytes.HasPrefix(b, []byte("%PDF-")):
		return "application/pdf"
	}
	return ""
}

// sameOriginCall refuses requests a page of another site could have made: a custom header (which
// a cross-site page cannot add without a CORS preflight that this app never grants) and, when the
// browser says so, the same origin.
func sameOriginCall(r *http.Request) bool {
	if r.Header.Get("X-Requested-With") != "filehop" {
		return false
	}
	if s := r.Header.Get("Sec-Fetch-Site"); s != "" && s != "same-origin" {
		return false
	}
	if o := r.Header.Get("Origin"); o != "" {
		u, err := url.Parse(o)
		if err != nil || u.Host != r.Host {
			return false
		}
	}
	return true
}

func pixelFail(w http.ResponseWriter, status int, code string) {
	writeJSON(w, status, map[string]any{"ok": false, "error": code})
}

// POST /api/v1/pixelhop/save?name=...  (body: the raw file)
func (a *App) pixelSave(w http.ResponseWriter, r *http.Request) {
	if !a.pixelEnabled() {
		http.NotFound(w, r)
		return
	}
	w.Header().Set("Cache-Control", "no-store")
	if !sameOriginCall(r) {
		pixelFail(w, http.StatusForbidden, "csrf")
		return
	}
	u := a.verifiedUser(r)
	if u == nil || u.Sub == "" {
		pixelFail(w, http.StatusUnauthorized, "not_signed_in")
		return
	}
	if !a.send.allow("px"+u.Sub, pixelPerMinute, time.Minute) {
		w.Header().Set("Retry-After", "60")
		pixelFail(w, http.StatusTooManyRequests, "rate_limited")
		return
	}
	max := a.pixelMax()
	if r.ContentLength > max {
		pixelFail(w, http.StatusRequestEntityTooLarge, "too_large")
		return
	}
	body, err := io.ReadAll(http.MaxBytesReader(w, r.Body, max))
	if err != nil {
		pixelFail(w, http.StatusRequestEntityTooLarge, "too_large")
		return
	}
	if len(body) == 0 || sniffPixelType(body) == "" {
		pixelFail(w, http.StatusUnsupportedMediaType, "unsupported_type")
		return
	}
	name := []rune(strings.TrimSpace(r.URL.Query().Get("name")))
	if len(name) > pixelNameMax {
		name = name[:pixelNameMax]
	}
	pathQ := "/hop/media"
	if len(name) > 0 {
		pathQ += "?name=" + url.QueryEscape(string(name))
	}
	req, err := http.NewRequestWithContext(r.Context(), http.MethodPost, a.cfg.PixelHopURL+pathQ, bytes.NewReader(body))
	if err != nil {
		pixelFail(w, http.StatusBadGateway, "failed")
		return
	}
	for k, v := range hop.Headers(a.cfg.SSOClient, a.cfg.PixelHopSecret, u.Sub, http.MethodPost, pathQ, body) {
		req.Header[k] = v
	}
	req.Header.Set("Content-Type", "application/octet-stream")
	ctx, cancel := context.WithTimeout(req.Context(), pixelTimeout)
	defer cancel()
	client := &http.Client{CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }}
	res, err := client.Do(req.WithContext(ctx))
	if err != nil {
		pixelFail(w, http.StatusBadGateway, "failed")
		return
	}
	defer res.Body.Close()
	var env struct {
		OK    bool   `json:"ok"`
		Error string `json:"error"`
		Data  struct {
			PageURL   string `json:"page_url"`
			URL       string `json:"url"`
			Thumb     string `json:"thumb_url"`
			Bytes     int64  `json:"bytes"`
			Duplicate bool   `json:"duplicate"`
		} `json:"data"`
	}
	if json.NewDecoder(io.LimitReader(res.Body, 64<<10)).Decode(&env) != nil {
		pixelFail(w, http.StatusBadGateway, "failed")
		return
	}
	if (res.StatusCode == http.StatusCreated || res.StatusCode == http.StatusOK) && env.OK {
		// only addresses on PixelHop itself are passed on to the page
		own := func(s string) string {
			if strings.HasPrefix(s, a.cfg.PixelHopURL+"/") {
				return s
			}
			return ""
		}
		page := own(env.Data.PageURL)
		if page == "" {
			pixelFail(w, http.StatusBadGateway, "failed")
			return
		}
		writeJSON(w, http.StatusOK, map[string]any{"ok": true, "page_url": page, "url": own(env.Data.URL),
			"thumb_url": own(env.Data.Thumb), "bytes": env.Data.Bytes, "duplicate": env.Data.Duplicate})
		return
	}
	// PixelHop's own words are never passed on: only a code the page has a translated message for.
	switch env.Error {
	case "no_account":
		pixelFail(w, http.StatusConflict, "no_account")
	case "quota_exceeded":
		pixelFail(w, http.StatusConflict, "quota_exceeded")
	case "too_large":
		pixelFail(w, http.StatusRequestEntityTooLarge, "too_large")
	case "unsupported_type":
		pixelFail(w, http.StatusUnsupportedMediaType, "unsupported_type")
	case "rate_limited":
		pixelFail(w, http.StatusTooManyRequests, "rate_limited")
	default:
		pixelFail(w, http.StatusBadGateway, "failed")
	}
}

package app

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"net/url"
	"strings"
	"sync"
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
	pixelSlots      = 4                // files held in memory at once, across everyone
	pixelReadTime   = 60 * time.Second // the whole body must arrive within this
)

// pixelGate bounds the memory the feature can use: a few bodies at once, and one save per person.
type pixelGate struct {
	up    sync.Mutex // one upstream call at a time
	mu    sync.Mutex
	busy  map[string]bool
	slots int
}

// enter returns "" when who may go ahead, "person" when they already have a save running and
// "full" when every slot is taken. A successful enter must be paired with leave.
func (g *pixelGate) enter(who string) string {
	g.mu.Lock()
	defer g.mu.Unlock()
	if g.busy == nil {
		g.busy = map[string]bool{}
	}
	switch {
	case g.busy[who]:
		return "person"
	case g.slots >= pixelSlots:
		return "full"
	}
	g.busy[who] = true
	g.slots++
	return ""
}

func (g *pixelGate) leave(who string) {
	g.mu.Lock()
	defer g.mu.Unlock()
	delete(g.busy, who)
	g.slots--
}

// readPixelBody reads the whole body into one buffer sized from Content-Length (grown by append only
// when the length is not known). A body over max is *http.MaxBytesError; anything else is a broken read.
func readPixelBody(w http.ResponseWriter, r *http.Request, max int64) ([]byte, error) {
	rc := http.NewResponseController(w)
	_ = rc.SetReadDeadline(time.Now().Add(pixelReadTime))
	body := http.MaxBytesReader(w, r.Body, max)
	if n := r.ContentLength; n > 0 && n <= max {
		buf := make([]byte, n)
		if _, err := io.ReadFull(body, buf); err != nil {
			return nil, err
		}
		// Content-Length promised exactly n bytes; one more would be a mismatch the server refuses itself
		return buf, nil
	}
	return io.ReadAll(body)
}

// bodyErrorCode tells "too big" from "the read broke" (a dropped connection, a timeout).
func bodyErrorCode(err error) (int, string) {
	var tooBig *http.MaxBytesError
	if errors.As(err, &tooBig) {
		return http.StatusRequestEntityTooLarge, "too_large"
	}
	return http.StatusBadRequest, "failed"
}

// pixelName is the file name the page sent in X-FileHop-Name (percent-encoded, so it never appears in
// this app's own request line): decoded, cleaned of control characters and cut to 200 characters.
func pixelName(r *http.Request) string {
	raw := r.Header.Get("X-FileHop-Name")
	if raw == "" || len(raw) > 4*pixelNameMax*3 {
		return ""
	}
	dec, err := url.PathUnescape(raw)
	if err != nil {
		return ""
	}
	var out []rune
	for _, c := range strings.TrimSpace(dec) {
		if c < 0x20 || c == 0x7f || (c >= 0x80 && c < 0xa0) {
			continue
		}
		out = append(out, c)
		if len(out) == pixelNameMax {
			break
		}
	}
	return string(out)
}

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

// POST /api/v1/pixelhop/save  (body: the raw file; its name in the X-FileHop-Name header, percent-encoded)
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
	// one save per person and a handful in all, so the memory held for bodies has a ceiling
	if why := a.px.enter(u.Sub); why != "" {
		pixelFail(w, map[string]int{"person": http.StatusTooManyRequests, "full": http.StatusServiceUnavailable}[why], "busy")
		return
	}
	defer a.px.leave(u.Sub)
	body, err := readPixelBody(w, r, max)
	if err != nil {
		st, code := bodyErrorCode(err)
		pixelFail(w, st, code)
		return
	}
	if len(body) == 0 || sniffPixelType(body) == "" {
		pixelFail(w, http.StatusUnsupportedMediaType, "unsupported_type")
		return
	}
	// PixelHop's request line carries the name (it is part of the signed path); this app's own does not.
	pathQ := "/hop/media"
	if name := pixelName(r); name != "" {
		pathQ += "?name=" + url.QueryEscape(name)
	}
	// One upstream call at a time from this server: all of FileHop's calls reach PixelHop from one
	// address, and PixelHop allows one unverified body in flight per address.
	a.px.up.Lock()
	status, env, err := a.pixelCall(r.Context(), u.Sub, pathQ, body)
	if err == nil && pixelRetryable(status, env.Error) {
		// PixelHop was busy or did not get the body in time: once more, after a short pause, signed afresh
		// (new nonce and timestamp: a nonce works only once)
		time.Sleep(pixelRetryPause)
		status, env, err = a.pixelCall(r.Context(), u.Sub, pathQ, body)
	}
	a.px.up.Unlock()
	if err != nil {
		pixelFail(w, http.StatusBadGateway, "failed")
		return
	}
	if (status == http.StatusCreated || status == http.StatusOK) && env.OK {
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
	case "busy", "body_timeout": // still so after the retry
		pixelFail(w, http.StatusServiceUnavailable, "busy")
	default:
		pixelFail(w, http.StatusBadGateway, "failed")
	}
}

var pixelRetryPause = 500 * time.Millisecond

// pixelRetryable: 503 busy (PixelHop has a body from this address in flight) and 408 body_timeout.
func pixelRetryable(status int, code string) bool {
	return (status == http.StatusServiceUnavailable && code == "busy") || (status == http.StatusRequestTimeout && code == "body_timeout")
}

type pixelEnv struct {
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

// pixelCall makes one signed POST /hop/media. Every call is signed anew: new nonce, new timestamp.
func (a *App) pixelCall(parent context.Context, actor, pathQ string, body []byte) (int, pixelEnv, error) {
	var env pixelEnv
	ctx, cancel := context.WithTimeout(parent, pixelTimeout)
	defer cancel()
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, a.cfg.PixelHopURL+pathQ, bytes.NewReader(body))
	if err != nil {
		return 0, env, err
	}
	for k, v := range hop.Headers(a.cfg.SSOClient, a.cfg.PixelHopSecret, actor, http.MethodPost, pathQ, body) {
		req.Header[k] = v
	}
	req.Header.Set("Content-Type", "application/octet-stream")
	client := &http.Client{CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }}
	res, err := client.Do(req)
	if err != nil {
		return 0, env, err
	}
	defer res.Body.Close()
	if json.NewDecoder(io.LimitReader(res.Body, 64<<10)).Decode(&env) != nil {
		if res.StatusCode == http.StatusRequestTimeout { // nginx's own HTML 408 in front of PixelHop
			return res.StatusCode, pixelEnv{Error: "body_timeout"}, nil
		}
		return 0, env, errors.New("unreadable answer")
	}
	return res.StatusCode, env, nil
}

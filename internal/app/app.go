// Package app is FileHop's server. It is deliberately small: the converter is
// the browser app in web/ and runs entirely in the tab, so the server only
// hands out those files with the right headers, signs people in with HOP ID,
// and answers the family's signed /hop/* protocol.
package app

import (
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"io/fs"
	"log"
	"net/http"
	"path"
	"strings"
	"time"

	"github.com/navi-crwn/FileHop/internal/db"
	"github.com/navi-crwn/FileHop/internal/hop"
)

type Config struct {
	Version       string
	BaseURL       string   // https://file.hel.ink, no trailing slash
	SSOURL        string   // https://hub.hel.ink; empty turns sign-in and /hop/* off
	SSOSecret     string   // this app's secret in the hub registry (HOP_SSO_SECRET_FILEHOP there)
	SSOClient     string   // the slug the hub knows this app by
	HopClients    []string // apps that may call /hop/* (imperium, helink)
	SecureCookies bool
}

func (c Config) SSOEnabled() bool { return c.SSOURL != "" && len(c.SSOSecret) >= 32 }

type App struct {
	cfg     Config
	db      *db.DB
	static  fs.FS
	index   []byte
	used    usedTickets
	nonces  hop.Nonces
	started time.Time
}

// New builds the handler. static is the built browser app (web/dist).
func New(cfg Config, d *db.DB, static fs.FS) (*App, error) {
	index, err := fs.ReadFile(static, "index.html")
	if err != nil {
		return nil, err
	}
	return &App{cfg: cfg, db: d, static: static, index: index, used: usedTickets{m: map[string]int64{}}, started: time.Now()}, nil
}

func (a *App) Handler() http.Handler {
	m := http.NewServeMux()

	// Plain liveness for nginx and the hub watchdog (registry default /healthz).
	m.HandleFunc("GET /healthz", func(w http.ResponseWriter, r *http.Request) {
		if err := a.db.Ping(); err != nil {
			http.Error(w, "db", http.StatusServiceUnavailable)
			return
		}
		w.Header().Set("Content-Type", "text/plain; charset=utf-8")
		w.Write([]byte("ok\n"))
	})

	a.hopRoutes(m)

	m.HandleFunc("GET /changelog", a.changelog)
	m.HandleFunc("GET /dashboard", a.dashboard)
	m.HandleFunc("GET /dashboard/", func(w http.ResponseWriter, r *http.Request) {
		http.Redirect(w, r, "/dashboard", http.StatusMovedPermanently)
	})

	m.HandleFunc("GET /auth/sso", a.ssoStart)
	m.HandleFunc("GET /auth/sso/callback", a.ssoCallback)
	m.HandleFunc("GET /auth/sso/logout", a.ssoLogout)
	m.HandleFunc("GET /api/v1/me", a.apiMe)
	m.HandleFunc("POST /api/v1/logout", a.apiLogout)
	m.HandleFunc("/api/", func(w http.ResponseWriter, r *http.Request) {
		writeJSON(w, http.StatusNotFound, map[string]string{"error": "not_found"})
	})

	// Everything else is the browser app. /send is kept for the peer-to-peer
	// sender that will live in this same app (file.hel.ink/send); like any
	// other route without an extension it gets the app shell today.
	m.HandleFunc("/", a.serveStatic)
	return secure(m)
}

// ---------- the browser app ----------

/*
The CSP is the one in WIRING.md. 'wasm-unsafe-eval' is needed by hash-wasm

	and pdf.js; nothing else may evaluate code. connect-src stays 'self': the
	session check is same-origin and sign-in is a navigation, not a fetch.
*/
const csp = "default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; worker-src 'self' blob:; " +
	"style-src 'self' 'unsafe-inline'; font-src 'self'; img-src 'self' blob: data:; media-src 'self' blob:; " +
	"connect-src 'self'; object-src 'none'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'"

// setAppHeaders is the cross-origin isolation and CSP of the app's own pages
// (the shell, its files and /changelog); never of the hub or marketing pages.
func setAppHeaders(h http.Header) {
	h.Set("Cross-Origin-Opener-Policy", "same-origin")
	h.Set("Cross-Origin-Embedder-Policy", "require-corp")
	h.Set("Cross-Origin-Resource-Policy", "same-origin")
	h.Set("Content-Security-Policy", csp)
}

func (a *App) serveStatic(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet && r.Method != http.MethodHead {
		w.Header().Set("Allow", "GET, HEAD")
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	name := strings.TrimPrefix(path.Clean(r.URL.Path), "/")
	h := w.Header()
	setAppHeaders(h)

	if name == "" || name == "index.html" || !strings.Contains(path.Base(name), ".") {
		// The shell, for / and for app routes such as /send.
		if st, err := fs.Stat(a.static, name); name != "" && name != "index.html" && err == nil && !st.IsDir() {
			// a real file without an extension: fall through to it
		} else {
			h.Set("Content-Type", "text/html; charset=utf-8")
			h.Set("Cache-Control", "no-cache")
			w.Write(a.index)
			return
		}
	}
	f, err := a.static.Open(name)
	if err != nil {
		http.Error(w, "not found", http.StatusNotFound)
		return
	}
	defer f.Close()
	st, err := f.Stat()
	if err != nil || st.IsDir() {
		http.Error(w, "not found", http.StatusNotFound)
		return
	}
	if strings.HasPrefix(name, "assets/") || strings.HasPrefix(name, "hop-fonts/") || strings.HasPrefix(name, "hop-ui/") || strings.HasPrefix(name, "vendor/") {
		h.Set("Cache-Control", "public, max-age=31536000, immutable")
	} else {
		h.Set("Cache-Control", "no-cache")
	}
	if strings.HasSuffix(name, ".mjs") {
		h.Set("Content-Type", "text/javascript; charset=utf-8")
	} else if strings.HasSuffix(name, ".webmanifest") {
		h.Set("Content-Type", "application/manifest+json")
	}
	http.ServeContent(w, r, name, st.ModTime(), f.(readSeeker))
}

type readSeeker interface {
	Read([]byte) (int, error)
	Seek(int64, int) (int64, error)
}

// secure adds the headers every answer gets, whatever produced it.
func secure(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		h := w.Header()
		h.Set("X-Content-Type-Options", "nosniff")
		h.Set("Referrer-Policy", "no-referrer")
		h.Set("Permissions-Policy", "geolocation=(), microphone=(), camera=()")
		h.Set("X-Frame-Options", "DENY")
		next.ServeHTTP(w, r)
	})
}

// ---------- small helpers ----------

func writeJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.Header().Set("Cache-Control", "no-store")
	w.WriteHeader(status)
	if err := json.NewEncoder(w).Encode(v); err != nil {
		log.Printf("json: %v", err)
	}
}

func randToken(n int) string {
	b := make([]byte, n)
	_, _ = rand.Read(b)
	return base64.RawURLEncoding.EncodeToString(b)
}

func hashHex(s string) string {
	sum := sha256.Sum256([]byte(s))
	return hex.EncodeToString(sum[:])
}

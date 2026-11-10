package app

import (
	"crypto/hmac"
	"log"
	"net/http"
	"net/url"
	"strings"
	"sync"
	"time"

	"github.com/navi-crwn/FileHop/internal/db"
	"github.com/navi-crwn/FileHop/internal/hop"
)

// Sign-in with HOP ID, the same flow as NoteHop (internal/app/sso.go there):
// the hub at FILEHOP_SSO_URL owns the account; FileHop sends the visitor to
// <hub>/sso/<client>, gets back a short-lived ticket signed with this app's
// registry secret, and keeps a local row keyed by the hub's id (sub) plus a
// session cookie. A guest never needs any of this: converting works signed out.

const (
	ssoCookie     = "fh_sso"
	sessionCookie = "fh_session"
	sessionTTL    = 30 * 24 * time.Hour
)

// recheckAfter is how long the hub's word is trusted. A session older than
// this is not shown as an account and does not open /dashboard until the
// browser has been through the hub again, which costs nothing while the same
// HOP ID is still signed in there and swaps the account if it is not. A var so
// tests can move it.
var recheckAfter = 5 * time.Minute

const dashboardPath = "/dashboard"

// usedTickets remembers ticket ids until they expire, so each works once.
type usedTickets struct {
	sync.Mutex
	m map[string]int64
}

func (u *usedTickets) first(jti string, exp int64) bool {
	u.Lock()
	defer u.Unlock()
	now := time.Now().Unix()
	for k, e := range u.m {
		if e < now {
			delete(u.m, k)
		}
	}
	if _, seen := u.m[jti]; seen {
		return false
	}
	u.m[jti] = exp
	return true
}

// safeNext keeps post-login redirects on this site. Browsers drop tabs and
// line breaks from a URL and read a backslash as a slash, so "/<tab>/host"
// would leave the site: control characters and backslashes are refused.
func safeNext(next string) string {
	if !strings.HasPrefix(next, "/") || strings.HasPrefix(next, "//") || strings.ContainsFunc(next, func(r rune) bool {
		return r < ' ' || r == 0x7f || r == '\\'
	}) {
		return "/"
	}
	return next
}

func (a *App) ssoStart(w http.ResponseWriter, r *http.Request) {
	if !a.cfg.SSOEnabled() {
		http.NotFound(w, r)
		return
	}
	state := randToken(32)
	next := ""
	if n := r.FormValue("next"); n != "" {
		next = safeNext(n)
	}
	// prompt=none: the hub must never show a login page. It answers with a ticket, or with
	// error=login_required to the callback, which then ends this app's session.
	silent := r.FormValue("prompt") == "none"
	mark := state + "|" + url.QueryEscape(next)
	if silent {
		mark += "|none"
	}
	http.SetCookie(w, &http.Cookie{Name: ssoCookie, Value: mark,
		Path: "/auth/", HttpOnly: true, Secure: a.cfg.SecureCookies, SameSite: http.SameSiteLaxMode, MaxAge: 900})
	q := url.Values{"state": {state}, "return_to": {a.cfg.BaseURL + "/auth/sso/callback"}}
	if silent {
		q.Set("prompt", "none")
	}
	http.Redirect(w, r, a.cfg.SSOURL+"/sso/"+url.PathEscape(a.cfg.SSOClient)+"?"+q.Encode(), http.StatusFound)
}

func (a *App) ssoCallback(w http.ResponseWriter, r *http.Request) {
	if !a.cfg.SSOEnabled() {
		http.NotFound(w, r)
		return
	}
	c, err := r.Cookie(ssoCookie)
	if err != nil {
		a.authFail(w, r, "expired")
		return
	}
	state, rest, _ := strings.Cut(c.Value, "|")
	next, flag, _ := strings.Cut(rest, "|")
	next, _ = url.QueryUnescape(next)
	silent := flag == "none"
	if e := r.FormValue("error"); e != "" {
		// Only the answer to a silent check, carrying our own state, counts: the hub has no
		// session for this browser, so whatever account this app still held is not valid.
		if !silent || e != "login_required" || !hmac.Equal([]byte(r.FormValue("state")), []byte(state)) {
			a.authFail(w, r, "invalid")
			return
		}
		a.endSession(w, r)
		http.SetCookie(w, &http.Cookie{Name: ssoCookie, Path: "/auth/", MaxAge: -1})
		if next == dashboardPath {
			http.Redirect(w, r, "/auth/sso?next="+url.QueryEscape(dashboardPath), http.StatusSeeOther)
		} else {
			http.Redirect(w, r, safeNext(next), http.StatusSeeOther)
		}
		return
	}
	t, err := hop.ParseTicket(r.FormValue("ticket"), a.cfg.SSOSecret, time.Now())
	// A ticket the hub made for another of its apps must not work here.
	if err != nil || !hmac.Equal([]byte(t.State), []byte(state)) || (t.Aud != "" && t.Aud != a.cfg.SSOClient) || !a.used.first(t.Jti, t.Exp) {
		a.authFail(w, r, "invalid")
		return
	}
	// The hub never issues a ticket for an inactive account; refuse one that says otherwise.
	if t.Status != "" && t.Status != db.StatusActive {
		a.authFail(w, r, "suspended")
		return
	}
	u, err := a.db.UpsertUser(t.Sub, clip(t.Email, 254), clip(t.Name, 80))
	if err != nil {
		log.Printf("sso: %v", err)
		a.authFail(w, r, "failed")
		return
	}
	if u.Status == db.StatusSuspended {
		a.authFail(w, r, "suspended")
		return
	}
	// Whatever session this browser held belongs to whoever was signed in
	// before; the hub has just vouched for someone, so that row ends here.
	if c, err := r.Cookie(sessionCookie); err == nil && c.Value != "" {
		if old, err := a.db.UserBySession(hashHex(c.Value)); err == nil && old.Sub != u.Sub {
			log.Printf("sso: browser switched account, old session ended")
		}
		_ = a.db.DeleteSession(hashHex(c.Value))
	}
	tok := randToken(32)
	if err := a.db.CreateSession(hashHex(tok), u.ID, sessionTTL); err != nil {
		log.Printf("session: %v", err)
		a.authFail(w, r, "failed")
		return
	}
	http.SetCookie(w, &http.Cookie{Name: sessionCookie, Value: tok, Path: "/", HttpOnly: true, Secure: a.cfg.SecureCookies,
		SameSite: http.SameSiteLaxMode, MaxAge: int(sessionTTL.Seconds())})
	http.SetCookie(w, &http.Cookie{Name: ssoCookie, Path: "/auth/", MaxAge: -1})
	if next == "" {
		next = dashboardPath
	}
	dest := safeNext(next)
	// ?_rc=1 says "you have just been through the hub". If the session is still not readable
	// when the page asks for it (cookies blocked), the page shows an error instead of going round again.
	if silent || dest == dashboardPath {
		if strings.Contains(dest, "?") {
			dest += "&_rc=1"
		} else {
			dest += "?_rc=1"
		}
	}
	http.Redirect(w, r, dest, http.StatusSeeOther)
}

func (a *App) currentUser(r *http.Request) *db.User {
	c, err := r.Cookie(sessionCookie)
	if err != nil || c.Value == "" {
		return nil
	}
	u, err := a.db.UserBySession(hashHex(c.Value))
	if err != nil || u.Status != db.StatusActive {
		return nil
	}
	return u
}

// verifiedUser is the account to show: the session's, but only while the hub
// has vouched for it recently. A stale session may belong to an account that
// is no longer the one signed in at the hub (switched without signing out, or
// signed out in another browser), so it counts as nobody until the next trip
// through the hub.
func (a *App) verifiedUser(r *http.Request) *db.User {
	u, fresh := a.sessionState(r)
	if !fresh {
		return nil
	}
	return u
}

// sessionState is the account behind the cookie (nil when there is none) and whether the hub
// vouched for it recently. A live but not fresh session is "stale": worth one silent trip to the hub.
func (a *App) sessionState(r *http.Request) (*db.User, bool) {
	u := a.currentUser(r)
	if u == nil {
		return nil, false
	}
	c, _ := r.Cookie(sessionCookie)
	at, err := a.db.SessionVerifiedAt(hashHex(c.Value))
	fresh := err == nil && time.Since(at) <= recheckAfter
	if !fresh && a.cfg.SSOEnabled() && !a.hubUp() {
		// Family rule: with the hub unreachable the app's own session stays trusted. Nobody is
		// redirected, signed out or turned into a guest; the re-check happens once the hub is back.
		fresh = true
	}
	return u, fresh
}

// dashboard is the signed-in workspace. Guests and stale sessions are sent
// through the hub and come back here.
func (a *App) dashboard(w http.ResponseWriter, r *http.Request) {
	if !a.cfg.SSOEnabled() {
		http.Redirect(w, r, "/", http.StatusFound)
		return
	}
	if u, fresh := a.sessionState(r); !fresh {
		w.Header().Set("Cache-Control", "no-store")
		switch {
		case !a.hubUp():
			// no session here and no way to sign in while the hub is down: say so rather than send the browser there
			http.Redirect(w, r, "/?auth=hub", http.StatusFound)
		case r.URL.Query().Get("_rc") != "":
			// just back from the hub and still no readable session: say so, do not go round again
			http.Redirect(w, r, "/?auth=cookies", http.StatusFound)
		case u != nil:
			// a session this app holds but the hub has not vouched for lately: ask the hub quietly
			http.Redirect(w, r, "/auth/sso?prompt=none&next="+url.QueryEscape(dashboardPath), http.StatusFound)
		default:
			http.Redirect(w, r, "/auth/sso?next="+url.QueryEscape(dashboardPath), http.StatusFound)
		}
		return
	}
	h := w.Header()
	setAppHeaders(h)
	h.Set("Content-Type", "text/html; charset=utf-8")
	h.Set("Cache-Control", "no-store")
	w.Write(a.index)
}

// apiMe tells the browser whether someone is signed in. It always answers 200
// so a guest's console stays clean; sso:false means sign-in is not set up here.
func (a *App) apiMe(w http.ResponseWriter, r *http.Request) {
	out := map[string]any{"sso": a.cfg.SSOEnabled(), "signed_in": false}
	if u, fresh := a.sessionState(r); u != nil && !fresh {
		// The page may re-check once, quietly, through the hub. With the hub down sessionState
		// trusts the session instead, so this branch only runs while the hub answers.
		if a.cfg.SSOEnabled() && a.hubUp() {
			out["stale"] = true
		}
	} else if u != nil {
		out["signed_in"] = true
		out["name"] = u.Name
		out["email"] = u.Email
	}
	if a.cfg.SSOEnabled() {
		out["hub_url"] = a.cfg.SSOURL
		// Signing out goes through the hub, which walks every app's logout in
		// turn; return= brings the person back to this app afterwards.
		out["logout_url"] = a.cfg.SSOURL + "/logout"
		if a.cfg.BaseURL != "" {
			out["logout_url"] = a.cfg.SSOURL + "/logout?return=" + url.QueryEscape(a.cfg.BaseURL+"/")
		}
	}
	writeJSON(w, http.StatusOK, out)
}

// apiLogout ends only this app's session (the hub's chained logout is the
// normal way out; this is for a stale cookie or a hub that is down).
func (a *App) apiLogout(w http.ResponseWriter, r *http.Request) {
	a.endSession(w, r)
	writeJSON(w, http.StatusOK, map[string]bool{"ok": true})
}

func (a *App) endSession(w http.ResponseWriter, r *http.Request) {
	if c, err := r.Cookie(sessionCookie); err == nil {
		_ = a.db.DeleteSession(hashHex(c.Value))
	}
	http.SetCookie(w, &http.Cookie{Name: sessionCookie, Value: "", Path: "/", MaxAge: -1, HttpOnly: true,
		Secure: a.cfg.SecureCookies, SameSite: http.SameSiteLaxMode})
}

// ssoLogout is this app's step in the hub's chained logout: end the session
// here, then go on to ?next=, but only to an https address on the hub's own
// domain (hub.hel.ink -> hel.ink and its subdomains), or to http on localhost
// when the hub itself runs there (local testing).
func (a *App) ssoLogout(w http.ResponseWriter, r *http.Request) {
	a.endSession(w, r)
	next := "/"
	if n := r.URL.Query().Get("next"); familyURL(n, a.cfg.SSOURL) {
		next = n
	}
	http.Redirect(w, r, next, http.StatusSeeOther)
}

func familyURL(u, sso string) bool {
	if u == "" || sso == "" {
		return false
	}
	t, err := url.Parse(u)
	h, err2 := url.Parse(sso)
	if err != nil || err2 != nil || t.Host == "" || t.User != nil {
		return false
	}
	local := func(host string) bool { return host == "localhost" || host == "127.0.0.1" || host == "::1" }
	if t.Scheme != "https" && !(t.Scheme == "http" && local(t.Hostname()) && local(h.Hostname())) {
		return false
	}
	base := h.Hostname()
	if local(base) {
		return local(t.Hostname())
	}
	if parts := strings.Split(base, "."); len(parts) > 2 {
		base = strings.Join(parts[len(parts)-2:], ".")
	}
	host := t.Hostname()
	return host == base || strings.HasSuffix(host, "."+base)
}

func clip(s string, n int) string {
	s = strings.TrimSpace(s)
	if len(s) > n {
		return s[:n]
	}
	return s
}

// authFail sends the visitor back to the app with a short code; the app shows
// the message in the visitor's language (auth.err_* in web/src/lib/i18n).
func (a *App) authFail(w http.ResponseWriter, r *http.Request, code string) {
	http.SetCookie(w, &http.Cookie{Name: ssoCookie, Path: "/auth/", MaxAge: -1})
	http.Redirect(w, r, "/?auth="+code, http.StatusSeeOther)
}

package app

import (
	"net/http"
	"net/url"
	"strings"
	"testing"
	"time"
)

// signIn walks the sign-in flow the way a browser does, as the account sub,
// and returns the callback answer. next is the optional ?next= of the start.
func signIn(t *testing.T, c *http.Client, base, sub, name, jti, next string) *http.Response {
	t.Helper()
	start := base + "/auth/sso"
	if next != "" {
		start += "?next=" + url.QueryEscape(next)
	}
	loc, _ := url.Parse(mustGet(t, c, start).Header.Get("Location"))
	now := time.Now().Unix()
	tk := ticket(t, map[string]any{"sub": sub, "aud": "filehop", "email": name + "@example.org", "name": name, "status": "active",
		"state": loc.Query().Get("state"), "iat": now, "exp": now + 120, "jti": jti, "v": 2})
	return mustGet(t, c, base+"/auth/sso/callback?ticket="+url.QueryEscape(tk))
}

func meName(t *testing.T, c *http.Client, base string) any {
	t.Helper()
	me := decode(t, mustGet(t, c, base+"/api/v1/me"))
	if me["signed_in"] != true {
		return nil
	}
	return me["name"]
}

func TestDashboardIsForSignedInPeopleOnly(t *testing.T) {
	_, srv := newTestApp(t, true)
	c := noRedirect()

	// a guest is sent through sign-in and comes back to /dashboard
	res := mustGet(t, c, srv.URL+"/dashboard")
	if res.StatusCode != 302 || res.Header.Get("Location") != "/auth/sso?next=%2Fdashboard" {
		t.Fatalf("guest: %d %s", res.StatusCode, res.Header.Get("Location"))
	}
	if res.Header.Get("Cross-Origin-Embedder-Policy") != "" {
		t.Fatal("a guest gets a redirect, not the app page")
	}
	res = mustGet(t, c, srv.URL+"/auth/sso?next=%2Fdashboard")
	if loc, _ := url.Parse(res.Header.Get("Location")); loc.Path != "/sso/filehop" {
		t.Fatalf("redirect did not reach the hub: %s", loc)
	}

	// the callback with no next lands on /dashboard
	res = signIn(t, c, srv.URL, "7", "Ana", "d-1", "")
	if res.StatusCode != 303 || res.Header.Get("Location") != "/dashboard" {
		t.Fatalf("callback without next: %d %s", res.StatusCode, res.Header.Get("Location"))
	}

	// signed in: the shell with the app's own isolation headers, never cached
	res = mustGet(t, c, srv.URL+"/dashboard")
	h := res.Header
	if res.StatusCode != 200 || !strings.Contains(h.Get("Content-Type"), "text/html") ||
		h.Get("Cross-Origin-Embedder-Policy") != "require-corp" || h.Get("Cross-Origin-Opener-Policy") != "same-origin" ||
		!strings.Contains(h.Get("Content-Security-Policy"), "script-src 'self' 'wasm-unsafe-eval'") || h.Get("Cache-Control") != "no-store" {
		t.Fatalf("dashboard: %d %v", res.StatusCode, h)
	}
	if res = mustGet(t, c, srv.URL+"/dashboard/"); res.StatusCode != 301 || res.Header.Get("Location") != "/dashboard" {
		t.Fatalf("trailing slash: %d %s", res.StatusCode, res.Header.Get("Location"))
	}

	// the public page is the same for a guest as before
	if res = mustGet(t, noRedirect(), srv.URL+"/"); res.StatusCode != 200 {
		t.Fatalf("public /: %d", res.StatusCode)
	}

	// a next that leaves the site still stays on the site
	res = signIn(t, c, srv.URL, "7", "Ana", "d-2", "//evil.example.com")
	if res.Header.Get("Location") != "/" {
		t.Fatalf("hostile next: %s", res.Header.Get("Location"))
	}
}

func TestDashboardWithoutSSOGoesHome(t *testing.T) {
	_, srv := newTestApp(t, false)
	res := mustGet(t, noRedirect(), srv.URL+"/dashboard")
	if res.StatusCode != 302 || res.Header.Get("Location") != "/" {
		t.Fatalf("%d %s", res.StatusCode, res.Header.Get("Location"))
	}
}

// The owner's report: signed in as A, then B at the hub without A ever being
// signed out of FileHop, and FileHop went on showing A.
func TestNoStaleAccountAfterSwitchingAtTheHub(t *testing.T) {
	a, srv := newTestApp(t, true)
	c := noRedirect()
	signIn(t, c, srv.URL, "1", "Clowny", "s-1", "")
	if meName(t, c, srv.URL) != "Clowny" {
		t.Fatal("A should be signed in")
	}

	// (a) the hub's sign-out event does end it
	ev := []byte(`{"id":"sw-1","type":"session.revoked","data":{"sub":"1","hop_id":"1"}}`)
	if r := decode(t, signed(t, srv, "helink", "POST", "/hop/events", ev)); r["ok"] != true {
		t.Fatalf("event: %v", r)
	}
	if meName(t, c, srv.URL) != nil {
		t.Fatal("session.revoked must end A's session")
	}

	// (c) no event arrives (switched without signing out, or signed out in
	// another browser): the session ages past the window and stops counting.
	signIn(t, c, srv.URL, "1", "Clowny", "s-2", "")
	old := recheckAfter
	recheckAfter = time.Millisecond
	t.Cleanup(func() { recheckAfter = old })
	time.Sleep(5 * time.Millisecond)
	if meName(t, c, srv.URL) != nil {
		t.Fatal("a session the hub has not vouched for lately must not be shown")
	}
	res := mustGet(t, c, srv.URL+"/dashboard")
	if res.StatusCode != 302 || res.Header.Get("Location") != "/auth/sso?next=%2Fdashboard" {
		t.Fatalf("stale session on /dashboard: %d %s", res.StatusCode, res.Header.Get("Location"))
	}

	// the trip through the hub, now as B: B is shown, A's old row is gone
	recheckAfter = old
	res = signIn(t, c, srv.URL, "2", "Ana", "s-3", "/dashboard")
	if res.Header.Get("Location") != "/dashboard" || meName(t, c, srv.URL) != "Ana" {
		t.Fatalf("after the switch: %s %v", res.Header.Get("Location"), meName(t, c, srv.URL))
	}
	if n, err := a.db.DeleteSessions("1"); err != nil || n != 0 {
		t.Fatalf("A still has %d sessions (%v)", n, err)
	}
	if res = mustGet(t, c, srv.URL+"/dashboard"); res.StatusCode != 200 {
		t.Fatalf("B on /dashboard: %d", res.StatusCode)
	}
}

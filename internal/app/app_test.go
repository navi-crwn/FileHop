package app

import (
	"crypto/hmac"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"io"
	"net/http"
	"net/http/cookiejar"
	"net/http/httptest"
	"net/url"
	"strings"
	"testing"
	"testing/fstest"
	"time"

	"github.com/navi-crwn/FileHop/internal/db"
	"github.com/navi-crwn/FileHop/internal/hop"
)

const testSecret = "filehop-test-secret-that-is-long-enough-123" // test only

func newTestApp(t *testing.T, sso bool) (*App, *httptest.Server) {
	t.Helper()
	d, err := db.Open(":memory:")
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { d.Close() })
	files := fstest.MapFS{
		"index.html":                {Data: []byte("<!doctype html><title>FileHop</title>")},
		"assets/app-abc123.js":      {Data: []byte("console.log(1)")},
		"vendor/pdf.worker.min.mjs": {Data: []byte("export {}")},
	}
	cfg := Config{Version: "test", SSOClient: "filehop", HopClients: []string{"imperium", "helink"}}
	if sso {
		cfg.SSOURL = "https://hub.example.org"
		cfg.SSOSecret = testSecret
	}
	a, err := New(cfg, d, files)
	if err != nil {
		t.Fatal(err)
	}
	srv := httptest.NewServer(a.Handler())
	t.Cleanup(srv.Close)
	a.cfg.BaseURL = srv.URL
	return a, srv
}

func noRedirect() *http.Client {
	jar, _ := cookiejar.New(nil)
	return &http.Client{Jar: jar, CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }}
}

func ticket(t *testing.T, claims map[string]any) string {
	t.Helper()
	js, _ := json.Marshal(claims)
	body := base64.RawURLEncoding.EncodeToString(js)
	m := hmac.New(sha256.New, []byte(testSecret))
	m.Write([]byte(body))
	return body + "." + base64.RawURLEncoding.EncodeToString(m.Sum(nil))
}

func signed(t *testing.T, srv *httptest.Server, as, method, path string, body []byte) *http.Response {
	t.Helper()
	req, _ := http.NewRequest(method, srv.URL+path, strings.NewReader(string(body)))
	for k, v := range hop.Headers(as, testSecret, "test", method, path, body) {
		req.Header[k] = v
	}
	res, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	return res
}

func decode(t *testing.T, res *http.Response) map[string]any {
	t.Helper()
	defer res.Body.Close()
	var v map[string]any
	if err := json.NewDecoder(res.Body).Decode(&v); err != nil {
		t.Fatal(err)
	}
	return v
}

func TestStaticHeadersAndRoutes(t *testing.T) {
	_, srv := newTestApp(t, false)
	for _, tc := range []struct {
		path, cache string
		status      int
	}{
		{"/", "no-cache", 200},
		{"/send", "no-cache", 200}, // reserved for the peer-to-peer sender: gets the shell
		{"/assets/app-abc123.js", "public, max-age=31536000, immutable", 200},
		{"/vendor/pdf.worker.min.mjs", "public, max-age=31536000, immutable", 200},
		{"/missing.js", "", 404},
	} {
		res, err := http.Get(srv.URL + tc.path)
		if err != nil {
			t.Fatal(err)
		}
		res.Body.Close()
		if res.StatusCode != tc.status {
			t.Errorf("%s: status %d, want %d", tc.path, res.StatusCode, tc.status)
			continue
		}
		if tc.status != 200 {
			continue
		}
		h := res.Header
		if h.Get("Cross-Origin-Embedder-Policy") != "require-corp" || h.Get("Cross-Origin-Opener-Policy") != "same-origin" {
			t.Errorf("%s: missing isolation headers", tc.path)
		}
		if !strings.Contains(h.Get("Content-Security-Policy"), "script-src 'self' 'wasm-unsafe-eval'") {
			t.Errorf("%s: CSP %q", tc.path, h.Get("Content-Security-Policy"))
		}
		if got := h.Get("Cache-Control"); got != tc.cache {
			t.Errorf("%s: cache %q, want %q", tc.path, got, tc.cache)
		}
	}
	res, _ := http.Get(srv.URL + "/vendor/pdf.worker.min.mjs")
	if ct := res.Header.Get("Content-Type"); !strings.HasPrefix(ct, "text/javascript") {
		t.Errorf("mjs served as %q", ct)
	}
}

func TestHealthz(t *testing.T) {
	_, srv := newTestApp(t, false)
	res, _ := http.Get(srv.URL + "/healthz")
	b, _ := io.ReadAll(res.Body)
	if res.StatusCode != 200 || string(b) != "ok\n" {
		t.Fatalf("healthz: %d %q", res.StatusCode, b)
	}
}

func TestHopNeedsSSOAndSignature(t *testing.T) {
	_, off := newTestApp(t, false)
	if res := signed(t, off, "imperium", "GET", "/hop/health", nil); res.StatusCode != 404 {
		t.Errorf("sso off: %d, want 404", res.StatusCode)
	}
	_, srv := newTestApp(t, true)
	res, _ := http.Get(srv.URL + "/hop/health")
	if res.StatusCode != 401 {
		t.Errorf("unsigned: %d, want 401", res.StatusCode)
	}
	if res := signed(t, srv, "stranger", "GET", "/hop/health", nil); res.StatusCode != 401 {
		t.Errorf("unknown app: %d, want 401", res.StatusCode)
	}
	v := decode(t, signed(t, srv, "imperium", "GET", "/hop/health", nil))
	data := v["data"].(map[string]any)
	if v["ok"] != true || data["app"] != "filehop" || data["db"] != "ok" {
		t.Errorf("health: %v", v)
	}
	m := decode(t, signed(t, srv, "imperium", "GET", "/hop/manifest", nil))["data"].(map[string]any)
	if caps := m["capabilities"].([]any); len(caps) != 3 || caps[0] != "admin_api" || caps[1] != "events" {
		t.Errorf("manifest capabilities: %v", m["capabilities"])
	}
}

func TestSignInMeEventsAndLogout(t *testing.T) {
	a, srv := newTestApp(t, true)
	c := noRedirect()

	// guest
	me := decode(t, mustGet(t, c, srv.URL+"/api/v1/me"))
	if me["sso"] != true || me["signed_in"] != false {
		t.Fatalf("guest me: %v", me)
	}

	// start: cookie with state, redirect to the hub
	res := mustGet(t, c, srv.URL+"/auth/sso?next=/send")
	loc, _ := url.Parse(res.Header.Get("Location"))
	if res.StatusCode != 302 || loc.Host != "hub.example.org" || loc.Path != "/sso/filehop" {
		t.Fatalf("start: %d %s", res.StatusCode, loc)
	}
	if loc.Query().Get("return_to") != srv.URL+"/auth/sso/callback" {
		t.Fatalf("return_to: %s", loc.Query().Get("return_to"))
	}
	state := loc.Query().Get("state")
	now := time.Now().Unix()
	claims := map[string]any{"sub": "42", "aud": "filehop", "email": "ana@example.org", "name": "Ana", "status": "active",
		"state": state, "iat": now, "exp": now + 120, "jti": "t-1", "v": 2}

	// a ticket for another app is refused
	other := map[string]any{}
	for k, v := range claims {
		other[k] = v
	}
	other["aud"], other["jti"] = "notehop", "t-0"
	res = mustGet(t, c, srv.URL+"/auth/sso/callback?ticket="+url.QueryEscape(ticket(t, other)))
	if res.Header.Get("Location") != "/?auth=invalid" {
		t.Fatalf("foreign aud: %s", res.Header.Get("Location"))
	}

	// the right one signs in and lands on next
	res = mustGet(t, c, srv.URL+"/auth/sso")
	loc, _ = url.Parse(res.Header.Get("Location"))
	claims["state"] = loc.Query().Get("state")
	res = mustGet(t, c, srv.URL+"/auth/sso/callback?ticket="+url.QueryEscape(ticket(t, claims)))
	if res.StatusCode != 303 || res.Header.Get("Location") != "/" {
		t.Fatalf("callback: %d %s", res.StatusCode, res.Header.Get("Location"))
	}
	me = decode(t, mustGet(t, c, srv.URL+"/api/v1/me"))
	if me["signed_in"] != true || me["name"] != "Ana" {
		t.Fatalf("signed-in me: %v", me)
	}

	// the same ticket twice is refused
	res = mustGet(t, c, srv.URL+"/auth/sso/callback?ticket="+url.QueryEscape(ticket(t, claims)))
	if !strings.HasPrefix(res.Header.Get("Location"), "/?auth=") {
		t.Fatalf("replayed ticket: %s", res.Header.Get("Location"))
	}

	// Imperium sees the account
	u := decode(t, signed(t, srv, "imperium", "GET", "/hop/users/42", nil))
	if u["data"].(map[string]any)["email"] != "ana@example.org" {
		t.Fatalf("hop user: %v", u)
	}

	// the hub revokes sessions: signed out here
	ev := []byte(`{"id":"ev-1","type":"session.revoked","data":{"sub":"42"}}`)
	r := decode(t, signed(t, srv, "helink", "POST", "/hop/events", ev))
	if r["ok"] != true {
		t.Fatalf("event: %v", r)
	}
	if me = decode(t, mustGet(t, c, srv.URL+"/api/v1/me")); me["signed_in"] != false {
		t.Fatalf("after session.revoked: %v", me)
	}
	if r = decode(t, signed(t, srv, "helink", "POST", "/hop/events", ev)); r["data"].(map[string]any)["duplicate"] != true {
		t.Fatalf("duplicate event: %v", r)
	}

	// suspension blocks the next sign-in
	decode(t, signed(t, srv, "helink", "POST", "/hop/events", []byte(`{"id":"ev-2","type":"account.status","data":{"sub":"42","status":"suspended"}}`)))
	res = mustGet(t, c, srv.URL+"/auth/sso")
	loc, _ = url.Parse(res.Header.Get("Location"))
	claims["state"], claims["jti"] = loc.Query().Get("state"), "t-2"
	res = mustGet(t, c, srv.URL+"/auth/sso/callback?ticket="+url.QueryEscape(ticket(t, claims)))
	if res.Header.Get("Location") != "/?auth=suspended" {
		t.Fatalf("suspended sign-in: %s", res.Header.Get("Location"))
	}

	// deletion removes the row
	decode(t, signed(t, srv, "helink", "POST", "/hop/events", []byte(`{"id":"ev-3","type":"account.deleted","data":{"sub":"42"}}`)))
	if _, err := a.db.UserBySub("42"); err != db.ErrNotFound {
		t.Fatalf("after account.deleted: %v", err)
	}

	// chained logout only follows family URLs
	res = mustGet(t, c, srv.URL+"/auth/sso/logout?next="+url.QueryEscape("https://hub.example.org/logout/next"))
	if res.Header.Get("Location") != "https://hub.example.org/logout/next" {
		t.Errorf("family next: %s", res.Header.Get("Location"))
	}
	res = mustGet(t, c, srv.URL+"/auth/sso/logout?next="+url.QueryEscape("https://evil.example.com/"))
	if res.Header.Get("Location") != "/" {
		t.Errorf("foreign next: %s", res.Header.Get("Location"))
	}
}

func mustGet(t *testing.T, c *http.Client, u string) *http.Response {
	t.Helper()
	res, err := c.Get(u)
	if err != nil {
		t.Fatal(err)
	}
	return res
}

func TestSafeNextAndFamilyURL(t *testing.T) {
	for in, want := range map[string]string{"/send": "/send", "//evil.com": "/", "/\t/evil.com": "/", "https://x": "/", `/\evil`: "/"} {
		if got := safeNext(in); got != want {
			t.Errorf("safeNext(%q) = %q, want %q", in, got, want)
		}
	}
	cases := []struct {
		u, sso string
		ok     bool
	}{
		{"https://hel.ink/", "https://hub.hel.ink", true},
		{"https://note.hel.ink/auth/sso/logout", "https://hub.hel.ink", true},
		{"http://hel.ink/", "https://hub.hel.ink", false},
		{"https://hel.ink.evil.com/", "https://hub.hel.ink", false},
		{"http://localhost:8097/logout/done", "http://localhost:8097", true},
		{"http://localhost:8097/", "https://hub.hel.ink", false},
	}
	for _, c := range cases {
		if got := familyURL(c.u, c.sso); got != c.ok {
			t.Errorf("familyURL(%q, %q) = %v", c.u, c.sso, got)
		}
	}
}

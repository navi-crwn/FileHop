package app

import (
	"crypto/hmac"
	"crypto/sha256"
	"net/http"
	"strconv"
	"strings"
	"testing"
	"time"

	"github.com/navi-crwn/FileHop/internal/db"
	"github.com/navi-crwn/FileHop/internal/hop"
)

// Who may run POST /hop/users/{sub}/actions: only a registered caller
// (imperium, helink) holding the registry secret, with a fresh, unused,
// untampered signature, while sign-in is configured. Everyone else (guest,
// signed-in member, wrong secret, stale or replayed request) is refused
// before the handler runs and nothing changes.

func seedUserWithSessions(t *testing.T, a *App, sub string, n int) {
	t.Helper()
	u, err := a.db.UpsertUser(sub, sub+"@example.org", "User "+sub)
	if err != nil {
		t.Fatal(err)
	}
	for i := 0; i < n; i++ {
		if err := a.db.CreateSession(sub+"-s"+strconv.Itoa(i), u.ID, time.Hour); err != nil {
			t.Fatal(err)
		}
	}
}

func alive(a *App, hash string) bool {
	_, err := a.db.UserBySession(hash)
	return err == nil
}

// rawSigned signs signBody but sends sendBody, so a test can tamper, age or
// replay a request.
func rawSigned(t *testing.T, srvURL, as, secret, ts, nonce, path, signPath string, signBody, sendBody []byte) *http.Response {
	t.Helper()
	req, _ := http.NewRequest("POST", srvURL+path, strings.NewReader(string(sendBody)))
	m := hmac.New(sha256.New, []byte(secret))
	m.Write([]byte(hop.StringToSign(as, ts, nonce, "POST", signPath, signBody)))
	req.Header.Set("X-HOP-App", as)
	req.Header.Set("X-HOP-Timestamp", ts)
	req.Header.Set("X-HOP-Nonce", nonce)
	req.Header.Set("X-HOP-Actor", "test")
	req.Header.Set("X-HOP-Signature", hop.B64(m.Sum(nil)))
	res, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	return res
}

func TestHopRevokeSessionsEndsOnlyThatAccountsSessions(t *testing.T) {
	a, srv := newTestApp(t, true)
	seedUserWithSessions(t, a, "7", 2)
	seedUserWithSessions(t, a, "8", 1)
	body := []byte(`{"action":"revoke_sessions","reason":"stolen laptop"}`)
	res := signed(t, srv, "imperium", "POST", "/hop/users/7/actions", body)
	if res.StatusCode != 200 {
		t.Fatalf("status %d", res.StatusCode)
	}
	v := decode(t, res)
	d, _ := v["data"].(map[string]any)
	if v["ok"] != true || d["revoked"] != true || d["sessions"] != float64(2) {
		t.Fatalf("body: %v", v)
	}
	if alive(a, "7-s0") || alive(a, "7-s1") {
		t.Fatal("the account's sessions are still alive")
	}
	if !alive(a, "8-s0") {
		t.Fatal("another account lost its session")
	}
	u, err := a.db.UserBySub("7")
	if err != nil || u.Status != db.StatusActive {
		t.Fatalf("the account itself must be untouched: %v %v", u, err)
	}
	// the hub may call it too, and it is fine with no sessions left
	res = signed(t, srv, "helink", "POST", "/hop/users/7/actions", body)
	if res.StatusCode != 200 || decode(t, res)["data"].(map[string]any)["sessions"] != float64(0) {
		t.Fatalf("second call: %d", res.StatusCode)
	}
}

func TestHopEveryAdvertisedUserActionHasARoute(t *testing.T) {
	a, srv := newTestApp(t, true)
	seedUserWithSessions(t, a, "7", 1)
	m := decode(t, signed(t, srv, "imperium", "GET", "/hop/manifest", nil))["data"].(map[string]any)
	list := m["actions"].(map[string]any)["user"].([]any)
	if len(list) == 0 {
		t.Fatal("the manifest lists no user action")
	}
	for _, act := range list {
		res := signed(t, srv, "imperium", "POST", "/hop/users/7/actions", []byte(`{"action":"`+act.(string)+`"}`))
		if res.StatusCode/100 != 2 {
			t.Errorf("advertised action %v answers %d", act, res.StatusCode)
		}
	}
}

func TestHopUserActionRefusals(t *testing.T) {
	body := []byte(`{"action":"revoke_sessions"}`)
	const path = "/hop/users/7/actions"
	now := time.Now().Unix()
	fresh := func() string { return strconv.FormatInt(time.Now().Unix(), 10) }
	nonce := func(s string) string { return "nonce-" + s + "-0123456789abcdef" }
	cases := []struct {
		name string
		do   func(t *testing.T, srv string) *http.Response
		code string
	}{
		{"no signature (guest)", func(t *testing.T, srv string) *http.Response {
			res, err := http.Post(srv+path, "application/json", strings.NewReader(string(body)))
			if err != nil {
				t.Fatal(err)
			}
			return res
		}, ""},
		{"member cookie is no credential", func(t *testing.T, srv string) *http.Response {
			req, _ := http.NewRequest("POST", srv+path, strings.NewReader(string(body)))
			req.AddCookie(&http.Cookie{Name: "filehop_session", Value: "7-s0"})
			res, err := http.DefaultClient.Do(req)
			if err != nil {
				t.Fatal(err)
			}
			return res
		}, ""},
		{"caller not registered", func(t *testing.T, srv string) *http.Response {
			return rawSigned(t, srv, "stranger", testSecret, fresh(), nonce("a"), path, path, body, body)
		}, ""},
		{"wrong secret", func(t *testing.T, srv string) *http.Response {
			return rawSigned(t, srv, "imperium", "not-the-secret-not-the-secret-0000", fresh(), nonce("b"), path, path, body, body)
		}, "bad_signature"},
		{"stale timestamp", func(t *testing.T, srv string) *http.Response {
			return rawSigned(t, srv, "imperium", testSecret, strconv.FormatInt(now-600, 10), nonce("c"), path, path, body, body)
		}, "stale_request"},
		{"body changed after signing", func(t *testing.T, srv string) *http.Response {
			return rawSigned(t, srv, "imperium", testSecret, fresh(), nonce("d"), path, path, body, []byte(`{"action":"revoke_sessions","x":1}`))
		}, "bad_signature"},
		{"signed for another account", func(t *testing.T, srv string) *http.Response {
			return rawSigned(t, srv, "imperium", testSecret, fresh(), nonce("e"), path, "/hop/users/8/actions", body, body)
		}, "bad_signature"},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			a, srv := newTestApp(t, true)
			seedUserWithSessions(t, a, "7", 1)
			res := tc.do(t, srv.URL)
			if res.StatusCode != 401 {
				t.Fatalf("status %d, want 401", res.StatusCode)
			}
			if tc.code != "" && decode(t, res)["error"] != tc.code {
				t.Fatalf("error code, want %s", tc.code)
			}
			if !alive(a, "7-s0") {
				t.Fatal("a refused call ended a session")
			}
		})
	}

	t.Run("replayed request", func(t *testing.T) {
		a, srv := newTestApp(t, true)
		seedUserWithSessions(t, a, "7", 1)
		ts, n := fresh(), nonce("r")
		if res := rawSigned(t, srv.URL, "imperium", testSecret, ts, n, path, path, body, body); res.StatusCode != 200 {
			t.Fatalf("first: %d", res.StatusCode)
		}
		seedUserWithSessions(t, a, "7", 1) // 7-s0 again, after the first call
		if res := rawSigned(t, srv.URL, "imperium", testSecret, ts, n, path, path, body, body); res.StatusCode != 401 {
			t.Fatalf("replay: %d, want 401", res.StatusCode)
		}
		if !alive(a, "7-s0") {
			t.Fatal("the replay ended a session")
		}
	})

	t.Run("sign-in not configured", func(t *testing.T) {
		a, srv := newTestApp(t, false)
		seedUserWithSessions(t, a, "7", 1)
		if res := signed(t, srv, "imperium", "POST", path, body); res.StatusCode != 404 {
			t.Fatalf("status %d, want 404", res.StatusCode)
		}
		if !alive(a, "7-s0") {
			t.Fatal("session ended while sign-in is off")
		}
	})

	t.Run("unknown account", func(t *testing.T) {
		a, srv := newTestApp(t, true)
		seedUserWithSessions(t, a, "7", 1)
		res := signed(t, srv, "imperium", "POST", "/hop/users/999/actions", body)
		if res.StatusCode != 404 || decode(t, res)["error"] != "not_found" {
			t.Fatalf("status %d", res.StatusCode)
		}
		if !alive(a, "7-s0") {
			t.Fatal("another account lost its session")
		}
	})

	for name, b := range map[string]string{
		"unknown action": `{"action":"delete"}`,
		"no action":      `{}`,
		"not json":       `revoke_sessions`,
		"empty body":     ``,
	} {
		t.Run(name, func(t *testing.T) {
			a, srv := newTestApp(t, true)
			seedUserWithSessions(t, a, "7", 1)
			res := signed(t, srv, "imperium", "POST", path, []byte(b))
			if res.StatusCode != 400 {
				t.Fatalf("status %d, want 400", res.StatusCode)
			}
			if !alive(a, "7-s0") {
				t.Fatal("a refused call ended a session")
			}
			if u, _ := a.db.UserBySub("7"); u == nil || u.Status != db.StatusActive {
				t.Fatal("account changed")
			}
		})
	}

	t.Run("wrong method", func(t *testing.T) {
		a, srv := newTestApp(t, true)
		seedUserWithSessions(t, a, "7", 1)
		res := signed(t, srv, "imperium", "PUT", path, body)
		if res.StatusCode/100 == 2 || !alive(a, "7-s0") {
			t.Fatalf("status %d", res.StatusCode)
		}
	})
}

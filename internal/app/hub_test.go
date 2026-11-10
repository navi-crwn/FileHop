package app

import (
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"sync/atomic"
	"testing"
	"time"
)

// Family rule: with the hub unreachable the app's own session stays trusted. A stale session is still
// "signed in" (no redirect, no guest, no error page) and /dashboard opens with it; only someone with no
// session at all is told the hub is down. When the hub is back the quiet re-check is offered again.
func TestHubDownKeepsTheExistingSession(t *testing.T) {
	a, srv := newTestApp(t, true)
	c := noRedirect()
	signIn(t, c, srv.URL, "1", "Ana", "h-1", "")
	restore := goStale(t)
	defer restore()

	a.hubUp = func() bool { return false }
	me := decode(t, mustGet(t, c, srv.URL+"/api/v1/me"))
	if me["signed_in"] != true || me["stale"] == true || me["name"] != "Ana" {
		t.Fatalf("hub down, stale session must stay signed in: %v", me)
	}
	for _, path := range []string{"/dashboard", "/dashboard?_rc=1"} {
		if res := mustGet(t, c, srv.URL+path); res.StatusCode != 200 {
			t.Fatalf("%s with the hub down: %d %s", path, res.StatusCode, res.Header.Get("Location"))
		}
	}
	if res := mustGet(t, noRedirect(), srv.URL+"/dashboard"); res.Header.Get("Location") != "/?auth=hub" {
		t.Fatalf("guest on /dashboard with the hub down: %s", res.Header.Get("Location"))
	}

	// back up: the session is stale again, so the quiet re-check is offered
	a.hubUp = func() bool { return true }
	if me = decode(t, mustGet(t, c, srv.URL+"/api/v1/me")); me["stale"] != true || me["signed_in"] == true {
		t.Fatalf("hub up again: %v", me)
	}
	if res := mustGet(t, c, srv.URL+"/dashboard"); res.StatusCode != 302 || !strings.Contains(res.Header.Get("Location"), "prompt=none") {
		t.Fatalf("hub up again, /dashboard: %d %s", res.StatusCode, res.Header.Get("Location"))
	}
}

// The probe is GET <hub>/up: only a 2xx is "up"; 502, a timeout and a closed port are "down"; the answer
// is cached for a minute and the probe recovers on the next check after that.
func TestHubProbeUpIsA2xxFromSlashUp(t *testing.T) {
	var hits atomic.Int32
	var status atomic.Int32
	status.Store(200)
	var slow atomic.Bool
	var path atomic.Value
	hub := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		hits.Add(1)
		path.Store(r.Method + " " + r.URL.Path)
		if slow.Load() {
			time.Sleep(300 * time.Millisecond)
		}
		w.WriteHeader(int(status.Load()))
	}))
	defer hub.Close()
	p := newHubProbe(hub.URL)
	p.client.Timeout = 100 * time.Millisecond
	if !p.Up() || !p.Up() || hits.Load() != 1 || path.Load() != "GET /up" {
		t.Fatalf("up, cached: hits=%d %v", hits.Load(), path.Load())
	}
	expire := func() { p.at = time.Now().Add(-2 * hubProbeTTL) }

	expire()
	status.Store(502)
	if p.Up() {
		t.Fatal("a 502 hub is not up")
	}
	if p.Up() || hits.Load() != 2 {
		t.Fatalf("down answer is cached too: hits=%d", hits.Load())
	}
	expire()
	status.Store(301)
	if p.Up() {
		t.Fatal("a redirect is not a 2xx")
	}
	expire()
	status.Store(200)
	slow.Store(true)
	if p.Up() {
		t.Fatal("a hub slower than the timeout is not up")
	}
	expire()
	slow.Store(false)
	if !p.Up() {
		t.Fatal("recovers once the hub answers 2xx again")
	}
	hub.Close()
	expire()
	if p.Up() {
		t.Fatal("a closed hub is not reachable")
	}
}

// The home page must not run the quiet re-check (a location.replace that drops the queue) while
// files are queued or a conversion runs. The page is a Svelte component with no DOM test library
// here, so this reads the guard from the source; tools/browser checks cover the behaviour.
func TestHomePageSkipsTheRecheckWhileWorkIsQueued(t *testing.T) {
	b, err := os.ReadFile("../../web/src/App.svelte")
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(string(b), "account.stale && queue.jobs.length === 0 && !running) recheckQuietly('/')") {
		t.Fatal("recheckQuietly must be guarded by an empty queue and no running job")
	}
}

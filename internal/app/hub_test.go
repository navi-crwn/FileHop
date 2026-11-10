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

// With the hub down, a stale session is answered as a guest (no stale flag, so the page never
// goes to the hub) and /dashboard says so instead of redirecting there.
func TestHubDownNeverSendsTheBrowserThere(t *testing.T) {
	a, srv := newTestApp(t, true)
	c := noRedirect()
	signIn(t, c, srv.URL, "1", "Ana", "h-1", "")
	restore := goStale(t)
	defer restore()

	a.hubUp = func() bool { return false }
	me := decode(t, mustGet(t, c, srv.URL+"/api/v1/me"))
	if me["signed_in"] != false || me["stale"] == true {
		t.Fatalf("hub down, stale session: %v", me)
	}
	for _, path := range []string{"/dashboard", "/dashboard?_rc=1"} {
		res := mustGet(t, c, srv.URL+path)
		if res.StatusCode != 302 || res.Header.Get("Location") != "/?auth=hub" {
			t.Fatalf("%s: %d %s", path, res.StatusCode, res.Header.Get("Location"))
		}
	}
	if res := mustGet(t, noRedirect(), srv.URL+"/dashboard"); res.Header.Get("Location") != "/?auth=hub" {
		t.Fatalf("guest on /dashboard with the hub down: %s", res.Header.Get("Location"))
	}

	// back up: the quiet re-check is offered again
	a.hubUp = func() bool { return true }
	if me = decode(t, mustGet(t, c, srv.URL+"/api/v1/me")); me["stale"] != true {
		t.Fatalf("hub up again: %v", me)
	}
}

func TestHubProbeCachesAndTreatsErrorsAsDown(t *testing.T) {
	var hits atomic.Int32
	status := 200
	hub := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { hits.Add(1); w.WriteHeader(status) }))
	p := newHubProbe(hub.URL)
	if !p.Up() || !p.Up() || hits.Load() != 1 {
		t.Fatalf("up, cached: hits=%d", hits.Load())
	}
	p.at = time.Now().Add(-2 * hubProbeTTL) // expire the cache
	status = 503
	if p.Up() {
		t.Fatal("a 5xx hub is not reachable")
	}
	hub.Close()
	p.at = time.Time{}
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

package app

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"sync/atomic"
	"testing"
	"time"
)

// A hub stand-in that serves /announcements.json and counts the requests.
type fakeHub struct {
	srv   *httptest.Server
	body  atomic.Value // string
	code  atomic.Int32
	delay atomic.Int64 // ms
	hits  atomic.Int32
	query atomic.Value // string
	hasCk atomic.Bool
}

func newFakeHub(t *testing.T, body string) *fakeHub {
	t.Helper()
	h := &fakeHub{}
	h.body.Store(body)
	h.code.Store(200)
	h.srv = httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		h.hits.Add(1)
		h.query.Store(r.URL.Path + "?" + r.URL.RawQuery)
		h.hasCk.Store(r.Header.Get("Cookie") != "" || r.Header.Get("Authorization") != "")
		time.Sleep(time.Duration(h.delay.Load()) * time.Millisecond)
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(int(h.code.Load()))
		w.Write([]byte(h.body.Load().(string)))
	}))
	t.Cleanup(h.srv.Close)
	return h
}

const hubDoc = `{"version":1,"generated_at":"2026-11-14T10:00:00Z","items":[
 {"id":"12","level":"info","title":"Scheduled maintenance","body":"Sunday 02:00 UTC.","url":"http://%HOST%/announcements/12","apps":["*"]}]}`

// signedInWithHub builds an app whose announcements come from hub and signs Ana in.
func signedInWithHub(t *testing.T, hub *fakeHub) (*App, *http.Client, string) {
	t.Helper()
	a, srv := newTestApp(t, true)
	a.ann = newAnnSource(hub.srv.URL)
	c := noRedirect()
	signIn(t, c, srv.URL, "1", "Ana", "ann-1", "")
	return a, c, srv.URL
}

func items(t *testing.T, c *http.Client, base string) []any {
	t.Helper()
	me := decode(t, mustGet(t, c, base+"/api/v1/me"))
	if me["signed_in"] != true {
		t.Fatalf("not signed in: %v", me)
	}
	l, _ := me["announcements"].([]any)
	return l
}

func doc(hub *fakeHub, s string) string {
	return strings.ReplaceAll(s, "%HOST%", strings.TrimPrefix(hub.srv.URL, "http://"))
}

// L-1 (a): a live item shows for a member, asked for the right app, with no cookie sent to the hub.
func TestAnnouncementReachesAMember(t *testing.T) {
	hub := newFakeHub(t, "")
	hub.body.Store(doc(hub, hubDoc))
	a, c, base := signedInWithHub(t, hub)
	a.ann.Refresh()
	l := items(t, c, base)
	if len(l) != 1 {
		t.Fatalf("items: %v", l)
	}
	it := l[0].(map[string]any)
	if it["id"] != "12" || it["title"] != "Scheduled maintenance" || it["body"] != "Sunday 02:00 UTC." || it["closable"] != true || it["level"] != "info" {
		t.Fatalf("item: %v", it)
	}
	if it["url"] != hub.srv.URL+"/announcements/12" {
		t.Fatalf("url: %v", it["url"])
	}
	if q := hub.query.Load().(string); q != "/announcements.json?app=filehop" {
		t.Fatalf("asked the hub for %q", q)
	}
	if hub.hasCk.Load() {
		t.Fatal("a cookie or credential went to the hub")
	}
}

// Guests never get the card; neither does a stale session that is only being re-checked.
func TestAnnouncementIsForSignedInMembersOnly(t *testing.T) {
	hub := newFakeHub(t, "")
	hub.body.Store(doc(hub, hubDoc))
	a, srv := newTestApp(t, true)
	a.ann = newAnnSource(hub.srv.URL)
	a.ann.Refresh()
	me := decode(t, mustGet(t, noRedirect(), srv.URL+"/api/v1/me"))
	if _, has := me["announcements"]; has {
		t.Fatalf("a guest got announcements: %v", me)
	}
}

// L-1 (b): a dead, slow or broken hub costs the page nothing and breaks nothing.
func TestAnnouncementHubDownOrSlowNeverSlowsOrBreaksTheDashboard(t *testing.T) {
	hub := newFakeHub(t, "")
	hub.body.Store(doc(hub, hubDoc))
	hub.delay.Store(3000) // longer than the 2 s limit
	_, c, base := signedInWithHub(t, hub)
	start := time.Now()
	for i := 0; i < 3; i++ {
		if l := items(t, c, base); len(l) != 0 {
			t.Fatalf("items from a hub that has not answered: %v", l)
		}
	}
	if d := time.Since(start); d > 800*time.Millisecond {
		t.Fatalf("/api/v1/me waited on the hub: %v", d)
	}
	if res := mustGet(t, c, base+"/dashboard"); res.StatusCode != 200 {
		t.Fatalf("/dashboard: %d", res.StatusCode)
	}
	// the one background request gives up on its own within the limit
	t0 := time.Now()
	hub2 := newFakeHub(t, "")
	hub2.delay.Store(3000)
	s := newAnnSource(hub2.srv.URL)
	if got, ok := s.fetch(); ok || got != nil || time.Since(t0) > 2500*time.Millisecond {
		t.Fatalf("slow hub: ok=%v items=%v after %v", ok, got, time.Since(t0))
	}

	// a hub that is gone, 500, 404 or sends junk: no card, no error
	for name, set := range map[string]func(h *fakeHub){
		"500":  func(h *fakeHub) { h.code.Store(500) },
		"404":  func(h *fakeHub) { h.code.Store(404) },
		"junk": func(h *fakeHub) { h.body.Store("<html>nope"); h.code.Store(200) },
	} {
		h := newFakeHub(t, doc(hub, hubDoc))
		set(h)
		src := newAnnSource(h.srv.URL)
		src.Refresh()
		if got := src.Items(); len(got) != 0 {
			t.Errorf("%s: %v", name, got)
		}
	}
	gone := newFakeHub(t, "")
	url := gone.srv.URL
	gone.srv.Close()
	src := newAnnSource(url)
	src.Refresh()
	if got := src.Items(); len(got) != 0 {
		t.Errorf("hub gone: %v", got)
	}
}

// The last good copy survives a hub that goes down later.
func TestAnnouncementKeepsTheLastGoodCopy(t *testing.T) {
	hub := newFakeHub(t, "")
	hub.body.Store(doc(hub, hubDoc))
	src := newAnnSource(hub.srv.URL)
	src.Refresh()
	hub.code.Store(503)
	src.Refresh()
	if got := src.Items(); len(got) != 1 {
		t.Fatalf("lost the copy: %v", got)
	}
	// ...and an empty answer from a healthy hub does clear it (the notice ended)
	hub.code.Store(200)
	hub.body.Store(`{"version":1,"items":[]}`)
	src.Refresh()
	if got := src.Items(); len(got) != 0 {
		t.Fatalf("ended notice still shown: %v", got)
	}
}

// The copy is kept five minutes: many page loads, one request.
func TestAnnouncementIsCachedAndFetchedInTheBackground(t *testing.T) {
	hub := newFakeHub(t, "")
	hub.body.Store(doc(hub, hubDoc))
	src := newAnnSource(hub.srv.URL)
	src.Items() // starts the background fetch, answers at once
	deadline := time.Now().Add(3 * time.Second)
	for len(src.Items()) == 0 && time.Now().Before(deadline) {
		time.Sleep(10 * time.Millisecond)
	}
	if len(src.Items()) != 1 {
		t.Fatal("background fetch never landed")
	}
	for i := 0; i < 20; i++ {
		src.Items()
	}
	if n := hub.hits.Load(); n != 1 {
		t.Fatalf("hub asked %d times, want 1", n)
	}
}

// L-1 (f): with no hub address (stand-alone install) nothing is asked, nobody sees a card.
func TestAnnouncementWithoutAHubAsksNothing(t *testing.T) {
	hub := newFakeHub(t, "")
	hub.body.Store(doc(hub, hubDoc))
	if got := newAnnSource("").Items(); got != nil {
		t.Fatalf("items: %v", got)
	}
	var none *annSource
	if none.Items() != nil {
		t.Fatal("nil source")
	}
	a, srv := newTestApp(t, false) // sign-in (and so the hub) is not configured
	a.cfg.SSOURL = ""
	a2, _ := New(a.cfg, a.db, a.static)
	if a2.ann != nil {
		t.Fatal("an app with no hub built a source")
	}
	a2.WarmAnnouncements()
	_ = srv
	time.Sleep(100 * time.Millisecond)
	if hub.hits.Load() != 0 {
		t.Fatal("a request went out")
	}
}

// L-1 (c)(e) and the safety rules: a critical notice cannot be closed and comes first, text is plain and
// cut to length, a link off the family is dropped, a notice for another app is ignored, and at most five go out.
func TestAnnouncementShapeAndSafety(t *testing.T) {
	long := strings.Repeat("é", 400)
	hub := newFakeHub(t, "")
	hub.body.Store(doc(hub, `{"version":1,"items":[
 {"id":"1","level":"info","title":"<b>First</b>","body":"<img src=x onerror=alert(1)> `+long+`","url":"https://evil.example.com/x","apps":["*"]},
 {"id":2,"level":"critical","title":"Outage","body":"Down.","url":"http://%HOST%/announcements/2","apps":["filehop"]},
 {"id":"3","level":"warning","title":"Other app only","body":"x","apps":["payhop"]},
 {"id":"4","level":"shout","title":"Odd level","body":"x","apps":["*"]},
 {"id":"5","level":"info","title":"","body":"no title","apps":["*"]},
 {"id":"6","level":"info","title":"six","body":"","apps":["*"]},
 {"id":"7","level":"info","title":"seven","body":"","apps":["*"]},
 {"id":"8","level":"info","title":"eight","body":"","apps":["*"]},
 {"id":"9","level":"info","title":"nine","body":"","apps":["*"]}]}`))
	src := newAnnSource(hub.srv.URL)
	src.Refresh()
	got := src.Items()
	if len(got) != 5 {
		t.Fatalf("%d items, want 5: %v", len(got), got)
	}
	if got[0].ID != "2" || got[0].Level != "critical" || got[0].Closable {
		t.Fatalf("critical must come first and cannot be closed: %+v", got[0])
	}
	var first annItem
	for _, it := range got {
		if it.ID == "3" || it.ID == "5" {
			t.Fatalf("kept %s (other app / no title)", it.ID)
		}
		if it.ID == "1" {
			first = it
		}
		if it.ID == "4" && it.Level != "info" {
			t.Fatalf("odd level %q not turned into info", it.Level)
		}
	}
	if first.Title != "<b>First</b>" || !strings.HasPrefix(first.Body, "<img") {
		t.Fatalf("text must stay as the hub sent it (the page escapes it): %+v", first)
	}
	if n := len([]rune(first.Body)); n != annBody {
		t.Fatalf("body is %d characters, want %d", n, annBody)
	}
	if first.URL != "" {
		t.Fatalf("a link off the family was kept: %s", first.URL)
	}
	if got[0].URL == "" {
		t.Fatal("a family link was dropped")
	}
}

package app

import (
	"bytes"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/navi-crwn/FileHop/internal/hop"
)

const pixelSecret = "pixelhop-store-secret-that-is-long-enough-1" // test only

var tinyPNG = append([]byte("\x89PNG\r\n\x1a\n"), bytes.Repeat([]byte{7}, 64)...)

// fakePixel stands in for PixelHop's POST /hop/media: it verifies the signature the way PixelHop does
// and answers with whatever the test set.
type fakePixel struct {
	mu     sync.Mutex
	nonces hop.Nonces
	calls  int
	actor  string
	path   string
	body   []byte
	status int
	reply  string
	srv    *httptest.Server
}

func newFakePixel(t *testing.T) *fakePixel {
	f := &fakePixel{status: 201}
	f.srv = httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		body, _ := io.ReadAll(r.Body)
		f.mu.Lock()
		defer f.mu.Unlock()
		f.calls++
		if err := f.nonces.Verify(r, body, "filehop", []string{pixelSecret}, 120*time.Second); err != nil {
			w.WriteHeader(401)
			io.WriteString(w, `{"ok":false,"error":"bad_signature","message":"raw upstream text"}`)
			return
		}
		f.actor, f.path, f.body = r.Header.Get("X-HOP-Actor"), r.URL.RequestURI(), body
		w.WriteHeader(f.status)
		io.WriteString(w, f.reply)
	}))
	t.Cleanup(f.srv.Close)
	return f
}

func okReply(base string) string {
	return `{"ok":true,"data":{"id":"x","url":"` + base + `/i/x.png","page_url":"` + base + `/x","thumb_url":"` + base + `/t/x.jpg","bytes":71,"duplicate":false}}`
}

func pixelApp(t *testing.T) (*App, *httptest.Server, *fakePixel, *http.Client) {
	pixelRetryPause = time.Millisecond
	a, srv := newTestApp(t, true)
	f := newFakePixel(t)
	a.cfg.PixelHopURL, a.cfg.PixelHopSecret = f.srv.URL, pixelSecret
	f.reply = okReply(f.srv.URL)
	c := noRedirect()
	signIn(t, c, srv.URL, "101", "Ana", "px-1", "")
	return a, srv, f, c
}

func save(t *testing.T, c *http.Client, srv *httptest.Server, body []byte, q string, hdr map[string]string) (int, map[string]any) {
	t.Helper()
	req, _ := http.NewRequest("POST", srv.URL+"/api/v1/pixelhop/save"+q, bytes.NewReader(body))
	req.Header.Set("X-Requested-With", "filehop")
	for k, v := range hdr {
		if v == "" {
			req.Header.Del(k)
		} else {
			req.Header.Set(k, v)
		}
	}
	res, err := c.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	defer res.Body.Close()
	var m map[string]any
	json.NewDecoder(res.Body).Decode(&m)
	return res.StatusCode, m
}

func TestPixelSaveForwardsSignedAsTheMember(t *testing.T) {
	_, srv, f, c := pixelApp(t)
	code, m := save(t, c, srv, tinyPNG, "", map[string]string{"X-FileHop-Name": "holiday%20%C3%A9.png"})
	if code != 200 || m["ok"] != true || !strings.HasPrefix(m["page_url"].(string), f.srv.URL) {
		t.Fatalf("save: %d %v", code, m)
	}
	if f.calls != 1 || f.actor != "101" || f.path != "/hop/media?name=holiday+%C3%A9.png" || !bytes.Equal(f.body, tinyPNG) {
		t.Fatalf("what PixelHop received: calls=%d actor=%q path=%q body ok=%v", f.calls, f.actor, f.path, bytes.Equal(f.body, tinyPNG))
	}
	// a second call uses a new nonce, so PixelHop's replay check does not trip
	if code, _ := save(t, c, srv, tinyPNG, "", nil); code != 200 {
		t.Fatalf("second call: %d", code)
	}
}

func TestPixelSaveIsOffWithoutTheSecret(t *testing.T) {
	a, srv, f, c := pixelApp(t)
	a.cfg.PixelHopSecret = ""
	if code, _ := save(t, c, srv, tinyPNG, "", nil); code != 404 || f.calls != 0 {
		t.Fatalf("not configured must be 404 and call nothing: %d %d", code, f.calls)
	}
	a.cfg.PixelHopSecret = testSecret // the SSO secret must never be accepted as the store secret
	if code, _ := save(t, c, srv, tinyPNG, "", nil); code != 404 {
		t.Fatalf("the SSO secret must not enable it: %d", code)
	}
	if me := decode(t, mustGet(t, c, srv.URL+"/api/v1/me")); me["pixelhop"] != nil {
		t.Fatalf("/me must not advertise it: %v", me)
	}
}

func TestPixelSaveAdvertisedToSignedInPeopleOnly(t *testing.T) {
	_, srv, f, c := pixelApp(t)
	me := decode(t, mustGet(t, c, srv.URL+"/api/v1/me"))
	px, _ := me["pixelhop"].(map[string]any)
	if px == nil || px["url"] != f.srv.URL || px["max"] != float64(pixelDefaultMax) {
		t.Fatalf("me: %v", me)
	}
	if guest := decode(t, mustGet(t, noRedirect(), srv.URL+"/api/v1/me")); guest["pixelhop"] != nil {
		t.Fatalf("a guest must not see it: %v", guest)
	}
}

func TestPixelSaveNeedsASignedInSessionAndASameOriginCall(t *testing.T) {
	_, srv, f, c := pixelApp(t)
	if code, m := save(t, noRedirect(), srv, tinyPNG, "", nil); code != 401 || m["error"] != "not_signed_in" {
		t.Fatalf("guest: %d %v", code, m)
	}
	for name, h := range map[string]map[string]string{
		"no custom header":    {"X-Requested-With": ""},
		"cross-site fetch":    {"Sec-Fetch-Site": "cross-site"},
		"foreign origin":      {"Origin": "https://evil.example"},
		"same-site (sibling)": {"Sec-Fetch-Site": "same-site"},
	} {
		if code, m := save(t, c, srv, tinyPNG, "", h); code != 403 || m["error"] != "csrf" {
			t.Fatalf("%s: %d %v", name, code, m)
		}
	}
	if f.calls != 0 {
		t.Fatalf("nothing may be forwarded, got %d calls", f.calls)
	}
	if code, _ := save(t, c, srv, tinyPNG, "", map[string]string{"Sec-Fetch-Site": "same-origin", "Origin": srv.URL}); code != 200 {
		t.Fatalf("a real same-origin call: %d", code)
	}
}

func TestPixelSaveRefusesBigAndWrongTypesBeforeForwarding(t *testing.T) {
	a, srv, f, c := pixelApp(t)
	a.cfg.PixelHopMaxBytes = 1024
	if code, m := save(t, c, srv, append(tinyPNG[:8:8], make([]byte, 2000)...), "", nil); code != 413 || m["error"] != "too_large" {
		t.Fatalf("too large by Content-Length: %d %v", code, m)
	}
	// no Content-Length (chunked): the cap is enforced while reading
	req, _ := http.NewRequest("POST", srv.URL+"/api/v1/pixelhop/save", io.NopCloser(bytes.NewReader(append(tinyPNG[:8:8], make([]byte, 3000)...))))
	req.Header.Set("X-Requested-With", "filehop")
	res, err := c.Do(req)
	if err != nil || res.StatusCode != 413 {
		t.Fatalf("too large while reading: %v %v", res, err)
	}
	res.Body.Close()
	for _, body := range [][]byte{[]byte("hello, not an image"), []byte("<svg xmlns='http://www.w3.org/2000/svg'/>"), {}, []byte("PK\x03\x04zip")} {
		if code, m := save(t, c, srv, body, "", nil); code != 415 || m["error"] != "unsupported_type" {
			t.Fatalf("type %q: %d %v", body, code, m)
		}
	}
	if f.calls != 0 {
		t.Fatalf("refused files must never be forwarded, got %d calls", f.calls)
	}
	for _, ok := range [][]byte{
		[]byte("\xff\xd8\xff\xe0jpeg"), []byte("GIF89a....."), []byte("RIFF\x00\x00\x00\x00WEBPVP8 "), append([]byte("BM"), make([]byte, 20)...), []byte("%PDF-1.7 ..."),
	} {
		if sniffPixelType(ok) == "" {
			t.Fatalf("%q should be accepted", ok)
		}
	}
}

func TestPixelSaveMapsEachUpstreamErrorWithoutEchoingIt(t *testing.T) {
	_, srv, f, c := pixelApp(t)
	for _, tc := range []struct {
		status int
		code   string
		want   int
		err    string
	}{
		{404, "no_account", 409, "no_account"},
		{413, "quota_exceeded", 409, "quota_exceeded"},
		{413, "too_large", 413, "too_large"},
		{415, "unsupported_type", 415, "unsupported_type"},
		{429, "rate_limited", 429, "rate_limited"},
		{403, "account_suspended", 502, "failed"},
		{403, "blocked_file", 502, "failed"},
		{500, "store_failed", 502, "failed"},
		{401, "bad_signature", 502, "failed"},
		{503, "busy", 503, "busy"},
		{408, "body_timeout", 503, "busy"},
	} {
		f.status, f.reply = tc.status, `{"ok":false,"error":"`+tc.code+`","message":"SECRET upstream words"}`
		code, m := save(t, c, srv, tinyPNG, "", nil)
		raw, _ := json.Marshal(m)
		if code != tc.want || m["error"] != tc.err || strings.Contains(string(raw), "SECRET") {
			t.Fatalf("%s: got %d %s", tc.code, code, raw)
		}
	}
	f.status, f.reply = 200, "<html>not json</html>"
	if code, m := save(t, c, srv, tinyPNG, "", nil); code != 502 || m["error"] != "failed" {
		t.Fatalf("garbage: %d %v", code, m)
	}
	// success pointing at another host is not passed on
	f.status, f.reply = 201, `{"ok":true,"data":{"page_url":"https://evil.example/x","url":"https://evil.example/i.png"}}`
	if code, _ := save(t, c, srv, tinyPNG, "", nil); code != 502 {
		t.Fatalf("a foreign address must not be returned: %d", code)
	}
}

func TestPixelSaveIsRateLimitedPerPerson(t *testing.T) {
	_, srv, f, c := pixelApp(t)
	for i := 0; i < pixelPerMinute; i++ {
		if code, _ := save(t, c, srv, tinyPNG, "", nil); code != 200 {
			t.Fatalf("call %d: %d", i, code)
		}
	}
	code, m := save(t, c, srv, tinyPNG, "", nil)
	if code != 429 || m["error"] != "rate_limited" || f.calls != pixelPerMinute {
		t.Fatalf("over the limit: %d %v (upstream calls %d)", code, m, f.calls)
	}
	other := noRedirect()
	signIn(t, other, srv.URL, "202", "Bo", "px-2", "")
	if code, _ := save(t, other, srv, tinyPNG, "", nil); code != 200 {
		t.Fatalf("another person has their own allowance: %d", code)
	}
}

func TestPixelHopURLIsDerivedFromTheHub(t *testing.T) {
	for in, want := range map[string]string{
		"https://hub.hel.ink": "https://pixel.hel.ink", "https://hel.ink": "https://pixel.hel.ink",
		"http://localhost:8080": "", "": "", "https://localhost": "",
	} {
		if got := PixelHopURLFor(in); got != want {
			t.Fatalf("%q: %q want %q", in, got, want)
		}
	}
}

func TestPixelNameTravelsInAHeaderNotTheQuery(t *testing.T) {
	_, srv, f, c := pixelApp(t)
	hdr := map[string]string{"X-FileHop-Name": "a%00b%0A%C2%85c%20d.png"} // control characters are dropped
	if code, _ := save(t, c, srv, tinyPNG, "?name=ignored.png", hdr); code != 200 {
		t.Fatal(code)
	}
	if f.path != "/hop/media?name=abc+d.png" {
		t.Fatalf("path sent upstream: %q", f.path)
	}
	for _, bad := range []string{"%zz", strings.Repeat("a", 5000)} { // not valid, or absurdly long: no name, still saved
		if code, _ := save(t, c, srv, tinyPNG, "", map[string]string{"X-FileHop-Name": bad}); code != 200 || f.path != "/hop/media" {
			t.Fatalf("bad name %.10q: %d %q", bad, code, f.path)
		}
	}
	long := strings.Repeat("é", 400)
	save(t, c, srv, tinyPNG, "", map[string]string{"X-FileHop-Name": url.PathEscape(long)})
	if got := f.path[len("/hop/media?name="):]; len([]rune(mustUnescape(t, got))) != pixelNameMax {
		t.Fatalf("name cut to %d characters, got %d", pixelNameMax, len([]rune(mustUnescape(t, got))))
	}
}

func mustUnescape(t *testing.T, s string) string {
	u, err := url.QueryUnescape(s)
	if err != nil {
		t.Fatal(err)
	}
	return u
}

func TestPixelGateBoundsMemoryAndOneSavePerPerson(t *testing.T) {
	var g pixelGate
	if g.enter("a") != "" || g.enter("a") != "person" {
		t.Fatal("one save per person")
	}
	for _, who := range []string{"b", "c", "d"} {
		if g.enter(who) != "" {
			t.Fatalf("slot for %s", who)
		}
	}
	if g.enter("e") != "full" {
		t.Fatalf("only %d bodies at a time", pixelSlots)
	}
	g.leave("a")
	if g.enter("e") != "" {
		t.Fatal("a slot comes back when a save ends")
	}
}

func TestPixelSaveAnswersBusyWhenSlotsOrPersonAreTaken(t *testing.T) {
	a, srv, f, c := pixelApp(t)
	for _, who := range []string{"x1", "x2", "x3", "x4"} {
		a.px.enter(who)
	}
	if code, m := save(t, c, srv, tinyPNG, "", nil); code != 503 || m["error"] != "busy" || f.calls != 0 {
		t.Fatalf("all slots taken: %d %v", code, m)
	}
	for _, who := range []string{"x1", "x2", "x3", "x4"} {
		a.px.leave(who)
	}
	a.px.enter("101") // this person already has one running
	if code, m := save(t, c, srv, tinyPNG, "", nil); code != 429 || m["error"] != "busy" {
		t.Fatalf("one save per person: %d %v", code, m)
	}
	a.px.leave("101")
	if code, _ := save(t, c, srv, tinyPNG, "", nil); code != 200 {
		t.Fatalf("after: %d", code)
	}
}

type brokenBody struct{ n int }

func (b *brokenBody) Read(p []byte) (int, error) {
	if b.n <= 0 {
		return 0, errors.New("connection reset")
	}
	k := copy(p, make([]byte, min(len(p), b.n)))
	b.n -= k
	return k, nil
}

func TestPixelBodyErrorsAreToldApart(t *testing.T) {
	rec := httptest.NewRecorder()
	// a body over the cap is "too large"
	r := httptest.NewRequest("POST", "/", bytes.NewReader(make([]byte, 100)))
	r.ContentLength = -1
	_, err := readPixelBody(rec, r, 10)
	if st, code := bodyErrorCode(err); st != 413 || code != "too_large" {
		t.Fatalf("over the cap: %d %s (%v)", st, code, err)
	}
	// a read that breaks half way (dropped connection, timeout) is not "too large"
	r = httptest.NewRequest("POST", "/", &brokenBody{n: 5})
	r.ContentLength = 50
	_, err = readPixelBody(rec, r, 1000)
	if st, code := bodyErrorCode(err); st != 400 || code != "failed" {
		t.Fatalf("broken read: %d %s (%v)", st, code, err)
	}
	// and a normal body is read once into a buffer of its own size
	r = httptest.NewRequest("POST", "/", bytes.NewReader(tinyPNG))
	r.ContentLength = int64(len(tinyPNG))
	if b, err := readPixelBody(rec, r, 1000); err != nil || !bytes.Equal(b, tinyPNG) || cap(b) != len(tinyPNG) {
		t.Fatalf("normal read: %v cap=%d", err, cap(b))
	}
}

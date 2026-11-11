package app

import (
	"io"
	"net/http"
	"net/http/httptest"
	"sync"
	"testing"
	"time"

	"github.com/navi-crwn/FileHop/internal/hop"
)

type scriptStep struct {
	status int
	reply  string
}

// scriptedPixel answers the calls it gets in the order given (the last answer repeats), verifies each
// signature like PixelHop (a repeated nonce is refused) and remembers every nonce.
type scriptedPixel struct {
	mu     sync.Mutex
	nonces hop.Nonces
	seen   []string
	script []scriptStep
	srv    *httptest.Server
}

func newScriptedPixel(t *testing.T, script []scriptStep) *scriptedPixel {
	f := &scriptedPixel{script: script}
	f.srv = httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		body, _ := io.ReadAll(r.Body)
		f.mu.Lock()
		defer f.mu.Unlock()
		if err := f.nonces.Verify(r, body, "filehop", []string{pixelSecret}, 120*time.Second); err != nil {
			w.WriteHeader(401)
			io.WriteString(w, `{"ok":false,"error":"replay"}`)
			return
		}
		f.seen = append(f.seen, r.Header.Get("X-HOP-Nonce"))
		st := f.script[min(len(f.seen)-1, len(f.script)-1)]
		w.WriteHeader(st.status)
		io.WriteString(w, st.reply)
	}))
	t.Cleanup(f.srv.Close)
	return f
}

func pixelAppWith(t *testing.T, script func(base string) []scriptStep) (*httptest.Server, *scriptedPixel, *http.Client) {
	a, srv := newTestApp(t, true)
	f := newScriptedPixel(t, nil)
	f.script = script(f.srv.URL)
	a.cfg.PixelHopURL, a.cfg.PixelHopSecret = f.srv.URL, pixelSecret
	c := noRedirect()
	signIn(t, c, srv.URL, "101", "Ana", "px-r", "")
	return srv, f, c
}

func TestPixelSaveRetriesOnceWhenPixelHopIsBusyOrTimesOut(t *testing.T) {
	pixelRetryPause = time.Millisecond
	for _, first := range []scriptStep{
		{503, `{"ok":false,"error":"busy"}`},
		{408, `{"ok":false,"error":"body_timeout"}`},
	} {
		// busy once, then fine: one retry, signed afresh (a repeated nonce would be refused as replay)
		srv, f, c := pixelAppWith(t, func(base string) []scriptStep { return []scriptStep{first, {201, okReply(base)}} })
		if code, m := save(t, c, srv, tinyPNG, "", nil); code != 200 || m["ok"] != true {
			t.Fatalf("%s, then success: %d %v", first.reply, code, m)
		}
		if len(f.seen) != 2 || f.seen[0] == f.seen[1] {
			t.Fatalf("two calls with different nonces expected, got %v", f.seen)
		}

		// busy twice: the person is told "busy", not a generic failure, and there is no third try
		srv, f, c = pixelAppWith(t, func(base string) []scriptStep { return []scriptStep{first, first, {201, okReply(base)}} })
		code, m := save(t, c, srv, tinyPNG, "", nil)
		if code != 503 || m["error"] != "busy" || len(f.seen) != 2 {
			t.Fatalf("%s twice: %d %v (upstream calls %d)", first.reply, code, m, len(f.seen))
		}
	}
	// other errors are not retried
	srv, f, c := pixelAppWith(t, func(string) []scriptStep { return []scriptStep{{413, `{"ok":false,"error":"too_large"}`}} })
	save(t, c, srv, tinyPNG, "", nil)
	if len(f.seen) != 1 {
		t.Fatalf("only busy and body_timeout are retried, got %d calls", len(f.seen))
	}
}

func TestPixelSaveMakesOneUpstreamCallAtATime(t *testing.T) {
	a, srv := newTestApp(t, true)
	var mu sync.Mutex
	inflight, peak := 0, 0
	fake := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		io.Copy(io.Discard, r.Body)
		mu.Lock()
		inflight++
		peak = max(peak, inflight)
		mu.Unlock()
		time.Sleep(60 * time.Millisecond)
		mu.Lock()
		inflight--
		mu.Unlock()
		w.WriteHeader(201)
		io.WriteString(w, okReply("http://"+r.Host))
	}))
	t.Cleanup(fake.Close)
	a.cfg.PixelHopURL, a.cfg.PixelHopSecret = fake.URL, pixelSecret
	var wg sync.WaitGroup
	for i := 0; i < 3; i++ { // three different people at once, all calls from this one server
		wg.Add(1)
		go func(i int) {
			defer wg.Done()
			c := noRedirect()
			signIn(t, c, srv.URL, string(rune('1'+i))+"00", "P", "px-c"+string(rune('a'+i)), "")
			save(t, c, srv, tinyPNG, "", nil)
		}(i)
	}
	wg.Wait()
	if peak != 1 {
		t.Fatalf("calls to PixelHop must not overlap, peak %d", peak)
	}
}

func TestPixelSaveTreatsAnHTML408AsABodyTimeout(t *testing.T) {
	pixelRetryPause = time.Millisecond
	srv, f, c := pixelAppWith(t, func(base string) []scriptStep {
		return []scriptStep{{408, "<html>408 Request Time-out</html>"}, {201, okReply(base)}}
	})
	if code, m := save(t, c, srv, tinyPNG, "", nil); code != 200 || m["ok"] != true || len(f.seen) != 2 {
		t.Fatalf("nginx's own 408 is retried once: %d %v (calls %d)", code, m, len(f.seen))
	}
}

package app

import (
	"context"
	"encoding/json"
	"net/http"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/coder/websocket"
)

func sendWS(t *testing.T, base, origin string) *websocket.Conn {
	t.Helper()
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	opts := &websocket.DialOptions{}
	if origin != "" {
		opts.HTTPHeader = http.Header{"Origin": {origin}}
	}
	c, _, err := websocket.Dial(ctx, "ws"+strings.TrimPrefix(base, "http")+"/api/send/signal", opts)
	if err != nil {
		t.Fatalf("dial: %v", err)
	}
	t.Cleanup(func() { c.CloseNow() })
	return c
}

func wsSend(t *testing.T, c *websocket.Conn, v any) {
	t.Helper()
	b, _ := json.Marshal(v)
	if err := c.Write(context.Background(), websocket.MessageText, b); err != nil {
		t.Fatal(err)
	}
}

func wsRead(t *testing.T, c *websocket.Conn) map[string]any {
	t.Helper()
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()
	_, raw, err := c.Read(ctx)
	if err != nil {
		t.Fatalf("read: %v", err)
	}
	var m map[string]any
	json.Unmarshal(raw, &m)
	return m
}

func newCode(t *testing.T, base string) string {
	t.Helper()
	res, err := http.Post(base+"/api/send/room", "", nil)
	if err != nil || res.StatusCode != 200 {
		t.Fatalf("room: %v %v", err, res)
	}
	var j struct{ Code string }
	json.NewDecoder(res.Body).Decode(&j)
	res.Body.Close()
	if len(j.Code) != 6 {
		t.Fatalf("code %q", j.Code)
	}
	return j.Code
}

func TestSendRoomRelaysBetweenTwoAndRefusesAThird(t *testing.T) {
	_, srv := newTestApp(t, false)
	code := newCode(t, srv.URL)

	a := sendWS(t, srv.URL, "")
	wsSend(t, a, map[string]any{"t": "join", "code": code})
	ha := wsRead(t, a)
	if ha["t"] != "hello" || len(ha["peers"].([]any)) != 0 {
		t.Fatalf("first hello: %v", ha)
	}
	b := sendWS(t, srv.URL, "")
	wsSend(t, b, map[string]any{"t": "join", "code": code})
	hb := wsRead(t, b)
	if len(hb["peers"].([]any)) != 1 || hb["peers"].([]any)[0].(map[string]any)["id"] != ha["id"] {
		t.Fatalf("second hello: %v", hb)
	}
	if m := wsRead(t, a); m["t"] != "peer" || m["id"] != hb["id"] {
		t.Fatalf("a should hear about b: %v", m)
	}

	wsSend(t, b, map[string]any{"t": "sig", "to": ha["id"], "d": map[string]any{"k": "commit", "h": "x"}})
	if m := wsRead(t, a); m["t"] != "sig" || m["from"] != hb["id"] {
		t.Fatalf("relay: %v", m)
	}

	// A third device is turned away, so nobody can slip in between two paired devices.
	c := sendWS(t, srv.URL, "")
	wsSend(t, c, map[string]any{"t": "join", "code": code})
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()
	_, _, err := c.Read(ctx)
	if websocket.CloseStatus(err) != 4404 {
		t.Fatalf("third peer should be closed with 4404, got %v", err)
	}

	// Leaving is announced.
	b.Close(websocket.StatusNormalClosure, "")
	if m := wsRead(t, a); m["t"] != "leave" {
		t.Fatalf("leave: %v", m)
	}
}

func TestSendWrongCodesBlockTheAddressEvenForTheRightCode(t *testing.T) {
	a, srv := newTestApp(t, false)
	a.cfg.TrustProxy = true
	code := newCode(t, srv.URL) // a waiting room
	dial := func(ip string) *websocket.Conn {
		ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()
		c, _, err := websocket.Dial(ctx, "ws"+strings.TrimPrefix(srv.URL, "http")+"/api/send/signal",
			&websocket.DialOptions{HTTPHeader: http.Header{"X-Forwarded-For": {ip}}})
		if err != nil {
			t.Fatal(err)
		}
		t.Cleanup(func() { c.CloseNow() })
		return c
	}
	closeOf := func(c *websocket.Conn) websocket.StatusCode {
		ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
		defer cancel()
		_, _, err := c.Read(ctx)
		return websocket.CloseStatus(err)
	}
	// the attacker spends its wrong tries: refused as unknown until the limit
	for i := 0; i < sendJoinFails; i++ {
		c := dial("198.51.100.66")
		wsSend(t, c, map[string]any{"t": "join", "code": "000000"})
		if got := closeOf(c); got != 4404 {
			t.Fatalf("try %d: wrong code should close 4404, got %d", i, got)
		}
	}
	// now even the CORRECT code from that address is refused, and the room is untouched
	c := dial("198.51.100.66")
	wsSend(t, c, map[string]any{"t": "join", "code": code})
	if got := closeOf(c); got != 4429 {
		t.Fatalf("the right code from a limited address must be refused (4429), got %d", got)
	}
	// another address still gets in, so the real receiver is not locked out
	d := dial("198.51.100.77")
	wsSend(t, d, map[string]any{"t": "join", "code": code})
	if m := wsRead(t, d); m["t"] != "hello" {
		t.Fatalf("another address must be able to join: %v", m)
	}
}

func TestSendSocketUpgradesArePerAddressLimited(t *testing.T) {
	a, srv := newTestApp(t, false)
	a.cfg.TrustProxy = true
	get := func(ip string) int {
		req, _ := http.NewRequest("GET", srv.URL+"/api/send/signal", nil)
		req.Header.Set("X-Forwarded-For", ip)
		res, err := http.DefaultClient.Do(req) // not an upgrade: only the count matters here
		if err != nil {
			t.Fatal(err)
		}
		res.Body.Close()
		return res.StatusCode
	}
	for i := 0; i < sendUpgrades; i++ {
		if get("203.0.113.5") == http.StatusTooManyRequests {
			t.Fatalf("request %d is under the cap", i)
		}
	}
	if get("203.0.113.5") != http.StatusTooManyRequests {
		t.Fatal("past the cap the address gets 429")
	}
	if get("203.0.113.6") == http.StatusTooManyRequests {
		t.Fatal("another address is unaffected")
	}
}

func TestSendRoomCreationIsLimited(t *testing.T) {
	_, srv := newTestApp(t, false)
	for i := 0; i < sendMakePerHr; i++ {
		newCode(t, srv.URL)
	}
	res, err := http.Post(srv.URL+"/api/send/room", "", nil)
	if err != nil || res.StatusCode != http.StatusTooManyRequests {
		t.Fatalf("expected 429, got %v %v", res, err)
	}
}

func TestSendRejectsForeignOrigin(t *testing.T) {
	_, srv := newTestApp(t, false)
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()
	_, _, err := websocket.Dial(ctx, "ws"+strings.TrimPrefix(srv.URL, "http")+"/api/send/signal",
		&websocket.DialOptions{HTTPHeader: http.Header{"Origin": {"https://evil.example"}}})
	if err == nil {
		t.Fatal("a page on another origin must not be able to open the signalling socket")
	}
}

func TestSendNeedsJoinFirst(t *testing.T) {
	_, srv := newTestApp(t, false)
	c := sendWS(t, srv.URL, "")
	wsSend(t, c, map[string]any{"t": "sig", "to": "x"})
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()
	_, _, err := c.Read(ctx)
	if websocket.CloseStatus(err) != websocket.StatusPolicyViolation {
		t.Fatalf("expected policy violation, got %v", err)
	}
}

func TestSendRoomIsSealedOnceTwoDevicesHaveJoined(t *testing.T) {
	_, srv := newTestApp(t, false)
	code := newCode(t, srv.URL)
	a := sendWS(t, srv.URL, "")
	wsSend(t, a, map[string]any{"t": "join", "code": code})
	wsRead(t, a)
	b := sendWS(t, srv.URL, "")
	wsSend(t, b, map[string]any{"t": "join", "code": code})
	wsRead(t, b)
	// Paired devices close the signalling socket once the direct channel is up.
	a.Close(websocket.StatusNormalClosure, "")
	b.Close(websocket.StatusNormalClosure, "")
	time.Sleep(100 * time.Millisecond)
	c := sendWS(t, srv.URL, "")
	wsSend(t, c, map[string]any{"t": "join", "code": code})
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()
	_, _, err := c.Read(ctx)
	if websocket.CloseStatus(err) != 4404 {
		t.Fatalf("a sealed room must refuse newcomers, got %v", err)
	}
}

func TestSendRoomIsGoneOnceItsOnlyDeviceLeaves(t *testing.T) {
	a, srv := newTestApp(t, false)
	code := newCode(t, srv.URL)
	c := sendWS(t, srv.URL, "")
	wsSend(t, c, map[string]any{"t": "join", "code": code})
	if m := wsRead(t, c); m["t"] != "hello" {
		t.Fatalf("hello: %v", m)
	}
	// The device that opened the room reloads or leaves before anyone joined.
	c.Close(websocket.StatusNormalClosure, "")
	deadline := time.Now().Add(2 * time.Second)
	for a.send.count() != 0 && time.Now().Before(deadline) {
		time.Sleep(10 * time.Millisecond)
	}
	if n := a.send.count(); n != 0 {
		t.Fatalf("the abandoned room must be removed, %d left", n)
	}
	// Someone scanning the old code is told it is unknown instead of waiting in an empty room.
	d := sendWS(t, srv.URL, "")
	wsSend(t, d, map[string]any{"t": "join", "code": code})
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()
	_, _, err := d.Read(ctx)
	if websocket.CloseStatus(err) != 4404 {
		t.Fatalf("an abandoned code must close with 4404, got %v", err)
	}
}

func TestSendParallelGuessesFromOneAddressAreStillLimited(t *testing.T) {
	a, srv := newTestApp(t, false)
	a.cfg.TrustProxy = true
	var mu sync.Mutex
	reachedJoin, refused := 0, 0
	var wg sync.WaitGroup
	for i := 0; i < 20; i++ { // 20 sockets opened at the same moment, all guessing
		wg.Add(1)
		go func() {
			defer wg.Done()
			ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
			defer cancel()
			c, _, err := websocket.Dial(ctx, "ws"+strings.TrimPrefix(srv.URL, "http")+"/api/send/signal",
				&websocket.DialOptions{HTTPHeader: http.Header{"X-Forwarded-For": {"198.51.100.99"}}})
			if err != nil {
				return
			}
			defer c.CloseNow()
			b, _ := json.Marshal(map[string]any{"t": "join", "code": "000000"})
			c.Write(ctx, websocket.MessageText, b)
			_, _, err = c.Read(ctx)
			mu.Lock()
			defer mu.Unlock()
			switch websocket.CloseStatus(err) {
			case 4404:
				reachedJoin++
			case 4429:
				refused++
			}
		}()
	}
	wg.Wait()
	if reachedJoin > sendJoinFails || reachedJoin+refused != 20 {
		t.Fatalf("at most %d guesses may reach the join, got %d (refused %d)", sendJoinFails, reachedJoin, refused)
	}
}

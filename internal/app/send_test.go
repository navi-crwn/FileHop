package app

import (
	"context"
	"encoding/json"
	"net/http"
	"strings"
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

func TestSendUnknownCodeIsMeteredPerAddress(t *testing.T) {
	_, srv := newTestApp(t, false)
	var last websocket.StatusCode
	for i := 0; i < sendJoinFails+2; i++ {
		c := sendWS(t, srv.URL, "")
		wsSend(t, c, map[string]any{"t": "join", "code": "000000"})
		ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
		_, _, err := c.Read(ctx)
		cancel()
		last = websocket.CloseStatus(err)
	}
	if last != 4429 {
		t.Fatalf("after %d wrong codes the address should be limited (4429), got %d", sendJoinFails+2, last)
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

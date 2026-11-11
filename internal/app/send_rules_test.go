package app

import (
	"context"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/coder/websocket"
)

// joinPair opens a room and joins two devices to it; it returns a's and b's ids.
func joinPair(t *testing.T, base string, a, b *websocket.Conn) (idA, idB string) {
	t.Helper()
	code := newCode(t, base)
	wsSend(t, a, map[string]any{"t": "join", "code": code})
	ha := wsRead(t, a)
	wsSend(t, b, map[string]any{"t": "join", "code": code})
	hb := wsRead(t, b)
	wsRead(t, a) // peer
	return ha["id"].(string), hb["id"].(string)
}

func TestSendRoomExpiresWithAnInjectedClock(t *testing.T) {
	a, srv := newTestApp(t, false)
	now := time.Date(2026, 11, 11, 12, 0, 0, 0, time.UTC)
	a.send.now = func() time.Time { return now }
	code := newCode(t, srv.URL)
	code2 := newCode(t, srv.URL)

	// just inside the ten minutes the code still works...
	now = now.Add(sendRoomTTL - time.Second)
	c := sendWS(t, srv.URL, "")
	wsSend(t, c, map[string]any{"t": "join", "code": code})
	if m := wsRead(t, c); m["t"] != "hello" {
		t.Fatalf("a young room should accept a device: %v", m)
	}

	// ...and past them the other room is gone.
	now = now.Add(2 * time.Second)
	d := sendWS(t, srv.URL, "")
	wsSend(t, d, map[string]any{"t": "join", "code": code2})
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()
	if _, _, err := d.Read(ctx); websocket.CloseStatus(err) != 4404 {
		t.Fatalf("an expired room must refuse with 4404, got %v", err)
	}
	if a.send.count() != 0 {
		t.Fatalf("expired rooms should be dropped, %d left", a.send.count())
	}
}

func TestSendRateWindowFollowsTheInjectedClock(t *testing.T) {
	var h sendHub
	now := time.Date(2026, 11, 11, 12, 0, 0, 0, time.UTC)
	h.now = func() time.Time { return now }
	for i := 0; i < 3; i++ {
		if !h.allow("k", 3, time.Hour) {
			t.Fatalf("try %d should pass", i)
		}
	}
	if h.allow("k", 3, time.Hour) {
		t.Fatal("the fourth try inside the hour must be refused")
	}
	now = now.Add(time.Hour + time.Second)
	if !h.allow("k", 3, time.Hour) {
		t.Fatal("a new hour starts a new allowance")
	}
}

func TestSendMessageLargerThanTheLimitClosesTheSocket(t *testing.T) {
	_, srv := newTestApp(t, false)
	code := newCode(t, srv.URL)
	c := sendWS(t, srv.URL, "")
	wsSend(t, c, map[string]any{"t": "join", "code": code})
	wsRead(t, c)
	big := strings.Repeat("x", sendMaxMsg+1)
	c.Write(context.Background(), websocket.MessageText, []byte(`{"t":"sig","to":"x","d":{"k":"`+big+`"}}`))
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()
	if _, _, err := c.Read(ctx); websocket.CloseStatus(err) != websocket.StatusMessageTooBig {
		t.Fatalf("an oversized message must close with 1009, got %v", err)
	}
}

func TestSendTrustProxyDecidesWhichAddressIsMetered(t *testing.T) {
	a, _ := newTestApp(t, false)
	req := httptest.NewRequest("GET", "/", nil)
	req.RemoteAddr = "10.0.0.7:5555"
	req.Header.Set("X-Forwarded-For", "203.0.113.9, 10.0.0.1")
	if got := a.clientIP(req); got != "10.0.0.7" {
		t.Fatalf("without TrustProxy the header must be ignored, got %q", got)
	}
	a.cfg.TrustProxy = true
	if got := a.clientIP(req); got != "203.0.113.9" {
		t.Fatalf("with TrustProxy the visitor is the first address, got %q", got)
	}
	req.Header.Del("X-Forwarded-For")
	if got := a.clientIP(req); got != "10.0.0.7" {
		t.Fatalf("with TrustProxy but no header the socket address is used, got %q", got)
	}
}

func TestSendRoomLimitIsPerForwardedAddressBehindAProxy(t *testing.T) {
	a, srv := newTestApp(t, false)
	a.cfg.TrustProxy = true
	mk := func(ip string) int {
		req, _ := http.NewRequest("POST", srv.URL+"/api/send/room", nil)
		req.Header.Set("X-Forwarded-For", ip)
		res, err := http.DefaultClient.Do(req)
		if err != nil {
			t.Fatal(err)
		}
		res.Body.Close()
		return res.StatusCode
	}
	for i := 0; i < sendMakePerHr; i++ {
		if mk("198.51.100.1") != 200 {
			t.Fatal("under the limit")
		}
	}
	if mk("198.51.100.1") != 429 {
		t.Fatal("one visitor over the limit")
	}
	if mk("198.51.100.2") != 200 {
		t.Fatal("another visitor behind the same proxy must not share that limit")
	}
}

func TestSendHelloAndPeerCarryEachDevicesLimit(t *testing.T) {
	_, srv := newTestApp(t, true)
	acct := noRedirect()
	signIn(t, acct, srv.URL, "1", "Ana", "r-1", "")

	// the account's device joins first, a guest second
	code := newCode(t, srv.URL)
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	wsURL := "ws" + strings.TrimPrefix(srv.URL, "http") + "/api/send/signal"
	a, _, err := websocket.Dial(ctx, wsURL, &websocket.DialOptions{HTTPClient: acct})
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { a.CloseNow() })
	wsSend(t, a, map[string]any{"t": "join", "code": code})
	ha := wsRead(t, a)
	if ha["max"] != float64(sendAccountMax) {
		t.Fatalf("a signed-in device may send %d, hello says %v", sendAccountMax, ha["max"])
	}
	b := sendWS(t, srv.URL, "")
	wsSend(t, b, map[string]any{"t": "join", "code": code})
	hb := wsRead(t, b)
	if hb["max"] != float64(sendGuestMax) {
		t.Fatalf("a guest device may send %d, hello says %v", sendGuestMax, hb["max"])
	}
	if p := hb["peers"].([]any)[0].(map[string]any); p["max"] != float64(sendAccountMax) {
		t.Fatalf("the guest must be told the account's limit, got %v", p)
	}
	if m := wsRead(t, a); m["t"] != "peer" || m["max"] != float64(sendGuestMax) {
		t.Fatalf("the account must be told the guest's limit: %v", m)
	}

	// /api/send/config tells each visitor their own
	for c, want := range map[*http.Client]float64{acct: float64(sendAccountMax), noRedirect(): float64(sendGuestMax)} {
		if got := decode(t, mustGet(t, c, srv.URL+"/api/send/config"))["maxBytes"]; got != want {
			t.Fatalf("config maxBytes %v, want %v", got, want)
		}
	}
}

func TestSendDescriptionsWaitForBothCommitments(t *testing.T) {
	_, srv := newTestApp(t, false)
	a, b := sendWS(t, srv.URL, ""), sendWS(t, srv.URL, "")
	idA, idB := joinPair(t, srv.URL, a, b)
	sdp := map[string]any{"sdp": map[string]any{"type": "offer"}}
	commit := map[string]any{"k": "commit", "h": "00"}
	expectErr := func(c *websocket.Conn, why string) {
		t.Helper()
		if m := wsRead(t, c); m["t"] != "err" || m["why"] != why {
			t.Fatalf("expected err %s, got %v", why, m)
		}
	}

	wsSend(t, a, map[string]any{"t": "sig", "to": idB, "d": sdp}) // before anyone committed
	expectErr(a, "order")
	wsSend(t, a, map[string]any{"t": "sig", "to": idB, "d": commit})
	if m := wsRead(t, b); m["t"] != "sig" || m["from"] != idA {
		t.Fatalf("a commitment is relayed: %v", m)
	}
	wsSend(t, a, map[string]any{"t": "sig", "to": idB, "d": sdp}) // only one side has committed
	expectErr(a, "order")
	wsSend(t, b, map[string]any{"t": "sig", "to": idA, "d": sdp})
	expectErr(b, "order")
	wsSend(t, a, map[string]any{"t": "sig", "to": idB, "d": map[string]any{"x": 1}}) // not a known message
	expectErr(a, "bad")

	wsSend(t, b, map[string]any{"t": "sig", "to": idA, "d": commit})
	if m := wsRead(t, a); m["t"] != "sig" || m["from"] != idB {
		t.Fatalf("second commitment: %v", m)
	}
	wsSend(t, a, map[string]any{"t": "sig", "to": idB, "d": sdp}) // now both have committed
	if m := wsRead(t, b); m["t"] != "sig" || m["d"].(map[string]any)["sdp"] == nil {
		t.Fatalf("the description flows once both committed: %v", m)
	}
}

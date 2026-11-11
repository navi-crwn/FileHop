package app

import (
	"context"
	"crypto/rand"
	"encoding/json"
	"fmt"
	"math/big"
	"net"
	"net/http"
	"strings"
	"sync"
	"time"

	"github.com/coder/websocket"
)

// Peer-to-peer send (/send). The server only introduces two browsers to each
// other: it relays the WebRTC handshake (offer, answer, ICE candidates) between
// the two members of a short-lived room named by a 6-digit code. The file never
// touches the server and the server stores nothing: rooms live in memory.

const (
	sendPeers     = 2
	sendMaxMsg    = 64 << 10
	sendRoomTTL   = 10 * time.Minute
	sendMaxRooms  = 5000
	sendMakePerHr = 10 // rooms one address may open per hour
	sendJoinFails = 10 // wrong codes one address may try per minute; past that even the right code is refused
	sendUpgrades  = 30 // signalling sockets one address may open per minute (a person opens one or two)
	sendMsgRate   = 20 // signalling messages per second per connection

	// Largest single file a sender may offer. The limit follows the sender and the
	// server tells the receiver, which enforces it.
	sendGuestMax   int64 = 2 << 30
	sendAccountMax int64 = 4 << 30
)

type sendPeer struct {
	id        string
	max       int64 // the most this device may send: set by the server from its session
	out       chan []byte
	cancel    context.CancelFunc
	committed bool // has sent its fingerprint commitment (see relay)
}

type sendRoom struct {
	expires time.Time
	sealed  bool // the second device has joined: nobody else may, even after both leave
	peers   map[string]*sendPeer
}

type sendHub struct {
	mu    sync.Mutex
	rooms map[string]*sendRoom
	win   map[string]*sendWindow
	now   func() time.Time // replaced in tests; nil means the wall clock
}

func (h *sendHub) clock() time.Time {
	if h.now != nil {
		return h.now()
	}
	return time.Now()
}

type sendWindow struct {
	start time.Time
	n     int
}

// allow reports whether key may act once more inside the window.
func (h *sendHub) allow(key string, max int, every time.Duration) bool {
	h.mu.Lock()
	defer h.mu.Unlock()
	if h.win == nil {
		h.win = map[string]*sendWindow{}
	}
	w := h.win[key]
	if w == nil || h.clock().Sub(w.start) > every {
		h.win[key] = &sendWindow{start: h.clock(), n: 1}
		return true
	}
	w.n++
	return w.n <= max
}

// over reports whether key has already used up max in the current window, without counting a try.
func (h *sendHub) over(key string, max int, every time.Duration) bool {
	h.mu.Lock()
	defer h.mu.Unlock()
	w := h.win[key]
	return w != nil && h.clock().Sub(w.start) <= every && w.n >= max
}

// gcLocked drops expired rooms and stale rate windows; the caller holds mu.
func (h *sendHub) gcLocked() {
	now := h.clock()
	for c, r := range h.rooms {
		if now.After(r.expires) {
			for _, p := range r.peers {
				p.cancel()
			}
			delete(h.rooms, c)
		}
	}
	for k, w := range h.win {
		if now.Sub(w.start) > time.Hour {
			delete(h.win, k)
		}
	}
}

func (h *sendHub) create() (string, bool) {
	h.mu.Lock()
	defer h.mu.Unlock()
	h.gcLocked()
	if h.rooms == nil {
		h.rooms = map[string]*sendRoom{}
	}
	if len(h.rooms) >= sendMaxRooms {
		return "", false
	}
	for i := 0; i < 20; i++ {
		n, err := rand.Int(rand.Reader, big.NewInt(1000000))
		if err != nil {
			return "", false
		}
		code := fmt.Sprintf("%06d", n.Int64())
		if _, taken := h.rooms[code]; !taken {
			h.rooms[code] = &sendRoom{expires: h.clock().Add(sendRoomTTL), peers: map[string]*sendPeer{}}
			return code, true
		}
	}
	return "", false
}

// join adds p to the room and queues p's hello. It returns "", "unknown" or "full".
// hello carries this device's id and limit and the other device's id and limit; the
// existing device is told about the newcomer with peer. Both are queued under the lock, so
// nothing relayed afterwards can overtake the hello.
func (h *sendHub) join(code string, p *sendPeer) string {
	h.mu.Lock()
	defer h.mu.Unlock()
	h.gcLocked()
	r := h.rooms[code]
	if r == nil || h.clock().After(r.expires) {
		return "unknown"
	}
	if r.sealed || len(r.peers) >= sendPeers {
		return "full"
	}
	others := []map[string]any{}
	for id, q := range r.peers {
		others = append(others, map[string]any{"id": id, "max": q.max})
		sendDeliver(q, mustJSON(map[string]any{"t": "peer", "id": p.id, "max": p.max}))
	}
	r.peers[p.id] = p
	r.sealed = len(r.peers) >= sendPeers
	sendDeliver(p, mustJSON(map[string]any{"t": "hello", "id": p.id, "max": p.max, "peers": others}))
	return ""
}

func (h *sendHub) leave(code string, p *sendPeer) {
	h.mu.Lock()
	defer h.mu.Unlock()
	if r := h.rooms[code]; r != nil {
		delete(r.peers, p.id)
		for _, q := range r.peers {
			sendDeliver(q, mustJSON(map[string]any{"t": "leave", "id": p.id}))
		}
	}
}

// relay hands a handshake message to the other member of the room only. A message d is one of
//
//	{"k":"commit","h":"<hash>"}      a commitment to the sender's DTLS fingerprint
//	{"sdp":{...}} or {"c":{...}}     the session description / an ICE candidate
//
// Both commitments must have been sent before any description or candidate is relayed: that
// order is what stops whoever relays the handshake from choosing a certificate after seeing
// the real one. The clients enforce it too; this is the same rule held by the server.
// It returns "" when the message was passed on, otherwise why it was dropped.
func (h *sendHub) relay(code string, from *sendPeer, to string, d json.RawMessage) string {
	h.mu.Lock()
	defer h.mu.Unlock()
	r := h.rooms[code]
	if r == nil {
		return "unknown"
	}
	var k struct {
		K   string          `json:"k"`
		SDP json.RawMessage `json:"sdp"`
		C   json.RawMessage `json:"c"`
	}
	if json.Unmarshal(d, &k) != nil {
		return "bad"
	}
	switch {
	case k.K == "commit":
		from.committed = true
	case k.SDP != nil || k.C != nil:
		both := len(r.peers) == sendPeers
		for _, q := range r.peers {
			both = both && q.committed
		}
		if !both {
			return "order"
		}
	default:
		return "bad"
	}
	if q := r.peers[to]; q != nil && q != from {
		sendDeliver(q, mustJSON(map[string]any{"t": "sig", "from": from.id, "d": d}))
	}
	return ""
}

func (h *sendHub) count() int {
	h.mu.Lock()
	defer h.mu.Unlock()
	return len(h.rooms)
}

func sendDeliver(p *sendPeer, msg []byte) {
	select {
	case p.out <- msg:
	default:
		p.cancel()
	}
}

func mustJSON(v any) []byte {
	b, _ := json.Marshal(v)
	return b
}

// clientIP is the visitor's address. Behind nginx (which overwrites
// X-Forwarded-For with $remote_addr) set Config.TrustProxy.
func (a *App) clientIP(r *http.Request) string {
	if a.cfg.TrustProxy {
		if f := r.Header.Get("X-Forwarded-For"); f != "" {
			return strings.TrimSpace(strings.Split(f, ",")[0])
		}
	}
	host, _, err := net.SplitHostPort(r.RemoteAddr)
	if err != nil {
		return r.RemoteAddr
	}
	return host
}

// sendMax is the largest file this visitor may send: a signed-in account gets more.
func (a *App) sendMax(r *http.Request) int64 {
	if a.verifiedUser(r) != nil {
		return sendAccountMax
	}
	return sendGuestMax
}

// POST /api/send/room: opens a room and returns its code.
func (a *App) sendNewRoom(w http.ResponseWriter, r *http.Request) {
	if !a.send.allow("mk"+a.clientIP(r), sendMakePerHr, time.Hour) {
		writeJSON(w, http.StatusTooManyRequests, map[string]string{"error": "rate_limited"})
		return
	}
	code, ok := a.send.create()
	if !ok {
		writeJSON(w, http.StatusServiceUnavailable, map[string]string{"error": "busy"})
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"code": code, "ttl": int(sendRoomTTL.Seconds())})
}

// GET /api/send/config: ICE servers come from the environment, not from code.
func (a *App) sendConfig(w http.ResponseWriter, r *http.Request) {
	ice := []map[string]any{}
	if len(a.cfg.StunURLs) > 0 {
		ice = append(ice, map[string]any{"urls": a.cfg.StunURLs})
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"iceServers": ice,
		"maxBytes":   a.sendMax(r), // what this visitor may send
		"guestMax":   sendGuestMax,
		"accountMax": sendAccountMax,
	})
}

// GET /api/send/signal (WebSocket). The first message is {"t":"join","code":"123456"};
// the code is not in the URL so it never reaches access logs.
func (a *App) sendSignal(w http.ResponseWriter, r *http.Request) {
	ip := a.clientIP(r)
	if !a.send.allow("ws"+ip, sendUpgrades, time.Minute) {
		http.Error(w, "rate_limited", http.StatusTooManyRequests)
		return
	}
	rc := http.NewResponseController(w)
	rc.SetReadDeadline(time.Time{})
	rc.SetWriteDeadline(time.Time{})
	c, err := websocket.Accept(w, r, nil) // Origin must equal Host: other sites cannot drive it
	if err != nil {
		return
	}
	c.SetReadLimit(sendMaxMsg)
	ctx, cancel := context.WithCancel(r.Context())
	defer cancel()
	defer c.CloseNow()

	jctx, stop := context.WithTimeout(ctx, 5*time.Second)
	_, raw, err := c.Read(jctx)
	stop()
	var j struct{ T, Code string }
	if err != nil || json.Unmarshal(raw, &j) != nil || j.T != "join" || len(j.Code) != 6 {
		c.Close(websocket.StatusPolicyViolation, "join")
		return
	}
	// Guessing codes is the attack here. An address that has used up its wrong tries is refused before
	// the join is even attempted, so a lucky guess does not get in after the limit is reached.
	if a.send.over("jf"+ip, sendJoinFails, time.Minute) {
		c.Close(websocket.StatusCode(4429), "rate_limited")
		return
	}
	p := &sendPeer{id: randToken(9), max: a.sendMax(r), out: make(chan []byte, 64), cancel: cancel}
	why := a.send.join(j.Code, p)
	if why != "" {
		if why == "unknown" {
			a.send.allow("jf"+ip, sendJoinFails, time.Minute) // count the wrong try
		}
		c.Close(websocket.StatusCode(4404), why)
		return
	}
	defer a.send.leave(j.Code, p)

	go func() {
		ping := time.NewTicker(30 * time.Second)
		defer ping.Stop()
		for {
			select {
			case <-ctx.Done():
				return
			case <-ping.C:
				pctx, stop := context.WithTimeout(ctx, 10*time.Second)
				err := c.Ping(pctx)
				stop()
				if err != nil {
					cancel()
					return
				}
			case msg := <-p.out:
				wctx, stop := context.WithTimeout(ctx, 10*time.Second)
				err := c.Write(wctx, websocket.MessageText, msg)
				stop()
				if err != nil {
					cancel()
					return
				}
			}
		}
	}()

	tokens, last := float64(sendMsgRate), time.Now()
	for {
		_, raw, err := c.Read(ctx)
		if err != nil {
			return
		}
		now := time.Now()
		tokens = min(sendMsgRate, tokens+now.Sub(last).Seconds()*sendMsgRate)
		last = now
		if tokens < 1 {
			continue
		}
		tokens--
		var m struct {
			T  string          `json:"t"`
			To string          `json:"to"`
			D  json.RawMessage `json:"d"`
		}
		if json.Unmarshal(raw, &m) != nil {
			continue
		}
		if m.T == "sig" {
			if why := a.send.relay(j.Code, p, m.To, m.D); why != "" {
				sendDeliver(p, mustJSON(map[string]any{"t": "err", "why": why}))
			}
		}
	}
}

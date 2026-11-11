package app

import (
	"net/http"
	"strings"
	"sync"
	"time"
)

// hubProbe says whether the hub answers, so a re-check never sends a browser to a hub that is down
// (it would land on the browser's own error page). One light request with a short timeout, the
// answer kept for a minute; only a 2xx from GET <hub>/up counts as reachable (a proxy that answers 502
// while the hub's PHP is down is not "up").
type hubProbe struct {
	url    string
	mu     sync.Mutex
	at     time.Time
	up     bool
	client *http.Client
}

const hubProbeTTL = time.Minute

func newHubProbe(url string) *hubProbe {
	return &hubProbe{url: url, client: &http.Client{Timeout: 1500 * time.Millisecond,
		CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }}}
}

func (p *hubProbe) Up() bool {
	p.mu.Lock()
	defer p.mu.Unlock()
	if !p.at.IsZero() && time.Since(p.at) < hubProbeTTL {
		return p.up
	}
	up := false
	if res, err := p.client.Get(strings.TrimRight(p.url, "/") + "/up"); err == nil {
		res.Body.Close()
		up = res.StatusCode >= 200 && res.StatusCode < 300
	}
	p.at, p.up = time.Now(), up
	return up
}

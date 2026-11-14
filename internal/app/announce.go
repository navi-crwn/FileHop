package app

import (
	"encoding/json"
	"io"
	"net/http"
	"strconv"
	"strings"
	"sync"
	"time"
	"unicode/utf8"
)

// The family announcement card. One source: the hub's public
// GET {hub}/announcements.json?app=filehop (contract L-1). The browser never
// asks the hub (CSP connect-src 'self'); this server does, and hands the items
// to a signed-in browser inside /api/v1/me.
//
// The dashboard and sign-in must never wait for, or fail because of, the hub:
// Items answers at once from the copy it holds and, when that copy is older
// than annTTL, refreshes it in the background (one request at a time, 2 s
// limit). A failed refresh keeps the last good copy; before any success the
// answer is simply "no items". No hub address (stand-alone install) means no
// request is ever made.

const (
	annTTL     = 5 * time.Minute
	annTimeout = 2 * time.Second
	annMax     = 5 // items handed to the page; it shows one at a time
	annBody    = 300
	annTitle   = 120
	annBytes   = 256 << 10
)

type annItem struct {
	ID       string `json:"id"`
	Level    string `json:"level"` // info | warning | critical
	Title    string `json:"title"`
	Body     string `json:"body"`
	URL      string `json:"url,omitempty"`
	Closable bool   `json:"closable"` // critical notices cannot be closed
}

type annSource struct {
	hub    string
	client *http.Client
	mu     sync.Mutex
	items  []annItem
	at     time.Time
	busy   bool
}

func newAnnSource(hub string) *annSource {
	return &annSource{hub: strings.TrimRight(hub, "/"), client: &http.Client{Timeout: annTimeout,
		CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }}}
}

// Items never blocks on the network.
func (s *annSource) Items() []annItem {
	if s == nil || s.hub == "" {
		return nil
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	if !s.busy && (s.at.IsZero() || time.Since(s.at) >= annTTL) {
		s.busy = true
		go s.Refresh()
	}
	return s.items
}

// Refresh fetches once and replaces the copy on success. A failure leaves the
// old copy and counts as an attempt, so a dead hub is tried once per annTTL.
func (s *annSource) Refresh() {
	items, ok := s.fetch()
	s.mu.Lock()
	defer s.mu.Unlock()
	s.busy = false
	s.at = time.Now()
	if ok {
		s.items = items
	}
}

func (s *annSource) fetch() ([]annItem, bool) {
	res, err := s.client.Get(s.hub + "/announcements.json?app=filehop")
	if err != nil {
		return nil, false
	}
	defer res.Body.Close()
	if res.StatusCode != http.StatusOK {
		return nil, false
	}
	var doc struct {
		Version int `json:"version"`
		Items   []struct {
			ID    any      `json:"id"`
			Level string   `json:"level"`
			Title string   `json:"title"`
			Body  string   `json:"body"`
			URL   string   `json:"url"`
			Apps  []string `json:"apps"`
		} `json:"items"`
	}
	if err := json.NewDecoder(io.LimitReader(res.Body, annBytes)).Decode(&doc); err != nil {
		return nil, false
	}
	var crit, rest []annItem
	for _, it := range doc.Items {
		id := idString(it.ID)
		title := clipRunes(it.Title, annTitle)
		if id == "" || title == "" {
			continue
		}
		if len(it.Apps) > 0 && !appliesToFileHop(it.Apps) {
			continue
		}
		ai := annItem{ID: clipRunes(id, 40), Level: "info", Title: title, Body: clipRunes(it.Body, annBody), Closable: true}
		switch it.Level {
		case "warning", "critical":
			ai.Level = it.Level
		}
		ai.Closable = ai.Level != "critical"
		if familyURL(it.URL, s.hub) {
			ai.URL = it.URL
		}
		if ai.Level == "critical" {
			crit = append(crit, ai)
		} else {
			rest = append(rest, ai)
		}
	}
	out := append(crit, rest...) // the hub sent newest first; critical goes before the rest
	if len(out) > annMax {
		out = out[:annMax]
	}
	return out, true
}

func appliesToFileHop(apps []string) bool {
	for _, a := range apps {
		if a == "*" || a == "filehop" {
			return true
		}
	}
	return false
}

func idString(v any) string {
	switch x := v.(type) {
	case string:
		return strings.TrimSpace(x)
	case float64:
		return strconv.FormatFloat(x, 'f', -1, 64)
	}
	return ""
}

// clipRunes trims and cuts at n characters without splitting one.
func clipRunes(s string, n int) string {
	s = strings.TrimSpace(s)
	if utf8.RuneCountInString(s) <= n {
		return s
	}
	r := []rune(s)
	return strings.TrimSpace(string(r[:n]))
}

// WarmAnnouncements starts the first fetch at boot so the first member to
// open the dashboard already finds the card.
func (a *App) WarmAnnouncements() { a.ann.Items() }

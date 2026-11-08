package app

import (
	"encoding/json"
	"errors"
	"io"
	"log"
	"net/http"
	"slices"
	"time"

	"github.com/navi-crwn/FileHop/internal/db"
	"github.com/navi-crwn/FileHop/internal/hop"
)

// The HOP App Protocol v1 (same wire format as NoteHop and PixelHop): Imperium
// reads health, manifest, stats and users here, and the hub pushes account
// events. Every call is signed with this app's registry secret by one of the
// apps in FILEHOP_HOP_CLIENTS. There is no content to moderate: files never
// reach the server, so the manifest lists no content types.

const hopMaxBody = 1 << 20

type hopHandler func(w http.ResponseWriter, r *http.Request, body []byte)

func (a *App) hopRoutes(m *http.ServeMux) {
	m.HandleFunc("GET /hop/health", a.hop(a.hopHealth))
	m.HandleFunc("GET /hop/manifest", a.hop(a.hopManifest))
	m.HandleFunc("GET /hop/stats", a.hop(a.hopStats))
	m.HandleFunc("GET /hop/users/{sub}", a.hop(a.hopUser))
	m.HandleFunc("POST /hop/events", a.hop(a.hopEvent))
	m.HandleFunc("/hop/", a.hop(func(w http.ResponseWriter, r *http.Request, _ []byte) {
		hopFail(w, http.StatusNotFound, "not_found", "no such endpoint")
	}))
}

// hop checks the signature before anything else runs: 404 not_configured
// while sign-in is off, 401 for a bad, stale or replayed signature.
func (a *App) hop(fn hopHandler) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if !a.cfg.SSOEnabled() {
			hopFail(w, http.StatusNotFound, "not_configured", "single sign-on is not configured on this server")
			return
		}
		body, err := io.ReadAll(http.MaxBytesReader(w, r.Body, hopMaxBody))
		if err != nil {
			hopFail(w, http.StatusRequestEntityTooLarge, "too_large", "the request body is too large")
			return
		}
		app := r.Header.Get("X-HOP-App")
		if !slices.Contains(a.cfg.HopClients, app) {
			hopFail(w, http.StatusUnauthorized, "bad_signature", "unknown calling app")
			return
		}
		if err := a.nonces.Verify(r, body, app, []string{a.cfg.SSOSecret}, hop.MaxAge); err != nil {
			hopFail(w, http.StatusUnauthorized, err.Error(), "the request signature was refused")
			return
		}
		fn(w, r, body)
	}
}

func hopOK(w http.ResponseWriter, data any) {
	writeJSON(w, http.StatusOK, map[string]any{"ok": true, "data": data})
}

func hopFail(w http.ResponseWriter, status int, code, msg string) {
	writeJSON(w, status, map[string]any{"ok": false, "error": code, "message": msg})
}

func hopServerErr(w http.ResponseWriter, what string, err error) {
	log.Printf("hop %s: %v", what, err)
	hopFail(w, http.StatusInternalServerError, "server_error", "something went wrong on the server")
}

func iso(t int64) any {
	if t == 0 {
		return nil
	}
	return time.Unix(t, 0).UTC().Format(time.RFC3339)
}

func (a *App) hopHealth(w http.ResponseWriter, r *http.Request, _ []byte) {
	dbState := "ok"
	checks := []map[string]any{{"name": "db", "ok": true, "detail": "sqlite"}}
	if err := a.db.Ping(); err != nil {
		dbState = "error"
		checks[0] = map[string]any{"name": "db", "ok": false, "detail": err.Error()}
	}
	checks = append(checks,
		map[string]any{"name": "sso", "ok": true, "detail": a.cfg.SSOURL},
		map[string]any{"name": "app", "ok": true, "detail": "browser-only conversion, no uploads"})
	hopOK(w, map[string]any{
		"app": "filehop", "version": a.cfg.Version, "uptime_s": int64(time.Since(a.started).Seconds()),
		"db": dbState, "storage": "none", "sso": "ok", "checks": checks,
	})
}

func (a *App) hopManifest(w http.ResponseWriter, r *http.Request, _ []byte) {
	hopOK(w, map[string]any{
		"app": "filehop", "name": "FileHop", "icon": "file", "base_url": a.cfg.BaseURL,
		"capabilities":  []string{"admin_api", "events", "zero_knowledge"},
		"content_types": []any{},
		"actions":       map[string]any{"user": []string{"revoke_sessions"}},
	})
}

func (a *App) hopStats(w http.ResponseWriter, r *http.Request, _ []byte) {
	s, err := a.db.Stats()
	if err != nil {
		hopServerErr(w, "stats", err)
		return
	}
	hopOK(w, map[string]any{"app": "filehop", "totals": s, "files_stored": 0})
}

func (a *App) hopUser(w http.ResponseWriter, r *http.Request, _ []byte) {
	u, err := a.db.UserBySub(r.PathValue("sub"))
	if errors.Is(err, db.ErrNotFound) {
		hopFail(w, http.StatusNotFound, "not_found", "this account never signed in here")
		return
	}
	if err != nil {
		hopServerErr(w, "user", err)
		return
	}
	hopOK(w, map[string]any{"sub": u.Sub, "id": u.ID, "name": u.Name, "email": u.Email, "status": u.Status,
		"created_at": iso(u.CreatedAt), "last_seen_at": iso(u.SeenAt), "content": map[string]int{}})
}

// ---------- account events from the hub ----------

type hopProfile struct {
	Sub         string `json:"sub"`
	HopID       string `json:"hop_id"`
	Name        string `json:"name"`
	DisplayName string `json:"display_name"`
	Email       string `json:"email"`
	Status      string `json:"status"`
}

func (p hopProfile) id() string {
	if p.Sub != "" {
		return p.Sub
	}
	return p.HopID
}

type hopEventBody struct {
	ID   string          `json:"id"`
	Type string          `json:"type"`
	At   string          `json:"at"`
	Data json.RawMessage `json:"data"`
}

func (a *App) hopEvent(w http.ResponseWriter, r *http.Request, body []byte) {
	var e hopEventBody
	if err := json.Unmarshal(body, &e); err != nil || e.ID == "" || e.Type == "" {
		hopFail(w, http.StatusBadRequest, "bad_request", "an event needs an id and a type")
		return
	}
	first, err := a.db.FirstEvent(e.ID)
	if err != nil {
		hopServerErr(w, "event", err)
		return
	}
	if !first {
		hopOK(w, map[string]any{"duplicate": true})
		return
	}
	res, err := a.applyEvent(e)
	if errors.Is(err, db.ErrNotFound) {
		hopOK(w, map[string]any{"ignored": true, "reason": "no such account here"})
		return
	}
	if err != nil {
		a.db.ForgetEvent(e.ID) // so the hub's retry gets another go
		hopServerErr(w, "event "+e.Type, err)
		return
	}
	hopOK(w, res)
}

func (a *App) applyEvent(e hopEventBody) (map[string]any, error) {
	var d struct {
		hopProfile
		Profile *hopProfile `json:"profile"`
	}
	_ = json.Unmarshal(e.Data, &d)
	p := d.hopProfile
	if d.Profile != nil {
		p = *d.Profile
	}
	sub := p.id()
	switch e.Type {
	case "profile.updated":
		name := p.DisplayName
		if name == "" {
			name = p.Name
		}
		return map[string]any{"sub": sub, "updated": true}, a.db.UpdateProfile(sub, clip(p.Email, 254), clip(name, 80))
	case "account.status":
		status := db.StatusActive
		if p.Status != "" && p.Status != db.StatusActive {
			status = db.StatusSuspended
		}
		if err := a.db.SetStatus(sub, status); err != nil {
			return nil, err
		}
		if status == db.StatusSuspended {
			if _, err := a.db.DeleteSessions(sub); err != nil {
				return nil, err
			}
		}
		return map[string]any{"sub": sub, "status": status}, nil
	case "account.deleted":
		return map[string]any{"sub": sub, "deleted": true}, a.db.DeleteUser(sub)
	case "session.revoked":
		n, err := a.db.DeleteSessions(sub)
		if err == nil && n == 0 {
			if _, err2 := a.db.UserBySub(sub); err2 != nil {
				return nil, err2
			}
		}
		return map[string]any{"sub": sub, "revoked": true, "sessions": n}, err
	case "app.secret_rotated":
		// The secret comes from the environment here; nothing to do but acknowledge.
		return map[string]any{"noted": true}, nil
	}
	return map[string]any{"ignored": true, "reason": "unknown event type"}, nil
}

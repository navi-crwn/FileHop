// Package db is FileHop's own SQLite: the HOP ID accounts that signed in here,
// their sessions, and the account events already handled. Files never come
// here: conversion happens in the browser and nothing is uploaded.
package db

import (
	"database/sql"
	"errors"
	"fmt"
	"time"

	_ "modernc.org/sqlite"
)

var ErrNotFound = errors.New("not found")

const (
	StatusActive    = "active"
	StatusSuspended = "suspended"
)

type User struct {
	ID        int64
	Sub       string // the hub's account id (HOP ID)
	Email     string
	Name      string
	Status    string
	CreatedAt int64
	SeenAt    int64
}

type DB struct{ sql *sql.DB }

const schema = `
CREATE TABLE IF NOT EXISTS users (
  id         INTEGER PRIMARY KEY,
  sub        TEXT NOT NULL UNIQUE,
  email      TEXT NOT NULL DEFAULT '',
  name       TEXT NOT NULL DEFAULT '',
  status     TEXT NOT NULL DEFAULT 'active',
  created_at INTEGER NOT NULL,
  seen_at    INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS sessions (
  hash       TEXT PRIMARY KEY,
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at INTEGER NOT NULL,
  verified_at INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS sessions_user ON sessions(user_id);
CREATE TABLE IF NOT EXISTS events (
  id TEXT PRIMARY KEY,
  at INTEGER NOT NULL
);
`

// Open opens (and creates) the database. ":memory:" works for tests.
func Open(path string) (*DB, error) {
	dsn := "file:" + path + "?_pragma=foreign_keys(1)&_pragma=journal_mode(WAL)&_pragma=busy_timeout(5000)"
	s, err := sql.Open("sqlite", dsn)
	if err != nil {
		return nil, err
	}
	if path == ":memory:" {
		s.SetMaxOpenConns(1) // one connection, or each one gets its own empty database
	}
	if _, err := s.Exec(schema); err != nil {
		s.Close()
		return nil, fmt.Errorf("schema: %w", err)
	}
	// A database made before verified_at existed: add the column once. Sessions
	// from before count as never verified, so the first visit re-checks them.
	var has int
	if err := s.QueryRow(`SELECT COUNT(*) FROM pragma_table_info('sessions') WHERE name = 'verified_at'`).Scan(&has); err == nil && has == 0 {
		if _, err := s.Exec(`ALTER TABLE sessions ADD COLUMN verified_at INTEGER NOT NULL DEFAULT 0`); err != nil {
			s.Close()
			return nil, fmt.Errorf("migrate: %w", err)
		}
	}
	return &DB{sql: s}, nil
}

func (d *DB) Close() error { return d.sql.Close() }
func (d *DB) Ping() error  { return d.sql.Ping() }

const userCols = `id, sub, email, name, status, created_at, seen_at`

func scanUser(row interface{ Scan(...any) error }) (*User, error) {
	var u User
	err := row.Scan(&u.ID, &u.Sub, &u.Email, &u.Name, &u.Status, &u.CreatedAt, &u.SeenAt)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, ErrNotFound
	}
	return &u, err
}

// UpsertUser links a signed-in HOP ID to a local row, refreshing the profile.
// The status is not touched here: a suspension only lifts through an event.
func (d *DB) UpsertUser(sub, email, name string) (*User, error) {
	now := time.Now().Unix()
	_, err := d.sql.Exec(`INSERT INTO users (sub, email, name, created_at, seen_at) VALUES (?, ?, ?, ?, ?)
		ON CONFLICT(sub) DO UPDATE SET email = excluded.email, name = excluded.name, seen_at = excluded.seen_at`,
		sub, email, name, now, now)
	if err != nil {
		return nil, err
	}
	return d.UserBySub(sub)
}

func (d *DB) UserBySub(sub string) (*User, error) {
	return scanUser(d.sql.QueryRow(`SELECT `+userCols+` FROM users WHERE sub = ?`, sub))
}

// UpdateProfile changes name and email of an existing account only.
func (d *DB) UpdateProfile(sub, email, name string) error {
	res, err := d.sql.Exec(`UPDATE users SET email = ?, name = ? WHERE sub = ?`, email, name, sub)
	return mustTouch(res, err)
}

func (d *DB) SetStatus(sub, status string) error {
	res, err := d.sql.Exec(`UPDATE users SET status = ? WHERE sub = ?`, status, sub)
	return mustTouch(res, err)
}

// DeleteUser removes the account and, through the foreign key, its sessions.
func (d *DB) DeleteUser(sub string) error {
	res, err := d.sql.Exec(`DELETE FROM users WHERE sub = ?`, sub)
	return mustTouch(res, err)
}

func mustTouch(res sql.Result, err error) error {
	if err != nil {
		return err
	}
	if n, _ := res.RowsAffected(); n == 0 {
		return ErrNotFound
	}
	return nil
}

// ---- sessions ----

func (d *DB) CreateSession(hash string, userID int64, ttl time.Duration) error {
	_, err := d.sql.Exec(`INSERT INTO sessions (hash, user_id, expires_at, verified_at) VALUES (?, ?, ?, ?)`,
		hash, userID, time.Now().Add(ttl).Unix(), time.Now().Unix())
	return err
}

// SessionVerifiedAt is when the hub last vouched for this session: the moment
// its ticket was accepted (0 for a session older than the column).
func (d *DB) SessionVerifiedAt(hash string) (time.Time, error) {
	var at int64
	err := d.sql.QueryRow(`SELECT verified_at FROM sessions WHERE hash = ? AND expires_at > ?`, hash, time.Now().Unix()).Scan(&at)
	if err != nil {
		return time.Time{}, err
	}
	return time.Unix(at, 0), nil
}

// UserBySession returns the account behind a live session.
func (d *DB) UserBySession(hash string) (*User, error) {
	return scanUser(d.sql.QueryRow(`SELECT u.id, u.sub, u.email, u.name, u.status, u.created_at, u.seen_at
		FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.hash = ? AND s.expires_at > ?`, hash, time.Now().Unix()))
}

func (d *DB) DeleteSession(hash string) error {
	_, err := d.sql.Exec(`DELETE FROM sessions WHERE hash = ?`, hash)
	return err
}

// DeleteSessions ends every session of an account (hub: session.revoked, suspension).
func (d *DB) DeleteSessions(sub string) (int64, error) {
	res, err := d.sql.Exec(`DELETE FROM sessions WHERE user_id = (SELECT id FROM users WHERE sub = ?)`, sub)
	if err != nil {
		return 0, err
	}
	return res.RowsAffected()
}

// PurgeExpired drops dead sessions and event ids older than keep.
func (d *DB) PurgeExpired(keep time.Duration) error {
	now := time.Now()
	if _, err := d.sql.Exec(`DELETE FROM sessions WHERE expires_at <= ?`, now.Unix()); err != nil {
		return err
	}
	_, err := d.sql.Exec(`DELETE FROM events WHERE at < ?`, now.Add(-keep).Unix())
	return err
}

// ---- events ----

// FirstEvent records an event id and reports whether it was new, so a retry
// from the hub is acknowledged without being applied twice.
func (d *DB) FirstEvent(id string) (bool, error) {
	res, err := d.sql.Exec(`INSERT OR IGNORE INTO events (id, at) VALUES (?, ?)`, id, time.Now().Unix())
	if err != nil {
		return false, err
	}
	n, _ := res.RowsAffected()
	return n == 1, nil
}

// ForgetEvent lets a failed event be tried again.
func (d *DB) ForgetEvent(id string) { _, _ = d.sql.Exec(`DELETE FROM events WHERE id = ?`, id) }

// ---- numbers for the control center ----

type Stats struct {
	Users     int64 `json:"users"`
	Suspended int64 `json:"users_suspended"`
	Sessions  int64 `json:"sessions_live"`
	Active30d int64 `json:"users_active_30d"`
}

func (d *DB) Stats() (Stats, error) {
	var s Stats
	now := time.Now()
	err := d.sql.QueryRow(`SELECT
		(SELECT COUNT(*) FROM users),
		(SELECT COUNT(*) FROM users WHERE status = 'suspended'),
		(SELECT COUNT(*) FROM sessions WHERE expires_at > ?),
		(SELECT COUNT(*) FROM users WHERE seen_at > ?)`, now.Unix(), now.AddDate(0, 0, -30).Unix()).
		Scan(&s.Users, &s.Suspended, &s.Sessions, &s.Active30d)
	return s, err
}

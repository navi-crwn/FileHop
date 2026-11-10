package db

import (
	"database/sql"
	"path/filepath"
	"strconv"
	"testing"
	"time"
)

// A database made before sessions.verified_at existed opens, gains the column
// once, and its old sessions count as never verified (so they are re-checked).
func TestOpenMigratesOldSessionsTable(t *testing.T) {
	path := filepath.Join(t.TempDir(), "old.db")
	old, err := sql.Open("sqlite", "file:"+path)
	if err != nil {
		t.Fatal(err)
	}
	for _, q := range []string{
		`CREATE TABLE users (id INTEGER PRIMARY KEY, sub TEXT NOT NULL UNIQUE, email TEXT NOT NULL DEFAULT '', name TEXT NOT NULL DEFAULT '', status TEXT NOT NULL DEFAULT 'active', created_at INTEGER NOT NULL, seen_at INTEGER NOT NULL)`,
		`CREATE TABLE sessions (hash TEXT PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE, expires_at INTEGER NOT NULL)`,
		`INSERT INTO users (id, sub, created_at, seen_at) VALUES (1, 'a', 1, 1)`,
		`INSERT INTO sessions VALUES ('h-old', 1, ` + strconv.FormatInt(time.Now().Add(time.Hour).Unix(), 10) + `)`,
	} {
		if _, err := old.Exec(q); err != nil {
			t.Fatal(err)
		}
	}
	old.Close()

	for i := 0; i < 2; i++ { // twice: the migration is idempotent
		d, err := Open(path)
		if err != nil {
			t.Fatal(err)
		}
		at, err := d.SessionVerifiedAt("h-old")
		if err != nil || at.Unix() != 0 {
			t.Fatalf("old session: %v %v", at, err)
		}
		if err := d.CreateSession("h-new", 1, time.Hour); err != nil {
			t.Fatal(err)
		}
		if at, err = d.SessionVerifiedAt("h-new"); err != nil || time.Since(at) > time.Minute {
			t.Fatalf("new session: %v %v", at, err)
		}
		_ = d.DeleteSession("h-new")
		d.Close()
	}
}

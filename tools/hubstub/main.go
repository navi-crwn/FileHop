// hubstub is a stand-in for the hub (hub.hel.ink) and Imperium, for testing
// FileHop's sign-in on one machine. It is a development tool, never deployed.
//
// It does what the real hub does for an app in its registry, with the same
// wire formats:
//
//	GET  /sso/filehop?state&return_to  sign-in page; POST issues a ticket and keeps a stub session cookie
//	GET  /sso/filehop?prompt=none&…    silent: a ticket when that cookie is set, else error=login_required (never a page)
//	GET  /logout                       chained logout through FileHop's /auth/sso/logout
//	POST /push?type=...&sub=...         a signed account event to FileHop /hop/events (as "helink")
//	GET  /imperium/{path...}            a signed GET to FileHop /hop/{path} (as "imperium")
//
// Run (both share one throwaway secret; never a real one):
//
//	FILEHOP_SSO_SECRET=<32+ chars> go run ./tools/hubstub
//	FILEHOP_SSO_URL=http://localhost:8097 FILEHOP_SSO_SECRET=<same> go run ./cmd/filehop
package main

import (
	"bytes"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"html/template"
	"io"
	"log"
	"net/http"
	"net/url"
	"os"
	"strings"
	"time"

	"github.com/navi-crwn/FileHop/internal/hop"
)

var (
	addr    = env("STUB_ADDR", "127.0.0.1:8097")
	self    = env("STUB_URL", "http://"+strings.Replace(addr, "127.0.0.1", "localhost", 1))
	app     = strings.TrimRight(env("FILEHOP_URL", "http://localhost:8095"), "/")
	inner   = strings.TrimRight(env("FILEHOP_INTERNAL_URL", app), "/") // server-to-server, when the browser goes through a tunnel
	client  = env("FILEHOP_SSO_CLIENT", "filehop")
	secret  = os.Getenv("FILEHOP_SSO_SECRET")
	counter int
)

func env(k, d string) string {
	if v := os.Getenv(k); v != "" {
		return v
	}
	return d
}

func b64(b []byte) string { return base64.RawURLEncoding.EncodeToString(b) }

func ticket(claims map[string]any) string {
	js, _ := json.Marshal(claims)
	body := b64(js)
	m := hmac.New(sha256.New, []byte(secret))
	m.Write([]byte(body))
	return body + "." + b64(m.Sum(nil))
}

func localURL(raw string) bool {
	u, err := url.Parse(raw)
	return err == nil && u.Scheme == "http" && (u.Hostname() == "localhost" || u.Hostname() == "127.0.0.1")
}

var page = template.Must(template.New("p").Parse(`<!doctype html><meta charset="utf-8">
<title>hub stub</title><style>body{font:15px/1.5 system-ui;max-width:40rem;margin:3rem auto;padding:0 16px}
input{font:inherit;padding:4px 6px}button{font:inherit;padding:6px 12px;margin:2px}pre{background:#f4f4f5;padding:12px;overflow:auto}</style>
<h1>HOP hub stub</h1><p><em>Local test double for hub.hel.ink and Imperium. Not the real HOP ID.</em></p>
{{if .SignIn}}
<h2>Sign in to {{.Client}}</h2>
<form method="post"><input type="hidden" name="state" value="{{.State}}"><input type="hidden" name="return_to" value="{{.ReturnTo}}">
<p><label>sub <input name="sub" value="1001"></label></p>
<p><label>name <input name="name" value="Ana Tester"></label></p>
<p><label>email <input name="email" value="ana@example.test"></label></p>
<p><label>status <select name="status"><option>active</option><option>suspended</option></select></label></p>
<button>Sign in</button></form>
{{else}}
<p>FileHop: <a href="{{.App}}">{{.App}}</a></p>
<h2>Imperium (signed GET /hop/…)</h2>
<p><a href="/imperium/health">health</a> · <a href="/imperium/manifest">manifest</a> · <a href="/imperium/stats">stats</a> · <a href="/imperium/users/1001">users/1001</a></p>
<h2>Hub events (signed POST /hop/events)</h2>
<form method="post" action="/push"><label>sub <input name="sub" value="1001"></label>
<button name="type" value="session.revoked">session.revoked</button>
<button name="type" value="account.status" formaction="/push?status=suspended">suspend</button>
<button name="type" value="account.status" formaction="/push?status=active">reactivate</button>
<button name="type" value="profile.updated">profile.updated</button>
<button name="type" value="account.deleted">account.deleted</button></form>
<p><a href="/logout">Sign out everywhere (chained logout)</a></p>
{{end}}
{{if .Out}}<h2>Last answer</h2><pre>{{.Out}}</pre>{{end}}`))

type view struct {
	SignIn                  bool
	Client, State, ReturnTo string
	App, Out                string
}

func main() {
	if len(secret) < 32 {
		log.Fatal("set FILEHOP_SSO_SECRET (32+ chars, the same value FileHop gets)")
	}
	m := http.NewServeMux()
	m.HandleFunc("GET /{$}", func(w http.ResponseWriter, r *http.Request) {
		page.Execute(w, view{App: app, Out: r.URL.Query().Get("out")})
	})
	m.HandleFunc("GET /sso/{client}", func(w http.ResponseWriter, r *http.Request) {
		q := r.URL.Query()
		if r.PathValue("client") != client || q.Get("state") == "" || !localURL(q.Get("return_to")) {
			http.Error(w, "unknown client, missing state, or return_to not on localhost", 400)
			return
		}
		if q.Get("prompt") == "none" { // silent: a ticket if the stub "hub session" cookie is set, else login_required, never a page
			if c, err := r.Cookie("stub_acct"); err == nil {
				if f := strings.SplitN(c.Value, "|", 3); len(f) == 3 {
					issue(w, r, q.Get("return_to"), q.Get("state"), f[0], f[1], f[2], "active")
					return
				}
			}
			http.Redirect(w, r, q.Get("return_to")+"?"+url.Values{"error": {"login_required"}, "state": {q.Get("state")}}.Encode(), http.StatusFound)
			return
		}
		page.Execute(w, view{SignIn: true, Client: client, State: q.Get("state"), ReturnTo: q.Get("return_to")})
	})
	m.HandleFunc("POST /sso/{client}", func(w http.ResponseWriter, r *http.Request) {
		if !localURL(r.FormValue("return_to")) {
			http.Error(w, "return_to not on localhost", 400)
			return
		}
		http.SetCookie(w, &http.Cookie{Name: "stub_acct", Path: "/", HttpOnly: true, SameSite: http.SameSiteLaxMode,
			Value: r.FormValue("sub") + "|" + r.FormValue("name") + "|" + r.FormValue("email")})
		issue(w, r, r.FormValue("return_to"), r.FormValue("state"), r.FormValue("sub"), r.FormValue("name"), r.FormValue("email"), r.FormValue("status"))
	})
	// The real hub ends its own session, then walks every app's logout path in turn.
	m.HandleFunc("GET /logout", func(w http.ResponseWriter, r *http.Request) {
		http.SetCookie(w, &http.Cookie{Name: "stub_acct", Path: "/", MaxAge: -1})
		http.Redirect(w, r, app+"/auth/sso/logout?next="+url.QueryEscape(self+"/?out=signed+out+everywhere"), http.StatusFound)
	})
	m.HandleFunc("POST /push", func(w http.ResponseWriter, r *http.Request) {
		counter++
		data := map[string]any{"sub": r.FormValue("sub")}
		switch r.FormValue("type") {
		case "account.status":
			data["status"] = r.URL.Query().Get("status")
		case "profile.updated":
			data["name"], data["email"] = "Ana Renamed", "ana.renamed@example.test"
		}
		body, _ := json.Marshal(map[string]any{"id": fmt.Sprintf("ev-%d-%d", time.Now().UnixNano(), counter),
			"type": r.FormValue("type"), "at": time.Now().UTC().Format(time.RFC3339), "data": data})
		out := call("helink", "POST", "/hop/events", body)
		http.Redirect(w, r, "/?out="+url.QueryEscape(r.FormValue("type")+" → "+out), http.StatusSeeOther)
	})
	m.HandleFunc("GET /imperium/{path...}", func(w http.ResponseWriter, r *http.Request) {
		out := call("imperium", "GET", "/hop/"+r.PathValue("path"), nil)
		http.Redirect(w, r, "/?out="+url.QueryEscape("GET /hop/"+r.PathValue("path")+" → "+out), http.StatusSeeOther)
	})
	log.Printf("hub stub on %s → FileHop at %s (client %q)", self, app, client)
	log.Fatal(http.ListenAndServe(addr, m))
}

// issue sends the browser back to the app with a ticket for the account, as the real hub does.
func issue(w http.ResponseWriter, r *http.Request, returnTo, state, sub, name, email, status string) {
	now := time.Now().Unix()
	counter++
	t := ticket(map[string]any{"sub": sub, "aud": client, "email": email, "name": name, "status": status, "roles": []string{},
		"state": state, "iat": now, "exp": now + 120, "jti": fmt.Sprintf("stub-%d-%d", now, counter), "v": 2})
	http.Redirect(w, r, returnTo+"?ticket="+url.QueryEscape(t), http.StatusFound)
}

func call(as, method, path string, body []byte) string {
	req, _ := http.NewRequest(method, inner+path, bytes.NewReader(body))
	for k, v := range hop.Headers(as, secret, "stub", method, path, body) {
		req.Header[k] = v
	}
	req.Header.Set("Content-Type", "application/json")
	res, err := http.DefaultClient.Do(req)
	if err != nil {
		return err.Error()
	}
	defer res.Body.Close()
	b, _ := io.ReadAll(res.Body)
	var pretty bytes.Buffer
	if json.Indent(&pretty, b, "", "  ") == nil {
		return res.Status + "\n" + pretty.String()
	}
	return res.Status + "\n" + string(b)
}

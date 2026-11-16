package app

import (
	"io"
	"net/http"
	"net/url"
	"regexp"
	"strings"
	"testing"
	"unicode/utf8"
)

// Every address the app answers as a page is listed here; the test below walks all of them. A browser route
// added to the app (web/src/App.svelte, main.ts) must be added to publicPages and so to this walk, or the
// server answers it 404.
func TestEveryRealRouteStaysAnswered(t *testing.T) {
	srv := builtApp(t)
	// pages: 200 in every language, with and without ?lang=
	for _, path := range sitemapRoutes() {
		for _, q := range append([]string{""}, langQueries()...) {
			if res, _ := fetchWith(t, srv.URL, path+q, nil); res.StatusCode != 200 {
				t.Errorf("%s%s: status %d, want 200", path, q, res.StatusCode)
			}
		}
	}
	// the shell also answers a trailing slash on /send and the explicit index file
	for _, path := range []string{"/send/", "/index.html"} {
		if res, _ := fetchWith(t, srv.URL, path, nil); res.StatusCode != 200 {
			t.Errorf("%s: status %d, want 200", path, res.StatusCode)
		}
	}
	// every address of the sitemap, as the sitemap writes it
	res, body := fetchWith(t, srv.URL, "/sitemap.xml", nil)
	if res.StatusCode != 200 {
		t.Fatalf("sitemap: %d", res.StatusCode)
	}
	locs := regexp.MustCompile(`(?:<loc>|href=")([^<"]+)(?:</loc>|")`).FindAllStringSubmatch(body, -1)
	if len(locs) < len(sitemapRoutes())*10 {
		t.Errorf("sitemap lists %d addresses, want at least %d", len(locs), len(sitemapRoutes())*10)
	}
	for _, m := range locs {
		u, err := url.Parse(m[1])
		if err != nil || !strings.HasPrefix(m[1], siteOrigin) {
			t.Errorf("sitemap address %q", m[1])
			continue
		}
		if r, _ := fetchWith(t, srv.URL, u.RequestURI(), nil); r.StatusCode != 200 {
			t.Errorf("sitemap address %s: status %d, want 200", m[1], r.StatusCode)
		}
	}
	// the other real routes: files, the server's own pages, the session and hop endpoints (answers other than 404)
	for path, want := range map[string]int{
		"/robots.txt": 200, "/theme.js": 200, "/manifest.webmanifest": 200, "/mark.svg": 200, "/healthz": 200,
		"/dashboard": 302, "/dashboard/": 301, "/api/v1/me": 200,
	} {
		res, _ := fetchWith(t, srv.URL, path, nil)
		if res.StatusCode != want {
			t.Errorf("%s: status %d, want %d", path, res.StatusCode, want)
		}
	}
}

func langQueries() []string {
	var out []string
	for _, l := range changeLocales {
		out = append(out, "?lang="+url.QueryEscape(l))
	}
	return out
}

// A path that is no page of the app is a real 404: noindex, no canonical, no alternates, no structured data;
// still the app's shell in the visitor's language so the app can answer in its own words.
func TestUnknownRoutesAre404(t *testing.T) {
	srv := builtApp(t)
	paths := []string{
		"/zz-no-such-page-seo-audit", "/features", "/about", "/pricing", "/send/extra", "/send/x/y",
		"/changelog/", "/changelog/x", "/Send", "/SEND", "/index", "/a/b/c",
	}
	for _, p := range paths {
		for _, q := range append([]string{""}, langQueries()...) {
			res, body := fetchWith(t, srv.URL, p+q, nil)
			if res.StatusCode != http.StatusNotFound {
				t.Errorf("%s%s: status %d, want 404", p, q, res.StatusCode)
				continue
			}
			if res.Header.Get("X-Robots-Tag") != "noindex" {
				t.Errorf("%s%s: X-Robots-Tag %q, want noindex", p, q, res.Header.Get("X-Robots-Tag"))
			}
			for _, bad := range []string{`rel="canonical"`, "hreflang", `property="og:url"`, "application/ld+json"} {
				if strings.Contains(body, bad) {
					t.Errorf("%s%s: a 404 page carries %s", p, q, bad)
				}
			}
			if !strings.Contains(body, `<div id="root">`) || !strings.Contains(body, `<script type="module"`) {
				t.Errorf("%s%s: the 404 is not the app shell", p, q)
			}
			if q == "?lang=de" && !strings.Contains(body, `<html lang="de">`) {
				t.Errorf("%s%s: not in German", p, q)
			}
		}
	}
	// HEAD: same status, no body
	req, _ := http.NewRequest("HEAD", srv.URL+"/features", nil)
	res, err := noRedirect().Do(req)
	if err != nil {
		t.Fatal(err)
	}
	b, _ := io.ReadAll(res.Body)
	res.Body.Close()
	if res.StatusCode != 404 || len(b) != 0 {
		t.Errorf("HEAD /features: %d with %d bytes", res.StatusCode, len(b))
	}
	// a missing file is still a plain 404
	if res, _ := fetchWith(t, srv.URL, "/no-such-file.js", nil); res.StatusCode != 404 {
		t.Errorf("missing file: %d", res.StatusCode)
	}
}

// The changelog's meta description tells what the page is, in 70 to 155 characters, in every language, and
// the page carries it in description and og:description.
func TestChangelogDescriptionIsAProperSentence(t *testing.T) {
	srv := builtApp(t)
	seen := map[string]bool{}
	for _, l := range changeLocales {
		d := changeText[l].Desc
		if n := utf8.RuneCountInString(d); n < 70 || n > 155 {
			t.Errorf("%s: description is %d characters, want 70 to 155", l, n)
		}
		if d == changeText[l].Lead || seen[d] {
			t.Errorf("%s: description repeats the lead or another language", l)
		}
		seen[d] = true
		_, body := fetchWith(t, srv.URL, "/changelog?lang="+url.QueryEscape(l), nil)
		for _, tag := range []string{`<meta name="description" content="`, `<meta property="og:description" content="`} {
			if !strings.Contains(body, tag+d+`">`) {
				t.Errorf("%s: /changelog lacks %s%s", l, tag, d)
			}
		}
	}
}

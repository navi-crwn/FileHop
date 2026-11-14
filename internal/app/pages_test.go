package app

import (
	"encoding/json"
	"html"
	"html/template"
	"io"
	"io/fs"
	"net/http"
	"net/http/httptest"
	"regexp"
	"sort"
	"strings"
	"testing"

	"github.com/navi-crwn/FileHop/internal/db"
	"github.com/navi-crwn/FileHop/web"
)

const siteOrigin = "https://file.hel.ink"

// builtApp serves the real web/dist, so these tests read the HTML a crawler gets.
func builtApp(t *testing.T) *httptest.Server {
	t.Helper()
	d, err := db.Open(":memory:")
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { d.Close() })
	a, err := New(Config{Version: "test"}, d, web.Dist())
	if err != nil {
		t.Fatal(err)
	}
	srv := httptest.NewServer(a.Handler())
	t.Cleanup(srv.Close)
	return srv
}

func fetchPage(t *testing.T, url string) (http.Header, string) {
	t.Helper()
	res, err := noRedirect().Get(url)
	if err != nil {
		t.Fatal(err)
	}
	defer res.Body.Close()
	b, _ := io.ReadAll(res.Body)
	return res.Header, string(b)
}

func one(t *testing.T, path, what, body string, re *regexp.Regexp) string {
	t.Helper()
	m := re.FindAllStringSubmatch(body, -1)
	if len(m) != 1 {
		t.Errorf("%s: %d %s, want 1", path, len(m), what)
		return ""
	}
	return m[0][len(m[0])-1]
}

func sitemapRoutes() []string {
	var out []string
	for _, p := range publicPages {
		out = append(out, p.Path)
	}
	return append(out, renderedRoutes...)
}

func TestPublicPagesAreReadableWithoutScripts(t *testing.T) {
	srv := builtApp(t)
	titles := map[string]string{}
	for _, path := range sitemapRoutes() {
		h, body := fetchPage(t, srv.URL+path+"?utm_source=x")
		if h.Get("X-Robots-Tag") != "" {
			t.Errorf("%s: a public page says %q", path, h.Get("X-Robots-Tag"))
		}
		one(t, path, "h1", body, regexp.MustCompile(`<h1[ >]`))
		if got := one(t, path, "canonical", body, regexp.MustCompile(`<link rel="canonical" href="([^"]*)">`)); got != siteOrigin+path {
			t.Errorf("%s: canonical %q", path, got)
		}
		if got := one(t, path, "og:url", body, regexp.MustCompile(`<meta property="og:url" content="([^"]*)">`)); got != siteOrigin+path {
			t.Errorf("%s: og:url %q", path, got)
		}
		if one(t, path, "description", body, regexp.MustCompile(`<meta name="description" content="([^"]+)">`)) == "" {
			t.Errorf("%s: no description", path)
		}
		title := one(t, path, "title", body, regexp.MustCompile(`<title>([^<]+)</title>`))
		if other, dup := titles[title]; dup || title == "" {
			t.Errorf("%s: title %q is also the title of %s", path, title, other)
		}
		titles[title] = path
		checkAlternates(t, path, body)
	}
	for _, p := range publicPages {
		_, body := fetchPage(t, srv.URL+p.Path)
		if !strings.Contains(body, `<div id="root"><div class="hop-static `) || !strings.Contains(body, "<h1>") {
			t.Errorf("%s: no first view inside the mount node", p.Path)
		}
		// shown as it is, not hidden until scripts turn out to be off
		if strings.Contains(body, ".hop-static{display:none") || strings.Contains(body, "<noscript><style>") {
			t.Errorf("%s: the first view is hidden", p.Path)
		}
		// <noscript> holds the one sentence, nothing else
		ns := regexp.MustCompile(`(?s)<noscript>(.*?)</noscript>`).FindAllStringSubmatch(body, -1)
		if len(ns) != 1 || ns[0][1] != `<p class="hs-nojs">`+html.EscapeString(appStrings("en")["app.needs_js"])+`</p>` {
			t.Errorf("%s: noscript %q", p.Path, ns)
		}
		for _, href := range []string{"/changelog", "https://github.com/navi-crwn/FileHop"} {
			if !strings.Contains(body, `<a href="`+href+`"`) {
				t.Errorf("%s: no plain link to %s", p.Path, href)
			}
		}
	}
}

// The first view's heading is the app's: the hero title on the home page, the send title on /send,
// with the accent phrase marked as App.svelte and Send.svelte mark it, in every language.
func TestFirstViewHeadingIsTheAppsHeading(t *testing.T) {
	srv := builtApp(t)
	for _, lang := range changeLocales {
		d := appStrings(lang)
		home := html.EscapeString(d["hero.h1_pre"])
		if heroBreakRe.MatchString(d["hero.h1_pre"]) {
			home += "<br>"
		} else {
			home += " "
		}
		want := map[string]string{
			"/":     home + `<em class="acc">` + html.EscapeString(d["hero.h1_accent"]) + `</em>`,
			"/send": html.EscapeString(d["send.h1_pre"]) + ` <em class="acc">` + html.EscapeString(d["send.h1_accent"]) + `</em>`,
		}
		for path, h1 := range want {
			req, _ := http.NewRequest("GET", srv.URL+path, nil)
			req.AddCookie(&http.Cookie{Name: "hop_lang", Value: lang})
			res, err := http.DefaultClient.Do(req)
			if err != nil {
				t.Fatal(err)
			}
			b, _ := io.ReadAll(res.Body)
			res.Body.Close()
			body := string(b)
			if got := one(t, path, "h1", body, regexp.MustCompile(`<h1>(.*?)</h1>`)); got != h1 {
				t.Errorf("%s %s: h1 %q, want %q", lang, path, got, h1)
			}
			if !strings.Contains(body, `<html lang="`+lang+`">`) {
				t.Errorf("%s %s: not marked as %s", lang, path, lang)
			}
			if !strings.Contains(res.Header.Get("Vary"), "Cookie") {
				t.Errorf("%s: Vary %q", path, res.Header.Get("Vary"))
			}
		}
	}
}

// Every word of the first views comes from the dictionaries, in every language.
func TestFirstViewUsesTheAppsOwnWords(t *testing.T) {
	for _, lang := range changeLocales {
		d := appStrings(lang)
		for _, p := range publicPages {
			missing := map[string]bool{}
			tm := template.Must(firstViewTmpl.Clone()).Funcs(template.FuncMap{"t": func(k string) string {
				if strings.TrimSpace(d[k]) == "" {
					missing[k] = true
				}
				return d[k]
			}})
			if err := tm.ExecuteTemplate(io.Discard, p.View, struct {
				LangCode string
				Break    bool
				Family   []familyApp
			}{"EN", false, changeFamily}); err != nil {
				t.Fatal(err)
			}
			for k := range missing {
				t.Errorf("%s %s: %q is not in the dictionary", lang, p.Path, k)
			}
			for _, k := range []string{p.Title, p.Desc} {
				if k != "" && strings.TrimSpace(d[k]) == "" {
					t.Errorf("%s %s: %q is not in the dictionary", lang, p.Path, k)
				}
			}
		}
	}
}

// The first view comes in the language the app is about to show: the family cookie hop_lang (plain text,
// one of the nine spelled exactly), then the browser's languages; a crawler (no cookie, no language) reads
// English. A route the server does not know gets the home page's first view, not indexed.
func TestFirstViewLanguageAndUnknownRoutes(t *testing.T) {
	srv := builtApp(t)
	get := func(path, cookie, accept string) (http.Header, string) {
		req, _ := http.NewRequest("GET", srv.URL+path, nil)
		if cookie != "" {
			req.AddCookie(&http.Cookie{Name: "hop_lang", Value: cookie})
		}
		if accept != "" {
			req.Header.Set("Accept-Language", accept)
		}
		res, err := http.DefaultClient.Do(req)
		if err != nil {
			t.Fatal(err)
		}
		defer res.Body.Close()
		b, _ := io.ReadAll(res.Body)
		return res.Header, string(b)
	}
	for _, c := range []struct{ cookie, accept, want string }{
		{"", "", "en"}, {"", "de-DE,de;q=0.9", "de"}, {"id", "de", "id"}, {"pt-BR", "", "pt-BR"},
		{"ar", "ja", "ja"}, {"ID", "", "en"},
	} {
		if _, body := get("/", c.cookie, c.accept); !strings.Contains(body, `<html lang="`+c.want+`">`) {
			t.Errorf("cookie %q accept %q: want %s", c.cookie, c.accept, c.want)
		}
	}
	h, body := get("/no-such-page", "", "")
	if h.Get("X-Robots-Tag") != "noindex" || !strings.Contains(body, `<div class="hop-static app">`) {
		t.Errorf("unknown route: %q, first view %v", h.Get("X-Robots-Tag"), strings.Contains(body, "hop-static"))
	}
}

func TestHomeDescribesTheAppAsData(t *testing.T) {
	srv := builtApp(t)
	re := regexp.MustCompile(`<script type="application/ld\+json">(.*?)</script>`)
	h, body := fetchPage(t, srv.URL+"/")
	var v struct {
		Context   string `json:"@context"`
		Type      string `json:"@type"`
		Name      string `json:"name"`
		URL       string `json:"url"`
		Desc      string `json:"description"`
		Category  string `json:"applicationCategory"`
		OS        string `json:"operatingSystem"`
		Offers    struct{ Price string }
		Publisher struct {
			Type string `json:"@type"`
			Name string
			URL  string
		}
	}
	if err := json.Unmarshal([]byte(one(t, "/", "data block", body, re)), &v); err != nil {
		t.Fatal(err)
	}
	if v.Context != "https://schema.org" || v.Type != "WebApplication" || v.Name == "" || v.URL != siteOrigin+"/" || v.Desc == "" ||
		v.Category != appCategory || v.OS != "Any" || v.Offers.Price != "0" ||
		v.Publisher.Type != "Organization" || v.Publisher.Name != "HEL.ink" || v.Publisher.URL != "https://hel.ink" {
		t.Errorf("data block: %+v", v)
	}
	// a data block is not a script: the CSP still allows scripts from this origin only
	if csp := h.Get("Content-Security-Policy"); !strings.Contains(csp, "script-src 'self'") || strings.Contains(strings.SplitN(strings.SplitN(csp, "script-src", 2)[1], ";", 2)[0], "unsafe-inline") {
		t.Errorf("CSP %q", csp)
	}
	if strings.Count(body, "<script") != strings.Count(body, "<script type=\"module\"")+strings.Count(body, "<script src=")+1 {
		t.Errorf("an inline script besides the data block: %s", body)
	}
	if _, other := fetchPage(t, srv.URL+publicPages[1].Path); re.MatchString(other) {
		t.Errorf("%s repeats the home page's data block", publicPages[1].Path)
	}
}

func TestPrivateAndUnknownRoutesAreNotIndexed(t *testing.T) {
	srv := builtApp(t)
	paths := []string{"/no-such-page"}
	for _, pre := range privatePrefixes {
		paths = append(paths, pre+"x")
	}
	paths = append(paths, strings.TrimSuffix(privatePrefixes[len(privatePrefixes)-1], "/"))
	for _, path := range paths {
		if h, _ := fetchPage(t, srv.URL+path); h.Get("X-Robots-Tag") != "noindex" {
			t.Errorf("%s: X-Robots-Tag %q, want noindex", path, h.Get("X-Robots-Tag"))
		}
	}
}

func TestSitemapListsEveryPublicPageAndNothingElse(t *testing.T) {
	srv := builtApp(t)
	res, err := http.Get(srv.URL + "/sitemap.xml")
	if err != nil {
		t.Fatal(err)
	}
	defer res.Body.Close()
	b, _ := io.ReadAll(res.Body)
	if res.StatusCode != 200 || !strings.HasPrefix(res.Header.Get("Content-Type"), "application/xml") {
		t.Fatalf("sitemap.xml: %d %s", res.StatusCode, res.Header.Get("Content-Type"))
	}
	var got, want []string
	for _, m := range regexp.MustCompile(`<loc>([^<]+)</loc>`).FindAllStringSubmatch(string(b), -1) {
		got = append(got, m[1])
	}
	for _, r := range sitemapRoutes() {
		want = append(want, siteOrigin+r)
	}
	sort.Strings(got)
	sort.Strings(want)
	if strings.Join(got, " ") != strings.Join(want, " ") {
		t.Errorf("sitemap.xml lists %v, want %v", got, want)
	}
	robots, err := fs.ReadFile(web.Dist(), "robots.txt")
	if err != nil {
		t.Fatal(err)
	}
	for _, pre := range privatePrefixes {
		if !regexp.MustCompile(`(?m)^Disallow: ` + regexp.QuoteMeta(pre) + `$`).Match(robots) {
			t.Errorf("robots.txt does not keep crawlers out of %s", pre)
		}
	}
}

// KONTRAK-SEO-BAHASA, FileHop: a page written in the visitor's language is in that one language from
// <head> to body, varies on Cookie and Accept-Language, is private to the visitor and, asked without
// ?lang=, keeps the bare canonical (with the ten alternates). Checked with Accept-Language: ru and no cookie, on every public page.
func TestFirstViewIsInOneLanguageAndNeverShared(t *testing.T) {
	srv := builtApp(t)
	ru, en := appStrings("ru"), appStrings("en")
	for _, p := range publicPages {
		req, _ := http.NewRequest("GET", srv.URL+p.Path, nil)
		req.Header.Set("Accept-Language", "ru")
		res, err := http.DefaultClient.Do(req)
		if err != nil {
			t.Fatal(err)
		}
		b, _ := io.ReadAll(res.Body)
		res.Body.Close()
		body := string(b)
		title, desc := html.EscapeString(ru[p.Title]), html.EscapeString(ru[p.Desc])
		for what, want := range map[string]string{
			"html lang":      `<html lang="ru">`,
			"title":          "<title>" + title + "</title>",
			"og:title":       `<meta property="og:title" content="` + title + `">`,
			"og:image:alt":   `<meta property="og:image:alt" content="` + title + `">`,
			"description":    `<meta name="description" content="` + desc + `">`,
			"og:description": `<meta property="og:description" content="` + desc + `">`,
			"canonical":      `<link rel="canonical" href="` + siteOrigin + p.Path + `">`,
		} {
			if !strings.Contains(body, want) {
				t.Errorf("%s: no Russian %s (%s)", p.Path, what, want)
			}
		}
		if p.App {
			var v struct{ Description string }
			json.Unmarshal([]byte(one(t, p.Path, "data block", body, regexp.MustCompile(`<script type="application/ld\+json">(.*?)</script>`))), &v)
			if v.Description != ru[p.Desc] {
				t.Errorf("%s: JSON-LD description %q", p.Path, v.Description)
			}
		}
		for _, k := range []string{p.Title, p.Desc, "app.needs_js"} {
			if strings.Contains(body, html.EscapeString(en[k])) {
				t.Errorf("%s: English %q left in a Russian page", p.Path, k)
			}
		}
		checkAlternates(t, p.Path, body)
		if v := res.Header.Get("Vary"); !strings.Contains(v, "Cookie") || !strings.Contains(v, "Accept-Language") {
			t.Errorf("%s: Vary %q", p.Path, v)
		}
		if cc := res.Header.Get("Cache-Control"); !strings.Contains(cc, "private") && !strings.Contains(cc, "no-store") {
			t.Errorf("%s: Cache-Control %q may let a shared cache keep it", p.Path, cc)
		}
	}
}

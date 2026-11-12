package app

import (
	"encoding/json"
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
		if strings.Contains(body, "hreflang") {
			t.Errorf("%s: hreflang without one address per language", path)
		}
	}
	for _, p := range publicPages {
		_, body := fetchPage(t, srv.URL+p.Path)
		if !strings.Contains(body, `<div id="root"><main class="hop-static"><h1>`) || !strings.Contains(body, "<li>") {
			t.Errorf("%s: no summary inside the mount node", p.Path)
		}
		for _, l := range p.Links {
			if !strings.Contains(body, `<a href="`+l.Href+`">`) {
				t.Errorf("%s: no plain link to %s", p.Path, l.Href)
			}
		}
		if !strings.Contains(body, `<noscript><style>.hop-static{display:block}</style></noscript>`) {
			t.Errorf("%s: the summary cannot be read with scripts off", p.Path)
		}
	}
}

func TestPublicPagesUseTheAppsOwnWords(t *testing.T) {
	dict := appStrings("en")
	for _, p := range publicPages {
		keys := append([]string{p.Title, p.Lead}, p.H1...)
		for _, o := range []string{p.Desc, p.ListTitle} {
			if o != "" {
				keys = append(keys, o)
			}
		}
		for _, it := range p.Items {
			keys = append(keys, it.Text)
			if it.Head != "" {
				keys = append(keys, it.Head)
			}
		}
		for _, l := range p.Links {
			keys = append(keys, l.Text)
		}
		for _, k := range keys {
			if strings.TrimSpace(dict[k]) == "" {
				t.Errorf("%s: %q is not in the English dictionary", p.Path, k)
			}
		}
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
	b, err := fs.ReadFile(web.Dist(), "sitemap.xml")
	if err != nil {
		t.Fatal(err)
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

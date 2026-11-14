package app

import (
	"html"
	"io"
	"net/http"
	"net/url"
	"regexp"
	"strings"
	"testing"
)

// The nine languages in the family order and the address each one has (English: the bare address).
var langOrder = []string{"en", "zh-CN", "de", "id", "ja", "pt-BR", "es", "fr", "ru"}

func wantAddr(path, lang string) string {
	if lang == "en" {
		return siteOrigin + path
	}
	return siteOrigin + path + "?lang=" + lang
}

var (
	altRe   = regexp.MustCompile(`<link rel="alternate" hreflang="([^"]+)" href="([^"]+)">`)
	canonRe = regexp.MustCompile(`<link rel="canonical" href="([^"]*)">`)
	ogURLRe = regexp.MustCompile(`<meta property="og:url" content="([^"]*)">`)
)

// checkAlternates: nine alternates in the family order plus x-default, English and x-default at the bare address.
func checkAlternates(t *testing.T, path, body string) {
	t.Helper()
	got := altRe.FindAllStringSubmatch(body, -1)
	if len(got) != 10 {
		t.Errorf("%s: %d hreflang links, want 10", path, len(got))
		return
	}
	for i, l := range langOrder {
		if got[i][1] != l || got[i][2] != wantAddr(path, l) {
			t.Errorf("%s: alternate %d is %s -> %s, want %s -> %s", path, i, got[i][1], got[i][2], l, wantAddr(path, l))
		}
	}
	if got[9][1] != "x-default" || got[9][2] != siteOrigin+path {
		t.Errorf("%s: x-default %v", path, got[9])
	}
}

func fetchWith(t *testing.T, srv, path string, hdr map[string]string, cookies ...*http.Cookie) (*http.Response, string) {
	t.Helper()
	req, _ := http.NewRequest("GET", srv+path, nil)
	for k, v := range hdr {
		req.Header.Set(k, v)
	}
	for _, c := range cookies {
		req.AddCookie(c)
	}
	res, err := noRedirect().Do(req)
	if err != nil {
		t.Fatal(err)
	}
	defer res.Body.Close()
	b, _ := io.ReadAll(res.Body)
	return res, string(b)
}

// ?lang=<code> is the address of a page in one language: it wins over the cookie and Accept-Language, its
// canonical and og:url are the address itself (the bare one for English), the head and the body are in that
// language, and the internal links keep it.
func TestEveryLanguageHasItsOwnAddress(t *testing.T) {
	srv := builtApp(t)
	for _, path := range sitemapRoutes() {
		for _, lang := range langOrder {
			res, body := fetchWith(t, srv.URL, path+"?lang="+lang, map[string]string{"Accept-Language": "ja"}, &http.Cookie{Name: "hop_lang", Value: "fr"})
			if !strings.Contains(body, `<html lang="`+lang+`">`) {
				t.Errorf("%s ?lang=%s: not served in %s (cookie fr and Accept-Language ja must lose)", path, lang, lang)
			}
			if c := one(t, path, "canonical", body, canonRe); c != wantAddr(path, lang) {
				t.Errorf("%s ?lang=%s: canonical %q, want %q", path, lang, c, wantAddr(path, lang))
			}
			if c := one(t, path, "og:url", body, ogURLRe); c != wantAddr(path, lang) {
				t.Errorf("%s ?lang=%s: og:url %q", path, lang, c)
			}
			checkAlternates(t, path, body)
			if v := res.Header.Get("Vary"); !strings.Contains(v, "Cookie") || !strings.Contains(v, "Accept-Language") {
				t.Errorf("%s ?lang=%s: Vary %q", path, lang, v)
			}
			if cc := res.Header.Get("Cache-Control"); !strings.Contains(cc, "private") && !strings.Contains(cc, "no-cache") && !strings.Contains(cc, "no-store") {
				t.Errorf("%s ?lang=%s: Cache-Control %q", path, lang, cc)
			}
		}
	}
	// the title really is that language's, on the two pages the app writes
	for _, p := range publicPages {
		for _, lang := range langOrder {
			_, body := fetchWith(t, srv.URL, p.Path+"?lang="+lang, nil)
			if !strings.Contains(body, "<title>"+html.EscapeString(appStrings(lang)[p.Title])+"</title>") {
				t.Errorf("%s ?lang=%s: title is not %s's", p.Path, lang, lang)
			}
		}
	}
}

// Other query parameters are dropped from the canonical; an unsupported or empty ?lang= is ignored (the
// visitor's own language, bare canonical); ?lang=pt means pt-BR; ?lang=en is the bare address.
func TestLangAddressEdgeCases(t *testing.T) {
	srv := builtApp(t)
	canon := func(path string, hdr map[string]string, cookies ...*http.Cookie) (string, string) {
		_, body := fetchWith(t, srv.URL, path, hdr, cookies...)
		lang := one(t, path, "html lang", body, regexp.MustCompile(`<html lang="([^"]*)">`))
		return one(t, path, "canonical", body, canonRe), lang
	}
	if c, l := canon("/?lang=de&utm_source=x&page=2", nil); c != siteOrigin+"/?lang=de" || l != "de" {
		t.Errorf("extra parameters: %s %s", c, l)
	}
	if c, l := canon("/send?utm_source=x&lang=ru", nil); c != siteOrigin+"/send?lang=ru" || l != "ru" {
		t.Errorf("lang after another parameter: %s %s", c, l)
	}
	if c, l := canon("/?lang=en", nil, &http.Cookie{Name: "hop_lang", Value: "de"}); c != siteOrigin+"/" || l != "en" {
		t.Errorf("?lang=en: canonical %s, language %s (English lives at the bare address)", c, l)
	}
	if c, l := canon("/?lang=pt", nil); c != siteOrigin+"/?lang=pt-BR" || l != "pt-BR" {
		t.Errorf("?lang=pt: %s %s", c, l)
	}
	for _, bad := range []string{"xx", "", "ar", "de;rm", "%3Cscript%3E"} {
		c, l := canon("/?lang="+bad, map[string]string{"Accept-Language": "es"})
		if c != siteOrigin+"/" || l != "es" {
			t.Errorf("?lang=%q is no language: canonical %s, language %s (want bare, es)", bad, c, l)
		}
	}
	// a request without ?lang= keeps the visitor's language and the bare canonical
	if c, l := canon("/send", nil, &http.Cookie{Name: "hop_lang", Value: "ja"}); c != siteOrigin+"/send" || l != "ja" {
		t.Errorf("cookie only: %s %s", c, l)
	}
	// an unknown route is not indexed: no hreflang, bare canonical, still in the asked language
	res, body := fetchWith(t, srv.URL, "/no-such-page?lang=de", nil)
	if res.Header.Get("X-Robots-Tag") != "noindex" || strings.Contains(body, "hreflang") || !strings.Contains(body, `<html lang="de">`) {
		t.Errorf("unknown route: %q hreflang=%v", res.Header.Get("X-Robots-Tag"), strings.Contains(body, "hreflang"))
	}
	// a private page is not indexed either and gets no alternates
	if res, body := fetchWith(t, srv.URL, "/dashboard?lang=de", nil); strings.Contains(body, "hreflang") || res.Header.Get("X-Robots-Tag") != "noindex" {
		t.Errorf("/dashboard: alternates or no noindex")
	}
}

// The internal links of a page in a language stay in it, on every public page and in the changelog; on a
// bare address, and in English, they stay bare.
func TestInternalLinksKeepTheLanguage(t *testing.T) {
	srv := builtApp(t)
	hrefs := func(body string) map[string]bool {
		out := map[string]bool{}
		for _, m := range regexp.MustCompile(`<a [^>]*href="([^"]+)"`).FindAllStringSubmatch(body, -1) {
			out[m[1]] = true
		}
		return out
	}
	for _, lang := range []string{"de", "zh-CN", "pt-BR"} {
		q := "?lang=" + url.QueryEscape(lang)
		for path, want := range map[string][]string{
			"/":          {"/send" + q, "/changelog" + q},
			"/send":      {"/" + q, "/changelog" + q, "/" + q + "#privacy"},
			"/changelog": {"/" + q, "/" + q + "#privacy"},
		} {
			_, body := fetchWith(t, srv.URL, path+q, nil)
			h := hrefs(body)
			for _, w := range want {
				if !h[w] {
					t.Errorf("%s%s: no link to %s", path, q, w)
				}
			}
			for _, bare := range []string{"/send", "/changelog"} {
				if h[bare] && bare != path {
					t.Errorf("%s%s: link %s lost the language", path, q, bare)
				}
			}
		}
	}
	for _, path := range []string{"/", "/send", "/changelog"} {
		_, body := fetchWith(t, srv.URL, path, nil, &http.Cookie{Name: "hop_lang", Value: "de"})
		if strings.Contains(strings.Join(keys(hrefs(body)), " "), "?lang=") && !strings.Contains(path, "changelog") {
			t.Errorf("%s: a bare request's links carry ?lang=", path)
		}
		_, body = fetchWith(t, srv.URL, path+"?lang=en", nil)
		for h := range hrefs(body) {
			if strings.HasPrefix(h, "/") && strings.Contains(h, "lang=") && !strings.HasPrefix(h, "/changelog?lang=") { // the language menu of the changelog
				t.Errorf("%s?lang=en: link %s carries a language", path, h)
			}
		}
	}
}

func keys(m map[string]bool) []string {
	var out []string
	for k := range m {
		out = append(out, k)
	}
	return out
}

// sitemap.xml: every public page once, bare, each with the nine alternates and x-default.
func TestSitemapCarriesTheAlternates(t *testing.T) {
	srv := builtApp(t)
	_, body := fetchWith(t, srv.URL, "/sitemap.xml", nil)
	if !strings.Contains(body, `xmlns:xhtml="http://www.w3.org/1999/xhtml"`) {
		t.Fatal("no xhtml namespace")
	}
	blocks := regexp.MustCompile(`(?s)<url>(.*?)</url>`).FindAllStringSubmatch(body, -1)
	if len(blocks) != len(sitemapRoutes()) {
		t.Fatalf("%d <url> blocks, want %d", len(blocks), len(sitemapRoutes()))
	}
	for i, path := range sitemapRoutes() {
		b := blocks[i][1]
		if !strings.Contains(b, "<loc>"+siteOrigin+path+"</loc>") {
			t.Errorf("block %d is not %s", i, path)
		}
		links := regexp.MustCompile(`<xhtml:link rel="alternate" hreflang="([^"]+)" href="([^"]+)"/>`).FindAllStringSubmatch(b, -1)
		if len(links) != 10 {
			t.Errorf("%s: %d xhtml:link, want 10", path, len(links))
			continue
		}
		for j, l := range langOrder {
			if links[j][1] != l || links[j][2] != wantAddr(path, l) {
				t.Errorf("%s: %v, want %s -> %s", path, links[j], l, wantAddr(path, l))
			}
		}
		if links[9][1] != "x-default" || links[9][2] != siteOrigin+path {
			t.Errorf("%s: x-default %v", path, links[9])
		}
	}
	if strings.Contains(body, "?lang=en") {
		t.Error("English has a second address in the sitemap")
	}
	// the address is never taken from the request
	_, other := fetchWith(t, srv.URL, "/sitemap.xml", map[string]string{"Host": "evil.example"})
	if strings.Contains(other, "evil.example") {
		t.Error("sitemap built from the request host")
	}
}

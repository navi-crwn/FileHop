package app

import (
	"io"
	"net/http"
	"regexp"
	"strings"
	"testing"
)

func get(t *testing.T, base, path, acceptLang string) (*http.Response, string) {
	t.Helper()
	req, _ := http.NewRequest("GET", base+path, nil)
	if acceptLang != "" {
		req.Header.Set("Accept-Language", acceptLang)
	}
	res, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	defer res.Body.Close()
	b, _ := io.ReadAll(res.Body)
	return res, string(b)
}

func TestChangelogIsARealPageWithTheAppHeaders(t *testing.T) {
	_, srv := newTestApp(t, false)
	res, body := get(t, srv.URL, "/changelog", "")
	if res.StatusCode != 200 || !strings.HasPrefix(res.Header.Get("Content-Type"), "text/html") {
		t.Fatalf("status %d, type %q", res.StatusCode, res.Header.Get("Content-Type"))
	}
	// It must not be the SPA shell.
	if strings.Contains(body, "<div id=\"root\">") || !strings.Contains(body, `class="log"`) {
		t.Fatalf("not the changelog page: %.200s", body)
	}
	// Same isolation and CSP as the shell, character for character.
	root, _ := get(t, srv.URL, "/", "")
	for _, k := range []string{"Cross-Origin-Opener-Policy", "Cross-Origin-Embedder-Policy", "Cross-Origin-Resource-Policy", "Content-Security-Policy"} {
		if res.Header.Get(k) == "" || res.Header.Get(k) != root.Header.Get(k) {
			t.Errorf("%s: changelog %q, shell %q", k, res.Header.Get(k), root.Header.Get(k))
		}
	}
	if res.Header.Get("Content-Security-Policy") != csp || res.Header.Get("Cross-Origin-Embedder-Policy") != "require-corp" {
		t.Errorf("headers changed: %q", res.Header.Get("Content-Security-Policy"))
	}
	// og:image is a file of this repository, on this app's own host.
	if !strings.Contains(body, `content="https://file.hel.ink/og-image.png"`) {
		t.Error("og:image missing")
	}
	// Nothing from another origin is loaded.
	for _, bad := range []string{`src="http`, `href="http://`, "<style src", "cdn."} {
		if strings.Contains(body, bad) {
			t.Errorf("page contains %q", bad)
		}
	}
}

func TestChangelogSnapshotListsFileHopOnly(t *testing.T) {
	h := changes()
	if len(h.Entries) == 0 {
		t.Fatal("empty snapshot")
	}
	for _, e := range h.Entries {
		if !strings.HasPrefix(e.URL, "https://github.com/navi-crwn/FileHop/") {
			t.Fatalf("entry from another repository: %+v", e)
		}
	}
}

func TestChangelogLanguageAndPaging(t *testing.T) {
	_, srv := newTestApp(t, false)
	for lang, want := range map[string]string{"de": "Änderungsprotokoll", "zh-CN": "更新日志", "ru": "История изменений", "fr": "Journal des modifications", "en": "Changelog"} {
		_, body := get(t, srv.URL, "/changelog?lang="+lang, "")
		if !strings.Contains(body, "<h1>"+want+"</h1>") || !strings.Contains(body, `<html lang="`+lang+`">`) {
			t.Errorf("?lang=%s: no %q", lang, want)
		}
	}
	// Accept-Language is used when there is no ?lang=; Arabic is not offered, so English.
	if _, body := get(t, srv.URL, "/changelog", "pt-BR,pt;q=0.9"); !strings.Contains(body, "Histórico de alterações") {
		t.Error("Accept-Language pt-BR ignored")
	}
	// The family cookie hop_lang (any HOP app) comes after ?lang= and before Accept-Language.
	withCookie := func(q, lang, accept string) string {
		req, _ := http.NewRequest("GET", srv.URL+"/changelog"+q, nil)
		req.AddCookie(&http.Cookie{Name: "hop_lang", Value: lang})
		req.Header.Set("Accept-Language", accept)
		res, err := http.DefaultClient.Do(req)
		if err != nil {
			t.Fatal(err)
		}
		defer res.Body.Close()
		b, _ := io.ReadAll(res.Body)
		return string(b)
	}
	if !strings.Contains(withCookie("", "id", "de"), `<html lang="id">`) {
		t.Error("the hop_lang cookie must win over Accept-Language")
	}
	if !strings.Contains(withCookie("?lang=fr", "id", "de"), `<html lang="fr">`) {
		t.Error("?lang= must win over the hop_lang cookie")
	}
	if !strings.Contains(withCookie("", "xx", "de"), `<html lang="de">`) {
		t.Error("a hop_lang that is not one of the nine languages must be ignored")
	}
	if _, body := get(t, srv.URL, "/changelog?lang=ar", "ar"); !strings.Contains(body, "<h1>Changelog</h1>") || strings.Contains(body, `lang="ar"`) {
		t.Error("an unsupported language must fall back to English")
	}
	// Out-of-range and junk page numbers are clamped, never a 500.
	for _, q := range []string{"?page=9999", "?page=-3", "?page=abc"} {
		if res, _ := get(t, srv.URL, "/changelog"+q, ""); res.StatusCode != 200 {
			t.Errorf("%s: status %d", q, res.StatusCode)
		}
	}
	// Every language has every string.
	for _, l := range changeLocales {
		s := changeText[l]
		if s.Title == "" || s.Lead == "" || s.Release == "" || s.PR == "" || s.Commit == "" || s.Newer == "" || s.Older == "" || !strings.Contains(s.PageOf, "%d") || s.Back == "" || s.Theme == "" || s.Language == "" || s.PartOf == "" {
			t.Errorf("%s: incomplete strings", l)
		}
	}
	if len(changeText) != 9 || len(changeNames) != 9 {
		t.Error("the family has nine languages")
	}
}

// The page shows releases in plain language: a title, the items grouped by type with their place in bold, and
// nothing of the git history.
func TestChangelogShowsPlainReleases(t *testing.T) {
	h := changes()
	for _, e := range h.Entries {
		if e.Title == "" || e.Version == "" || len(e.Items) == 0 {
			t.Fatalf("a release without a title, a version or items: %+v", e)
		}
		for _, it := range e.Items {
			if it.Where == "" || it.Text == "" {
				t.Fatalf("an item without a place or a text in %s", e.Version)
			}
		}
	}
	_, srv := newTestApp(t, false)
	for _, lang := range []string{"en", "de", "ru"} {
		_, body := get(t, srv.URL, "/changelog?lang="+lang, "")
		for _, want := range []string{`class="rel"`, "<h3>", "<b>Dashboard, announcements.</b>"} {
			if !strings.Contains(body, want) {
				t.Errorf("?lang=%s: page lacks %q", lang, want)
			}
		}
		for _, bad := range []string{"Merge pull request", "remote-tracking", "feat/", "fix/"} {
			if strings.Contains(body, bad) {
				t.Errorf("?lang=%s: page shows %q", lang, bad)
			}
		}
		if regexp.MustCompile(`(?i)\btrain\b|kereta`).MatchString(body) {
			t.Errorf("?lang=%s: the page has a forbidden word", lang)
		}
	}
	if _, body := get(t, srv.URL, "/changelog?lang=de", ""); !strings.Contains(body, "<h3>Behoben</h3>") && !strings.Contains(body, "<h3>Neu</h3>") {
		t.Error("the group labels are not translated")
	}
}

// Every language has every label the cards need.
func TestChangelogLabelsExistInNineLanguages(t *testing.T) {
	for _, l := range changeLocales {
		s := changeText[l]
		for name, v := range map[string]string{"Details": s.Details, "Added": s.Added, "Changed": s.Changed, "Fixed": s.Fixed, "Security": s.Security, "Removed": s.Removed, "Deprecated": s.Deprecated, "Lead": s.Lead} {
			if strings.TrimSpace(v) == "" {
				t.Errorf("%s: no %s", l, name)
			}
		}
	}
}

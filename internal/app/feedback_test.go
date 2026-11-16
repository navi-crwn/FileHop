package app

import (
	"html"
	"net/http/httptest"
	"regexp"
	"strings"
	"testing"

	"github.com/navi-crwn/FileHop/internal/db"
	"github.com/navi-crwn/FileHop/web"
)

// builtAppWith serves the real web/dist with the given hub setting, so these tests read the HTML a visitor gets.
func builtAppWith(t *testing.T, hub string) *httptest.Server {
	t.Helper()
	d, err := db.Open(":memory:")
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { d.Close() })
	cfg := Config{Version: "1.4.0", SSOClient: "filehop"}
	if hub != "" {
		cfg.SSOURL, cfg.SSOSecret = hub, testSecret
	}
	a, err := New(cfg, d, web.Dist())
	if err != nil {
		t.Fatal(err)
	}
	srv := httptest.NewServer(a.Handler())
	t.Cleanup(srv.Close)
	return srv
}

func TestFeedbackURLContract(t *testing.T) {
	cases := []struct{ hub, screen, ver, want string }{
		{"https://hub.hel.ink", "home", "1.4.0", "https://hub.hel.ink/feedback?app=filehop&from=home&v=1.4.0"},
		{"https://hub.hel.ink/", "send", "dev", "https://hub.hel.ink/feedback?app=filehop&from=send&v=dev"},
		{"https://hub.hel.ink", "home", "", "https://hub.hel.ink/feedback?app=filehop&from=home"},
		{"https://hub.hel.ink", "a b?x=1#y", "1.0 beta<>", "https://hub.hel.ink/feedback?app=filehop&from=abx1y&v=1.0beta"},
		{"", "home", "1", ""},
		{"not a url", "home", "1", ""},
		{"javascript:alert(1)", "home", "1", ""},
	}
	for _, c := range cases {
		if got := feedbackURL(c.hub, c.screen, c.ver); got != c.want {
			t.Errorf("feedbackURL(%q,%q,%q) = %q, want %q", c.hub, c.screen, c.ver, got, c.want)
		}
	}
	long := feedbackURL("https://h.example", strings.Repeat("a", 200), strings.Repeat("1", 99))
	if !strings.Contains(long, "from="+strings.Repeat("a", 80)+"&") || !strings.HasSuffix(long, "v="+strings.Repeat("1", 24)) {
		t.Errorf("long values are not cut to 80 and 24: %s", long)
	}
}

var feedbackLinkRe = regexp.MustCompile(`<a href="([^"]*/feedback\?[^"]*)" target="_blank" rel="noopener">`)

func feedbackLinks(body string) []string {
	var out []string
	for _, m := range feedbackLinkRe.FindAllStringSubmatch(body, -1) {
		out = append(out, html.UnescapeString(m[1]))
	}
	return out
}

func TestFeedbackLinkOnPublicPages(t *testing.T) {
	srv := builtAppWith(t, "https://hub.example.org")
	want := func(screen string) string {
		return "https://hub.example.org/feedback?app=filehop&from=" + screen + "&v=1.4.0"
	}
	for _, c := range []struct{ path, screen string }{
		{"/", "home"}, {"/send", "send"}, {"/changelog", "changelog"},
		// an address the person typed never reaches the hub, nor a send code, query or fragment
		{"/send?code=123456&lang=de", "send"}, {"/changelog?page=2", "changelog"}, {"/nothing-here/9f8e7d", "other"},
	} {
		_, body := fetchPage(t, srv.URL+c.path)
		links := feedbackLinks(body)
		// the home page and the changelog carry it in their footer; /send in the sidebar foot and nowhere else
		if len(links) != 1 || links[0] != want(c.screen) {
			t.Errorf("%s: Feedback links %v, want exactly [%s]", c.path, links, want(c.screen))
		}
		if strings.Contains(body, "123456") && strings.Contains(strings.Join(links, " "), "123456") {
			t.Errorf("%s: a send code reached the Feedback link", c.path)
		}
	}
	// the Privacy card on the home page says what the link is, with a link to the hub's privacy page
	_, home := fetchPage(t, srv.URL+"/")
	if !regexp.MustCompile(`<p id="feedbackNote">[^<]+<a href="https://hub\.example\.org/privacy" rel="noopener">[^<]+</a>[^<]*</p>`).MatchString(home) {
		t.Errorf("no Feedback sentence with a link to the hub's privacy page in the Privacy card")
	}
	if strings.Contains(home, "hel.ink/privacy") {
		t.Errorf("the Privacy sentence names hel.ink instead of the hub this app is connected to")
	}
	// every language has the words (no empty link text, no raw key)
	for _, l := range changeLocales {
		_, body := fetchPage(t, srv.URL+"/?lang="+l)
		if m := regexp.MustCompile(`target="_blank" rel="noopener">([^<]*)</a>`).FindStringSubmatch(body); m == nil || strings.TrimSpace(m[1]) == "" || strings.Contains(m[1], "footer.") {
			t.Errorf("%s: Feedback link text %q", l, m)
		}
	}
}

func TestNoFeedbackWithoutHubAddress(t *testing.T) {
	srv := builtAppWith(t, "")
	for _, path := range []string{"/", "/send", "/changelog", "/nothing-here", "/?lang=ru"} {
		_, body := fetchPage(t, srv.URL+path)
		if strings.Contains(body, "/feedback") || strings.Contains(body, "feedbackNote") {
			t.Errorf("%s: a Feedback link or sentence without a hub address", path)
		}
	}
}

func TestMeTellsTheVersion(t *testing.T) {
	_, srv := newTestApp(t, true)
	me := decode(t, mustGet(t, noRedirect(), srv.URL+"/api/v1/me"))
	if me["version"] != "test" {
		t.Errorf("/api/v1/me version = %v, want the running version", me["version"])
	}
}

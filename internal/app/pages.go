package app

import (
	"bytes"
	_ "embed"
	"encoding/json"
	"fmt"
	"html"
	"html/template"
	"net/http"
	"regexp"
	"strings"
)

/*
The app shell is an empty <div id="root">: a crawler that does not run scripts
reads nothing in it, and a visitor looks at an empty page until the app has
loaded. So every public route is served with its own title, description and
canonical address, and with a first view of the page inside the mount node
(firstview.html.tmpl): the app's own markup, classes and words, painted at
once in the theme theme.js reads from the family cookie. web/src/main.ts keeps
it on screen until the app can show the same thing, then the app takes its
place.

The words are the app's own dictionaries (web/src/lib/i18n); nothing is
written here. A crawler, which sends no cookie, gets English; a visitor gets
the language the app is about to show (pageLang). The whole page, head
included, is in that one language; the answer varies on Cookie and
Accept-Language and is private, so no shared cache hands one visitor's
language to another (KONTRAK-SEO-BAHASA, FileHop).
*/

type publicPage struct {
	Path  string
	Title string // <title> and og:title
	Desc  string // description and og:description
	View  string // its first view in firstview.html.tmpl
	App   bool   // carries the WebApplication description (the home page)
}

var publicPages = []publicPage{
	{Path: "/", Title: "app.title", Desc: "app.description", View: "home", App: true},
	{Path: "/send", Title: "send.title", Desc: "send.lead", View: "send"},
}

// renderedRoutes are public pages the server renders itself (changelog.go); with publicPages they are sitemap.xml.
var renderedRoutes = []string{"/changelog"}

// privatePrefixes are never for a search index; robots.txt keeps crawlers out of them too.
var privatePrefixes = []string{"/api/", "/auth/", "/hop/", "/dashboard"}

const appCategory = "UtilitiesApplication"

const pageMount = `<div id="root"></div>`

//go:embed firstview.html.tmpl
var firstViewSrc string

// firstViewTmpl is parsed once; each language renders a clone with its own words.
var firstViewTmpl = template.Must(template.New("firstview").Funcs(template.FuncMap{
	"t": func(string) string { return "" }, "hint": func() template.HTML { return "" }, "partOf": func() template.HTML { return "" },
	"icon": firstViewIcon,
}).Parse(firstViewSrc))

// The shapes of web/src/lib/components/Icon.svelte that the first view draws.
var firstViewIcons = map[string]string{
	"plus":    "M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8zM14 3v5h5", // Icon.svelte has no "plus": it draws "file"
	"upload":  "M12 16V4m0 0-4 4m4-4 4 4M4 16v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2",
	"image":   "M4 5h16v14H4zM4 15l4.5-4.5 4 4 3-3L20 15m-11-6.5a1.25 1.25 0 1 1-2.5 0 1.25 1.25 0 0 1 2.5 0",
	"pdf":     "M7 3h7l5 5v13H7zM14 3v5h5M9.5 17v-4h1.2a1.3 1.3 0 0 1 0 2.6H9.5",
	"data":    "M4 6c0-1.7 3.6-3 8-3s8 1.3 8 3-3.6 3-8 3-8-1.3-8-3zM4 6v12c0 1.7 3.6 3 8 3s8-1.3 8-3V6M4 12c0 1.7 3.6 3 8 3s8-1.3 8-3",
	"text":    "M5 5h14M5 10h9M5 15h14M5 20h7",
	"archive": "M4 4h16v5H4zM4 9h16v11H4zM12 12v4m0 0-2-2m2 2 2-2",
	"hash":    "M9 4 7 20M17 4l-2 16M4 9h16M3 15h16",
	"gear":    "M12 15.5a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7zM19.4 15a1.7 1.7 0 0 0 .34 1.87l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.7 1.7 0 0 0-1.87-.34 1.7 1.7 0 0 0-1 1.55V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.56 1.7 1.7 0 0 0-1.87.34l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.7 1.7 0 0 0 .34-1.87 1.7 1.7 0 0 0-1.55-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.56-1.1 1.7 1.7 0 0 0-.34-1.87l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.7 1.7 0 0 0 1.87.34H9a1.7 1.7 0 0 0 1-1.55V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.55 1.7 1.7 0 0 0 1.87-.34l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.7 1.7 0 0 0-.34 1.87V9a1.7 1.7 0 0 0 1.55 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z",
	"sun":     "M12 4V2m0 20v-2m8-8h2M2 12h2m13.7-5.7 1.4-1.4M4.9 19.1l1.4-1.4m11.4 0 1.4 1.4M4.9 4.9l1.4 1.4M16 12a4 4 0 1 1-8 0 4 4 0 0 1 8 0z",
	"moon":    "M20 14.5A8.5 8.5 0 0 1 9.5 4a8.5 8.5 0 1 0 10.5 10.5z",
	"refresh": "M20 12a8 8 0 1 1-2.3-5.7M20 4v4h-4",
	"net":     "M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM3 12h18M12 3a13 13 0 0 1 0 18 13 13 0 0 1 0-18z",
	"shield":  "M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z",
	"menu":    "M4 7h16M4 12h16M4 17h16",
}

func firstViewIcon(name string, size int) template.HTML {
	return template.HTML(fmt.Sprintf(`<svg width="%d" height="%d" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="%s"/></svg>`,
		size, size, firstViewIcons[name]))
}

// pageStyle: the app's own stylesheet draws the first view; this covers only what it needs on top.
// The /send rules repeat the scoped ones of web/src/lib/send/Send.svelte, whose stylesheet arrives with
// that component. The first rule keeps the app unseen while it is mounted behind the first view (main.ts).
const pageStyle = `<style>#root>.hop-static~*{display:none}` +
	`@media (scripting:none){.hop-static .hs-js{display:none}}` +
	// without scripts the top bar has no controls, so it shows the name (the app hides it on small screens
	// to make room for its buttons); on /send, where the side bar is a drawer below 1024 px, the logo too
	`.hs-bar-brand{display:none}@media (scripting:none){.hop-static .brand .hop-name{display:inline}}` +
	`@media (scripting:none) and (max-width:1023px){.hop-static .hs-bar-brand{display:inline-flex}}` +
	`.hs-nojs{margin:0;font-weight:600}` +
	`.hs-sun{display:contents}.hs-moon{display:none}` +
	`:root[data-theme="light"] .hs-sun{display:none}:root[data-theme="light"] .hs-moon{display:contents}` +
	`@media (prefers-color-scheme:light){:root:not([data-theme="dark"]) .hs-sun{display:none}:root:not([data-theme="dark"]) .hs-moon{display:contents}}` +
	`.hs-send{max-width:1180px;margin-inline:auto;display:grid;gap:16px}.hs-send p{margin:0}` +
	`.hs-intro h1{margin:6px 0 10px;font-size:clamp(28px,3.6vw,42px);line-height:1.05;font-weight:800;letter-spacing:-.04em;text-wrap:balance}` +
	`.hs-lead{color:var(--muted);max-width:60ch}` +
	`.hs-cols{display:grid;gap:16px;grid-template-columns:minmax(0,7fr) minmax(0,5fr);align-items:start}@media (max-width:1023px){.hs-cols{grid-template-columns:minmax(0,1fr)}}` +
	`.hs-main,.hs-side{display:grid;gap:16px;align-content:start;min-width:0}` +
	`.hs-sc{background:var(--panel);border:1px solid var(--line-2);border-radius:var(--radius);padding:18px;display:grid;gap:12px;justify-items:start}` +
	`.hs-h{margin:0;font-size:17px}.hs-hint{font-size:13px;color:var(--muted)}` +
	`.hs-two{display:grid;gap:16px;grid-template-columns:1fr 1fr}@media (max-width:640px){.hs-two{grid-template-columns:1fr}.hs-join{order:-1}}` +
	`.hs-side .steps{grid-template-columns:minmax(0,1fr)}` +
	`.hs-assure{gap:8px}.hs-assure p{display:flex;gap:8px;align-items:flex-start;font-size:13.5px;color:var(--muted)}.hs-assure svg{flex:none;margin-top:2px;color:var(--green)}` +
	`.hs-srow{display:flex;gap:8px;align-items:center;flex-wrap:wrap}` +
	`.hs-field{height:var(--hop-ctl-h,36px);padding:0 12px;border-radius:var(--radius-sm);border:1px solid var(--line-2);background:var(--bg-2);color:var(--text);font-size:16px;width:9rem;letter-spacing:.12em;font-variant-numeric:tabular-nums;font-family:var(--mono)}` +
	`.hs-sc label{font-size:13px;font-weight:600}` +
	`.hs-note{display:flex;gap:8px;align-items:flex-start;font-size:13px;color:var(--muted)}.hs-note svg{flex:none;margin-top:2px}</style>`

var (
	pageTitleRe   = regexp.MustCompile(`<title>[^<]*</title>`)
	pageDescRe    = regexp.MustCompile(`<meta name="description" content="([^"]*)">`)
	pageOGTitleRe = regexp.MustCompile(`<meta property="og:title" content="[^"]*">`)
	pageOGDescRe  = regexp.MustCompile(`<meta property="og:description" content="[^"]*">`)
	pageOGURLRe   = regexp.MustCompile(`<meta property="og:url" content="[^"]*">`)
	pageOGAltRe   = regexp.MustCompile(`<meta property="og:image:alt" content="[^"]*">`)
	pageSiteRe    = regexp.MustCompile(`<meta property="og:site_name" content="([^"]*)">`)
	pageCanonRe   = regexp.MustCompile(`<link rel="canonical" href="[^"]*">`)
	pageOriginRe  = regexp.MustCompile(`<(?:link rel="canonical" href|meta property="og:url" content)="(https?://[^/"]+)/?">`)
	pageLangRe    = regexp.MustCompile(`<html lang="[^"]*">`)
	heroBreakRe   = regexp.MustCompile(`[、，。]$`)
)

// buildPages is the shell as each public route is served, per language (lang -> path -> page). The
// site's address is the one index.html already states; without it the shell is served as it is.
func buildPages(index []byte) map[string]map[string][]byte {
	m := pageOriginRe.FindSubmatch(index)
	if m == nil {
		return nil
	}
	out := map[string]map[string][]byte{}
	for _, lang := range changeLocales {
		dict := appStrings(lang)
		out[lang] = map[string][]byte{}
		for _, p := range publicPages {
			out[lang][p.Path] = renderPage(index, string(m[1]), p, lang, dict)
		}
	}
	return out
}

func renderPage(index []byte, origin string, p publicPage, lang string, dict map[string]string) []byte {
	text := func(key string) string { return html.EscapeString(strings.TrimSpace(dict[key])) }
	url := origin + p.Path
	b := pageLangRe.ReplaceAllLiteral(index, []byte(`<html lang="`+lang+`">`))
	if t := text(p.Title); t != "" {
		b = pageTitleRe.ReplaceAllLiteral(b, []byte("<title>"+t+"</title>"))
		b = pageOGTitleRe.ReplaceAllLiteral(b, []byte(`<meta property="og:title" content="`+t+`">`))
		b = pageOGAltRe.ReplaceAllLiteral(b, []byte(`<meta property="og:image:alt" content="`+t+`">`))
	}
	if d := text(p.Desc); p.Desc != "" && d != "" {
		b = pageDescRe.ReplaceAllLiteral(b, []byte(`<meta name="description" content="`+d+`">`))
		b = pageOGDescRe.ReplaceAllLiteral(b, []byte(`<meta property="og:description" content="`+d+`">`))
	}
	b = pageOGURLRe.ReplaceAllLiteral(b, []byte(`<meta property="og:url" content="`+url+`">`))

	canonical := `<link rel="canonical" href="` + url + `">`
	head := pageStyle
	if pageCanonRe.Match(b) {
		b = pageCanonRe.ReplaceAllLiteral(b, []byte(canonical))
	} else {
		head = canonical + "\n" + head
	}
	if p.App {
		head += "\n" + appData(b, origin)
	}
	b = bytes.Replace(b, []byte("</head>"), []byte(head+"\n</head>"), 1)
	return bytes.Replace(b, []byte(pageMount), []byte(`<div id="root">`+firstView(p.View, lang, dict)+`</div>`), 1)
}

// firstView renders one view of firstview.html.tmpl in one language.
func firstView(view, lang string, dict map[string]string) string {
	t := func(k string) string { return dict[k] }
	partPre, partPost, _ := strings.Cut(t("footer.part_of"), "{name}")
	hintPre, hintPost, _ := strings.Cut(t("drop.hint"), "{kbd}")
	tm := template.Must(firstViewTmpl.Clone()).Funcs(template.FuncMap{
		"t": t,
		"hint": func() template.HTML {
			return template.HTML(html.EscapeString(hintPre) + "<kbd>Ctrl/⌘ V</kbd>" + html.EscapeString(hintPost))
		},
		"partOf": func() template.HTML {
			return template.HTML(html.EscapeString(partPre) + "<b>Hop Easy Link</b>" + html.EscapeString(partPost))
		},
	})
	var s strings.Builder
	err := tm.ExecuteTemplate(&s, view, struct {
		LangCode string
		Break    bool // Japanese and Chinese start the accent phrase on its own line, as App.svelte does
		Family   []familyApp
	}{strings.ToUpper(strings.SplitN(lang, "-", 2)[0]), heroBreakRe.MatchString(t("hero.h1_pre")), changeFamily})
	if err != nil {
		panic(err) // the template is part of the binary: a broken one fails the tests, never a request
	}
	return s.String()
}

// appData describes the app to search engines (schema.org WebApplication). It is
// a data block, not a script: the browser never runs it, so the CSP is untouched.
func appData(page []byte, origin string) string {
	find := func(re *regexp.Regexp) string {
		if m := re.FindSubmatch(page); m != nil {
			return html.UnescapeString(string(m[1]))
		}
		return ""
	}
	js, err := json.Marshal(map[string]any{
		"@context":            "https://schema.org",
		"@type":               "WebApplication",
		"name":                find(pageSiteRe),
		"url":                 origin + "/",
		"description":         find(pageDescRe),
		"applicationCategory": appCategory,
		"operatingSystem":     "Any",
		"offers":              map[string]any{"@type": "Offer", "price": "0", "priceCurrency": "USD"},
		"publisher":           map[string]any{"@type": "Organization", "name": "HEL.ink", "url": "https://hel.ink"},
	})
	if err != nil {
		return ""
	}
	return `<script type="application/ld+json">` + string(js) + `</script>`
}

// shell is the HTML of an app route: a public one as built above, in the visitor's language. Any other
// path gets the home page's first view (the app shows its home there too), marked so it is not indexed.
func (a *App) shell(name string, r *http.Request, h http.Header) []byte {
	route := "/" + name
	if name == "index.html" {
		route = "/"
	}
	if route != "/" && !isPublicPage(route) {
		h.Set("X-Robots-Tag", "noindex")
		route = "/"
	}
	if a.pages == nil {
		return a.index
	}
	h.Add("Vary", "Cookie, Accept-Language")
	return a.pages[pageLang(r)][route]
}

func isPublicPage(route string) bool {
	for _, p := range publicPages {
		if p.Path == route {
			return true
		}
	}
	return false
}

// pageLang is the language the app will show, as far as the server can tell: the family cookie, then the
// browser's languages. The app also reads its old localStorage key, which the server cannot see.
func pageLang(r *http.Request) string {
	if l := cookieLang(r); l != "" {
		return l
	}
	return acceptLang(r)
}

func privatePath(p string) bool {
	for _, pre := range privatePrefixes {
		if strings.HasPrefix(p, pre) {
			return true
		}
	}
	return false
}

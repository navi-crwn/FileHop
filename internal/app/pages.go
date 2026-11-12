package app

import (
	"bytes"
	"encoding/json"
	"html"
	"net/http"
	"regexp"
	"strings"
)

/*
The app shell is an empty <div id="root">: a crawler that does not run scripts
reads nothing in it. So every public route is served with its own title,
description and canonical address, and with a plain summary of the page inside
the mount node. web/src/main.ts empties the node before the app mounts and the
summary is only displayed when scripts are off, so nothing changes on screen.

The words are the app's own: every entry of publicPages names keys of the
English dictionary (web/src/lib/i18n/en.json). Nothing is written here.
*/

type pageItem struct{ Head, Text string }

type pageLink struct{ Href, Text string }

type publicPage struct {
	Path      string
	Title     string     // <title> and og:title
	Desc      string     // description; "" keeps the one written in index.html
	H1        []string   // joined with a space
	Lead      string     // the paragraph under the heading
	ListTitle string     // heading of the list; "" for none
	Items     []pageItem // what the page does
	Links     []pageLink // the other public routes
	App       bool       // carries the WebApplication description (the home page)
}

var publicPages = []publicPage{
	{
		Path: "/", Title: "app.title", H1: []string{"hero.h1"}, Lead: "hero.lead", ListTitle: "formats.title",
		Items: []pageItem{
			{"formats.images", "formats.images_v"}, {"formats.pdf", "formats.pdf_v"}, {"formats.data", "formats.data_v"},
			{"formats.text", "formats.text_v"}, {"formats.archive", "formats.archive_v"}, {"formats.hash", "formats.hash_v"},
			{"", "footer.note"},
		},
		Links: []pageLink{{"/send", "send.footer_link"}, {"/changelog", "footer.changelog"}},
		App:   true,
	},
	{
		Path: "/send", Title: "send.title", Desc: "send.lead", H1: []string{"send.h1_pre", "send.h1_accent"}, Lead: "send.lead",
		Items: []pageItem{{"", "send.scan"}, {"", "send.verify_note"}, {"", "send.done_in"}, {"", "send.privacy_note"}, {"", "send.unscanned"}},
		Links: []pageLink{{"/", "send.convert"}, {"/changelog", "footer.changelog"}},
	},
}

// renderedRoutes are public pages the server renders itself (changelog.go); with publicPages they are sitemap.xml.
var renderedRoutes = []string{"/changelog"}

// privatePrefixes are never for a search index; robots.txt keeps crawlers out of them too.
var privatePrefixes = []string{"/api/", "/auth/", "/hop/", "/dashboard"}

const appCategory = "UtilitiesApplication"

const pageMount = `<div id="root"></div>`

// Hidden until scripts are known to be off, so the summary never flashes before the app mounts.
const pageStyle = `<style>.hop-static{display:none;max-width:44rem;margin:0 auto;padding:2rem 1.25rem;line-height:1.6}.hop-static a{color:inherit}</style>` +
	`<noscript><style>.hop-static{display:block}</style></noscript>`

var (
	pageTitleRe   = regexp.MustCompile(`<title>[^<]*</title>`)
	pageDescRe    = regexp.MustCompile(`<meta name="description" content="([^"]*)">`)
	pageOGTitleRe = regexp.MustCompile(`<meta property="og:title" content="[^"]*">`)
	pageOGDescRe  = regexp.MustCompile(`<meta property="og:description" content="[^"]*">`)
	pageOGURLRe   = regexp.MustCompile(`<meta property="og:url" content="[^"]*">`)
	pageSiteRe    = regexp.MustCompile(`<meta property="og:site_name" content="([^"]*)">`)
	pageCanonRe   = regexp.MustCompile(`<link rel="canonical" href="[^"]*">`)
	pageOriginRe  = regexp.MustCompile(`<(?:link rel="canonical" href|meta property="og:url" content)="(https?://[^/"]+)/?">`)
)

// buildPages is the shell as each public route is served. The site's address is
// the one index.html already states; without it the shell is served as it is.
func buildPages(index []byte, dict map[string]string) map[string][]byte {
	m := pageOriginRe.FindSubmatch(index)
	if m == nil {
		return nil
	}
	out := map[string][]byte{}
	for _, p := range publicPages {
		out[p.Path] = renderPage(index, string(m[1]), p, dict)
	}
	return out
}

func renderPage(index []byte, origin string, p publicPage, dict map[string]string) []byte {
	text := func(keys ...string) string {
		var parts []string
		for _, k := range keys {
			if v := strings.TrimSpace(dict[k]); v != "" {
				parts = append(parts, html.EscapeString(v))
			}
		}
		return strings.Join(parts, " ")
	}
	url := origin + p.Path
	b := index
	if t := text(p.Title); t != "" {
		b = pageTitleRe.ReplaceAllLiteral(b, []byte("<title>"+t+"</title>"))
		b = pageOGTitleRe.ReplaceAllLiteral(b, []byte(`<meta property="og:title" content="`+t+`">`))
	}
	if d := text(p.Desc); d != "" {
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

	var s strings.Builder
	s.WriteString(`<main class="hop-static"><h1>` + text(p.H1...) + `</h1>`)
	if v := text(p.Lead); v != "" {
		s.WriteString("<p>" + v + "</p>")
	}
	if v := text(p.ListTitle); v != "" {
		s.WriteString("<h2>" + v + "</h2>")
	}
	s.WriteString("<ul>")
	for _, it := range p.Items {
		v := text(it.Text)
		if v == "" {
			continue
		}
		if hd := text(it.Head); hd != "" {
			v = "<strong>" + hd + "</strong>: " + v
		}
		s.WriteString("<li>" + v + "</li>")
	}
	s.WriteString("</ul><nav><ul>")
	for _, l := range p.Links {
		if v := text(l.Text); v != "" {
			s.WriteString(`<li><a href="` + l.Href + `">` + v + `</a></li>`)
		}
	}
	s.WriteString("</ul></nav></main>")
	return bytes.Replace(b, []byte(pageMount), []byte(`<div id="root">`+s.String()+`</div>`), 1)
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

// shell is the HTML of an app route: a public one as built above, any other
// path the bare shell, marked so it is not indexed as a copy of the home page.
func (a *App) shell(name string, h http.Header) []byte {
	route := "/" + name
	if name == "index.html" {
		route = "/"
	}
	if p, ok := a.pages[route]; ok {
		return p
	}
	if route != "/" {
		h.Set("X-Robots-Tag", "noindex")
	}
	return a.index
}

func privatePath(p string) bool {
	for _, pre := range privatePrefixes {
		if strings.HasPrefix(p, pre) {
			return true
		}
	}
	return false
}

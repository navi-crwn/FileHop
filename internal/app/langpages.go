package app

import (
	"html/template"
	"net/http"
	"net/url"
	"strings"
)

// One address per language (KONTRAK-SEO-BAHASA): English lives at the bare address, each of the other eight
// languages at <page>?lang=<code>. A request that names a language with ?lang= gets that language whatever
// its cookie says (pageLang), so the address is a real per-language page; its canonical is the address
// itself (the bare one for English). A request without ?lang= keeps the visitor's language but has the
// bare canonical. Every public page lists the nine alternates plus x-default, and sitemap.xml repeats them.

// explicitLang reports whether the request itself names one of the nine languages with ?lang=.
func explicitLang(r *http.Request) bool { return matchLang(r.URL.Query().Get("lang")) != "" }

// langAddress is the address of a page in a language: bare for English, ?lang=<code> for the others.
func langAddress(origin, path, lang string) string {
	if lang == "en" {
		return origin + path
	}
	return origin + path + "?lang=" + url.QueryEscape(lang)
}

// langQuery is what an internal link carries on a per-language address: "?lang=de", nothing for English or
// for a bare request.
func langQuery(lang string, explicit bool) string {
	if !explicit || lang == "en" {
		return ""
	}
	return "?lang=" + url.QueryEscape(lang)
}

type hreflangLink struct {
	Code string
	URL  template.URL
}

// hreflangLinks are the nine alternates in the family order, then x-default at the bare address.
func hreflangLinks(origin, path string) []hreflangLink {
	out := make([]hreflangLink, 0, len(changeLocales)+1)
	for _, l := range changeLocales {
		out = append(out, hreflangLink{l, template.URL(langAddress(origin, path, l))})
	}
	return append(out, hreflangLink{"x-default", template.URL(origin + path)})
}

func hreflangHTML(origin, path string) string {
	var b strings.Builder
	for _, l := range hreflangLinks(origin, path) {
		b.WriteString(`<link rel="alternate" hreflang="` + l.Code + `" href="` + string(l.URL) + `">`)
	}
	return b.String()
}

// sitemap lists every public page once, at its bare address, with the nine alternates and x-default.
func (a *App) sitemap(w http.ResponseWriter, r *http.Request) {
	origin := a.origin
	if origin == "" {
		origin = strings.TrimRight(a.cfg.BaseURL, "/")
	}
	if origin == "" {
		http.NotFound(w, r)
		return
	}
	var b strings.Builder
	b.WriteString(`<?xml version="1.0" encoding="UTF-8"?>` + "\n" +
		`<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">` + "\n")
	paths := make([]string, 0, len(publicPages)+len(renderedRoutes))
	for _, p := range publicPages {
		paths = append(paths, p.Path)
	}
	paths = append(paths, renderedRoutes...)
	for _, p := range paths {
		b.WriteString("  <url>\n    <loc>" + origin + p + "</loc>\n")
		for _, l := range hreflangLinks(origin, p) {
			b.WriteString(`    <xhtml:link rel="alternate" hreflang="` + l.Code + `" href="` + string(l.URL) + `"/>` + "\n")
		}
		b.WriteString("  </url>\n")
	}
	b.WriteString("</urlset>\n")
	h := w.Header()
	h.Set("Content-Type", "application/xml; charset=utf-8")
	h.Set("Cache-Control", "public, max-age=3600")
	h.Set("X-Content-Type-Options", "nosniff")
	if r.Method != http.MethodHead {
		w.Write([]byte(b.String()))
	}
}

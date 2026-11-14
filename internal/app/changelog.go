package app

import (
	_ "embed"
	"encoding/json"
	"fmt"
	"html/template"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"sync"

	"github.com/navi-crwn/FileHop/web"
)

/*
/changelog is a real page, not the app shell: the history comes from the
snapshot in web/changelog.json (scripts/build-changelog.py), so the server
never calls GitHub. It is rendered here instead of in the Svelte app so that it
works without running the converter bundle, and it answers with the same
isolation and CSP headers as every other page of the app.
*/

const changelogPerPage = 40

//go:embed changelog.html.tmpl
var changelogSrc string

var changelogTmpl = template.Must(template.New("changelog").Parse(changelogSrc))

// changeItem is one line of a release: what changed (Type), where (Where) and the plain-language Text.
// encoding/json fills these from "type", "where" and "text" (names match without regard to case).
type changeItem struct{ Type, Where, Text string }

// changeEntry is one release of the plain-language changelog (scripts/build-changelog.py).
type changeEntry struct {
	Kind, Date, Title, URL, ID string
	Version, Summary           string
	Items                      []changeItem
}

type changeHistory struct {
	Entries []changeEntry
}

// changeGroup is the items of one type, in the order the page shows them.
type changeGroup struct {
	Type, Label string
	Items       []changeItem
}

var changeTypes = []string{"added", "changed", "fixed", "security", "removed", "deprecated"}

// groups sorts a release's items by type, keeping the written order inside a type, so the template needs no logic.
func (e changeEntry) groups(s changeStrings) []changeGroup {
	labels := map[string]string{"added": s.Added, "changed": s.Changed, "fixed": s.Fixed, "security": s.Security, "removed": s.Removed, "deprecated": s.Deprecated}
	var out []changeGroup
	for _, t := range changeTypes {
		var items []changeItem
		for _, it := range e.Items {
			if it.Type == t {
				items = append(items, it)
			}
		}
		if len(items) > 0 {
			out = append(out, changeGroup{Type: t, Label: labels[t], Items: items})
		}
	}
	return out
}

var changes = sync.OnceValue(func() changeHistory {
	var h changeHistory
	if err := json.Unmarshal(web.Changelog, &h); err != nil {
		panic(err)
	}
	return h
})

// changeStrings are the words on the page, in the family's nine languages.
type changeStrings struct {
	Title, Lead, Release, PR, Commit, Newer, Older, PageOf, Back, Theme, Language, PartOf string
	Details, Added, Changed, Fixed, Security, Removed, Deprecated                         string
}

var changeLocales = []string{"en", "zh-CN", "de", "id", "ja", "pt-BR", "es", "fr", "ru"}

var changeNames = map[string]string{
	"en": "English", "zh-CN": "简体中文", "de": "Deutsch", "id": "Bahasa Indonesia", "ja": "日本語",
	"pt-BR": "Português (Brasil)", "es": "Español", "fr": "Français", "ru": "Русский",
}

var changeText = map[string]changeStrings{
	"en":    {"Changelog", "What changed in FileHop, newest first.", "Release", "Pull request", "Commit", "Newer", "Older", "Page %d of %d", "Back to FileHop", "Theme", "Language", "Part of Hop Easy Link", "Technical details", "Added", "Changed", "Fixed", "Security", "Removed", "Deprecated"},
	"zh-CN": {"更新日志", "FileHop 的更新内容，最新的在前。", "发布", "拉取请求", "提交", "较新", "较早", "第 %d / %d 页", "返回 FileHop", "主题", "语言", "Hop Easy Link 的一部分", "技术详情", "新增", "变更", "修复", "安全", "移除", "已弃用"},
	"de":    {"Änderungsprotokoll", "Was sich an FileHop geändert hat, die neuesten zuerst.", "Release", "Pull Request", "Commit", "Neuer", "Älter", "Seite %d von %d", "Zurück zu FileHop", "Design", "Sprache", "Teil von Hop Easy Link", "Technische Details", "Neu", "Geändert", "Behoben", "Sicherheit", "Entfernt", "Veraltet"},
	"id":    {"Catatan perubahan", "Apa yang berubah di FileHop, yang terbaru di atas.", "Rilis", "Pull request", "Commit", "Lebih baru", "Lebih lama", "Halaman %d dari %d", "Kembali ke FileHop", "Tema", "Bahasa", "Bagian dari Hop Easy Link", "Detail teknis", "Ditambahkan", "Diubah", "Diperbaiki", "Keamanan", "Dihapus", "Usang"},
	"ja":    {"変更履歴", "FileHop で何が変わったか。新しい順です。", "リリース", "プルリクエスト", "コミット", "新しい", "古い", "%d / %d ページ", "FileHop に戻る", "テーマ", "言語", "Hop Easy Link の一部", "技術的な詳細", "追加", "変更", "修正", "セキュリティ", "削除", "非推奨"},
	"pt-BR": {"Histórico de alterações", "O que mudou no FileHop, do mais recente ao mais antigo.", "Versão", "Pull request", "Commit", "Mais recentes", "Mais antigas", "Página %d de %d", "Voltar ao FileHop", "Tema", "Idioma", "Parte do Hop Easy Link", "Detalhes técnicos", "Adicionado", "Alterado", "Corrigido", "Segurança", "Removido", "Obsoleto"},
	"es":    {"Registro de cambios", "Qué ha cambiado en FileHop, lo más reciente primero.", "Versión", "Pull request", "Commit", "Más recientes", "Más antiguos", "Página %d de %d", "Volver a FileHop", "Tema", "Idioma", "Parte de Hop Easy Link", "Detalles técnicos", "Añadido", "Cambiado", "Corregido", "Seguridad", "Eliminado", "Obsoleto"},
	"fr":    {"Journal des modifications", "Ce qui a changé dans FileHop, du plus récent au plus ancien.", "Version", "Pull request", "Commit", "Plus récentes", "Plus anciennes", "Page %d sur %d", "Retour à FileHop", "Thème", "Langue", "Fait partie de Hop Easy Link", "Détails techniques", "Ajouté", "Modifié", "Corrigé", "Sécurité", "Supprimé", "Obsolète"},
	"ru":    {"История изменений", "Что изменилось в FileHop, сначала новое.", "Релиз", "Pull request", "Коммит", "Новее", "Старее", "Страница %d из %d", "Назад к FileHop", "Тема", "Язык", "Часть Hop Easy Link", "Технические подробности", "Добавлено", "Изменено", "Исправлено", "Безопасность", "Удалено", "Устарело"},
}

// changeLang picks ?lang=, then the family cookie hop_lang, then the browser's Accept-Language, then English.
func changeLang(r *http.Request) string {
	if l := matchLang(r.URL.Query().Get("lang")); l != "" {
		return l
	}
	if l := cookieLang(r); l != "" {
		return l
	}
	return acceptLang(r)
}

// cookieLang is the family's language cookie (hop_lang, plain text, shared by every HOP app on .hel.ink)
// when it names one of the nine languages exactly; "" otherwise.
func cookieLang(r *http.Request) string {
	if c, err := r.Cookie("hop_lang"); err == nil {
		for _, l := range changeLocales {
			if c.Value == l {
				return l
			}
		}
	}
	return ""
}

// acceptLang is the first of the browser's languages FileHop has, or English.
func acceptLang(r *http.Request) string {
	for _, tag := range strings.Split(r.Header.Get("Accept-Language"), ",") {
		if l := matchLang(tag); l != "" {
			return l
		}
	}
	return "en"
}

func matchLang(tag string) string {
	tag = strings.TrimSpace(strings.SplitN(tag, ";", 2)[0])
	if tag == "" {
		return ""
	}
	for _, l := range changeLocales {
		if strings.EqualFold(l, tag) {
			return l
		}
	}
	base := strings.ToLower(strings.SplitN(tag, "-", 2)[0])
	for _, l := range changeLocales {
		if strings.ToLower(strings.SplitN(l, "-", 2)[0]) == base {
			return l
		}
	}
	return ""
}

type changeRow struct {
	Kind, Date, Title, URL, ID string
	Version, Summary           string
	Groups                     []changeGroup
}

type changeLink struct{ Code, Name, URL string }

type familyApp struct{ Slug, Name, URL, Mark string }

// changeFamily is the family list of the footer, as in web/src/App.svelte (a test keeps both equal to the manifest).
var changeFamily = []familyApp{
	{"hub", "HOP ID", "https://hel.ink", "/hop-id-mark.png"},
	{"linkhop", "LinkHop", "https://link.hel.ink", "/hop-marks/linkhop.svg"},
	{"biohop", "BioHop", "https://bio.hel.ink", "/hop-marks/biohop.svg"},
	{"pixelhop", "PixelHop", "https://pixel.hel.ink", "/hop-marks/pixelhop.svg"},
	{"notehop", "NoteHop", "https://note.hel.ink", "/hop-marks/notehop.svg"},
	{"payhop", "PayHop", "https://pay.hel.ink", "/hop-marks/payhop.svg"},
}

// appStrings are the app's own dictionaries (web/src/lib/i18n), so the footer and the top bar say what the app says.
func appStrings(lang string) map[string]string {
	out := map[string]string{}
	for _, l := range []string{"en", lang} {
		b, err := web.I18n.ReadFile("src/lib/i18n/" + l + ".json")
		if err != nil {
			continue
		}
		var d map[string]string
		if json.Unmarshal(b, &d) == nil {
			for k, v := range d {
				out[k] = v
			}
		}
	}
	return out
}

type changePage struct {
	T                 map[string]string
	PartPre, PartPost string
	Family            []familyApp
	Lang, LangCode    string
	S                 changeStrings
	Rows              []changeRow
	Page, Pages       int
	PageLabel         string
	Previous, Next    string
	Langs             []changeLink
	Canonical         string         // this page's own address (the bare one for English or no ?lang=)
	Hreflang          []hreflangLink // the nine alternates and x-default
	Home              template.URL   // "/" that keeps a per-language address's language
}

// changeOrigin is the site address the changelog states, as index.html does for the other pages.
const changeOrigin = "https://file.hel.ink"

func changeURL(lang string, page int) string {
	q := url.Values{}
	q.Set("lang", lang)
	if page > 1 {
		q.Set("page", strconv.Itoa(page))
	}
	return "/changelog?" + q.Encode()
}

func buildChangePage(r *http.Request) changePage {
	lang := changeLang(r)
	s := changeText[lang]
	all := changes().Entries
	pages := max(1, (len(all)+changelogPerPage-1)/changelogPerPage)
	page, _ := strconv.Atoi(r.URL.Query().Get("page"))
	page = max(1, min(page, pages))
	p := changePage{Lang: lang, S: s, Page: page, Pages: pages, LangCode: strings.ToUpper(strings.SplitN(lang, "-", 2)[0])}
	p.T = appStrings(lang)
	p.PartPre, p.PartPost, _ = strings.Cut(p.T["footer.part_of"], "{name}")
	p.Family = changeFamily
	p.PageLabel = fmt.Sprintf(s.PageOf, page, pages)
	explicit := explicitLang(r)
	p.Canonical = changeOrigin + "/changelog"
	if explicit {
		p.Canonical = langAddress(changeOrigin, "/changelog", lang)
	}
	p.Hreflang = hreflangLinks(changeOrigin, "/changelog")
	p.Home = template.URL("/" + langQuery(lang, explicit))
	kinds := map[string]string{"tag": s.Release, "pr": s.PR, "commit": s.Commit}
	for _, e := range all[(page-1)*changelogPerPage : min(page*changelogPerPage, len(all))] {
		date := e.Date
		if len(date) >= 10 {
			date = date[:10]
		}
		p.Rows = append(p.Rows, changeRow{Kind: kinds[e.Kind], Date: date, Title: e.Title, URL: e.URL, ID: e.ID, Version: e.Version, Summary: e.Summary, Groups: e.groups(s)})
	}
	if page > 1 {
		p.Previous = changeURL(lang, page-1)
	}
	if page < pages {
		p.Next = changeURL(lang, page+1)
	}
	for _, l := range changeLocales {
		p.Langs = append(p.Langs, changeLink{Code: l, Name: changeNames[l], URL: changeURL(l, page)})
	}
	return p
}

func (a *App) changelog(w http.ResponseWriter, r *http.Request) {
	p := buildChangePage(r)
	h := w.Header()
	setAppHeaders(h)
	h.Set("Content-Type", "text/html; charset=utf-8")
	h.Set("Cache-Control", "no-cache")
	h.Add("Vary", "Cookie, Accept-Language")
	if r.Method == http.MethodHead {
		return
	}
	if err := changelogTmpl.Execute(w, p); err != nil {
		http.Error(w, "render", http.StatusInternalServerError)
	}
}

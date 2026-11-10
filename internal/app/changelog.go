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

type changeEntry struct {
	Kind, Date, Title, URL, ID string
}

type changeHistory struct {
	Entries []changeEntry
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
}

var changeLocales = []string{"en", "zh-CN", "de", "id", "ja", "pt-BR", "es", "fr", "ru"}

var changeNames = map[string]string{
	"en": "English", "zh-CN": "简体中文", "de": "Deutsch", "id": "Bahasa Indonesia", "ja": "日本語",
	"pt-BR": "Português (Brasil)", "es": "Español", "fr": "Français", "ru": "Русский",
}

var changeText = map[string]changeStrings{
	"en":    {"Changelog", "Every change to FileHop, newest first, built from the public repository.", "Release", "Pull request", "Commit", "Newer", "Older", "Page %d of %d", "Back to FileHop", "Theme", "Language", "Part of Hop Easy Link"},
	"zh-CN": {"更新日志", "FileHop 的每一次变更，按时间从新到旧，来自公开仓库。", "发布", "拉取请求", "提交", "较新", "较早", "第 %d / %d 页", "返回 FileHop", "主题", "语言", "Hop Easy Link 的一部分"},
	"de":    {"Änderungsprotokoll", "Jede Änderung an FileHop, die neueste zuerst, aus dem öffentlichen Repository.", "Release", "Pull Request", "Commit", "Neuer", "Älter", "Seite %d von %d", "Zurück zu FileHop", "Design", "Sprache", "Teil von Hop Easy Link"},
	"id":    {"Catatan perubahan", "Setiap perubahan pada FileHop, terbaru lebih dulu, dari repositori publik.", "Rilis", "Pull request", "Commit", "Lebih baru", "Lebih lama", "Halaman %d dari %d", "Kembali ke FileHop", "Tema", "Bahasa", "Bagian dari Hop Easy Link"},
	"ja":    {"変更履歴", "FileHop のすべての変更を、新しい順に公開リポジトリから掲載しています。", "リリース", "プルリクエスト", "コミット", "新しい", "古い", "%d / %d ページ", "FileHop に戻る", "テーマ", "言語", "Hop Easy Link の一部"},
	"pt-BR": {"Histórico de alterações", "Todas as alterações do FileHop, da mais recente para a mais antiga, a partir do repositório público.", "Versão", "Pull request", "Commit", "Mais recentes", "Mais antigas", "Página %d de %d", "Voltar ao FileHop", "Tema", "Idioma", "Parte do Hop Easy Link"},
	"es":    {"Registro de cambios", "Todos los cambios de FileHop, del más reciente al más antiguo, desde el repositorio público.", "Versión", "Pull request", "Commit", "Más recientes", "Más antiguos", "Página %d de %d", "Volver a FileHop", "Tema", "Idioma", "Parte de Hop Easy Link"},
	"fr":    {"Journal des modifications", "Toutes les modifications de FileHop, les plus récentes d’abord, issues du dépôt public.", "Version", "Pull request", "Commit", "Plus récentes", "Plus anciennes", "Page %d sur %d", "Retour à FileHop", "Thème", "Langue", "Fait partie de Hop Easy Link"},
	"ru":    {"История изменений", "Все изменения FileHop, от новых к старым, из публичного репозитория.", "Релиз", "Pull request", "Коммит", "Новее", "Старее", "Страница %d из %d", "Назад к FileHop", "Тема", "Язык", "Часть Hop Easy Link"},
}

// changeLang picks ?lang=, then the browser's Accept-Language, then English.
func changeLang(r *http.Request) string {
	match := func(tag string) string {
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
	if l := match(r.URL.Query().Get("lang")); l != "" {
		return l
	}
	for _, tag := range strings.Split(r.Header.Get("Accept-Language"), ",") {
		if l := match(tag); l != "" {
			return l
		}
	}
	return "en"
}

type changeRow struct {
	Kind, Date, Title, URL, ID string
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
}

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
	kinds := map[string]string{"tag": s.Release, "pr": s.PR, "commit": s.Commit}
	for _, e := range all[(page-1)*changelogPerPage : min(page*changelogPerPage, len(all))] {
		date := e.Date
		if len(date) >= 10 {
			date = date[:10]
		}
		p.Rows = append(p.Rows, changeRow{Kind: kinds[e.Kind], Date: date, Title: e.Title, URL: e.URL, ID: e.ID})
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
	h.Add("Vary", "Accept-Language")
	if r.Method == http.MethodHead {
		return
	}
	if err := changelogTmpl.Execute(w, p); err != nil {
		http.Error(w, "render", http.StatusInternalServerError)
	}
}

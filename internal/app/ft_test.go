package app

import (
	"encoding/json"
	"os"
	"strings"
	"testing"
)

func TestChangelogFooterAndTopBarMatchTheApp(t *testing.T) {
	_, srv := newTestApp(t, false)
	_, body := get(t, srv.URL, "/changelog?lang=de", "")
	for _, want := range []string{`class="ft-part"`, "Richtlinien", "HOP-Familie", `data-app="notehop"`, `id="add"`, `id="acct"`, "© 2026 navi-crwn"} {
		if !strings.Contains(body, want) {
			t.Errorf("missing %q", want)
		}
	}
	if strings.Contains(body, `class="eyebrow`) || strings.Contains(body, `class="hero-eyebrow`) {
		t.Error("no eyebrow label on the page")
	}
}

func TestChangelogFamilyEqualsManifest(t *testing.T) {
	raw, err := os.ReadFile("../../tools/hop-apps.json")
	if err != nil {
		t.Fatal(err)
	}
	var m struct {
		Apps []struct {
			Slug, Name, URL string
			Public          bool
		}
	}
	if err := json.Unmarshal(raw, &m); err != nil {
		t.Fatal(err)
	}
	var want []familyApp
	for _, a := range m.Apps {
		if a.Public && a.Slug != "filehop" {
			want = append(want, familyApp{Slug: a.Slug, Name: a.Name, URL: a.URL})
		}
	}
	if len(want) != len(changeFamily) {
		t.Fatalf("family has %d apps, manifest %d", len(changeFamily), len(want))
	}
	for i, w := range want {
		g := changeFamily[i]
		if g.Slug != w.Slug || g.Name != w.Name || g.URL != w.URL {
			t.Errorf("%d: %+v != %+v", i, g, w)
		}
	}
}

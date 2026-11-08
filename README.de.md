<p align="center">🌐 <a href="README.md">English</a> · <a href="README.zh-CN.md">简体中文</a> · <b>Deutsch</b> · <a href="README.id.md">Bahasa Indonesia</a> · <a href="README.ja.md">日本語</a> · <a href="README.pt-BR.md">Português (Brasil)</a> · <a href="README.es.md">Español</a> · <a href="README.fr.md">Français</a> · <a href="README.ru.md">Русский</a></p>

<p align="center"><picture><source media="(prefers-color-scheme: dark)" srcset="docs/readme/hero-dark.webp"><img src="docs/readme/hero-light.webp" alt="Die Startseite von FileHop: die Überschrift „Alles umwandeln, und nichts verlässt dieses Gerät“ neben der Ablagefläche" width="100%"></picture></p>

<p align="center"><b>Jede Datei, jedes Format, auf deinem Gerät.</b><br>FileHop wandelt Bilder, PDFs, Tabellen, Text und Archive in deinem Browser um. Nichts wird hochgeladen.</p>

<p align="center">
  <a href="https://file.hel.ink"><b>Online ausprobieren</b></a> ·
  <a href="#selbst-betreiben">Selbst betreiben</a> ·
  <a href="#was-es-umwandelt">Was es umwandelt</a> ·
  <a href="#faq">FAQ</a> ·
  <a href="docs/DEPLOY.md">Bereitstellung</a> ·
  <a href="docs/TESTING.md">Tests</a> ·
  <a href="CHANGELOG.md">Änderungen</a>
</p>

<p align="center"><sub>Eine Go-Binärdatei · die Umwandlung läuft im Browser-Tab · 9 Sprachen · keine Werbung, keine Tracker · kostenlos und Open Source (MIT)</sub></p>

> [!IMPORTANT]
> FileHop hat keinen Upload-Button, weil es keinen Upload gibt. Dateien werden über die File API des Browsers geöffnet, im Tab mit deiner eigenen CPU umgewandelt und als Download zurückgegeben. Der Server liefert die App aus und hält, wenn du dich anmeldest, deine HOP-ID-Sitzung. Eine Datei bekommt er nie.

FileHop ist ein Dateikonverter, den du selbst betreiben kannst. Dateien auf die Seite ziehen, auf jeder Karte ein Format wählen (oder eines für die ganze Gruppe), auf „Umwandeln“ drücken, herunterladen. Gedacht ist es für Leute, die:

- ein PNG als WebP, einen Scan als PDF oder ein PDF in Einzelseiten brauchen und die Datei keiner Website geben wollen,
- CSV in JSON oder YAML umwandeln (und zurück), ohne eine Tabellenkalkulation zu öffnen,
- sehen wollen, was in einem ZIP steckt, oder die SHA-256 einer Datei prüfen möchten, auf einem Rechner, auf dem sie nichts installieren dürfen.

Die Installation ist ein einziger Befehl. Das Skript prüft deinen Rechner, stellt ein paar Fragen und kann FileHop mit einem HOP-ID-Konto-Hub verbinden:

```bash
curl -fsSL https://raw.githubusercontent.com/navi-crwn/FileHop/main/install.sh | bash
```

Aus einem Klon: `./install.sh`. Aktualisieren mit `./update.sh`, entfernen mit `./uninstall.sh`. Mit `--yes` werden alle Standardwerte übernommen; `--help` listet die Optionen auf.

## Was es umwandelt

| Kategorie | Eingabe | Ausgabe |
|---|---|---|
| Bilder | PNG, JPEG, WebP, AVIF\*, GIF, BMP, TIFF, ICO, SVG | WebP, AVIF\*, JPEG, PNG, PDF |
| PDF | PDF | zusammengeführt, geteilt (ZIP), gedreht, Seitenauswahl, Seiten → PNG/JPEG (ZIP), Dokumentinfo (JSON) |
| Daten | CSV, TSV, JSON, YAML | CSV, TSV, JSON, YAML |
| Text | Markdown, HTML, reiner Text | HTML, Markdown, reiner Text |
| Archive | ZIP, TAR, GZIP | ZIP (neu gepackt), GZIP, Inhaltsliste (JSON) |
| Alles | jede Datei | SHA-256, BLAKE3, MD5 |

\* AVIF wird nur angeboten, wenn der eigene Encoder des Browsers es schreiben kann. Canvas liefert stillschweigend ein PNG, wenn es das nicht kann. Deshalb prüft FileHop das Ergebnis und blendet das Zielformat lieber aus, statt dir eine falsch beschriftete Datei zu geben.

**Noch nicht dabei:** DOCX und LaTeX (braucht pandoc, GPL), RAR und 7z, Video und Audio. Die App sagt das in ihrem Formate-Bereich offen, statt so zu tun, als ob.

Getestet am 2026-11-08 in Chromium 158, Firefox 159 und der WebKit-Engine (je 22 Umwandlungen, alle bestanden). Safari auf Mac oder iPhone wurde noch nicht getestet. Details: [docs/TESTING.md](docs/TESTING.md).

## Was der Server sieht

- Die eigenen Dateien der App (HTML, Skripte, Schriften). Jede Anfrage ist same-origin; die Seite lädt nichts von anderen Websites.
- Wenn du dich mit HOP ID anmeldest: deine HOP-ID-Nummer, deinen Namen und deine E-Mail-Adresse sowie ein Sitzungs-Cookie. Abmelden, oder vom Hub abgemeldet werden, löscht die Sitzung.
- Niemals eine Datei, einen Dateinamen oder ein Umwandlungsergebnis.

Die Seite läuft cross-origin-isoliert (`Cross-Origin-Embedder-Policy: require-corp`) mit einer strengen Content Security Policy: keine Inline-Skripte, kein `eval`, keine Drittanbieter-Hosts.

## Selbst betreiben

**Mit dem Installer** (siehe oben): Er baut die Browser-App mit Node 20.19+ und den Server mit Go 1.27+ oder nutzt Docker, und er schreibt `.env`, `start.sh` und eine systemd-Unit für dich.

**Von Hand:**

```bash
npm ci && npm run build        # die Browser-App → web/dist
go build -o filehop ./cmd/filehop
FILEHOP_ADDR=127.0.0.1:8095 ./filehop
```

Einstellungen sind Umgebungsvariablen, aufgelistet in [`deploy/filehop.env.example`](deploy/filehop.env.example). Ohne `FILEHOP_SSO_URL` läuft FileHop ganz ohne Konten und ist trotzdem ein vollständiger Konverter. Mit der Variable können sich Leute über deinen Hub (HEL.ink) mit HOP ID anmelden. [docs/DEPLOY.md](docs/DEPLOY.md) behandelt nginx, systemd und den Hub.

**Für die Entwicklung:**

```bash
npm run dev          # http://localhost:5179, nur die Browser-App (Vite)
npm run local        # http://localhost:8095, der Go-Server + ein Ersatz-Hub auf :8097
```

`npm run local` startet den echten Server zusammen mit `tools/hubstub`, einem kleinen Ersatz für den HOP-ID-Hub und das Imperium-Kontrollpanel mit denselben Datenformaten. So lassen sich Anmelden, Abmelden und Kontoereignisse auf einem einzigen Rechner ausprobieren.

## FAQ

**Wird meine Datei irgendwohin geschickt?** Nein. Öffne während einer Umwandlung den Netzwerk-Tab in den Entwicklertools deines Browsers: Er bleibt leer.

**Brauche ich ein Konto?** Nein. Alles funktioniert auch ohne. Eine HOP ID bringt heute nur das Kontomenü; synchronisierte Voreinstellungen kommen später.

**Wie groß darf eine Datei sein?** So groß, wie der Speicher deines Browsers es zulässt. FileHop schätzt vor dem Start, wie viel Speicher eine Aufgabe braucht, und sagt dir, wenn eine Datei für dieses Gerät zu groß ist. Ein Stapel ist auf 50 Dateien begrenzt.

**Warum fehlt AVIF auf meinem Rechner?** Dein Browser kann kein AVIF schreiben. FileHop bietet nur Formate an, die es tatsächlich erzeugen kann.

**Sind die Umwandlungen bei Dateien unbekannter Herkunft sicher?** FileHop behandelt jede Datei als feindlich: Archive werden vor dem Entpacken vermessen (Zip-Bomben und `../`-Pfade werden abgelehnt), SVG wird über ein Bildelement gezeichnet, das nie Skripte ausführt, und PDFs werden mit pdf.js gelesen, das kein JavaScript aus dem Dokument ausführt.

## Unter der Haube

```
web/src/App.svelte (queue UI)
   └── Queue (web/src/lib/store/queue.svelte.ts)   $state array of $state jobs
         └── Pool (web/src/lib/core/pool.ts)       one Worker per slot, sized by the machine
               └── convert.worker.ts              runJob() → engines
                     ├── run/image.ts              canvas + createImageBitmap + pdf-lib
                     ├── run/pdf.ts                pdf.js (read) + pdf-lib (write)
                     ├── run/data.ts               papaparse / yaml, one table model
                     ├── run/text.ts               marked, and a DOM-free HTML → Markdown rule set
                     ├── run/archive.ts            fflate + a ustar reader
                     └── run/hash.ts               hash-wasm, 8 MB chunks

cmd/filehop          the server: web/dist embedded, headers, HOP ID sign-in, /hop/*
internal/app         routes, sign-in, the HOP App Protocol handlers
internal/db          SQLite: accounts, sessions, handled event ids (no files)
internal/hop         HOP App Protocol v1, the same as NoteHop's
```

- **Der Typ kommt aus den Bytes.** Zuerst die Magic Bytes, dann die Endung. Ein in `.txt` umbenanntes JPEG öffnet sich trotzdem, und die Karte zeigt „Name ≠ Inhalt“.
- **Eine Aufgabe, ein Worker.** Der Pool lässt der Seite einen Kern frei, geht auf Handys und Geräten mit wenig Speicher auf 2 Worker herunter und lässt sich in den Einstellungen auf 1 festlegen.
- **Canvas-Arbeit wandert auf die Seite, wenn es sein muss.** SVG braucht ein `<img>`, und Browser ohne `OffscreenCanvas` (Safari vor 16.4) können in einem Worker nicht zeichnen. Solche Aufgaben belegen deshalb einen Platz im Haupt-Thread.
- **Zur Laufzeit wird nichts nachgeladen.** Die ganze Engine steckt im Bundle (etwa 236 KB gzip für den Worker-Teil, 45 KB für die Seite).
- **Für die Familie:** `/hop/health`, `/hop/manifest`, `/hop/stats`, `/hop/users/{sub}` und `/hop/events` beantworten signierte Aufrufe vom Imperium-Kontrollpanel und vom Hub.

Schrift: Inter für Text, Instrument Serif kursiv für die Akzentphrase, JetBrains Mono für Dateinamen und Hashes, alle mitgeliefert in `web/public/hop-fonts/`. Sprachen: `en, zh-CN, de, id, ja, pt-BR, es, fr, ru` in `web/src/lib/i18n/`; `npm run lint:i18n` hält sie im Gleichschritt.

## Sicherheit, Lizenz und Verlauf

Sicherheitslücken bitte vertraulich melden: [SECURITY.md](SECURITY.md). FileHop steht unter der MIT-Lizenz ([LICENSE](LICENSE)). Die verwendeten Bibliotheken: `pdfjs-dist` Apache-2.0 · `pdf-lib` MIT · `fflate` MIT · `hash-wasm` MIT · `marked` MIT · `papaparse` MIT · `yaml` ISC · Svelte MIT · Schriften SIL OFL 1.1. Keine GPL- oder AGPL-Engine ist enthalten. Was sich wann geändert hat: [CHANGELOG.md](CHANGELOG.md).

## Die HOP-Familie

FileHop gehört zur HOP-Familie, einer Reihe datenschutzfreundlicher, selbst hostbarer Open-Source-Apps.

<!-- hop-family:start -->
<!-- Generated from HEL.ink resources/hop-assets/apps.source.json; edit there, then run scripts/hop_assets.py build. -->
| App | Address | Repository | What it does |
| --- | --- | --- | --- |
| **HOP ID** | [hel.ink](https://hel.ink) · accounts at `hub.hel.ink` | [navi-crwn/HEL.ink](https://github.com/navi-crwn/HEL.ink) | One account for every HOP app. |
| **LinkHop** | [link.hel.ink](https://link.hel.ink) · `hel.ink/l/…` | [navi-crwn/LinkHop](https://github.com/navi-crwn/LinkHop) | Short links, QR codes and click analytics. |
| **BioHop** | [bio.hel.ink](https://bio.hel.ink) · `hel.ink/b/…` | [navi-crwn/BioHop](https://github.com/navi-crwn/BioHop) | One link-in-bio page for everything you do. |
| **PixelHop** | [pixel.hel.ink](https://pixel.hel.ink) · `p.hel.ink/…` | [navi-crwn/PixelHop](https://github.com/navi-crwn/PixelHop) | Image hosting with albums and direct links. |
| **NoteHop** | [note.hel.ink](https://note.hel.ink) · `n.hel.ink/…` | [navi-crwn/NoteHop](https://github.com/navi-crwn/NoteHop) | Encrypted notes you share with a link. |
| **FileHop** | [file.hel.ink](https://file.hel.ink) | [navi-crwn/FileHop](https://github.com/navi-crwn/FileHop) | Convert files in your browser; nothing is uploaded. |
| **Imperium** | private (owner only) | private | The HOP control panel. |
<!-- hop-family:end -->

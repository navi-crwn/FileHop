<p align="center">🌐 <a href="README.md">English</a> · <a href="README.zh-CN.md">简体中文</a> · <a href="README.de.md">Deutsch</a> · <a href="README.id.md">Bahasa Indonesia</a> · <a href="README.ja.md">日本語</a> · <a href="README.pt-BR.md">Português (Brasil)</a> · <a href="README.es.md">Español</a> · <b>Français</b> · <a href="README.ru.md">Русский</a></p>

<p align="center"><picture><source media="(prefers-color-scheme: dark)" srcset="docs/readme/hero-dark.webp"><img src="docs/readme/hero-light.webp" alt="La page d’accueil de FileHop : le titre « Convertissez tout, et rien ne quitte cet appareil » à côté de la zone de dépôt" width="100%"></picture></p>

<p align="center"><b>N’importe quel fichier, n’importe quel format, sur votre appareil.</b><br>FileHop convertit images, PDF, tableaux, textes et archives dans votre navigateur. Rien n’est envoyé.</p>

<p align="center">
  <a href="https://file.hel.ink"><b>Essayer en ligne</b></a> ·
  <a href="#héberger-soi-même">Héberger soi-même</a> ·
  <a href="#formats-pris-en-charge">Formats pris en charge</a> ·
  <a href="#questions-fréquentes">Questions fréquentes</a> ·
  <a href="docs/DEPLOY.md">Déploiement</a> ·
  <a href="docs/TESTING.md">Tests</a> ·
  <a href="CHANGELOG.md">Journal des modifications</a>
</p>

<p align="center"><sub>Un seul binaire Go · la conversion se fait dans l’onglet du navigateur · 9 langues · ni publicité ni pisteurs · libre et gratuit (MIT)</sub></p>

> [!IMPORTANT]
> FileHop n’a pas de bouton d’envoi, parce qu’il n’y a pas d’envoi. Les fichiers sont ouverts avec la File API du navigateur, convertis dans l’onglet avec votre propre processeur, puis rendus sous forme de téléchargement. Le serveur fournit l’application et, si vous vous connectez, conserve votre session HOP ID. Il ne reçoit jamais de fichier.

FileHop est un convertisseur de fichiers que vous pouvez héberger vous-même. Déposez des fichiers sur la page, choisissez un format sur chaque carte (ou un seul pour tout le groupe), cliquez sur Convertir, téléchargez. Il s’adresse à ceux qui :

- ont besoin d’un PNG en WebP, d’un scan en PDF ou d’un PDF découpé en pages, sans confier le fichier à un site web,
- veulent passer du CSV au JSON ou au YAML (et inversement) sans ouvrir de tableur,
- veulent voir le contenu d’un ZIP, ou vérifier le SHA-256 d’un fichier, sur une machine où ils ne peuvent rien installer.

L’installation tient en une commande. Le script vérifie votre machine, pose quelques questions et peut relier FileHop à un hub de comptes HOP ID :

```bash
curl -fsSL https://raw.githubusercontent.com/navi-crwn/FileHop/main/install.sh | bash
```

Depuis un clone : `./install.sh`. Mettez à jour avec `./update.sh` et désinstallez avec `./uninstall.sh`. Ajoutez `--yes` pour accepter toutes les valeurs par défaut ; `--help` liste les options.

## Formats pris en charge

| Catégorie | Entrée | Sortie |
|---|---|---|
| Images | PNG, JPEG, WebP, AVIF\*, GIF, BMP, TIFF, ICO, SVG | WebP, AVIF\*, JPEG, PNG, PDF |
| PDF | PDF | fusion, découpage (ZIP), rotation, sélection de pages, pages → PNG/JPEG (ZIP), infos du document (JSON) |
| Données | CSV, TSV, JSON, YAML | CSV, TSV, JSON, YAML |
| Texte | Markdown, HTML, texte brut | HTML, Markdown, texte brut |
| Archives | ZIP, TAR, GZIP | ZIP (réempaqueté), GZIP, liste du contenu (JSON) |
| Tout le reste | n’importe quel fichier | SHA-256, BLAKE3, MD5 |

\* La sortie AVIF n’est proposée que si l’encodeur du navigateur lui-même sait l’écrire. Quand il ne le peut pas, Canvas renvoie un PNG sans prévenir : FileHop vérifie donc le résultat et masque ce format plutôt que de vous donner un fichier mal étiqueté.

**Pas encore disponible :** DOCX et LaTeX (nécessitent pandoc, sous GPL), RAR et 7z, vidéo et audio. L’application le dit clairement dans sa section des formats au lieu de faire semblant.

Testé le 2026-11-08 sous Chromium 158, Firefox 159 et le moteur WebKit (22 conversions chacun, toutes réussies). Safari sur Mac ou iPhone n’a pas encore été testé. Détails : [docs/TESTING.md](docs/TESTING.md).

## Ce que voit le serveur

- Les fichiers de l’application elle-même (HTML, scripts, polices). Toutes les requêtes sont de même origine ; la page ne charge rien depuis un autre site.
- Si vous vous connectez avec HOP ID : votre numéro HOP ID, votre nom et votre adresse e-mail, ainsi qu’un cookie de session. Se déconnecter, ou être déconnecté par le hub, supprime la session.
- Jamais un fichier, un nom de fichier ni un résultat de conversion.

La page fonctionne en isolation cross-origin (`Cross-Origin-Embedder-Policy: require-corp`) avec une Content Security Policy stricte : pas de scripts inline, pas d’`eval`, aucun hôte tiers.

## Héberger soi-même

**Avec l’installateur** (ci-dessus) : il compile l’application navigateur avec Node 20.19+ et le serveur avec Go 1.27+, ou utilise Docker, et écrit pour vous `.env`, `start.sh` et une unité systemd.

**À la main :**

```bash
npm ci && npm run build        # l’application navigateur → web/dist
go build -o filehop ./cmd/filehop
FILEHOP_ADDR=127.0.0.1:8095 ./filehop
```

Les réglages sont des variables d’environnement, listées dans [`deploy/filehop.env.example`](deploy/filehop.env.example). Sans `FILEHOP_SSO_URL`, FileHop fonctionne sans aucun compte, et c’est déjà un convertisseur complet. Avec elle, les utilisateurs peuvent se connecter avec HOP ID depuis votre hub (HEL.ink). [docs/DEPLOY.md](docs/DEPLOY.md) couvre nginx, systemd et le hub.

**Pour le développement :**

```bash
npm run dev          # http://localhost:5179, l’application navigateur seule (Vite)
npm run local        # http://localhost:8095, le serveur Go + un hub de substitution sur :8097
```

`npm run local` lance le vrai serveur à côté de `tools/hubstub`, un petit substitut du hub HOP ID et du panneau de contrôle Imperium qui parle les mêmes formats. Vous pouvez ainsi essayer la connexion, la déconnexion et les événements de compte sur une seule machine.

## Questions fréquentes

**Mon fichier est-il envoyé quelque part ?** Non. Ouvrez l’onglet Réseau des outils de développement de votre navigateur pendant une conversion : il reste vide.

**Faut-il un compte ?** Non. Tout fonctionne sans. Pour l’instant, un HOP ID n’ajoute que le menu du compte ; les préréglages synchronisés viendront plus tard.

**Quelle taille peut faire un fichier ?** Autant que la mémoire de votre navigateur le permet. FileHop estime la mémoire nécessaire avant de lancer une tâche et vous prévient si un fichier est trop gros pour cet appareil. Un lot est limité à 50 fichiers.

**Pourquoi AVIF n’apparaît-il pas sur mon ordinateur ?** Votre navigateur ne sait pas écrire l’AVIF. FileHop ne propose que les formats qu’il peut réellement produire.

**Les conversions sont-elles sûres pour des fichiers douteux ?** FileHop considère chaque fichier comme hostile : les archives sont mesurées avant d’être décompressées (les bombes zip et les chemins `../` sont refusés), le SVG est dessiné via un élément image qui n’exécute jamais de script, et les PDF sont lus avec pdf.js, qui n’exécute pas le JavaScript du document.

## Sous le capot

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

- **Le type vient des octets.** D’abord les magic bytes, ensuite l’extension. Un JPEG renommé en `.txt` s’ouvre quand même, et la carte affiche « Nom ≠ contenu ».
- **Une tâche, un worker.** Le pool laisse un cœur à la page, descend à 2 workers sur les téléphones et les appareils avec peu de mémoire, et peut être fixé à 1 dans les réglages.
- **Le travail Canvas passe sur la page quand il le faut.** Le SVG a besoin d’un `<img>`, et les navigateurs sans `OffscreenCanvas` (Safari avant 16.4) ne peuvent pas dessiner dans un worker : ces tâches occupent donc un emplacement sur le thread principal.
- **Rien n’est téléchargé à l’exécution.** Tout le moteur est dans le bundle (environ 236 Ko gzip pour la partie worker, 45 Ko pour la page).
- **Pour la famille :** `/hop/health`, `/hop/manifest`, `/hop/stats`, `/hop/users/{sub}` et `/hop/events` répondent aux appels signés du panneau de contrôle Imperium et du hub.

Typographie : Inter pour le texte, Instrument Serif en italique pour la phrase d’accent, JetBrains Mono pour les noms de fichiers et les empreintes, toutes fournies dans `web/public/hop-fonts/`. Langues : `en, zh-CN, de, id, ja, pt-BR, es, fr, ru` dans `web/src/lib/i18n/` ; `npm run lint:i18n` les garde synchronisées.

## Sécurité, licence et historique

Signalez les vulnérabilités en privé : [SECURITY.md](SECURITY.md). FileHop est sous licence MIT ([LICENSE](LICENSE)). Ses bibliothèques : `pdfjs-dist` Apache-2.0 · `pdf-lib` MIT · `fflate` MIT · `hash-wasm` MIT · `marked` MIT · `papaparse` MIT · `yaml` ISC · Svelte MIT · polices SIL OFL 1.1. Aucun moteur GPL ou AGPL n’est inclus. Ce qui a changé, et quand : [CHANGELOG.md](CHANGELOG.md).

## La famille HOP

FileHop fait partie de la famille HOP, des applications libres, respectueuses de la vie privée et auto-hébergeables.

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

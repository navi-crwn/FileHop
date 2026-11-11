<p align="center">🌐 <a href="README.md">English</a> · <a href="README.zh-CN.md">简体中文</a> · <a href="README.de.md">Deutsch</a> · <a href="README.id.md">Bahasa Indonesia</a> · <a href="README.ja.md">日本語</a> · <a href="README.pt-BR.md">Português (Brasil)</a> · <b>Español</b> · <a href="README.fr.md">Français</a> · <a href="README.ru.md">Русский</a></p>

<p align="center"><picture><source media="(prefers-color-scheme: dark)" srcset="docs/readme/hero-dark.webp"><img src="docs/readme/hero-light.webp" alt="La página de inicio de FileHop: el titular 'Convierte lo que sea, y que nada salga de este dispositivo' junto a la zona para soltar archivos" width="100%"></picture></p>

<p align="center"><b>Cualquier archivo, cualquier formato, en tu dispositivo.</b><br>FileHop convierte imágenes, PDF, tablas, texto y archivos comprimidos en tu navegador. No se sube nada.</p>

<p align="center">
  <a href="https://file.hel.ink"><b>Pruébalo en línea</b></a> ·
  <a href="#instálalo-tú-mismo">Instálalo tú mismo</a> ·
  <a href="#qué-convierte">Qué convierte</a> ·
  <a href="#preguntas-frecuentes">Preguntas frecuentes</a> ·
  <a href="docs/DEPLOY.md">Despliegue</a> ·
  <a href="docs/TESTING.md">Pruebas</a> ·
  <a href="CHANGELOG.md">Registro de cambios</a>
</p>

<p align="center"><sub>Un solo binario de Go · la conversión ocurre en la pestaña del navegador · 9 idiomas · sin anuncios ni rastreadores · gratis y de código abierto (MIT)</sub></p>

> [!IMPORTANT]
> FileHop no tiene botón de subida porque no hay subida. Los archivos se abren con la File API del navegador, se convierten dentro de la pestaña con tu propio procesador y te los devuelve como descarga. El servidor solo envía la aplicación y, si inicias sesión, guarda tu sesión de HOP ID. Nunca recibe un archivo.

FileHop es un conversor de archivos que puedes alojar tú mismo. Suelta los archivos en la página, elige un formato en cada tarjeta (o uno para todo el grupo), pulsa Convertir y descarga. Está pensado para quien:

- necesita un PNG en WebP, un escaneo en PDF o un PDF separado en páginas, y no quiere entregar el archivo a un sitio web,
- quiere pasar CSV a JSON o YAML (y al revés) sin abrir una hoja de cálculo,
- quiere ver qué hay dentro de un ZIP, o comprobar el SHA-256 de un archivo, en un equipo donde no puede instalar programas.

Se instala con un solo comando. El script revisa tu equipo, te hace unas preguntas y puede conectar FileHop a un hub de cuentas HOP ID:

```bash
curl -fsSL https://raw.githubusercontent.com/navi-crwn/FileHop/main/install.sh | bash
```

Desde un clon: `./install.sh`. Actualiza con `./update.sh` y desinstala con `./uninstall.sh`. Añade `--yes` para aceptar todos los valores por defecto; `--help` muestra las opciones.

## Qué convierte

| Categoría | Entrada | Salida |
|---|---|---|
| Imágenes | PNG, JPEG, WebP, AVIF\*, GIF, BMP, TIFF, ICO, SVG | WebP, AVIF\*, JPEG, PNG, PDF |
| PDF | PDF | unir, dividir (ZIP), girar, seleccionar páginas, páginas → PNG/JPEG (ZIP), información del documento (JSON) |
| Datos | CSV, TSV, JSON, YAML | CSV, TSV, JSON, YAML |
| Texto | Markdown, HTML, texto plano | HTML, Markdown, texto plano |
| Archivos comprimidos | ZIP, TAR, GZIP | ZIP (reempaquetado), GZIP, listado (JSON) |
| Lo que sea | cualquier archivo | SHA-256, BLAKE3, MD5 |

\* La salida AVIF solo se ofrece cuando el codificador del propio navegador puede escribirla. Si no puede, Canvas devuelve un PNG sin avisar, así que FileHop comprueba el resultado y oculta ese formato en lugar de darte un archivo mal etiquetado.

**Todavía no disponible:** DOCX y LaTeX (necesitan pandoc, GPL), RAR y 7z, vídeo y audio. La aplicación lo dice claramente en su sección de formatos en vez de fingir.

Probado el 2026-11-08 en Chromium 158, Firefox 159 y el motor WebKit (22 conversiones en cada uno, todas superadas). Safari en Mac o iPhone aún no se ha probado. Detalles: [docs/TESTING.md](docs/TESTING.md).

## Qué ve el servidor

- Los archivos de la propia aplicación (HTML, scripts, fuentes). Todas las peticiones son del mismo origen; la página no carga nada de ningún otro sitio.
- Si inicias sesión con HOP ID: tu número de HOP ID, tu nombre y tu correo, y una cookie de sesión. Cerrar sesión, o que el hub cierre tu sesión, la elimina.
- Nunca un archivo, un nombre de archivo ni un resultado de conversión.

La página funciona con aislamiento entre orígenes (`Cross-Origin-Embedder-Policy: require-corp`) y una Content Security Policy estricta: sin scripts en línea, sin `eval`, sin hosts de terceros.

## Instálalo tú mismo

**Con el instalador** (arriba): compila la aplicación del navegador con Node 20.19+ y el servidor con Go 1.27+, o usa Docker, y te genera `.env`, `start.sh` y una unidad de systemd.

**A mano:**

```bash
npm ci && npm run build        # la aplicación del navegador → web/dist
go build -o filehop ./cmd/filehop
FILEHOP_ADDR=127.0.0.1:8095 ./filehop
```

La configuración se hace con variables de entorno, listadas en [`deploy/filehop.env.example`](deploy/filehop.env.example). Sin `FILEHOP_SSO_URL`, FileHop funciona sin ninguna cuenta, y ya es un conversor completo. Con ella, la gente puede iniciar sesión con HOP ID desde tu hub (HEL.ink). [docs/DEPLOY.md](docs/DEPLOY.md) explica nginx, systemd y el hub.

**Para desarrollo:**

```bash
npm run dev          # http://localhost:5179, solo la aplicación del navegador (Vite)
npm run local        # http://localhost:8095, el servidor Go + un hub sustituto en :8097
```

`npm run local` ejecuta el servidor real junto a `tools/hubstub`, un pequeño sustituto del hub de HOP ID y del panel de control Imperium con los mismos formatos de comunicación, para que puedas probar el inicio de sesión, el cierre de sesión y los eventos de cuenta en una sola máquina.

## Preguntas frecuentes

**¿Se envía mi archivo a algún sitio?** No. Abre la pestaña Red en las herramientas de desarrollo de tu navegador mientras se hace una conversión: se queda vacía.

**¿Necesito una cuenta?** No. Todo funciona sin ella. Por ahora HOP ID solo añade el menú de cuenta; los ajustes predefinidos sincronizados llegarán más adelante.

**¿Qué tamaño puede tener un archivo?** El que permita la memoria de tu navegador. FileHop calcula la memoria que necesita una tarea antes de empezar y te avisa si un archivo es demasiado grande para este dispositivo. Cada lote admite como máximo 50 archivos.

**¿Por qué no aparece AVIF en mi ordenador?** Tu navegador no puede escribir AVIF. FileHop solo ofrece los formatos que realmente puede generar.

**¿Son seguras las conversiones con archivos de origen dudoso?** FileHop trata cada archivo como hostil: los archivos comprimidos se miden antes de descomprimirlos (se rechazan las bombas zip y las rutas `../`), el SVG se dibuja mediante un elemento de imagen que nunca ejecuta scripts y los PDF se leen con pdf.js, que no ejecuta el JavaScript del documento.

## Cómo funciona por dentro

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

- **El tipo sale de los bytes.** Primero los magic bytes, después la extensión. Un JPEG renombrado a `.txt` se abre igual, y la tarjeta indica "Nombre ≠ contenido".
- **Una tarea, un worker.** El pool deja un núcleo libre para la página, baja a 2 workers en móviles y dispositivos con poca memoria, y se puede fijar en 1 desde los ajustes.
- **El trabajo de Canvas pasa a la página cuando hace falta.** El SVG necesita un `<img>`, y los navegadores sin `OffscreenCanvas` (Safari anterior a 16.4) no pueden dibujar en un worker, así que esas tareas ocupan un hueco en el hilo principal.
- **No se descarga nada en tiempo de ejecución.** Todo el motor va en el bundle (unos 236 KB con gzip para la parte del worker y 45 KB para la página).
- **Para la familia:** `/hop/health`, `/hop/manifest`, `/hop/stats`, `/hop/users/{sub}` y `/hop/events` responden a llamadas firmadas del panel de control Imperium y del hub.

Tipografía: Inter para el texto, Instrument Serif en cursiva para la frase destacada y JetBrains Mono para nombres de archivo y hashes, todas incluidas en `web/public/hop-fonts/`. Idiomas: `en, zh-CN, de, id, ja, pt-BR, es, fr, ru` en `web/src/lib/i18n/`; `npm run lint:i18n` los mantiene sincronizados.

## Seguridad, licencia e historial

Informa de vulnerabilidades en privado: [SECURITY.md](SECURITY.md). FileHop tiene licencia MIT ([LICENSE](LICENSE)). Sus bibliotecas: `pdfjs-dist` Apache-2.0 · `pdf-lib` MIT · `fflate` MIT · `hash-wasm` MIT · `marked` MIT · `papaparse` MIT · `yaml` ISC · Svelte MIT · fuentes SIL OFL 1.1. No incluye ningún motor GPL ni AGPL. Qué cambió y cuándo: [CHANGELOG.md](CHANGELOG.md).

## Autoalojamiento

<!-- self-hosting:start -->
Todo lo que FileHop necesita está en repositorios públicos: ningún repositorio privado, ningún token y ninguna cuenta en hel.ink. Los detalles están en la guía de la familia: [docs/self-hosting.md](https://github.com/navi-crwn/HEL.ink/blob/main/docs/self-hosting.md) (en inglés).

| Pieza | Para FileHop | Qué hace |
| --- | --- | --- |
| [HEL.ink](https://github.com/navi-crwn/HEL.ink) (hub, HOP ID) | Opcional: añade «Iniciar sesión con HOP ID» | Cuentas e inicio de sesión para todas las apps |
| [Imperium](https://github.com/navi-crwn/Imperium) | Opcional | Panel de administración de toda la familia; necesita el hub |
| Fuentes y mosaicos de la familia | Nada que instalar: se cargan desde `hel.ink/hop-assets` | Sin hel.ink: fuentes del sistema, sin mosaicos flotantes |

- **Orden de instalación**: FileHop solo con `./install.sh`. Para iniciar sesión con HOP ID, primero el [hub](https://github.com/navi-crwn/HEL.ink): `./install.sh --hub new` instala uno al lado.
- **Ajustes mínimos**: `FILEHOP_BASE_URL`; con el hub: `FILEHOP_SSO_URL`, `FILEHOP_SSO_CLIENT=filehop`, `FILEHOP_SSO_SECRET`.
- **Solo o en la familia**: FileHop funciona solo, sin ninguna cuenta, y ya es un conversor completo. Con un hub, se puede iniciar sesión con HOP ID.
- **Sin Imperium**: no falta nada: FileHop no guarda archivos, e Imperium solo muestra su estado y sus cifras.
<!-- self-hosting:end -->

## La familia HOP

FileHop forma parte de la familia HOP, un conjunto de aplicaciones de código abierto que respetan la privacidad y que puedes alojar tú mismo.

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
| **PayHop** | [pay.hel.ink](https://pay.hel.ink) | [navi-crwn/PayHop](https://github.com/navi-crwn/PayHop) | Make a payment QR and split a bill; nothing leaves your browser. |
| **Imperium** | not public-facing: optional, for admins | [navi-crwn/Imperium](https://github.com/navi-crwn/Imperium) | The HOP control panel. |
<!-- hop-family:end -->

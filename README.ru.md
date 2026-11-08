<p align="center">🌐 <a href="README.md">English</a> · <a href="README.zh-CN.md">简体中文</a> · <a href="README.de.md">Deutsch</a> · <a href="README.id.md">Bahasa Indonesia</a> · <a href="README.ja.md">日本語</a> · <a href="README.pt-BR.md">Português (Brasil)</a> · <a href="README.es.md">Español</a> · <a href="README.fr.md">Français</a> · <b>Русский</b></p>

<p align="center"><picture><source media="(prefers-color-scheme: dark)" srcset="docs/readme/hero-dark.webp"><img src="docs/readme/hero-light.webp" alt="Главная страница FileHop: заголовок «Конвертируйте что угодно, и ничто не покинет это устройство» рядом с зоной для перетаскивания файлов" width="100%"></picture></p>

<p align="center"><b>Любой файл, любой формат, на вашем устройстве.</b><br>FileHop конвертирует изображения, PDF, таблицы, текст и архивы прямо в браузере. Ничего не загружается на сервер.</p>

<p align="center">
  <a href="https://file.hel.ink"><b>Попробовать онлайн</b></a> ·
  <a href="#свой-сервер">Свой сервер</a> ·
  <a href="#что-он-конвертирует">Что он конвертирует</a> ·
  <a href="#частые-вопросы">Частые вопросы</a> ·
  <a href="docs/DEPLOY.md">Развёртывание</a> ·
  <a href="docs/TESTING.md">Тестирование</a> ·
  <a href="CHANGELOG.md">Список изменений</a>
</p>

<p align="center"><sub>Один бинарный файл на Go · конвертация идёт во вкладке браузера · 9 языков · без рекламы и трекеров · бесплатно и с открытым кодом (MIT)</sub></p>

> [!IMPORTANT]
> У FileHop нет кнопки загрузки, потому что никакой загрузки нет. Файлы открываются через File API браузера, конвертируются во вкладке силами вашего процессора и возвращаются вам в виде скачивания. Сервер отдаёт само приложение и, если вы вошли, хранит вашу сессию HOP ID. Файлов он не получает никогда.

FileHop — это конвертер файлов, который можно развернуть у себя. Перетащите файлы на страницу, выберите формат на каждой карточке (или один для всей группы), нажмите «Конвертировать» и скачайте результат. Он пригодится тем, кому нужно:

- превратить PNG в WebP, скан в PDF или разбить PDF на страницы, не отдавая файл какому-то сайту,
- перевести CSV в JSON или YAML (и обратно) без электронных таблиц,
- заглянуть внутрь ZIP или проверить SHA-256 файла на компьютере, где нельзя ничего устанавливать.

Установка — одна команда. Скрипт проверит ваш компьютер, задаст несколько вопросов и может подключить FileHop к хабу аккаунтов HOP ID:

```bash
curl -fsSL https://raw.githubusercontent.com/navi-crwn/FileHop/main/install.sh | bash
```

Из клона репозитория: `./install.sh`. Обновление — `./update.sh`, удаление — `./uninstall.sh`. Добавьте `--yes`, чтобы принять все значения по умолчанию; `--help` покажет список параметров.

## Что он конвертирует

| Категория | На входе | На выходе |
|---|---|---|
| Изображения | PNG, JPEG, WebP, AVIF\*, GIF, BMP, TIFF, ICO, SVG | WebP, AVIF\*, JPEG, PNG, PDF |
| PDF | PDF | объединение, разделение (ZIP), поворот, выбор страниц, страницы → PNG/JPEG (ZIP), сведения о документе (JSON) |
| Данные | CSV, TSV, JSON, YAML | CSV, TSV, JSON, YAML |
| Текст | Markdown, HTML, обычный текст | HTML, Markdown, обычный текст |
| Архивы | ZIP, TAR, GZIP | ZIP (перепакованный), GZIP, список содержимого (JSON) |
| Что угодно | любой файл | SHA-256, BLAKE3, MD5 |

\* Вывод в AVIF предлагается, только если собственный кодировщик браузера умеет его записывать. Если не умеет, Canvas молча возвращает PNG, поэтому FileHop проверяет результат и скрывает этот формат, а не отдаёт вам файл с неверной подписью.

**Пока нет:** DOCX и LaTeX (нужен pandoc, GPL), RAR и 7z, видео и аудио. Приложение честно пишет об этом в разделе форматов, а не делает вид, что всё умеет.

Проверено 2026-11-08 в Chromium 158, Firefox 159 и на движке WebKit (по 22 конвертации в каждом, все успешны). Safari на Mac или iPhone ещё не проверялся. Подробности: [docs/TESTING.md](docs/TESTING.md).

## Что видит сервер

- Файлы самого приложения (HTML, скрипты, шрифты). Все запросы идут к тому же источнику; страница ничего не загружает с других сайтов.
- Если вы входите через HOP ID: ваш номер HOP ID, имя и email, а также cookie сессии. Выход из аккаунта или выход по команде хаба удаляет сессию.
- Никогда — ни файл, ни имя файла, ни результат конвертации.

Страница работает в режиме cross-origin isolation (`Cross-Origin-Embedder-Policy: require-corp`) со строгой Content Security Policy: никаких встроенных скриптов, никакого `eval`, никаких сторонних хостов.

## Свой сервер

**С установщиком** (см. выше): он соберёт браузерное приложение на Node 20.19+ и сервер на Go 1.27+ или воспользуется Docker, а также создаст для вас `.env`, `start.sh` и юнит systemd.

**Вручную:**

```bash
npm ci && npm run build        # браузерное приложение → web/dist
go build -o filehop ./cmd/filehop
FILEHOP_ADDR=127.0.0.1:8095 ./filehop
```

Настройки задаются переменными окружения, их список — в [`deploy/filehop.env.example`](deploy/filehop.env.example). Без `FILEHOP_SSO_URL` FileHop работает вообще без аккаунтов, и это уже полноценный конвертер. С ней пользователи смогут входить через HOP ID с вашего хаба (HEL.ink). Про nginx, systemd и хаб рассказано в [docs/DEPLOY.md](docs/DEPLOY.md).

**Для разработки:**

```bash
npm run dev          # http://localhost:5179, только браузерное приложение (Vite)
npm run local        # http://localhost:8095, сервер на Go + хаб-заглушка на :8097
```

`npm run local` запускает настоящий сервер вместе с `tools/hubstub` — небольшой заменой хаба HOP ID и панели управления Imperium с теми же форматами обмена. Так вход, выход и события аккаунта можно проверить на одной машине.

## Частые вопросы

**Мой файл куда-то отправляется?** Нет. Откройте вкладку «Сеть» в инструментах разработчика браузера во время конвертации: она останется пустой.

**Нужен ли аккаунт?** Нет. Всё работает и без него. Пока HOP ID добавляет только меню аккаунта; синхронизация пресетов появится позже.

**Какого размера может быть файл?** Настолько большого, насколько позволяет память браузера. FileHop заранее оценивает, сколько памяти понадобится задаче, и предупреждает, если файл слишком велик для этого устройства. В одном пакете — не больше 50 файлов.

**Почему на моём компьютере нет AVIF?** Ваш браузер не умеет записывать AVIF. FileHop предлагает только те форматы, которые действительно может создать.

**Безопасно ли конвертировать файлы из ненадёжных источников?** FileHop считает каждый файл потенциально враждебным: архивы измеряются до распаковки (zip-бомбы и пути `../` отклоняются), SVG рисуется через элемент изображения, который никогда не выполняет скрипты, а PDF читаются с помощью pdf.js, который не запускает JavaScript из документа.

## Как это устроено

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

- **Тип определяется по байтам.** Сначала сигнатура файла, потом расширение. JPEG, переименованный в `.txt`, всё равно откроется, а на карточке появится «Имя ≠ содержимое».
- **Одна задача — один воркер.** Пул оставляет одно ядро для страницы, на телефонах и устройствах с малым объёмом памяти снижает число воркеров до 2, а в настройках его можно зафиксировать на 1.
- **Работа с Canvas переходит на страницу, когда без этого никак.** SVG нужен `<img>`, а браузеры без `OffscreenCanvas` (Safari до 16.4) не умеют рисовать в воркере, поэтому такие задачи занимают один слот в основном потоке.
- **Во время работы ничего не скачивается.** Весь движок уже в бандле (около 236 КБ в gzip для части воркера и 45 КБ для страницы).
- **Для семейства:** `/hop/health`, `/hop/manifest`, `/hop/stats`, `/hop/users/{sub}` и `/hop/events` отвечают на подписанные запросы от панели управления Imperium и хаба.

Шрифты: Inter для текста, курсив Instrument Serif для акцентной фразы, JetBrains Mono для имён файлов и хешей; все они лежат в `web/public/hop-fonts/`. Языки: `en, zh-CN, de, id, ja, pt-BR, es, fr, ru` в `web/src/lib/i18n/`; `npm run lint:i18n` следит, чтобы они не расходились.

## Безопасность, лицензия и история

Об уязвимостях сообщайте конфиденциально: [SECURITY.md](SECURITY.md). FileHop распространяется по лицензии MIT ([LICENSE](LICENSE)). Используемые библиотеки: `pdfjs-dist` Apache-2.0 · `pdf-lib` MIT · `fflate` MIT · `hash-wasm` MIT · `marked` MIT · `papaparse` MIT · `yaml` ISC · Svelte MIT · шрифты SIL OFL 1.1. Движков под GPL или AGPL нет. Что и когда менялось: [CHANGELOG.md](CHANGELOG.md).

## Собственный хостинг

<!-- self-hosting:start -->
Всё, что нужно FileHop, лежит в публичных репозиториях: не нужны ни приватный репозиторий, ни токен, ни учётная запись на hel.ink. Подробности — в руководстве по семейству: [docs/self-hosting.md](https://github.com/navi-crwn/HEL.ink/blob/main/docs/self-hosting.md) (на английском).

| Компонент | Для FileHop | Зачем |
| --- | --- | --- |
| [HEL.ink](https://github.com/navi-crwn/HEL.ink) (хаб, HOP ID) | Необязательно: добавляет «Войти через HOP ID» | Учётные записи и вход для всех приложений |
| [Imperium](https://github.com/navi-crwn/Imperium) | Необязательно | Панель администратора для всего семейства; нужен хаб |
| Шрифты и плитки семейства | Ничего устанавливать не нужно: загружаются с `hel.ink/hop-assets` | Без hel.ink: системные шрифты, без плавающих плиток |

- **Порядок установки**: FileHop отдельно через `./install.sh`. Для входа через HOP ID сначала [хаб](https://github.com/navi-crwn/HEL.ink): `./install.sh --hub new` установит его рядом.
- **Минимальные настройки**: `FILEHOP_BASE_URL`; с хабом: `FILEHOP_SSO_URL`, `FILEHOP_SSO_CLIENT=filehop`, `FILEHOP_SSO_SECRET`.
- **Отдельно или в семействе**: FileHop работает отдельно вообще без учётных записей и уже является полноценным конвертером. С хабом можно входить через HOP ID.
- **Без Imperium**: ничего не теряется: FileHop не хранит файлы, а Imperium лишь показывает его состояние и цифры.
<!-- self-hosting:end -->

## Семейство HOP

FileHop входит в семейство HOP — набор приложений с открытым кодом, которые уважают приватность и которые можно развернуть у себя.

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
| **Imperium** | not public-facing: optional, for admins | [navi-crwn/Imperium](https://github.com/navi-crwn/Imperium) | The HOP control panel. |
<!-- hop-family:end -->

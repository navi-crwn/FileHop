<p align="center">🌐 <a href="README.md">English</a> · <a href="README.zh-CN.md">简体中文</a> · <a href="README.de.md">Deutsch</a> · <a href="README.id.md">Bahasa Indonesia</a> · <a href="README.ja.md">日本語</a> · <b>Português (Brasil)</b> · <a href="README.es.md">Español</a> · <a href="README.fr.md">Français</a> · <a href="README.ru.md">Русский</a></p>

<p align="center"><picture><source media="(prefers-color-scheme: dark)" srcset="docs/readme/hero-dark.webp"><img src="docs/readme/hero-light.webp" alt="A página inicial do FileHop: o título 'Converta qualquer coisa, e nada sai deste dispositivo' ao lado da área para soltar arquivos" width="100%"></picture></p>

<p align="center"><b>Qualquer arquivo, qualquer formato, no seu dispositivo.</b><br>O FileHop converte imagens, PDFs, tabelas, textos e arquivos compactados no seu navegador. Nada é enviado.</p>

<p align="center">
  <a href="https://file.hel.ink"><b>Experimente online</b></a> ·
  <a href="#hospede-você-mesmo">Hospede você mesmo</a> ·
  <a href="#o-que-ele-converte">O que ele converte</a> ·
  <a href="#perguntas-frequentes">Perguntas frequentes</a> ·
  <a href="docs/DEPLOY.md">Implantação</a> ·
  <a href="docs/TESTING.md">Testes</a> ·
  <a href="CHANGELOG.md">Histórico de mudanças</a>
</p>

<p align="center"><sub>Um único binário Go · a conversão acontece na aba do navegador · 9 idiomas · sem anúncios, sem rastreadores · gratuito e de código aberto (MIT)</sub></p>

> [!IMPORTANT]
> O FileHop não tem botão de upload porque não existe upload. Os arquivos são abertos pela File API do navegador, convertidos dentro da aba com o seu próprio processador e devolvidos como download. O servidor só entrega o app e, se você entrar, guarda a sua sessão do HOP ID. Ele nunca recebe um arquivo.

O FileHop é um conversor de arquivos que você pode hospedar por conta própria. Solte os arquivos na página, escolha um formato em cada cartão (ou um para o grupo todo), clique em Converter e baixe. Ele é para quem:

- precisa de um PNG em WebP, de uma digitalização em PDF ou de um PDF separado em páginas, sem entregar o arquivo a um site,
- quer transformar CSV em JSON ou YAML (e vice-versa) sem abrir uma planilha,
- quer ver o que tem dentro de um ZIP, ou conferir o SHA-256 de um arquivo, num computador em que não pode instalar programas.

A instalação é um único comando. O script verifica o seu computador, faz algumas perguntas e pode conectar o FileHop a um hub de contas HOP ID:

```bash
curl -fsSL https://raw.githubusercontent.com/navi-crwn/FileHop/main/install.sh | bash
```

A partir de um clone: `./install.sh`. Atualize com `./update.sh` e remova com `./uninstall.sh`. Adicione `--yes` para aceitar todos os padrões; `--help` lista as opções.

## O que ele converte

| Categoria | Entrada | Saída |
|---|---|---|
| Imagens | PNG, JPEG, WebP, AVIF\*, GIF, BMP, TIFF, ICO, SVG | WebP, AVIF\*, JPEG, PNG, PDF |
| PDF | PDF | juntar, dividir (ZIP), girar, selecionar páginas, páginas → PNG/JPEG (ZIP), informações do documento (JSON) |
| Dados | CSV, TSV, JSON, YAML | CSV, TSV, JSON, YAML |
| Texto | Markdown, HTML, texto simples | HTML, Markdown, texto simples |
| Arquivos compactados | ZIP, TAR, GZIP | ZIP (recompactado), GZIP, listagem (JSON) |
| Qualquer coisa | qualquer arquivo | SHA-256, BLAKE3, MD5 |

\* A saída em AVIF só aparece quando o codificador do próprio navegador consegue gravá-la. Quando não consegue, o Canvas devolve um PNG sem avisar, então o FileHop confere o resultado e esconde esse formato em vez de entregar um arquivo com o rótulo errado.

**Ainda não disponível:** DOCX e LaTeX (precisam do pandoc, GPL), RAR e 7z, vídeo e áudio. O app diz isso abertamente na seção de formatos, em vez de fingir que suporta.

Testado em 2026-11-08 no Chromium 158, no Firefox 159 e no motor WebKit (22 conversões em cada um, todas aprovadas). O Safari no Mac ou no iPhone ainda não foi testado. Detalhes: [docs/TESTING.md](docs/TESTING.md).

## O que o servidor vê

- Os arquivos do próprio app (HTML, scripts, fontes). Toda requisição é da mesma origem; a página não carrega nada de nenhum outro site.
- Se você entrar com o HOP ID: o seu número HOP ID, nome e e-mail, além de um cookie de sessão. Sair, ou ser desconectado pelo hub, apaga a sessão.
- Nunca um arquivo, um nome de arquivo ou um resultado de conversão.

A página roda com isolamento entre origens (`Cross-Origin-Embedder-Policy: require-corp`) e uma Content Security Policy rígida: sem scripts inline, sem `eval`, sem hosts de terceiros.

## Hospede você mesmo

**Com o instalador** (acima): ele compila o app do navegador com Node 20.19+ e o servidor com Go 1.27+, ou usa Docker, e gera para você o `.env`, o `start.sh` e uma unit do systemd.

**Manualmente:**

```bash
npm ci && npm run build        # o app do navegador → web/dist
go build -o filehop ./cmd/filehop
FILEHOP_ADDR=127.0.0.1:8095 ./filehop
```

As configurações são variáveis de ambiente, listadas em [`deploy/filehop.env.example`](deploy/filehop.env.example). Sem `FILEHOP_SSO_URL`, o FileHop roda sem nenhuma conta, e já é um conversor completo. Com ela, as pessoas podem entrar com o HOP ID do seu hub (HEL.ink). O [docs/DEPLOY.md](docs/DEPLOY.md) explica nginx, systemd e o hub.

**Para desenvolvimento:**

```bash
npm run dev          # http://localhost:5179, só o app do navegador (Vite)
npm run local        # http://localhost:8095, o servidor Go + um hub substituto em :8097
```

O `npm run local` roda o servidor de verdade junto com o `tools/hubstub`, um pequeno substituto do hub HOP ID e do painel de controle Imperium com os mesmos formatos de comunicação. Assim dá para testar login, logout e eventos de conta numa única máquina.

## Perguntas frequentes

**Meu arquivo é enviado para algum lugar?** Não. Abra a aba Rede nas ferramentas de desenvolvedor do navegador enquanto uma conversão roda: ela continua vazia.

**Preciso de uma conta?** Não. Tudo funciona sem conta. Por enquanto o HOP ID só acrescenta o menu da conta; predefinições sincronizadas virão depois.

**Qual o tamanho máximo de um arquivo?** O que a memória do seu navegador aguentar. O FileHop estima a memória que uma tarefa vai usar antes de começar e avisa quando um arquivo é grande demais para este dispositivo. Cada lote tem limite de 50 arquivos.

**Por que o AVIF não aparece no meu computador?** O seu navegador não consegue gravar AVIF. O FileHop só oferece formatos que ele realmente consegue gerar.

**As conversões são seguras para arquivos de origem desconhecida?** O FileHop trata todo arquivo como hostil: arquivos compactados são medidos antes de serem extraídos (bombas zip e caminhos `../` são recusados), o SVG é desenhado por um elemento de imagem que nunca executa scripts, e os PDFs são lidos com o pdf.js, que não executa o JavaScript do documento.

## Por dentro

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

- **O tipo vem dos bytes.** Primeiro os magic bytes, depois a extensão. Um JPEG renomeado para `.txt` abre do mesmo jeito, e o cartão mostra "Nome ≠ conteúdo".
- **Uma tarefa, um worker.** O pool deixa um núcleo livre para a página, cai para 2 workers em celulares e aparelhos com pouca memória e pode ser fixado em 1 nas configurações.
- **O trabalho de Canvas vai para a página quando é preciso.** O SVG precisa de um `<img>`, e navegadores sem `OffscreenCanvas` (Safari antes do 16.4) não conseguem desenhar num worker, então essas tarefas ocupam uma vaga na thread principal.
- **Nada é baixado em tempo de execução.** O motor inteiro está no bundle (cerca de 236 KB com gzip para a parte do worker, 45 KB para a página).
- **Para a família:** `/hop/health`, `/hop/manifest`, `/hop/stats`, `/hop/users/{sub}` e `/hop/events` respondem a chamadas assinadas do painel de controle Imperium e do hub.

Tipografia: Inter para o texto, Instrument Serif itálico para a frase de destaque, JetBrains Mono para nomes de arquivo e hashes, todas incluídas em `web/public/hop-fonts/`. Idiomas: `en, zh-CN, de, id, ja, pt-BR, es, fr, ru` em `web/src/lib/i18n/`; o `npm run lint:i18n` mantém todos em sincronia.

## Segurança, licença e histórico

Relate vulnerabilidades de forma privada: [SECURITY.md](SECURITY.md). O FileHop é licenciado sob MIT ([LICENSE](LICENSE)). Bibliotecas usadas: `pdfjs-dist` Apache-2.0 · `pdf-lib` MIT · `fflate` MIT · `hash-wasm` MIT · `marked` MIT · `papaparse` MIT · `yaml` ISC · Svelte MIT · fontes SIL OFL 1.1. Nenhum motor GPL ou AGPL está incluído. O que mudou e quando: [CHANGELOG.md](CHANGELOG.md).

## A família HOP

O FileHop faz parte da família HOP, um conjunto de apps de código aberto que respeitam a privacidade e podem ser hospedados por conta própria.

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

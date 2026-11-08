// Drives the built app in several browser engines and converts at least one
// real file per category in each, then checks the first bytes of every output.
// It is a smoke test of the production build behind production headers, not a
// unit test.
//
//   npm run build && PORT=4181 npm start             # in one shell
//   node tools/browser-matrix.mjs http://localhost:4181 chromium,webkit,firefox
//
// Drivers (none is a dependency of this repo; install them anywhere):
//   chromium, webkit  Playwright         PLAYWRIGHT_MODULE=/path/node_modules/playwright/index.mjs
//   firefox           Puppeteer + the official Mozilla build over WebDriver BiDi
//                     PUPPETEER_MODULE=/path/node_modules/puppeteer-core/lib/esm/puppeteer/puppeteer-core.js
//                     FIREFOX_BIN=/path/firefox.exe   (npx @puppeteer/browsers install firefox@stable)
//
// Honest limits: Playwright's WebKit is the open-source WebKit engine, not
// Apple's Safari, and it runs on Windows/Linux here, not on macOS or iOS. It
// catches engine differences (COEP, OffscreenCanvas, encoders, workers); it
// does not replace a check on a real Safari.
//
// Every interaction goes through the page's own DOM (button.click(), the file
// input), and downloads are caught at the <a download> the app clicks, so the
// same steps run unchanged under both drivers.
import { readFileSync, writeFileSync, mkdirSync, copyFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { tmpdir } from 'node:os';
import { PDFDocument } from 'pdf-lib';

const base = process.argv[2] ?? 'http://localhost:4181';
const engines = (process.argv[3] ?? 'chromium,webkit,firefox').split(',');
const load = async (envName, fallback) => {
  const p = process.env[envName];
  return import(p ? pathToFileURL(resolve(p)).href : fallback);
};

const td = resolve('testdata');
const out = resolve(process.env.MATRIX_OUT ?? join(tmpdir(), 'filehop-matrix'));
mkdirSync(out, { recursive: true });
const pdf2 = join(out, 'second.pdf'); // a second file, so Merge has two PDFs
copyFileSync(join(td, 'sample.pdf'), pdf2);
const bin = join(out, 'tiny.bin'); // bytes no detector claims, so only hashes are offered
writeFileSync(bin, Uint8Array.from({ length: 4096 }, (_, i) => (i * 7 + 3) & 255));

const magic = {
  webp: b => b.subarray(0, 4).toString() === 'RIFF' && b.subarray(8, 12).toString() === 'WEBP',
  jpeg: b => b[0] === 0xff && b[1] === 0xd8,
  png: b => b.subarray(1, 4).toString() === 'PNG',
  pdf: b => b.subarray(0, 4).toString() === '%PDF',
  zip: b => b[0] === 0x50 && b[1] === 0x4b,
  json: b => { try { JSON.parse(b.toString()); return true; } catch { return false; } },
  yaml: b => /^\s*-?\s*\w+:/m.test(b.toString()),
  html: b => /<(p|h1|ul|strong)/.test(b.toString()),
  md: b => /^#|\*\*|^- /m.test(b.toString())
};

const f = n => join(td, n);
const sha = createHash('sha256').update(readFileSync(bin)).digest('hex');

/* expect: a magic key, 'hash' (compare with node:crypto) or 'error' (must be refused) */
const CASES = [
  { cat: 'image', files: [f('sample.png')], target: 'WebP', expect: 'webp' },
  { cat: 'image', files: [f('sample.png')], target: 'JPEG', expect: 'jpeg' },
  { cat: 'image', files: [f('sample.png')], target: 'PDF', expect: 'pdf' },
  { cat: 'image', files: [f('sample.jpg')], target: 'PNG', expect: 'png' },
  { cat: 'image', files: [f('sample.jpg')], target: 'WebP', expect: 'webp' },
  { cat: 'image', files: [f('hostile-script.svg')], target: 'WebP', expect: 'webp', svg: true },
  { cat: 'pdf', files: [f('sample.pdf')], target: 'Split', expect: 'zip' },
  { cat: 'pdf', files: [f('sample.pdf')], target: 'Pages → PNG', expect: 'zip' },
  { cat: 'pdf', files: [f('sample.pdf')], target: 'Rotate 90°', expect: 'pdf' },
  { cat: 'pdf', files: [f('sample.pdf')], target: 'Info', expect: 'json' },
  { cat: 'pdf', files: [f('sample.pdf'), pdf2], target: 'Merge', expect: 'pdf', pages: 6 },
  { cat: 'pdf', files: [f('hostile-openaction.pdf')], target: 'Info', expect: 'json' },
  { cat: 'data', files: [f('people.csv')], target: 'JSON', expect: 'json' },
  { cat: 'data', files: [f('people.yaml')], target: 'JSON', expect: 'json' },
  { cat: 'data', files: [f('people.json')], target: 'YAML', expect: 'yaml' },
  { cat: 'text', files: [f('readme.md')], target: 'HTML', expect: 'html' },
  { cat: 'text', files: [f('page.html')], target: 'Markdown', expect: 'md' },
  { cat: 'archive', files: [f('bundle.zip')], target: 'List', expect: 'json' },
  { cat: 'archive', files: [f('bundle.zip')], target: 'ZIP', expect: 'zip' },
  { cat: 'archive', files: [f('hostile-ratio.zip')], target: 'List', expect: 'error' },
  { cat: 'archive', files: [f('hostile-slipslip.zip')], target: 'ZIP', expect: 'error' },
  { cat: 'hash', files: [bin], target: 'SHA-256', expect: 'hash' }
];

/* Runs before the app: catches CSP reports and the blob behind every <a download>. */
const INIT = `
  window.__csp = [];
  window.__dl = [];
  document.addEventListener('securitypolicyviolation', e => window.__csp.push(e.violatedDirective + ' ' + e.blockedURI));
  const blobs = new Map();
  const make = URL.createObjectURL;
  URL.createObjectURL = function (o) { const u = make.call(URL, o); if (o instanceof Blob) blobs.set(u, o); return u; };
  window.__blob = href => blobs.get(href);
  const click = HTMLAnchorElement.prototype.click;
  HTMLAnchorElement.prototype.click = function () {
    if (this.download && this.href.startsWith('blob:')) { window.__dl.push({ name: this.download, href: this.href }); return; }
    return click.call(this);
  };
`;

/* The same steps for every engine; d is a thin driver. */
async function runEngine(d) {
  const env = await d.eval(`(async () => {
    const c = document.createElement('canvas'); c.width = c.height = 2;
    let offscreenWebp = 'n/a';
    if (typeof OffscreenCanvas !== 'undefined') {
      try { const o = new OffscreenCanvas(2, 2); o.getContext('2d').fillRect(0, 0, 1, 1);
            offscreenWebp = (await o.convertToBlob({ type: 'image/webp' })).type; }
      catch (e) { offscreenWebp = 'throws: ' + e.message; }
    }
    return { ua: navigator.userAgent, crossOriginIsolated: self.crossOriginIsolated,
      sharedArrayBuffer: typeof SharedArrayBuffer !== 'undefined', offscreenCanvas: typeof OffscreenCanvas !== 'undefined',
      canvasWebp: c.toDataURL('image/webp').slice(5, 15), canvasAvif: c.toDataURL('image/avif').slice(5, 15), offscreenWebp,
      hardwareConcurrency: navigator.hardwareConcurrency };
  })()`);
  const rows = [];
  const csp = [];
  for (const c of CASES) {
    await d.fresh();
    await d.upload(c.files);
    const row = { cat: c.cat, file: c.files.map(p => p.split(/[\\/]/).pop()).join(' + '), target: c.target, result: '', ok: false };
    try {
      await d.waitFor(`!!document.querySelector('article.card')`);
      const picked = await d.eval(`(() => {
        const card = document.querySelector('article.card');
        const chips = [...card.querySelectorAll('.targets button')];
        const chip = chips.find(b => b.textContent.trim() === ${JSON.stringify(c.target)});
        if (!chip) return 'not offered (got: ' + chips.map(b => b.textContent.trim()).join(', ') + ')';
        chip.click();
        return 'ok';
      })()`);
      if (picked !== 'ok') throw new Error('target ' + picked);
      await d.eval(`new Promise(r => setTimeout(r, 50))`);
      await d.eval(`[...document.querySelector('article.card').querySelectorAll('button')].find(b => b.textContent.trim() === 'Convert').click()`);
      await d.waitFor(`/\\b(done|error)\\b/.test(document.querySelector('article.card').className)`, 60000);
      const state = await d.eval(`(() => { const card = document.querySelector('article.card');
        return { cls: card.className, err: card.querySelector('.err')?.textContent.trim() ?? '', hash: card.querySelector('code.hash')?.textContent.trim() ?? '' }; })()`);
      const failed = state.cls.includes('error');
      if (c.expect === 'error') {
        row.ok = failed;
        row.result = failed ? 'refused: ' + state.err : 'NOT refused';
      } else if (failed) {
        row.result = 'error: ' + state.err;
      } else if (c.expect === 'hash') {
        row.ok = state.hash === sha;
        row.result = row.ok ? 'sha256 matches node:crypto' : `hash ${state.hash} != ${sha}`;
      } else {
        await d.eval(`[...document.querySelector('article.card').querySelectorAll('button')].find(b => b.textContent.trim() === 'Download').click()`);
        const dl = await d.eval(`(async () => { const x = window.__dl.pop(); if (!x) return null;
          const b = new Uint8Array(await window.__blob(x.href).arrayBuffer());
          let s = ''; for (let i = 0; i < b.length; i += 0x8000) s += String.fromCharCode(...b.subarray(i, i + 0x8000));
          return { name: x.name, b64: btoa(s) }; })()`);
        if (!dl) throw new Error('no download was started');
        const bytes = Buffer.from(dl.b64, 'base64');
        writeFileSync(join(out, `${d.name}-${c.cat}-${c.target.replace(/\W+/g, '_')}-${dl.name}`), bytes);
        row.ok = bytes.length > 0 && magic[c.expect](bytes);
        row.result = `${dl.name} ${bytes.length} B ${row.ok ? c.expect + ' ok' : 'BAD BYTES'}`;
        if (c.pages) {
          const n = (await PDFDocument.load(bytes)).getPageCount();
          row.result += `, ${n} pages`;
          row.ok &&= n === c.pages;
        }
      }
      if (c.svg) {
        const ran = await d.eval(`!!window.__svgRan`);
        row.result += ran ? ', SVG SCRIPT RAN' : ', svg script did not run';
        row.ok &&= !ran;
      }
    } catch (e) {
      row.result = 'FAIL: ' + String(e.message).split('\n')[0];
    }
    csp.push(...(await d.eval(`window.__csp`)));
    rows.push(row);
    console.log(`${d.name.padEnd(8)} ${row.ok ? 'PASS' : 'FAIL'}  ${row.cat.padEnd(7)} ${row.file} → ${row.target}: ${row.result}`);
  }
  return { env, rows, csp };
}

/* waitForFunction with a string compiles it inside the page, which the app's CSP
   (no 'unsafe-eval') rightly refuses; evaluate() goes through the debugger
   protocol instead, so poll with that. */
async function poll(page, src, timeout = 15000) {
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    if (await page.evaluate(src)) return;
    await new Promise(r => setTimeout(r, 100));
  }
  throw new Error('timed out waiting for ' + src.slice(0, 80));
}

function playwrightDriver(pw, name) {
  return async () => {
    const browser = await pw[name].launch();
    const page = await (await browser.newContext({ locale: 'en-US' })).newPage();
    const errors = [];
    const external = new Set();
    page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
    page.on('pageerror', e => errors.push('pageerror: ' + e.message));
    page.on('request', r => { const u = new URL(r.url()); if (/^https?:$/.test(u.protocol) && u.origin !== new URL(base).origin) external.add(u.origin); });
    await page.addInitScript(INIT);
    return {
      name, version: browser.version(), errors, external,
      fresh: async () => { await page.goto(base); await page.waitForSelector('input.filepicker', { state: 'attached' }); },
      upload: files => page.setInputFiles('input.filepicker', files),
      eval: src => page.evaluate(src),
      waitFor: (src, timeout) => poll(page, src, timeout),
      close: () => browser.close()
    };
  };
}

function puppeteerFirefoxDriver(pp) {
  return async () => {
    const browser = await pp.launch({ browser: 'firefox', executablePath: process.env.FIREFOX_BIN, headless: true });
    const page = await browser.newPage();
    const errors = [];
    const external = new Set();
    page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
    page.on('pageerror', e => errors.push('pageerror: ' + e.message));
    page.on('request', r => { const u = new URL(r.url()); if (/^https?:$/.test(u.protocol) && u.origin !== new URL(base).origin) external.add(u.origin); });
    await page.evaluateOnNewDocument(INIT);
    return {
      name: 'firefox', version: await browser.version(), errors, external,
      fresh: async () => { await page.goto(base); await page.waitForSelector('input.filepicker'); },
      upload: async files => (await page.$('input.filepicker')).uploadFile(...files),
      eval: src => page.evaluate(src),
      waitFor: (src, timeout) => poll(page, src, timeout),
      close: () => browser.close()
    };
  };
}

const report = [];
const head = (await fetch(base + '/')).headers;
for (const name of engines) {
  const make = name === 'firefox'
    ? puppeteerFirefoxDriver((await load('PUPPETEER_MODULE', 'puppeteer-core')).default)
    : playwrightDriver(await load('PLAYWRIGHT_MODULE', 'playwright'), name);
  const d = await make();
  await d.fresh();
  const r = await runEngine(d);
  report.push({ engine: name, version: d.version, ...r, consoleErrors: d.errors, external: [...d.external],
    headers: { coop: head.get('cross-origin-opener-policy'), coep: head.get('cross-origin-embedder-policy'), csp: head.get('content-security-policy') } });
  console.log(`${name} ${d.version}: crossOriginIsolated=${r.env.crossOriginIsolated}, external requests=${d.external.size}, console errors=${d.errors.length}, CSP violations=${r.csp.length}\n`);
  await d.close();
}

const file = join(out, 'matrix.json');
writeFileSync(file, JSON.stringify(report, null, 2));
const failed = report.flatMap(r => r.rows.filter(x => !x.ok).map(x => `${r.engine}: ${x.file} → ${x.target}`));
console.log(`${report.reduce((n, r) => n + r.rows.length, 0) - failed.length} passed, ${failed.length} failed. Report: ${file}`);
process.exit(failed.length ? 1 : 0);

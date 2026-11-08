// Unit checks for the pure parts: detection from magic bytes, target selection,
// page ranges and CSV cell typing. No browser needed.
// Run with: node tools/unit.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRequire } from 'node:module';

/* The sources are TypeScript for the browser. `ts.transpileModule` strips the
   types without bundling, which is all these pure modules need: their only
   cross-imports are type-only except actions.ts -> features.ts. */
const require = createRequire(import.meta.url);
const ts = require('typescript');
const dir = mkdtempSync(join(tmpdir(), 'fh-unit-'));

function transpile(rel) {
  const src = readFileSync(new URL(`../web/src/lib/core/${rel}`, import.meta.url), 'utf8');
  const js = ts.transpileModule(src, {
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 }
  }).outputText;
  return js
    .replace(/from '\.\/features'/g, "from './features.mjs'")
    .replace(/from '\.\/types'/g, "from './types.mjs'")
    .replace(/from '\.\/detect'/g, "from './detect.mjs'");
}

writeFileSync(join(dir, 'types.mjs'), 'export {};');
for (const rel of ['features.ts', 'detect.ts', 'actions.ts', 'pages.ts', 'zip.ts']) {
  writeFileSync(join(dir, rel.replace('.ts', '.mjs')), transpile(rel));
}

const detect = await import('file://' + join(dir, 'detect.mjs').replace(/\\/g, '/'));
const actions = await import('file://' + join(dir, 'actions.mjs').replace(/\\/g, '/'));
const pages = await import('file://' + join(dir, 'pages.mjs').replace(/\\/g, '/'));
const zip = await import('file://' + join(dir, 'zip.mjs').replace(/\\/g, '/'));

const PNG_1PX = Uint8Array.from(
  atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg=='),
  c => c.charCodeAt(0)
);

test('detects PNG from bytes even when the name lies', async () => {
  const d = await detect.detectFile(new File([PNG_1PX], 'notes.txt'));
  assert.equal(d.mime, 'image/png');
  assert.equal(d.mismatch, true);
  assert.equal(d.confidence, 'high');
});

test('does not flag a correct extension', async () => {
  const d = await detect.detectFile(new File([PNG_1PX], 'shot.png'));
  assert.equal(d.mismatch, false);
  assert.equal(d.label, 'PNG');
});

test('reads CSV, JSON, Markdown and ZIP', async () => {
  const enc = new TextEncoder();
  assert.equal((await detect.detectFile(new File([enc.encode('a,b\n1,2\n')], 't.csv'))).category, 'data');
  assert.equal((await detect.detectFile(new File([enc.encode('{"a":1}')], 't.json'))).category, 'data');
  assert.equal((await detect.detectFile(new File([enc.encode('# hi')], 't.md'))).category, 'text');
  const zip = new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0, 0, 0, 0]);
  assert.equal((await detect.detectFile(new File([zip], 't.zip'))).category, 'archive');
});

test('PDF signature wins over a .docx name', async () => {
  const pdf = new TextEncoder().encode('%PDF-1.7\n...');
  const d = await detect.detectFile(new File([pdf], 'report.docx'));
  assert.equal(d.mime, 'application/pdf');
  assert.equal(d.mismatch, true);
});

test('SVG is recognised as an image, not as text', async () => {
  const svg = new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"><rect/></svg>');
  const d = await detect.detectFile(new File([svg], 'logo.svg'));
  assert.equal(d.mime, 'image/svg+xml');
  assert.equal(d.category, 'image');
});

test('a misleading JSON body is still JSON', async () => {
  const json = new TextEncoder().encode('[{"a":1}]');
  const d = await detect.detectFile(new File([json], 'payload.bin'));
  assert.equal(d.mime, 'application/json');
});

test('every action label key is in the English dictionary', () => {
  const en = JSON.parse(readFileSync(new URL('../web/src/lib/i18n/en.json', import.meta.url), 'utf8'));
  for (const a of actions.ACTIONS) {
    if (a.labelKey) assert.ok(a.labelKey in en, `${a.id}: ${a.labelKey}`);
  }
});

test('every category has at least one target', () => {
  for (const cat of ['image', 'pdf', 'data', 'text', 'archive', 'font', 'media', 'unknown']) {
    assert.ok(actions.targetsFor(cat, '').length > 0, `no target for ${cat}`);
  }
});

test('the default target is never a no-op', () => {
  assert.notEqual(actions.defaultActionFor('image', 'png'), 'image:png');
  assert.notEqual(actions.defaultActionFor('data', 'csv'), 'data:csv');
  assert.notEqual(actions.defaultActionFor('text', 'md'), 'text:md');
});

test('a target equal to the source format is not offered', () => {
  assert.ok(!actions.targetsFor('data', 'csv').includes('data:csv'));
  assert.ok(!actions.targetsFor('image', 'png').includes('image:png'));
  assert.ok(!actions.targetsFor('text', 'md').includes('text:md'));
});

test('the real page-range parser handles open ends and clamps', () => {
  assert.deepEqual(pages.parsePages('1-3,7', 10), [0, 1, 2, 6]);
  assert.deepEqual(pages.parsePages('5-', 6), [4, 5]);
  assert.deepEqual(pages.parsePages('-2', 6), [0, 1]);
  assert.deepEqual(pages.parsePages('2', 6), [1]);
  assert.deepEqual(pages.parsePages('3,1,2', 6), [0, 1, 2]);
  assert.deepEqual(pages.parsePages(' 1 - 2 , 5 ', 6), [0, 1, 4]);
});

test('the page-range parser refuses junk instead of returning nothing', () => {
  assert.throws(() => pages.parsePages('99', 6), /bad_page_selection/);
  assert.throws(() => pages.parsePages('abc', 6), /bad_page_selection/);
  assert.throws(() => pages.parsePages('', 6), /bad_page_selection/);
  assert.throws(() => pages.parsePages('0', 6), /bad_page_selection/);
});

test('looksLikePages filters obvious junk before it reaches the parser', () => {
  assert.equal(pages.looksLikePages('1-3,7'), true);
  assert.equal(pages.looksLikePages(' 2 '), true);
  assert.equal(pages.looksLikePages('all'), false);
  assert.equal(pages.looksLikePages('1;2'), false);
});

test('CSV cells keep leading zeros and trailing zeros as text', () => {
  // mirrors typedCell in run/data.ts
  const typed = (raw) => {
    const t = raw.trim();
    if (t === '') return '';
    if (t === 'true') return true;
    if (t === 'false') return false;
    if (/^-?(0|[1-9]\d*)(\.\d+)?$/.test(t)) {
      const n = Number(t);
      if (String(n) === t && Number.isFinite(n)) return n;
    }
    return raw;
  };
  assert.equal(typed('3'), 3);
  assert.equal(typed('-2.5'), -2.5);
  assert.equal(typed('007'), '007');
  assert.equal(typed('1.50'), '1.50');
  assert.equal(typed('hello'), 'hello');
  assert.equal(typed('true'), true);
  assert.equal(typed(''), '');
});

test('zip entry names that escape the archive are refused', () => {
  assert.throws(() => zip.assertSafeName('../etc/passwd'), /archive_unsafe_path/);
  assert.throws(() => zip.assertSafeName('a/../../b'), /archive_unsafe_path/);
  assert.throws(() => zip.assertSafeName('/etc/passwd'), /archive_unsafe_path/);
  assert.throws(() => zip.assertSafeName('C:/Windows/x'), /archive_unsafe_path/);
  assert.equal(zip.assertSafeName('notes/a.txt'), 'notes/a.txt');
  assert.equal(zip.assertSafeName('deep\\win\\path.txt'), 'deep/win/path.txt');
});

test('a bomb is refused from the declared size, before inflating', () => {
  // 900 MB declared from 40 KB compressed
  assert.throws(() => zip.checkLimits(900 * 1024 * 1024, 40 * 1024, 900 * 1024 * 1024, 1), /archive_too_big/);
  // high ratio but tiny absolute size: allowed, the floor protects real archives
  assert.doesNotThrow(() => zip.checkLimits(1 * 1024 * 1024, 4096, 1 * 1024 * 1024, 1));
  // large ratio above the floor
  assert.throws(() => zip.checkLimits(100 * 1024 * 1024, 100 * 1024, 100 * 1024 * 1024, 1), /archive_ratio/);
  // too many entries
  assert.throws(() => zip.checkLimits(1024, 1024, 1024, 200_000), /archive_too_big/);
});

test('a normal archive passes every limit', () => {
  assert.doesNotThrow(() => zip.checkLimits(3 * 1024 * 1024, 1 * 1024 * 1024, 2 * 1024 * 1024, 12));
});

test('the tar reader stops at the end marker and refuses traversal', () => {
  // one 512-byte header, name "a.txt", size 3, then data, then two zero blocks
  const block = new Uint8Array(512);
  const name = new TextEncoder().encode('a.txt');
  block.set(name, 0);
  const size = new TextEncoder().encode('00000000003');
  block.set(size, 124);
  block[156] = '0'.charCodeAt(0);
  const data = new Uint8Array(512);
  data.set(new TextEncoder().encode('hey'), 0);
  const end = new Uint8Array(1024);
  const tar = new Uint8Array(512 + 512 + 1024);
  tar.set(block, 0); tar.set(data, 512); tar.set(end, 1024);
  const entries = zip.readTar(tar);
  assert.equal(entries.length, 1);
  assert.equal(entries[0].name, 'a.txt');
  assert.equal(entries[0].size, 3);

  const evil = new Uint8Array(block);
  evil.set(new TextEncoder().encode('../../x'), 0);
  assert.throws(() => zip.readTar(evil), /archive_unsafe_path/);
});

process.on('exit', () => rmSync(dir, { recursive: true, force: true }));
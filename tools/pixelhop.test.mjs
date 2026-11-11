// Unit checks for the page side of "Save to PixelHop" (web/src/lib/core/pixelhop.ts).
// Run with: node tools/pixelhop.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRequire } from 'node:module';

const ts = createRequire(import.meta.url)('typescript');
const dir = mkdtempSync(join(tmpdir(), 'fh-px-'));
const src = readFileSync(new URL('../web/src/lib/core/pixelhop.ts', import.meta.url), 'utf8');
writeFileSync(join(dir, 'px.mjs'), ts.transpileModule(src, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText);
const P = await import('file://' + join(dir, 'px.mjs').replace(/\\/g, '/'));
const MB = 1 << 20;
const res = (name, size, type = '') => ({ name, size, blob: { type } });

test('only kinds PixelHop takes, within the size cap, qualify', () => {
  for (const [n, t] of [['a.png', 'image/png'], ['a.jpg', 'image/jpeg'], ['a.webp', 'image/webp'], ['a.gif', 'image/gif'], ['a.bmp', 'image/bmp'], ['a.pdf', 'application/pdf']]) {
    assert.equal(P.canSaveToPixelHop(res(n, 1000, t), 20 * MB), true, n);
  }
  assert.equal(P.canSaveToPixelHop(res('a.png', 1000), 20 * MB), true, 'type from the extension when the blob has none');
  for (const [n, t] of [['a.json', 'application/json'], ['a.zip', 'application/zip'], ['a.svg', 'image/svg+xml'], ['a.txt', 'text/plain'], ['a.md5', ''], ['noext', '']]) {
    assert.equal(P.canSaveToPixelHop(res(n, 1000, t), 20 * MB), false, n);
  }
  assert.equal(P.canSaveToPixelHop(res('a.png', 20 * MB, 'image/png'), 20 * MB), true);
  assert.equal(P.canSaveToPixelHop(res('a.png', 20 * MB + 1, 'image/png'), 20 * MB), false);
  assert.equal(P.canSaveToPixelHop(res('a.png', 0, 'image/png'), 20 * MB), false);
  assert.equal(P.canSaveToPixelHop(undefined, 20 * MB), false);
});

test('every server error code has a translated message; anything else is a plain failure', () => {
  for (const c of ['no_account', 'quota_exceeded', 'too_large', 'unsupported_type', 'rate_limited', 'not_signed_in']) assert.equal(P.saveErrorKey(c), 'save.err_' + c);
  for (const c of ['csrf', 'failed', 'store_failed', '<script>', undefined, 5, null]) assert.equal(P.saveErrorKey(c), 'save.err_failed');
});

test('saveToPixelHop sends one same-origin call with the marker header and maps the answer', async () => {
  let seen;
  const fake = (status, body) => async (url, init) => { seen = { url, init }; return { ok: status < 300, status, json: async () => body }; };
  const ok = await P.saveToPixelHop(new Blob(['x']), 'a b.png', fake(200, { ok: true, page_url: 'https://pixel.hel.ink/x', duplicate: true }));
  assert.deepEqual(ok, { ok: true, pageUrl: 'https://pixel.hel.ink/x', duplicate: true });
  assert.equal(seen.url, '/api/v1/pixelhop/save?name=a%20b.png');
  assert.equal(seen.init.method, 'POST');
  assert.equal(seen.init.credentials, 'same-origin');
  assert.equal(seen.init.headers['X-Requested-With'], 'filehop');
  assert.deepEqual(await P.saveToPixelHop(new Blob(['x']), 'a.png', fake(409, { ok: false, error: 'no_account' })), { ok: false, error: 'no_account' });
  assert.deepEqual(await P.saveToPixelHop(new Blob(['x']), 'a.png', fake(200, { ok: true, page_url: 'javascript:alert(1)' })), { ok: false, error: 'failed' });
  assert.deepEqual(await P.saveToPixelHop(new Blob(['x']), 'a.png', async () => { throw new Error('offline'); }), { ok: false, error: 'failed' });
  assert.deepEqual(await P.saveToPixelHop(new Blob(['x']), 'a.png', async () => ({ ok: false, status: 502, json: async () => { throw new Error('html'); } })), { ok: false, error: 'failed' });
});

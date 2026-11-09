// Unit checks for the pure parts: detection from magic bytes, target selection,
// page ranges and CSV cell typing. No browser needed.
// Run with: node tools/unit.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';

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

test('confirmAction asks with the family dialog when it is loaded, with the native one otherwise', async () => {
  const src = readFileSync(new URL('../web/src/lib/util/confirm.ts', import.meta.url), 'utf8');
  const js = ts.transpileModule(src, {
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 }
  }).outputText;
  writeFileSync(join(dir, 'confirm.mjs'), js);
  const { confirmAction } = await import('file://' + join(dir, 'confirm.mjs').replace(/\\/g, '/'));
  const asked = [];
  globalThis.confirm = (m) => { asked.push(m); return false; };
  try {
    assert.equal(await confirmAction({ title: 'Drop everything?', message: 'Files in the queue: 3.' }), false);
    assert.deepEqual(asked, ['Drop everything?\n\nFiles in the queue: 3.']);
    const seen = [];
    globalThis.HopUI = { confirm: async (o) => { seen.push(o); return true; } };
    assert.equal(await confirmAction({ title: 'Drop everything?', danger: true }), true);
    assert.equal(seen[0].danger, true);
    assert.equal(asked.length, 1, 'the native dialog is not used once HopUI is there');
  } finally {
    delete globalThis.HopUI;
    delete globalThis.confirm;
  }
});

test('the vendored family dialog is byte-identical to hop-assets v5', () => {
  // the integrity values of ui_js and ui_css in hel.ink/hop-assets/apps.json
  const sri = (rel) => 'sha384-' + createHash('sha384').update(readFileSync(new URL(rel, import.meta.url))).digest('base64');
  assert.equal(sri('../web/public/hop-ui/v5/hop-ui.js'), 'sha384-IDcwQXxUXNwfC3GDCIJqMuOMHaY/SCZUaezF7ZhL4Els1pk5yrUMyml00NObV0fq');
  assert.equal(sri('../web/public/hop-ui/v5/hop-ui.css'), 'sha384-wfq/3oTQ0jQYJQZHY7wgY3KoulTamoM2OHTwsb4boVF+dUy7JdPUurlLswZEXSt1');
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

/* Queue behaviour around PDF merge: one merge per group, ever. These lock the
   bug where a second merge could be started for the same group (a mid-run
   target change exposed another card's Run button, and a direct runOne on a
   non-carrier had no guard) and where a card that joined the group mid-run was
   marked merged although its pages were not in the result. */
const transpileFrom = (url, rewrites) =>
  ts.transpileModule(readFileSync(url, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 }
  }).outputText.replace(/from '([^']+)'/g, (m, p) => `from '${rewrites[p] ?? p}'`);

// The pool never spawns workers here: every run() stays pending until the test
// resolves it, which is exactly what a mid-run race needs.
writeFileSync(join(dir, 'pool-stub.mjs'), `
export class Pool {
  constructor() { this.calls = []; }
  run(payload, onProgress) {
    let resolve, reject;
    const promise = new Promise((res, rej) => { resolve = res; reject = rej; });
    this.calls.push({ payload, onProgress, resolve, reject });
    return { promise, cancel: () => reject(Object.assign(new Error('canceled'), { canceled: true })) };
  }
}
`);
// The queue reads navigator.deviceMemory for its memory budget. Node only has a global
// navigator from 21 on; without one every run would stop before it reaches the pool.
if (!('navigator' in globalThis)) globalThis.navigator = {};
// .svelte.ts stores use runes; plain TypeScript leaves them as calls.
globalThis.$state = Object.assign((v) => v, { snapshot: (v) => v });
writeFileSync(join(dir, 'queue.mjs'), transpileFrom(new URL('../web/src/lib/store/queue.svelte.ts', import.meta.url), {
  '../core/pool': './pool-stub.mjs',
  '../core/detect': './detect.mjs',
  '../core/actions': './actions.mjs',
  '../core/types': './types.mjs'
}));
const { Queue } = await import('file://' + join(dir, 'queue.mjs').replace(/\\/g, '/'));
const { Pool } = await import('file://' + join(dir, 'pool-stub.mjs').replace(/\\/g, '/'));

// Render the real Svelte card on the server so these tests assert the controls
// produced by isAbsorbed + JobCard, rather than only calling queue methods.
const { compile } = await import('svelte/compiler');
const { render } = await import('svelte/server');
const en = JSON.parse(readFileSync(new URL('../web/src/lib/i18n/en.json', import.meta.url), 'utf8'));
writeFileSync(join(dir, 'i18n-stub.mjs'), `
export const i18n = { t: (key, vars) => (${JSON.stringify(en)}[key] ?? key).replace(/\\{(\\w+)\\}/g, (_, name) => vars?.[name] ?? '') };
export const actionLabel = (def) => def.labelKey ? i18n.t(def.labelKey) : def.label;
`);
writeFileSync(join(dir, 'format-stub.mjs'), 'export const fmtSize = (n) => `${n} B`;');
writeFileSync(join(dir, 'pages-stub.mjs'), 'export const looksLikePages = () => true;');
for (const name of ['Icon', 'JobCard']) {
  const url = new URL(`../web/src/lib/components/${name}.svelte`, import.meta.url);
  const compiled = compile(readFileSync(url, 'utf8'), { filename: `${name}.svelte`, generate: 'server' });
  writeFileSync(join(dir, `${name}.mjs`), compiled.js.code
    .replace(/from 'svelte\/internal\/server'/g, `from '${new URL('../node_modules/svelte/src/internal/server/index.js', import.meta.url).href}'`)
    .replace("from './Icon.svelte'", "from './Icon.mjs'")
    .replace("from '../i18n/index.svelte'", "from './i18n-stub.mjs'")
    .replace("from '../core/actions'", "from './actions.mjs'")
    .replace("from '../util/format'", "from './format-stub.mjs'")
    .replace("from '../core/pages'", "from './pages-stub.mjs'"));
}
const { default: JobCard } = await import('file://' + join(dir, 'JobCard.mjs').replace(/\\/g, '/'));
function cardButtons(job, jobs) {
  const noop = () => {};
  const { body } = render(JobCard, { props: {
    job, pdfCount: jobs.length, absorbed: actions.isAbsorbed(job, jobs),
    onAction: noop, onOpt: noop, onRun: noop, onCancel: noop, onRemove: noop, onDownload: noop
  } });
  const side = body.match(/<div class="side[^>]*>([\s\S]*?)<\/div>/)?.[1] ?? body;
  return [...side.matchAll(/<button\b[^>]*>([\s\S]*?)<\/button>/g)].map(m =>
    m[1].replace(/<!--[\s\S]*?-->/g, '').replace(/<[^>]+>/g, '').trim()
  );
}

// SSR produces the actual button. Server-rendered markup carries no event
// attributes (handlers live in the compiled component), so the honest
// server-side equivalent of a click invokes the callback the button's onclick
// binds to. Returns the rendered body so callers assert on the same state.
async function invokeCardButton(job, jobs, label, onRun) {
  const { body } = render(JobCard, { props: {
    job, pdfCount: jobs.length, absorbed: actions.isAbsorbed(job, jobs),
    mergeBusy: actions.mergeCarrier(jobs)?.status === 'running',
    onAction() {}, onOpt() {}, onRun, onCancel() {}, onRemove() {}, onDownload() {}
  } });
  const match = [...body.matchAll(/<button\b([^>]*)>([\s\S]*?)<\/button>/g)].find(m =>
    m[2].replace(/<!--[\s\S]*?-->/g, '').replace(/<[^>]+>/g, '').trim() === label
  );
  assert.ok(match, `real JobCard exposes ${label}`);
  assert.ok(!/\bdisabled\b/.test(match[1]), `${label} is enabled`);
  onRun();
  return body;
}

const pdfFile = (name) => new File([new Uint8Array([0x25, 0x50, 0x44, 0x46])], name, { type: 'application/pdf' });
const mergedResult = (name = 'm-merged.pdf') => ({ blob: new Blob([new Uint8Array([1])]), name, size: 1, saving: 0, pages: 3 });

async function queueWith(names) {
  const pool = new Pool();
  const q = new Queue(pool, { onChange: () => {} });
  const jobs = await q.add(names.map(pdfFile));
  return { pool, q, jobs };
}

test('merge only takes the PDFs whose target is Merge, in queue order', async () => {
  const { q, jobs } = await queueWith(['a.pdf', 'b.pdf', 'c.pdf']);
  q.setAction(jobs[0], 'pdf:merge');
  q.setAction(jobs[2], 'pdf:merge'); // b.pdf keeps its Split target
  assert.deepEqual(q.mergeGroup().map(j => j.name), ['a.pdf', 'c.pdf']);
  assert.deepEqual(q.groupFor(jobs[0]).map(f => f.name), ['a.pdf', 'c.pdf']);
  assert.equal(actions.mergeCarrier(q.jobs), jobs[0]);
});

test('runOne on a card that is not the carrier starts nothing', async () => {
  const { pool, q, jobs } = await queueWith(['a.pdf', 'b.pdf']);
  q.setAction(jobs[0], 'pdf:merge');
  q.setAction(jobs[1], 'pdf:merge');
  // not awaited: on the unfixed code this would start a merge and never return
  q.runOne(jobs[1]); // absorbed card: it has no merge of its own
  assert.equal(pool.calls.length, 0, 'a second merge must never be started');
  assert.equal(jobs[1].status, 'queued');
});

test('a running merge keeps its target and its group closed', async () => {
  const { pool, q, jobs } = await queueWith(['a.pdf', 'b.pdf']);
  q.setAction(jobs[0], 'pdf:merge');
  q.setAction(jobs[1], 'pdf:merge');
  const run = q.runOne(jobs[0]);
  assert.equal(pool.calls.length, 1);
  q.setAction(jobs[0], 'pdf:rotate'); // the run already captured its target
  assert.equal(jobs[0].action, 'pdf:merge', 'a running card cannot change target');
  // not awaited for the same reason as above
  q.runOne(jobs[1]); // still the absorbed card: no second merge
  assert.equal(pool.calls.length, 1, 'the group merged exactly once');
  pool.calls[0].resolve(mergedResult());
  await run;
  assert.equal(jobs[0].status, 'done');
  assert.equal(jobs[1].status, 'merged');
});

test('a card that joins the merge mid-run is not marked merged', async () => {
  const { pool, q, jobs } = await queueWith(['a.pdf', 'b.pdf']);
  q.setAction(jobs[0], 'pdf:merge');
  q.setAction(jobs[1], 'pdf:merge');
  const run = q.runOne(jobs[0]); // group snapshot: a.pdf + b.pdf
  const [late] = await q.add([pdfFile('c.pdf')]);
  q.setAction(late, 'pdf:merge'); // joins after the run started
  pool.calls[0].resolve(mergedResult());
  await run;
  assert.equal(jobs[1].status, 'merged', 'b.pdf was in the merge');
  assert.equal(late.status, 'queued', 'c.pdf was not in the merge, so it is not merged');
  assert.equal(actions.mergeCarrier(q.jobs), late, 'the queued joiner carries the next merge');
  assert.equal(actions.isAbsorbed(jobs[0], q.jobs), false, 'a finished result is not absorbed by the next run');
  assert.equal(actions.isAbsorbed(jobs[1], q.jobs), true, 'the absorbed member stays folded beside the completed owner');
  assert.equal(jobs[0].result.name, 'm-merged.pdf', 'the previous download remains on its owner');
  assert.equal(jobs[1].result, undefined, 'an absorbed member has no result of its own');
});

test('bulk target and option changes cannot mutate a running merge', async () => {
  const { pool, q, jobs } = await queueWith(['a.pdf', 'b.pdf', 'c.pdf']);
  q.setAction(jobs[0], 'pdf:merge');
  q.setAction(jobs[1], 'pdf:merge');
  q.setAction(jobs[2], 'pdf:extract');
  const run = q.runOne(jobs[0]);
  q.setActionForCategory('pdf', 'pdf:split');
  q.setOpt(jobs[0], 'pages', '99');
  assert.equal(jobs[0].action, 'pdf:merge');
  assert.deepEqual(jobs[0].opts, {});
  assert.equal(pool.calls[0].payload.action, 'pdf:merge');
  assert.equal(jobs[1].action, 'pdf:split');
  assert.equal(jobs[2].action, 'pdf:split');
  pool.calls[0].resolve(mergedResult());
  await run;
  assert.equal(jobs[0].status, 'done');
  assert.equal(jobs[1].status, 'queued', 'a member that left the running group is not marked merged');
  assert.equal(actions.isAbsorbed(jobs[0], q.jobs), false);
});

test('an earlier queued joiner cannot displace the running merge or hide Cancel', async () => {
  const { pool, q, jobs } = await queueWith(['a.pdf', 'b.pdf', 'c.pdf']);
  q.setAction(jobs[1], 'pdf:merge');
  q.setAction(jobs[2], 'pdf:merge');
  const running = q.runOne(jobs[1]); // fixed payload B+C
  q.setAction(jobs[0], 'pdf:merge'); // earlier A joins after B+C started
  assert.deepEqual(pool.calls[0].payload.group.map(f => f.name), ['b.pdf', 'c.pdf']);
  assert.equal(actions.mergeCarrier(q.jobs), jobs[1], 'running carrier wins globally over earlier queued A');
  assert.equal(actions.isAbsorbed(jobs[1], q.jobs), false);
  assert.deepEqual(cardButtons(jobs[1], q.jobs), [en['job.cancel']], 'running B exposes Cancel');
  assert.equal(actions.isAbsorbed(jobs[2], q.jobs), true, 'C is already absorbed by running B');
  await q.runOne(jobs[0]);
  assert.equal(pool.calls.length, 1, 'A cannot start a concurrent second merge');
  assert.equal(jobs[1].status, 'running');
  pool.calls[0].resolve(mergedResult('bc.pdf'));
  await running;
  assert.equal(jobs[0].status, 'queued', 'late A is not claimed by B+C');
  assert.equal(jobs[2].status, 'merged');
  assert.equal(actions.mergeCarrier(q.jobs), jobs[0], 'A becomes eligible only after B finishes');
});

test('bulk Merge selection preserves completed result ownership and Download', async () => {
  const { pool, q, jobs } = await queueWith(['a.pdf', 'b.pdf']);
  q.setAction(jobs[0], 'pdf:merge');
  q.setAction(jobs[1], 'pdf:merge');
  const run = q.runOne(jobs[0]);
  pool.calls[0].resolve(mergedResult('finished.pdf'));
  await run;
  const result = jobs[0].result;
  q.setActionForCategory('pdf', 'pdf:merge'); // clicking the already-selected target
  assert.equal(jobs[0].status, 'done');
  assert.equal(jobs[0].result, result, 'same-action bulk selection does not clear the result');
  assert.equal(jobs[0].result.name, 'finished.pdf');
  assert.deepEqual(cardButtons(jobs[0], q.jobs), [en['job.download'], en['job.remove']]);
  q.setActionForCategory('pdf', 'pdf:split'); // another target: the chip must do something
  assert.equal(jobs[0].action, 'pdf:split');
  assert.equal(jobs[0].status, 'queued', 'a different bulk target re-queues the finished card');
  assert.equal(jobs[1].status, 'queued', 'and the card that was folded into the merge');
  assert.deepEqual(cardButtons(jobs[0], q.jobs), [en['job.run']]);
});

test('a failed carrier beside a queued member exposes error and Retry in the real card', async () => {
  const { pool, q, jobs } = await queueWith(['a.pdf', 'b.pdf']);
  q.setAction(jobs[0], 'pdf:merge');
  q.setAction(jobs[1], 'pdf:merge');
  const failed = q.runOne(jobs[0]);
  pool.calls[0].reject(new Error('worker_crash'));
  await failed;
  assert.equal(jobs[0].status, 'error');
  assert.equal(actions.isAbsorbed(jobs[0], q.jobs), false, 'an error is never absorbed by another run');
  const { body } = render(JobCard, { props: {
    job: jobs[0], pdfCount: jobs.length, absorbed: actions.isAbsorbed(jobs[0], q.jobs),
    onAction() {}, onOpt() {}, onRun() {}, onCancel() {}, onRemove() {}, onDownload() {}
  } });
  assert.match(body, /class="err"/, 'the error remains visible');
  assert.match(body, /err\.worker_crash|Worker crashed|worker/i, 'the error text remains visible');
  assert.deepEqual(cardButtons(jobs[0], q.jobs), [en['job.retry'], ''], 'Retry and icon-only Remove remain available');
});

test('completion uses the execution action, not mutable card state', async () => {
  const { pool, q, jobs } = await queueWith(['a.pdf', 'b.pdf']);
  q.setAction(jobs[0], 'pdf:merge');
  q.setAction(jobs[1], 'pdf:merge');
  const run = q.runOne(jobs[0]);
  // Simulate state changing through any unforeseen path: the run must still
  // finish its own merge group, rather than silently skipping that completion.
  jobs[0].action = 'pdf:rotate';
  pool.calls[0].resolve(mergedResult());
  await run;
  assert.equal(jobs[0].result.name, 'm-merged.pdf');
  assert.equal(jobs[1].status, 'merged');
});

test('a queued joiner runs next and every completed merge keeps its result', async () => {
  const { pool, q, jobs } = await queueWith(['a.pdf', 'b.pdf']);
  q.setAction(jobs[0], 'pdf:merge');
  q.setAction(jobs[1], 'pdf:merge');
  const first = q.runOne(jobs[0]);
  const [late] = await q.add([pdfFile('c.pdf')]);
  q.setAction(late, 'pdf:merge');
  pool.calls[0].resolve(mergedResult('first.pdf'));
  await first;
  assert.equal(actions.isAbsorbed(jobs[0], q.jobs), false);
  const second = q.runOne(late);
  assert.equal(pool.calls.length, 2, 'the queued joiner is the next execution carrier');
  assert.deepEqual(pool.calls[1].payload.group.map(f => f.name), ['a.pdf', 'b.pdf', 'c.pdf'], 'queue order, although C carries it');
  pool.calls[1].resolve(mergedResult('second.pdf'));
  await second;
  assert.equal(jobs[0].result.name, 'first.pdf', 'the next merge does not replace the old result');
  assert.equal(late.result.name, 'second.pdf');
  assert.equal(actions.isAbsorbed(jobs[0], q.jobs), false);
  assert.equal(actions.isAbsorbed(late, q.jobs), false);
  const doneResults = q.jobs.filter(j => j.status === 'done' && j.result).map(j => j.result.name);
  assert.deepEqual(doneResults, ['first.pdf', 'second.pdf'], 'both outputs stay downloadable');
  assert.equal(q.doneCount, 2, 'done results and absorbed membership are separate counts');
});

test('a failed carrier exposes a queued member, and that member\'s success folds the failed card in', async () => {
  const { pool, q, jobs } = await queueWith(['a.pdf', 'b.pdf']);
  q.setAction(jobs[0], 'pdf:merge');
  q.setAction(jobs[1], 'pdf:merge');
  const failed = q.runOne(jobs[0]);
  pool.calls[0].reject(new Error('worker_crash'));
  await failed;
  assert.equal(jobs[0].status, 'error');
  assert.equal(jobs[0].error, 'worker_crash');
  assert.equal(actions.mergeCarrier(q.jobs), jobs[1]);
  assert.equal(actions.isAbsorbed(jobs[1], q.jobs), false, 'the next member exposes Run');
  const next = q.runOne(jobs[1]);
  assert.deepEqual(pool.calls[1].payload.group.map(f => f.name), ['a.pdf', 'b.pdf'], 'queue order, although B carries it');
  pool.calls[1].resolve(mergedResult('after-error.pdf'));
  await next;
  assert.equal(jobs[0].status, 'merged', 'the failed card is inside the result that succeeded');
  assert.equal(jobs[0].error, undefined, 'its old error no longer holds');
  assert.equal(jobs[1].result.name, 'after-error.pdf');
  assert.equal(actions.isAbsorbed(jobs[1], q.jobs), false);
  assert.deepEqual(cardButtons(jobs[0], q.jobs), [en['job.remove']], 'nothing left to retry on the folded card');
  assert.equal(pool.calls.length, 2, 'the group was merged once after the failure');
});

test('the SSR Retry callback makes failed A the carrier of eligible A+B', async () => {
  const { pool, q, jobs } = await queueWith(['a.pdf', 'b.pdf']);
  q.setAction(jobs[0], 'pdf:merge');
  q.setAction(jobs[1], 'pdf:merge');
  const failed = q.runOne(jobs[0]);
  pool.calls[0].reject(new Error('worker_crash'));
  await failed;
  assert.equal(actions.mergeCarrier(q.jobs), jobs[1], 'the pre-fix carrier incorrectly selects queued B');
  let retried;
  await invokeCardButton(jobs[0], q.jobs, en['job.retry'], () => { retried = q.runOne(jobs[0]); });
  assert.equal(pool.calls.length, 2, 'Retry starts a run instead of silently returning');
  assert.equal(pool.calls[1].payload.id, jobs[0].id, 'failed A owns its retried result');
  assert.deepEqual(pool.calls[1].payload.group.map(f => f.name), ['a.pdf', 'b.pdf']);
  pool.calls[1].resolve(mergedResult('retry-before-b.pdf'));
  await retried;
  assert.equal(jobs[0].status, 'done');
  assert.equal(jobs[1].status, 'merged');
  assert.equal(jobs[0].result.name, 'retry-before-b.pdf');
});

test('SSR Retry is disabled with a visible hint while B runs, then B\'s result folds the failed card in', async () => {
  const { pool, q, jobs } = await queueWith(['a.pdf', 'b.pdf']);
  q.setAction(jobs[0], 'pdf:merge');
  q.setAction(jobs[1], 'pdf:merge');
  const failed = q.runOne(jobs[0]);
  pool.calls[0].reject(new Error('worker_crash'));
  await failed;
  const running = q.runOne(jobs[1]);
  const { body } = render(JobCard, { props: {
    job: jobs[0], pdfCount: jobs.length, absorbed: actions.isAbsorbed(jobs[0], q.jobs),
    mergeBusy: actions.mergeCarrier(q.jobs)?.status === 'running',
    onAction() {}, onOpt() {}, onRun() { assert.fail('disabled Retry must not run'); },
    onCancel() {}, onRemove() {}, onDownload() {}
  } });
  const retry = [...body.matchAll(/<button\b([^>]*)>([\s\S]*?)<\/button>/g)].find(m =>
    m[2].replace(/<!--[\s\S]*?-->/g, '').replace(/<[^>]+>/g, '').trim() === en['job.retry']
  );
  assert.ok(retry, 'error A keeps Retry beside running B');
  assert.match(retry[1], /\bdisabled\b/);
  const hint = body.match(/<p[^>]*\bid="(retry-wait-[^"]+)"[^>]*>([\s\S]*?)<\/p>/);
  assert.ok(hint, 'the disabled Retry has a visible explanation');
  assert.equal(hint[1], 'retry-wait-' + jobs[0].id, 'the hint belongs to this card');
  assert.equal(hint[2].trim(), en['job.retry_wait'], 'the hint says why in words');
  assert.match(retry[1], new RegExp('aria-describedby="' + hint[1] + '"'), 'the Retry button points at the hint');
  assert.ok(!/title=/.test(retry[1]), 'no title-only explanation');
  assert.match(body, /class="err"/, 'the original error stays visible');
  assert.equal(pool.calls.length, 2, 'B is still the only running merge');
  pool.calls[1].resolve(mergedResult('b-first.pdf'));
  await running;
  // B's result holds A's pages too: the failed card is folded into it
  assert.equal(jobs[0].status, 'merged');
  assert.equal(jobs[1].result.name, 'b-first.pdf');
  const { body: after } = render(JobCard, { props: {
    job: jobs[0], pdfCount: jobs.length, absorbed: actions.isAbsorbed(jobs[0], q.jobs),
    mergeBusy: actions.mergeCarrier(q.jobs)?.status === 'running',
    onAction() {}, onOpt() {}, onRun() {}, onCancel() {}, onRemove() {}, onDownload() {}
  } });
  assert.ok(!/retry-wait-/.test(after), 'the hint is gone once no merge runs');
  assert.ok(!/class="err"/.test(after), 'and so is the old error');
  assert.deepEqual(cardButtons(jobs[0], q.jobs), [en['job.remove']]);
  assert.equal(pool.calls.length, 2, 'no third merge');
});

test('canceling or removing a member never marks it merged or restores its file', async () => {
  const { pool, q, jobs } = await queueWith(['a.pdf', 'b.pdf']);
  q.setAction(jobs[0], 'pdf:merge');
  q.setAction(jobs[1], 'pdf:merge');
  const first = q.runOne(jobs[0]);
  q.cancel(jobs[1]);
  assert.equal(jobs[1].status, 'canceled');
  assert.equal(actions.isAbsorbed(jobs[1], q.jobs), false, 'a stopped member keeps its own Retry');
  pool.calls[0].resolve(mergedResult('kept.pdf'));
  await first;
  assert.equal(jobs[1].status, 'canceled', 'completion does not overwrite cancellation');
  q.remove(jobs[1]);
  assert.deepEqual(q.jobs, [jobs[0]]);
  const retry = q.runOne(jobs[0]);
  assert.deepEqual(pool.calls[1].payload.group.map(f => f.name), ['a.pdf']);
  pool.calls[1].resolve(mergedResult('without-removed.pdf'));
  await retry;
  assert.equal(jobs[0].result.name, 'without-removed.pdf');
});

test('canceling a running carrier leaves other members runnable and removal is final', async () => {
  const { pool, q, jobs } = await queueWith(['a.pdf', 'b.pdf']);
  q.setAction(jobs[0], 'pdf:merge');
  q.setAction(jobs[1], 'pdf:merge');
  const canceled = q.runOne(jobs[0]);
  q.cancel(jobs[0]);
  await canceled;
  assert.equal(jobs[0].status, 'canceled');
  assert.equal(actions.mergeCarrier(q.jobs), jobs[1]);
  assert.equal(actions.isAbsorbed(jobs[1], q.jobs), false);
  const next = q.runOne(jobs[1]);
  assert.deepEqual(pool.calls[1].payload.group.map(f => f.name), ['b.pdf']);
  q.remove(jobs[0]);
  assert.deepEqual(q.jobs, [jobs[1]]);
  pool.calls[1].resolve(mergedResult('after-cancel.pdf'));
  await next;
  assert.equal(jobs[1].result.name, 'after-cancel.pdf');
  q.remove(jobs[1]);
  assert.deepEqual(q.jobs, []);
  assert.equal(pool.calls.length, 2);
});

test('a merge stopped while it ran can be tried again and joins the same PDFs', async () => {
  const { pool, q, jobs } = await queueWith(['a.pdf', 'b.pdf']);
  q.setAction(jobs[0], 'pdf:merge');
  q.setAction(jobs[1], 'pdf:merge');
  const stopped = q.runOne(jobs[0]);
  q.cancel(jobs[0]);
  await stopped;
  assert.equal(jobs[0].status, 'canceled');
  assert.equal(actions.isAbsorbed(jobs[0], q.jobs), false, 'the stopped card is not shown as folded into a merge');
  assert.deepEqual(cardButtons(jobs[0], q.jobs), [en['job.retry'], ''], 'Retry and icon-only Remove');
  const again = q.runOne(jobs[0]);
  assert.equal(pool.calls.length, 2, 'Retry starts the merge again');
  assert.deepEqual(pool.calls[1].payload.group.map(f => f.name), ['a.pdf', 'b.pdf']);
  pool.calls[1].resolve(mergedResult('again.pdf'));
  await again;
  assert.equal(jobs[0].status, 'done');
  assert.equal(jobs[1].status, 'merged');
});

test('runAll runs the merge once and skips the absorbed cards', async () => {
  const { pool, q, jobs } = await queueWith(['a.pdf', 'b.pdf', 'c.pdf']);
  q.setAction(jobs[0], 'pdf:merge');
  q.setAction(jobs[1], 'pdf:merge');
  const all = q.runAll();
  const merges = pool.calls.filter(c => c.payload.action === 'pdf:merge');
  assert.equal(merges.length, 1);
  assert.equal(merges[0].payload.id, jobs[0].id);
  for (const c of pool.calls) c.resolve(mergedResult());
  await all;
});

process.on('exit', () => rmSync(dir, { recursive: true, force: true }));

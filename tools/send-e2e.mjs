// Two-browser proof for /send: two separate headless Chromium instances pair through a running
// FileHop server and exchange files over a real RTCDataChannel.
//
//   node tools/send-e2e.mjs --base http://127.0.0.1:18300 [--size 100] [--only transfer,cancel,...] [--log out.log]
//
// Needs `playwright-core` (not a dependency of the repo; PW_DIR points at where it is installed) and a Chromium: set CHROME to its path, or
// use --channel msedge. The server must be the production build (`npm run build`, then `go build`) started with
// FILEHOP_TRUST_PROXY=1 (see tools/send-e2e.sh).
// Peers on one host find each other only without mDNS candidates, hence the test-only browser flag.
// The native save dialog (File System Access) cannot be driven headless, so the saves here use the
// private file system (opfs) and the in-memory Blob; ?store= forces the tier.
//
// Scenarios: transfer (>= 100 MiB by default, four hashes compared), corrupt (one byte flipped on
// the wire: nothing may be offered for saving), cancel (both directions), early (data or an offer
// before both pressed Match closes the connection), forged (an offer above the sender's limit is
// refused, a hostile name is cleaned), nomatch, rooms (unknown code, third device).
import { createHash, randomBytes } from 'node:crypto';
import { createReadStream, mkdirSync, statSync, writeFileSync, createWriteStream, existsSync } from 'node:fs';
import { join } from 'node:path';

const arg = (k, d) => { const i = process.argv.indexOf('--' + k); return i > 0 ? process.argv[i + 1] : d; };
const base = arg('base', 'http://127.0.0.1:18300');
const sizeMiB = Number(arg('size', '100'));
const only = (arg('only', '') || '').split(',').filter(Boolean);
const logPath = arg('log', '');
const out = arg('out', 'out-send');
mkdirSync(out, { recursive: true });

let chromium;
try {
  // PW_DIR: a folder with playwright-core installed (tools/send-e2e.sh makes one); default is the current folder
  const { createRequire } = await import('node:module');
  ({ chromium } = createRequire((process.env.PW_DIR || process.cwd()) + '/')('playwright-core'));
} catch { console.error('playwright-core is not installed (set PW_DIR to a folder where it is)'); process.exit(2); }

const T0 = Date.now();
const lines = [];
const log = (s) => { const l = `[${((Date.now() - T0) / 1000).toFixed(1).padStart(6)}s] ${s}`; lines.push(l); console.log(l); };
const sha = (p) => new Promise((res, rej) => { const h = createHash('sha256'); createReadStream(p).on('data', (d) => h.update(d)).on('end', () => res(h.digest('hex'))).on('error', rej); });

function makeFile(name, mib) {
  const p = join(out, name);
  if (existsSync(p) && statSync(p).size === mib * 1048576) return p;
  const ws = createWriteStream(p);
  for (let i = 0; i < mib; i++) ws.write(randomBytes(1048576));
  return new Promise((res) => ws.end(() => res(p)));
}

const launch = () => chromium.launch({
  executablePath: process.env.CHROME || undefined,
  channel: arg('channel', undefined),
  headless: true,
  args: ['--no-sandbox', '--disable-features=WebRtcHideLocalIpsWithMdns']
});

// Rooms are limited to 10 per hour per visitor address. The test server runs with
// FILEHOP_TRUST_PROXY=1 and every device presents its own address, like visitors behind a proxy.
let nextAddr = Number(process.env.E2E_ADDR_BASE || 1); // a loop of runs gives each its own range
/** A page for one device. `init` runs in the page before the app does. */
async function device(browser, init) {
  const n = nextAddr++;
  const ctx = await browser.newContext({ acceptDownloads: true, extraHTTPHeaders: { 'X-Forwarded-For': `10.77.${n >> 8}.${n & 255}` } });
  const page = await ctx.newPage();
  const problems = [];
  page.on('console', (m) => { if (['error', 'warning'].includes(m.type())) problems.push(m.text()); });
  page.on('pageerror', (e) => problems.push('pageerror: ' + e.message));
  await page.addInitScript(() => {
    const L = (window.__log = []); const t0 = performance.now();
    const log = (s) => L.push(Math.round(performance.now() - t0) + 'ms ' + s);
    const PC = window.RTCPeerConnection;
    window.RTCPeerConnection = class extends PC {
      constructor(...a) {
        super(...a); log('pc:new');
        this.addEventListener('connectionstatechange', () => log('pc:' + this.connectionState));
        this.addEventListener('iceconnectionstatechange', () => log('ice:' + this.iceConnectionState));
        this.addEventListener('datachannel', () => log('pc:datachannel'));
      }
    };
    for (const k of ['generateCertificate']) window.RTCPeerConnection[k] = PC[k].bind(PC);
    const WS = window.WebSocket;
    window.WebSocket = class extends WS {
      constructor(...a) { super(...a); this.addEventListener('message', (e) => { try { log('ws:' + JSON.parse(e.data).t); } catch {} }); this.addEventListener('close', (e) => log('ws:close ' + e.code)); }
    };
  });
  if (init) await page.addInitScript(init);
  return { ctx, page, problems };
}

/** Starts a room on A, joins B, waits for both verification numbers. Does not press Match unless asked. */
async function pair(browsers, { initA, initB, store = 'opfs', match = true } = {}) {
  const A = await device(browsers[0], initA), B = await device(browsers[1], initB);
  const qs = `?store=${store}`;
  await A.page.goto(`${base}/send${qs}`);
  await B.page.goto(`${base}/send${qs}`);
  await A.page.click('#start');
  await A.page.waitForSelector('#room-code');
  const code = (await A.page.textContent('#room-code')).replace(/\s/g, '');
  await B.page.fill('#code-in', code);
  await B.page.click('#join');
  // either the numbers appear on both screens or the page shows an error (with its technical detail)
  try {
    await Promise.all([A, B].map((d) => d.page.waitForSelector('#sas, #error', { timeout: 40000 })));
  } catch (e) {
    const dump = await Promise.all([A, B].map((d) => d.page.evaluate(() => ({ log: window.__log, text: (document.querySelector('.send')?.innerText ?? '').replace(/s+/g, ' ').slice(180, 520) })).catch(() => null)));
    throw new Error('pairing stalled: ' + JSON.stringify(dump) + ' console A: ' + A.problems.join(' | ') + ' B: ' + B.problems.join(' | '));
  }
  const failed = await Promise.all([A, B].map((d) => d.page.$('#error')));
  if (failed[0] || failed[1]) {
    const info = await Promise.all([A, B].map((d) => d.page.evaluate(() => ({ why: document.querySelector('#error')?.getAttribute('data-reason'), tech: document.querySelector('.tech code')?.textContent }))));
    throw new Error(`pairing failed: A ${JSON.stringify(info[0])} | B ${JSON.stringify(info[1])}`);
  }
  const sas = [(await A.page.textContent('#sas')).trim(), (await B.page.textContent('#sas')).trim()];
  if (match) {
    if (sas[0] !== sas[1]) throw new Error(`verification numbers differ: ${sas}`);
    await Promise.all([A.page.click('#sas-ok'), B.page.click('#sas-ok')]);
    await Promise.all([A.page.waitForSelector('#pick', { state: 'attached', timeout: 15000 }), B.page.waitForSelector('#pick', { state: 'attached', timeout: 15000 })]);
  }
  return { A, B, code, sas, close: () => Promise.all([A.ctx.close(), B.ctx.close()]).catch(() => {}) };
}

const finished = (page, dir) => page.waitForSelector(`.xfer[data-dir=${dir}][data-state=done], .xfer[data-dir=${dir}][data-state=failed]`, { timeout: 900000 });
const state = (page, dir) => page.getAttribute(`.xfer[data-dir=${dir}]`, 'data-state');
const opfsLeft = (page) => page.evaluate(async () => {
  try {
    const d = await (await navigator.storage.getDirectory()).getDirectoryHandle('filehop-send');
    const names = []; for await (const k of d.keys()) names.push(k); return names;
  } catch { return []; }
});
// the worker removes its file a moment after the page marks the transfer failed
const opfsEmpty = async (page) => { for (let i = 0; i < 30; i++) { if (!(await opfsLeft(page)).length) return true; await new Promise((r) => setTimeout(r, 100)); } return false; };
const checks = [];
const check = (name, ok, extra = '') => { checks.push([name, ok]); log(`${ok ? 'PASS' : 'FAIL'}  ${name}${extra ? '  ' + extra : ''}`); };

// ------------------------------------------------------------------ scenarios

const scenarios = {
  async transfer(b) {
    for (const store of ['opfs', 'blob']) {
      const mib = store === 'blob' ? Math.min(sizeMiB, 100) : sizeMiB;
      const file = await makeFile(`random-${mib}MiB.bin`, mib);
      const src = await sha(file);
      const p = await pair(b, { store });
      const route = await p.A.page.getAttribute('#route', 'data-route');
      log(`[${store}] paired, verification number "${p.sas[0]}", route ${route}`);
      await p.A.page.setInputFiles('#pick', file);
      await p.B.page.waitForSelector('.offer-accept', { timeout: 15000 });
      const t0 = Date.now();
      await p.B.page.click('.offer-accept');
      await Promise.all([finished(p.A.page, 'out'), finished(p.B.page, 'in')]);
      const wall = (Date.now() - t0) / 1000;
      const [sa, sb] = [await state(p.A.page, 'out'), await state(p.B.page, 'in')];
      const hA = (await p.A.page.textContent('.xfer[data-dir=out] .hash'))?.trim();
      const hB = (await p.B.page.textContent('.xfer[data-dir=in] .hash'))?.trim();
      let disk = '', diskSize = 0;
      if (sb === 'done') {
        const [dl] = await Promise.all([p.B.page.waitForEvent('download'), p.B.page.click('.xfer[data-dir=in] .save')]);
        const dest = join(out, `received-${store}.bin`);
        await dl.saveAs(dest);
        diskSize = statSync(dest).size; disk = await sha(dest);
      }
      log(`[${store}] ${mib} MiB in ${wall.toFixed(1)} s = ${(mib / wall).toFixed(1)} MiB/s (loopback, shared VPS: not a network measurement)`);
      check(`transfer ${mib} MiB (${store}): both sides done, original = sender = receiver = saved file`, sa === 'done' && sb === 'done' && [hA, hB, disk].every((h) => h === src) && diskSize === mib * 1048576, `sha256 ${src}`);
      const bad = [...p.A.problems, ...p.B.problems].filter((m) => /Content Security Policy|Refused|Cross-Origin|pageerror/i.test(m));
      check(`transfer (${store}): no CSP / COEP violations or page errors`, bad.length === 0, bad.join(' | '));
      check(`transfer (${store}): crossOriginIsolated`, await p.A.page.evaluate(() => self.crossOriginIsolated));
      await p.close();
    }
  },

  async corrupt(b) {
    const file = await makeFile('random-8MiB.bin', 8);
    const flip = () => { // test only: one byte of the 50th data message is changed on the wire
      const orig = RTCDataChannel.prototype.send; let n = 0;
      RTCDataChannel.prototype.send = function (d) {
        if (d instanceof ArrayBuffer && ++n === 50) { const u = new Uint8Array(d.slice(0)); u[7] ^= 0xff; d = u.buffer; }
        return orig.call(this, d);
      };
    };
    for (const store of ['opfs', 'blob']) {
      const p = await pair(b, { initA: flip, initB: flip, store }); // whichever side sends, one byte is wrong
      await p.A.page.setInputFiles('#pick', file);
      await p.B.page.waitForSelector('.offer-accept', { timeout: 15000 });
      await p.B.page.click('.offer-accept');
      await Promise.all([finished(p.A.page, 'out'), finished(p.B.page, 'in')]);
      const sb = await state(p.B.page, 'in');
      const why = (await p.B.page.textContent('.xfer[data-dir=in] .result')).trim();
      check(`corrupt byte (${store}): receiver marks it failed`, sb === 'failed', why);
      check(`corrupt byte (${store}): no save link is offered`, (await p.B.page.$('.xfer[data-dir=in] .save')) === null);
      check(`corrupt byte (${store}): the sender is told it failed`, (await state(p.A.page, 'out')) === 'failed');
      check(`corrupt byte (${store}): nothing left in private storage`, await opfsEmpty(p.B.page), JSON.stringify(await opfsLeft(p.B.page)));
      await p.close();
    }
  },

  async cancel(b) {
    const file = await makeFile('random-64MiB.bin', 64);
    for (const by of ['sender', 'receiver']) {
      const p = await pair(b);
      await p.A.page.setInputFiles('#pick', file);
      await p.B.page.waitForSelector('.offer-accept', { timeout: 15000 });
      await p.B.page.click('.offer-accept');
      await p.A.page.waitForFunction(() => { const e = document.querySelector('.xfer[data-dir=out] progress'); return e && e.value > 2 * 1048576; }, null, { timeout: 60000 });
      const side = by === 'sender' ? p.A : p.B;
      await side.page.click(`.xfer[data-dir=${by === 'sender' ? 'out' : 'in'}] button`);
      await Promise.all([finished(p.A.page, 'out'), finished(p.B.page, 'in')]);
      check(`cancel by ${by}: both sides end as failed`, (await state(p.A.page, 'out')) === 'failed' && (await state(p.B.page, 'in')) === 'failed');
      check(`cancel by ${by}: no save link, nothing left in private storage`, (await p.B.page.$('.xfer[data-dir=in] .save')) === null && (await opfsEmpty(p.B.page)), JSON.stringify(await opfsLeft(p.B.page)));
      await p.close();
    }
  },

  async early(b) {
    // B (the joiner) opens the channel; its page keeps the channel so the test can misuse it.
    const keep = () => {
      const o = RTCPeerConnection.prototype.createDataChannel;
      RTCPeerConnection.prototype.createDataChannel = function (...a) { const dc = o.apply(this, a); window.__dc = dc; window.__msgs = []; dc.addEventListener('message', (e) => window.__msgs.push(e.data)); return dc; };
    };
    for (const kind of ['bytes', 'offer']) {
      const p = await pair(b, { initB: keep, match: false });
      await p.B.page.evaluate((k) => {
        if (k === 'bytes') window.__dc.send(new ArrayBuffer(4096));
        else window.__dc.send(JSON.stringify({ t: 'offer', id: 'early1', name: 'x.bin', size: 10, mime: '' }));
      }, kind);
      await p.A.page.waitForSelector('#error', { timeout: 10000 });
      check(`before Match, ${kind === 'bytes' ? 'file data' : 'an offer'} closes the connection on the receiver`, (await p.A.page.getAttribute('#error', 'data-reason')) === 'protocol');
      check(`before Match, no offer reaches the receiver's screen`, (await p.A.page.$('.offer')) === null);
      await p.close();
    }
  },

  async forged(b) {
    const keep = () => {
      const o = RTCPeerConnection.prototype.createDataChannel;
      RTCPeerConnection.prototype.createDataChannel = function (...a) { const dc = o.apply(this, a); window.__dc = dc; window.__msgs = []; dc.addEventListener('message', (e) => window.__msgs.push(e.data)); return dc; };
    };
    const p = await pair(b, { initB: keep });
    // B is a guest: an offer of 3 GiB is above what the server says B may send (2 GiB)
    await p.B.page.evaluate(() => window.__dc.send(JSON.stringify({ t: 'offer', id: 'big1', name: 'big.bin', size: 3 * 2 ** 30, mime: '' })));
    await p.B.page.waitForFunction(() => window.__msgs.some((m) => typeof m === 'string' && m.includes('too_big')), null, { timeout: 10000 });
    check('an offer above the sender\'s limit is refused by the receiver (too_big)', (await p.A.page.$('.offer')) === null);
    // a hostile name is cleaned before it is shown
    await p.B.page.evaluate(() => window.__dc.send(JSON.stringify({ t: 'offer', id: 'name1', name: 'tagihan‮fdp.exe', size: 10, mime: '' })));
    await p.A.page.waitForSelector('.offer .sname', { timeout: 10000 });
    const shown = (await p.A.page.textContent('.offer .sname')).trim();
    check('a right-to-left override in a file name is removed before it is shown', shown === 'tagihanfdp.exe', JSON.stringify(shown));
    await p.close();
  },

  async nomatch(b) {
    const p = await pair(b, { match: false });
    await p.A.page.click('#sas-ok');
    await p.B.page.click('#sas-no'); // B leaves
    await p.A.page.waitForSelector('#error', { timeout: 10000 });
    check('"They differ" ends the pairing for both', (await p.A.page.getAttribute('#error', 'data-reason')) === 'connection_lost');
    await p.close();
  },

  async limit(b) {
    // a scanner spends its wrong tries, then guesses right: it must still be refused, and the real receiver gets in
    const A = await device(b[0]), S = await device(b[1]), R = await device(b[1]);
    await A.page.goto(`${base}/send`);
    await A.page.click('#start');
    await A.page.waitForSelector('#room-code');
    const code = (await A.page.textContent('#room-code')).replace(/\s/g, '');
    await S.page.goto(`${base}/send`);
    const tryJoin = (page, c) => page.evaluate((cc) => new Promise((res) => {
      const ws = new WebSocket((location.protocol === 'https:' ? 'wss://' : 'ws://') + location.host + '/api/send/signal');
      ws.onopen = () => ws.send(JSON.stringify({ t: 'join', code: cc }));
      ws.onmessage = (e) => { if (JSON.parse(e.data).t === 'hello') { res('joined'); ws.close(); } };
      ws.onclose = (e) => res(String(e.code));
    }), c);
    const codes = [];
    for (let i = 0; i < 10; i++) codes.push(await tryJoin(S.page, '000000'));
    check('ten wrong codes from one address are told "unknown"', codes.every((c) => c === '4404'), codes.join(','));
    const after = await tryJoin(S.page, code);
    check('then the CORRECT code from that address is refused (4429)', after === '4429', after);
    await R.page.goto(`${base}/send`);
    const rj = await tryJoin(R.page, code);
    check('another address still joins the waiting room', rj === 'joined', rj);
    await Promise.all([A, S, R].map((d) => d.ctx.close()));
  },

  async rooms(b) {
    const A = await device(b[0]), B = await device(b[1]);
    await A.page.goto(`${base}/send`);
    await A.page.fill('#code-in', '000000');
    await A.page.click('#join');
    await A.page.waitForSelector('#error', { timeout: 10000 });
    check('an unknown code says so', (await A.page.getAttribute('#error', 'data-reason')) === 'room_unknown');
    await B.ctx.close(); await A.ctx.close();
    const p = await pair(b);
    const C = await device(b[0]);
    await C.page.goto(`${base}/send`);
    await C.page.fill('#code-in', p.code);
    await C.page.click('#join');
    await C.page.waitForSelector('#error', { timeout: 10000 });
    check('a third device is refused (room full)', (await C.page.getAttribute('#error', 'data-reason')) === 'room_full');
    await C.ctx.close(); await p.close();
  }
};

const browsers = [await launch(), await launch()];
let crashed = false;
try {
  for (const [name, fn] of Object.entries(scenarios)) {
    if (only.length && !only.includes(name)) continue;
    log(`--- ${name}`);
    try { await fn(browsers); } catch (e) { crashed = true; check(`${name} ran to the end`, false, String(e?.stack ?? e).split('\n').slice(0, 3).join(' | ')); }
  }
} finally {
  await Promise.all(browsers.map((x) => x.close().catch(() => {})));
  const failed = checks.filter(([, ok]) => !ok).length;
  log(`RESULT: ${checks.length - failed} passed, ${failed} failed${crashed ? ' (a scenario crashed)' : ''}`);
  if (logPath) writeFileSync(logPath, lines.join('\n') + '\n');
  process.exitCode = failed || crashed ? 1 : 0;
}

// Unit checks for the pure parts of /send (web/src/lib/send/pure.ts): flow control, chunking,
// the incremental hash, file name sanitising and the pairing arithmetic. No browser needed.
// Run with: node tools/send.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import { createHash, randomBytes } from 'node:crypto';

const require = createRequire(import.meta.url);
const ts = require('typescript');
const dir = mkdtempSync(join(tmpdir(), 'fh-send-'));
const src = readFileSync(new URL('../web/src/lib/send/pure.ts', import.meta.url), 'utf8');
writeFileSync(join(dir, 'pure.mjs'), ts.transpileModule(src, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText);
const P = await import('file://' + join(dir, 'pure.mjs').replace(/\\/g, '/'));
const { createSHA256 } = await import('hash-wasm');

const MiB = 1 << 20;

// ------------------------------------------------------------ flow control

test('the numbers are the ones the plan names', () => {
  assert.equal(P.CHUNK, 16 * 1024);
  assert.equal(P.READ, MiB);
  assert.equal(P.HIGH, 4 * MiB);
  assert.equal(P.LOW, MiB);
  assert.equal(P.WINDOW, 16 * MiB);
  assert.equal(P.ACK_EVERY, 4 * MiB);
  assert.equal(P.BLOB_LIMIT, 512 * MiB);
  assert.equal(P.CONNECT_MS, 20000);
});

test('offerGroup: only a believable, complete group passes', () => {
  assert.deepEqual(P.offerGroup(2, 5, 1000), { n: 2, of: 5, total: 1000 });
  assert.deepEqual(P.offerGroup(1, 1, 0), { n: 1, of: 1, total: 0 });
  assert.equal(P.offerGroup(undefined, undefined, undefined), null); // an old sender sends none
  assert.equal(P.offerGroup(0, 5, 10), null);
  assert.equal(P.offerGroup(6, 5, 10), null);
  assert.equal(P.offerGroup(1, 0, 10), null);
  assert.equal(P.offerGroup(1, 1, -1), null);
  assert.equal(P.offerGroup(1.5, 2, 10), null);
  assert.equal(P.offerGroup(1, 1, NaN), null);
  assert.equal(P.offerGroup(1, 1, Infinity), null);
});

test('a group one receiver takes in one go is capped at what a tab should hold', () => {
  assert.equal(P.GROUP_CAP, 512 * MiB);
});

test('gate: the channel queue holds the sender first, then the receiver window', () => {
  assert.equal(P.gate(0, 0, 0), 'go');
  assert.equal(P.gate(10 * MiB, 0, P.HIGH), 'go'); // exactly HIGH is still allowed
  assert.equal(P.gate(10 * MiB, 0, P.HIGH + 1), 'buffer');
  assert.equal(P.gate(P.WINDOW, 0, 0), 'go'); // exactly one window in flight
  assert.equal(P.gate(P.WINDOW + 1, 0, 0), 'ack');
  assert.equal(P.gate(P.WINDOW + 1, 1, 0), 'go'); // the first byte was acknowledged
  assert.equal(P.gate(100 * MiB, 100 * MiB - MiB, 0), 'go');
  assert.equal(P.gate(P.WINDOW + 5, 0, P.HIGH + 5), 'buffer'); // both: the queue is checked first
});

test('chunkRanges covers the file exactly, in order, with a short last piece', () => {
  assert.deepEqual(P.chunkRanges(0), []);
  assert.deepEqual(P.chunkRanges(1), [[0, 1]]);
  assert.deepEqual(P.chunkRanges(P.CHUNK), [[0, P.CHUNK]]);
  assert.deepEqual(P.chunkRanges(P.CHUNK + 1), [[0, P.CHUNK], [P.CHUNK, P.CHUNK + 1]]);
  const len = 5 * MiB + 123;
  const r = P.chunkRanges(len);
  assert.equal(r.length, Math.ceil(len / P.CHUNK));
  assert.ok(r.every(([a, b], i) => b - a <= P.CHUNK && (i === 0 || r[i - 1][1] === a)));
  assert.equal(r[r.length - 1][1], len);
});

test('ackDue fires after every 4 MiB written and not before', () => {
  assert.equal(P.ackDue(P.ACK_EVERY - 1, 0), false);
  assert.equal(P.ackDue(P.ACK_EVERY, 0), true);
  assert.equal(P.ackDue(P.ACK_EVERY + 10, P.ACK_EVERY), false);
  assert.equal(P.ackDue(2 * P.ACK_EVERY, P.ACK_EVERY), true);
});

test('a simulated transfer never has more than a window in flight', () => {
  let sent = 0, acked = 0, lastAck = 0, buffered = 0, maxFlight = 0, maxBuffered = 0;
  const total = 64 * MiB;
  // each tick the wire drains 2 MiB and the receiver writes what it drained
  for (let guard = 0; acked < total && guard < 100000; guard++) {
    const ranges = P.chunkRanges(total - sent, P.CHUNK);
    for (const [a, b] of ranges) {
      if (P.gate(sent, acked, buffered) !== 'go') break;
      sent += b - a; buffered += b - a;
      maxBuffered = Math.max(maxBuffered, buffered);
      maxFlight = Math.max(maxFlight, sent - acked);
    }
    const drained = Math.min(buffered, 2 * MiB);
    buffered -= drained;
    const written = sent - buffered;
    if (P.ackDue(written, lastAck) || written === total) { lastAck = written; acked = written; }
  }
  assert.equal(acked, total);
  assert.ok(maxFlight <= P.WINDOW + P.CHUNK, `in flight ${maxFlight}`);
  assert.ok(maxBuffered <= P.HIGH + P.CHUNK, `buffered ${maxBuffered}`);
});

// ------------------------------------------------------------ hash

test('incremental SHA-256 matches known vectors', async () => {
  const hex = (u) => Buffer.from(u).toString('hex');
  let h = await createSHA256();
  assert.equal(h.digest('hex'), 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
  h = await createSHA256();
  h.update(new TextEncoder().encode('abc'));
  assert.equal(h.digest('hex'), 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  h = await createSHA256();
  const a = new Uint8Array(1000).fill(97);
  for (let i = 0; i < 1000; i++) h.update(a); // one million 'a'
  assert.equal(h.digest('hex'), 'cdc76e5c9914fb9281a1c7e284d73e67f1809a48a497200e046d39ccc7112cd0');
  void hex;
});

test('hashing in 16 KB chunks equals hashing the whole file', async () => {
  const data = randomBytes(3 * MiB + 777);
  const h = await createSHA256();
  for (const [a, b] of P.chunkRanges(data.length)) h.update(data.subarray(a, b));
  assert.equal(h.digest('hex'), createHash('sha256').update(data).digest('hex'));
});

// ------------------------------------------------------------ file names

test('sanitizeFileName table', () => {
  const T = '‮', ZW = '​';
  const cases = [
    ['report.pdf', 'report.pdf'],
    ['  report.pdf  ', 'report.pdf'],
    ['tagihan' + T + 'fdp.exe', 'tagihanfdp.exe'], // right-to-left override removed: no "exe" disguised as "pdf"
    ['a‎b‏c‪d⁦e⁩f', 'abcdef'],
    ['ab' + ZW + 'c‍﻿.txt', 'abc.txt'],
    ['line break .txt', 'linebreak.txt'],
    ['arab؜ic.txt', 'arabic.txt'],
    ['nul\u0000l\u0007\u001F.txt', 'null.txt'], // C0
    ['c1\u0085\u009F.txt', 'c1.txt'], // C1
    ['a<b>c:d"e/f\\g|h?i*j.txt', 'a_b_c_d_e_f_g_h_i_j.txt'],
    ['../../etc/passwd', '_.._etc_passwd'],
    ['.hidden', 'hidden'],
    ['...', 'file'],
    ['name. . ', 'name'],
    ['', 'file'],
    [' ‮ ', 'file'],
    ['CON', '_CON'],
    ['con.txt', '_con.txt'],
    ['Aux.tar.gz', '_Aux.tar.gz'],
    ['NUL', '_NUL'],
    ['com1', '_com1'],
    ['LPT9.log', '_LPT9.log'],
    ['COM10.txt', 'COM10.txt'], // not a device name
    ['console.txt', 'console.txt'],
    ['é.txt', 'é.txt'], // NFC: e + combining acute becomes é
    ['日本語のファイル.txt', '日本語のファイル.txt'],
    ['so­ft͏hyᅟᅠp᠎en.txt', 'softhypen.txt'],
    ['a⁠b⁡c⁢d⁣e⁤f.txt', 'abcdef.txt'],
    ['xㅤyﾠz.txt', 'xyz.txt'],
    ['v︀️w.txt', 'vw.txt'],
    ['t󠁁󠁿g.txt', 'tg.txt'],
    ['😀.png', '😀.png']
  ];
  for (const [input, want] of cases) assert.equal(P.sanitizeFileName(input), want, JSON.stringify(input));
  assert.equal(P.sanitizeFileName('', 'berkas'), 'berkas'); // the translated default
  assert.equal(P.sanitizeFileName(undefined, 'x'), 'x');
  assert.equal(P.sanitizeFileName(42, 'x'), 'x');
});

test('sanitizeFileName cuts at 200 characters and keeps the extension', () => {
  const long = 'a'.repeat(300) + '.pdf';
  const out = P.sanitizeFileName(long);
  assert.equal([...out].length, 200);
  assert.ok(out.endsWith('.pdf'));
  assert.equal(P.sanitizeFileName('b'.repeat(250)).length, 200);
  const exactly = 'c'.repeat(196) + '.txt';
  assert.equal(P.sanitizeFileName(exactly), exactly);
  const emoji = '😀'.repeat(250); // counted in characters, never cut in the middle of one
  assert.equal([...P.sanitizeFileName(emoji)].length, 200);
  assert.ok(!P.sanitizeFileName(emoji).includes('�'));
  const noext = 'x'.repeat(190) + '.' + 'y'.repeat(40); // a "long extension" is not kept
  assert.equal([...P.sanitizeFileName(noext)].length, 200);
});

// ------------------------------------------------------------ pairing

const FP_A = 'AA:BB:CC:DD';
const FP_B = '11:22:33:44';
const NONCE = '00112233445566778899aabbccddeeff';

test('fingerprintOf reads the sha-256 line of a description', () => {
  const sdp = 'v=0\r\nm=application 9 UDP/DTLS/SCTP webrtc-datachannel\r\na=fingerprint:sha-256 ab:cd:01:EF\r\na=setup:actpass\r\n';
  assert.equal(P.fingerprintOf(sdp), 'AB:CD:01:EF');
  assert.equal(P.fingerprintOf('v=0\r\n'), '');
  assert.equal(P.fingerprintOf(undefined), '');
  assert.equal(P.fingerprintOf('a=fingerprint:sha-1 AA:BB\r\n'), '');
});

test('commitment vector is fixed, and case of the fingerprint does not matter', async () => {
  const want = '956b0b2ced173ff2aaf201eec26534587e3405e1f3e8067811ef7c00a75ac595';
  assert.equal(await P.commitOf(FP_A, NONCE), want);
  assert.equal(await P.commitOf(FP_A.toLowerCase(), NONCE), want);
  assert.equal(await P.commitOf(FP_A, NONCE), createHash('sha256').update(`fh-commit|${FP_A}|${NONCE}`).digest('hex'));
  assert.notEqual(await P.commitOf(FP_B, NONCE), want);
  assert.notEqual(await P.commitOf(FP_A, NONCE.replace('00', '01')), want);
});

test('revealMatches accepts only the committed fingerprint and nonce', async () => {
  const c = await P.commitOf(FP_A, NONCE);
  assert.equal(await P.revealMatches(c, FP_A, NONCE), true);
  assert.equal(await P.revealMatches(c, FP_B, NONCE), false); // a different certificate than the one committed to
  assert.equal(await P.revealMatches(c, FP_A, 'ff'.repeat(16)), false);
  assert.equal(await P.revealMatches(c, FP_A, 'not hex'), false);
  assert.equal(await P.revealMatches('', FP_A, NONCE), false);
});

test('verification number has fixed vectors and does not depend on who is "local"', async () => {
  assert.equal(await P.verificationNumber(FP_A, FP_B, '123456'), '868 017');
  assert.equal(await P.verificationNumber(FP_B, FP_A, '123456'), '868 017');
  assert.equal(await P.verificationNumber(FP_A, FP_B, '000000'), '473 632');
  assert.notEqual(await P.verificationNumber(FP_A, 'DE:AD:BE:EF', '123456'), '868 017'); // a third party's certificate
  for (let i = 0; i < 50; i++) assert.match(await P.verificationNumber(FP_A, randomBytes(4).toString('hex'), '123456'), /^\d{3} \d{3}$/);
});

test('offer ids: short plain ids, each used once', () => {
  const seen = new Set(['used1']);
  for (const ok of ['a', 'abc123', '0123456789abcdef']) assert.equal(P.validOfferId(ok, seen), true, ok);
  for (const bad of ['', 'used1', '__proto__', 'A1', 'a-b', 'a b', '0123456789abcdefg', 'é', 7, null, undefined, {}, ['a']]) assert.equal(P.validOfferId(bad, seen), false, String(bad));
});

test('reveal answers: only plain repeats, bounded, never to an answer, never after Match', () => {
  assert.equal(P.shouldAnswerReveal(false, false, 0), true, 'a repeat before the other side matched');
  assert.equal(P.shouldAnswerReveal(true, false, 0), false, 'an answer is never answered');
  assert.equal(P.shouldAnswerReveal(false, true, 0), false, 'the other side pressed Match: it has our reveal');
  assert.equal(P.shouldAnswerReveal(false, false, P.MAX_REVEAL_ANSWERS), false, 'bounded');
  // two devices, ping-pong: however many repeats are in flight, the exchange ends
  let traffic = 0;
  const dev = () => ({ answered: 0 });
  const a = dev(), b = dev();
  const queue = [[b, false], [b, false], [a, false], [a, false]]; // extra plain repeats in flight to both
  while (queue.length && traffic < 1000) {
    const [to, isAnswer] = queue.shift();
    if (P.shouldAnswerReveal(isAnswer, false, to.answered)) { to.answered++; traffic++; queue.push([to === a ? b : a, true]); }
  }
  assert.ok(traffic <= 2 * P.MAX_REVEAL_ANSWERS, 'traffic ' + traffic);
  assert.equal(queue.length, 0);
});

test('nonces are 128 random bits', () => {
  const a = P.newNonce(), b = P.newNonce();
  assert.match(a, /^[0-9a-f]{32}$/);
  assert.notEqual(a, b);
});

test('routeOf names the route of the selected pair', () => {
  assert.equal(P.routeOf('host', 'host'), 'host');
  assert.equal(P.routeOf('host', 'srflx'), 'srflx');
  assert.equal(P.routeOf('prflx', 'host'), 'prflx');
  assert.equal(P.routeOf('srflx', 'relay'), 'relay');
  assert.equal(P.routeOf(undefined, undefined), 'unknown');
});

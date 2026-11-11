// Peer-to-peer send: pairing through the server's signalling socket, then everything (control
// messages as JSON strings, file bytes as ArrayBuffers) over one ordered, reliable
// RTCDataChannel, which WebRTC encrypts with DTLS. The server never sees a byte of the file.
//
// Pairing, in order:
//   1. each device commits to its DTLS fingerprint (a hash, not the fingerprint) through the server;
//   2. only after both commitments are in does the session description travel;
//   3. when the channel opens each device reveals its nonce; the other checks it against the
//      commitment and the fingerprint it now sees in the description;
//   4. both people compare a six-digit number derived from the two fingerprints and the room code,
//      and press "Match". Nothing else may cross the channel before both have.
// Someone who relays the handshake has to pick their certificates before seeing the real ones,
// so a wrong pairing shows different numbers except for a one-in-a-million chance per attempt.
import { createSHA256 } from 'hash-wasm';
import {
  CHUNK, READ, LOW, CONNECT_MS, gate, ackDue, sanitizeFileName, fingerprintOf, newNonce, commitOf,
  revealMatches, verificationNumber, routeOf, validOfferId, shouldAnswerReveal, type Route
} from './pure';

export type { Route };

const params = new URLSearchParams(location.search);
// 'opfs' or 'blob' force a save tier (used by the browser tests); the default tries the save dialog first.
const STORE_MODE = params.get('store') ?? 'auto';

export type Phase = 'idle' | 'waiting' | 'connecting' | 'verify' | 'ready' | 'closed' | 'error';

export interface Offer { id: string; name: string; size: number; mime: string }
export interface Progress { id: string; dir: 'in' | 'out'; name: string; size: number; done: number; bytesPerSec: number }
export interface Finished {
  id: string; dir: 'in' | 'out'; name: string; size: number; ok: boolean;
  sha256: string; peerSha256: string; ms: number; file?: File; store?: string; reason?: string;
}

export interface Hooks {
  phase(p: Phase, detail?: string): void;
  code(c: string): void;
  sas(s: string): void;
  route(r: Route): void;
  limits(mine: number, peer: number): void;
  diag(text: string): void;
  offer(o: Offer): void;
  progress(p: Progress): void;
  finished(f: Finished): void;
  verified(): void;
}

type Json = Record<string, unknown>;
const GIB2 = 2 * 1024 * 1024 * 1024;

export class Session {
  code = '';
  /** Used when a name from the other device is empty once cleaned (set by the page, translated). */
  fallbackName = 'file';
  maxBytes = GIB2; // what this device may send, as the server sees it
  peerMax = GIB2; // what the other device may send, as the server told us
  closed = false;
  private ws: WebSocket | null = null;
  private pc: RTCPeerConnection | null = null;
  private dc: RTCDataChannel | null = null;
  private me = '';
  private peer = '';
  private ice: RTCIceServer[] = [];
  private caller = false;
  private ttlMs = 0;
  private roomAt = 0;
  private early: RTCIceCandidateInit[] = [];
  private timer = 0;
  private verifyTimer = 0;
  private revealTimer = 0;
  private revealAnswers = 0;
  private nonce = '';
  private myFp = '';
  private myCommit = '';
  private peerCommit = '';
  private sentCommit = false;
  private offered = false;
  private revealed = false;
  private sasShown = false;
  private myOk = false;
  private peerOk = false;
  private kinds = { local: [] as string[], remote: [] as string[] };
  private waiters = new Map<string, (m: Json) => void>();
  private cancelled = new Set<string>();
  private seenIds = new Set<string>(); // offer ids the other device has used
  private acked = new Map<string, number>();
  private worker: Worker | null = null;
  private incoming: { id: string; name: string; size: number; got: number; acked: number; t0: number; sha: string; endSize: number; peerOk: boolean } | null = null;
  private resolveWorker: ((m: Json) => void) | null = null;
  private wake: (() => void) | null = null;
  private trail: string[] = []; // what happened, for the technical detail shown when something fails
  private t0 = performance.now();
  private note(s: string) { if (this.trail.length < 24) this.trail.push(`${Math.round(performance.now() - this.t0)}ms ${s}`); }

  constructor(private h: Hooks) {}

  private get matched() { return this.myOk && this.peerOk; }

  // ---------- pairing ----------
  async create(): Promise<void> {
    this.h.phase('connecting');
    let r: Response;
    try { r = await fetch('/api/send/room', { method: 'POST' }); } catch { return this.fail('busy'); }
    if (r.status === 429) return this.fail('rate_limited');
    if (!r.ok) return this.fail('busy');
    const j = await r.json();
    this.ttlMs = (j.ttl ?? 600) * 1000;
    this.roomAt = Date.now();
    this.code = j.code;
    this.h.code(j.code);
    await this.open(j.code);
  }

  async join(code: string): Promise<void> {
    this.code = code;
    this.h.code(code);
    this.h.phase('connecting');
    await this.open(code);
  }

  private async open(code: string) {
    try {
      const c = await (await fetch('/api/send/config')).json();
      this.ice = c.iceServers ?? [];
      if (c.maxBytes) this.maxBytes = c.maxBytes;
    } catch { /* defaults */ }
    const ws = (this.ws = new WebSocket((location.protocol === 'https:' ? 'wss://' : 'ws://') + location.host + '/api/send/signal'));
    ws.onopen = () => ws.send(JSON.stringify({ t: 'join', code }));
    ws.onmessage = (e) => {
      let m: any;
      try { m = JSON.parse(e.data); } catch { return; }
      this.note('ws:' + m.t);
      if (m.t === 'hello') {
        this.me = m.id;
        if (typeof m.max === 'number') this.maxBytes = m.max;
        const other = m.peers?.[0];
        if (other) {
          this.peer = other.id;
          if (typeof other.max === 'number') this.peerMax = other.max;
          this.caller = true; // the newcomer calls
          this.h.limits(this.maxBytes, this.peerMax);
          void this.begin();
        } else {
          this.h.limits(this.maxBytes, this.peerMax);
          this.h.phase('waiting');
        }
      } else if (m.t === 'peer') {
        this.peer = m.id;
        if (typeof m.max === 'number') this.peerMax = m.max;
        this.h.limits(this.maxBytes, this.peerMax);
        void this.begin();
      } else if (m.t === 'sig' && m.from === this.peer) {
        void this.signal(m.d);
      } else if (m.t === 'err') {
        this.fail('protocol');
      } else if (m.t === 'leave' && m.id === this.peer && !this.pc) {
        this.fail('connection_lost'); // left before the handshake began; the room is sealed, nobody can take that place
      }
      // once the handshake runs, a "leave" is normal: the other device closes the socket as soon as
      // its channel is open, which can be just before ours is. The 20 s timer covers a real failure.
    };
    ws.onclose = (e) => {
      if (this.closed || this.dc?.readyState === 'open') return; // the channel no longer needs the socket
      if (e.code === 4404) this.fail(e.reason === 'full' ? 'room_full' : 'room_unknown');
      else if (e.code === 4429) this.fail('rate_limited');
      else if (this.pc?.connectionState !== 'connected') {
        const gone = this.ttlMs && Date.now() - this.roomAt >= this.ttlMs - 5000;
        this.fail(gone ? 'room_expired' : 'signal_lost');
      }
    };
  }

  private sig(d: unknown) {
    if (this.ws?.readyState === 1) this.ws.send(JSON.stringify({ t: 'sig', to: this.peer, d }));
  }

  /** The other device is known: commit to our fingerprint, then (the caller) wait for theirs. */
  private async begin() {
    if (this.pc || this.closed) return;
    this.h.phase('connecting');
    try {
      const cert = await RTCPeerConnection.generateCertificate({ name: 'ECDSA', namedCurve: 'P-256' } as EcKeyGenParams);
      this.myFp = (cert.getFingerprints().find((f) => f.algorithm === 'sha-256')?.value ?? '').toUpperCase();
      if (!this.myFp) return this.fail('unsupported');
      this.nonce = newNonce();
      this.myCommit = await commitOf(this.myFp, this.nonce);
      const pc = (this.pc = new RTCPeerConnection({ iceServers: this.ice, certificates: [cert] }));
      pc.onicecandidate = (e) => {
        if (!e.candidate) return;
        this.kinds.local.push(e.candidate.type ?? '?');
        this.sig({ c: e.candidate.toJSON() });
      };
      pc.ondatachannel = (e) => this.channel(e.channel);
      pc.onconnectionstatechange = () => {
        this.note('pc:' + pc.connectionState);
        if (pc.connectionState === 'failed') this.fail('no_direct');
        if (pc.connectionState === 'disconnected' || pc.connectionState === 'closed') this.dropped();
      };
      this.timer = window.setTimeout(() => { if (!this.dc || this.dc.readyState !== 'open') this.fail('no_direct'); }, CONNECT_MS);
      this.sig({ k: 'commit', h: this.myCommit });
      this.sentCommit = true;
      this.maybeOffer();
      if (this.early.length && pc.remoteDescription) this.drainEarly();
    } catch { this.fail('unsupported'); }
  }

  private maybeOffer() {
    const pc = this.pc;
    if (!pc || !this.caller || !this.sentCommit || !this.peerCommit || this.offered) return;
    this.offered = true;
    this.channel(pc.createDataChannel('send', { ordered: true }));
    pc.createOffer().then((o) => pc.setLocalDescription(o)).then(() => this.sig({ sdp: pc.localDescription!.toJSON() }))
      .catch(() => this.fail('no_direct'));
  }

  private drainEarly() {
    const pc = this.pc!;
    this.early.splice(0).forEach((c) => pc.addIceCandidate(c).catch(() => {}));
  }

  private async signal(d: any) {
    if (d?.k === 'commit') {
      if (typeof d.h === 'string' && /^[0-9a-f]{64}$/.test(d.h) && !this.peerCommit) { this.peerCommit = d.h; this.maybeOffer(); }
      return;
    }
    if (d?.sdp) {
      // a description is only acceptable once both commitments exist
      const want = this.caller ? 'answer' : 'offer';
      if (!this.peerCommit || !this.sentCommit || !this.pc || d.sdp.type !== want) return this.fail('protocol');
      const pc = this.pc;
      try {
        await pc.setRemoteDescription(d.sdp);
        this.drainEarly();
        if (!this.caller) {
          await pc.setLocalDescription(await pc.createAnswer());
          this.sig({ sdp: pc.localDescription!.toJSON() });
        }
      } catch { this.fail('no_direct'); }
    } else if (d?.c) {
      this.kinds.remote.push(String(d.c.candidate ?? '').split(' ')[7] ?? '?');
      if (!this.pc?.remoteDescription) this.early.push(d.c);
      else this.pc.addIceCandidate(d.c).catch(() => {});
    }
  }

  private channel(dc: RTCDataChannel) {
    this.dc = dc;
    dc.binaryType = 'arraybuffer';
    dc.bufferedAmountLowThreshold = LOW;
    dc.onbufferedamountlow = () => this.wake?.();
    dc.onopen = async () => {
      this.note('dc:open');
      clearTimeout(this.timer);
      // connected, but the pairing check must finish too: never leave the person looking at "Connecting"
      this.verifyTimer = window.setTimeout(() => { if (!this.sasShown) this.fail('handshake_stalled'); }, 10000);
      this.ws?.close(); // the server is not needed any more
      // The first message a device sends on a fresh channel is sometimes not delivered (seen with the
      // answerer's reveal in Chromium, about one pairing in thirty). Reveal is idempotent, so it is sent
      // again until our own number is shown; a device that receives a repeat answers with its own.
      this.say({ t: 'reveal', n: this.nonce });
      this.revealTimer = window.setInterval(() => {
        if (this.sasShown || this.closed) clearInterval(this.revealTimer);
        else this.say({ t: 'reveal', n: this.nonce });
      }, 700);
      this.h.route(await this.routeKind());
    };
    dc.onclose = () => { this.note('dc:close'); this.dropped(); };
    dc.onmessage = (e) => {
      if (this.closed) return;
      if (typeof e.data !== 'string') return this.bytes(e.data as ArrayBuffer);
      let m: any;
      try { m = JSON.parse(e.data); } catch { return this.fail('protocol'); }
      void this.control(m);
    };
  }

  // The other device's nonce must open the commitment it made before it saw our description.
  // Only the first reveal is ever processed: `revealed` is set before anything is awaited, and a later
  // one (a repeat, an answer, a late one) returns before it can touch the fingerprint, the number or the
  // phase, so the number shown cannot be replaced or changed afterwards. A plain repeat may be answered
  // (marked `re`, a bounded number of times, never once the other side pressed "Match"); an answer is
  // never answered, so nothing can bounce back and forth.
  private async reveal(n: unknown, isAnswer = false) {
    if (this.revealed) {
      if (shouldAnswerReveal(isAnswer, this.peerOk, this.revealAnswers)) {
        this.revealAnswers++;
        this.say({ t: 'reveal', n: this.nonce, re: 1 });
      }
      return;
    }
    this.revealed = true;
    const pc = this.pc!;
    const remoteFp = fingerprintOf(pc.currentRemoteDescription?.sdp);
    const localFp = fingerprintOf(pc.currentLocalDescription?.sdp);
    if (!remoteFp || localFp !== this.myFp || !(await revealMatches(this.peerCommit, remoteFp, String(n)))) return this.fail('commit_mismatch');
    const number = await verificationNumber(localFp, remoteFp, this.code);
    if (this.closed || this.sasShown) return;
    this.h.sas(number);
    this.sasShown = true;
    clearTimeout(this.verifyTimer);
    clearInterval(this.revealTimer);
    this.note('sas');
    this.h.phase('verify');
  }

  private async routeKind(): Promise<Route> {
    try {
      const stats = await this.pc!.getStats();
      let pair: any;
      stats.forEach((r) => { if (r.type === 'transport' && r.selectedCandidatePairId) pair = stats.get(r.selectedCandidatePairId); });
      if (!pair) stats.forEach((r) => { if (r.type === 'candidate-pair' && r.nominated && r.state === 'succeeded') pair = r; });
      return routeOf(pair && stats.get(pair.localCandidateId)?.candidateType, pair && stats.get(pair.remoteCandidateId)?.candidateType);
    } catch { return 'unknown'; }
  }

  /** The person confirmed that the numbers match. Files may flow once both people have. */
  confirmShortCode() {
    if (!this.sasShown) return;
    this.myOk = true;
    this.say({ t: 'ok' });
    this.maybeReady();
  }
  private maybeReady() {
    if (this.matched) { this.h.phase('ready'); this.h.verified(); }
  }

  leave() {
    this.closed = true;
    clearTimeout(this.timer);
    clearTimeout(this.verifyTimer);
    clearInterval(this.revealTimer);
    this.wake?.();
    if (this.incoming) this.abortIncoming('cancelled'); // tells the worker to clean up, then ends it
    else this.endWorker();
    try { this.dc?.close(); } catch { /* */ }
    try { this.pc?.close(); } catch { /* */ }
    try { this.ws?.close(); } catch { /* */ }
    this.h.phase('closed');
  }

  private fail(reason: string) {
    if (this.closed) return;
    this.closed = true;
    clearTimeout(this.timer);
    clearTimeout(this.verifyTimer);
    clearInterval(this.revealTimer);
    this.wake?.();
    const pc = this.pc;
    this.h.diag([
      `reason=${reason}`,
      pc ? `connection=${pc.connectionState} ice=${pc.iceConnectionState} gathering=${pc.iceGatheringState}` : 'no peer connection',
      `signalling=${this.ws?.readyState === 1 ? 'open' : 'closed'}`,
      `events ${this.trail.join(' > ')}`,
      `candidates local[${this.kinds.local.join(',') || '-'}] remote[${this.kinds.remote.join(',') || '-'}]`
    ].join('; '));
    if (this.incoming) this.abortIncoming('connection_lost'); // worker cleans up, row is finished
    try { this.dc?.close(); } catch { /* */ }
    try { pc?.close(); } catch { /* */ }
    try { this.ws?.close(); } catch { /* */ }
    this.h.phase('error', reason);
  }

  private dropped() {
    if (this.closed) return;
    if (this.incoming) this.abortIncoming('connection_lost');
    this.waiters.forEach((w) => w({ t: 'lost' }));
    this.wake?.();
    this.fail('connection_lost');
  }

  private say(o: Json) {
    if (this.dc?.readyState === 'open') this.dc.send(JSON.stringify(o));
  }

  // ---------- control messages ----------
  private async control(m: any) {
    switch (m.t) {
      case 'reveal': this.note(m.re === 1 ? 'rx:reveal(answer)' : 'rx:reveal'); return this.reveal(m.n, m.re === 1);
      case 'ok': this.peerOk = true; return this.maybeReady();
    }
    // Everything below is for after both people pressed "Match".
    if (!this.matched) return this.fail('protocol');
    switch (m.t) {
      case 'offer': {
        const size = Number(m.size);
        if (!validOfferId(m.id, this.seenIds)) return this.say({ t: 'reject', id: 'x', why: 'bad_id' });
        const id: string = m.id;
        this.seenIds.add(id);
        if (!Number.isFinite(size) || size < 0 || size > this.peerMax) return this.say({ t: 'reject', id, why: 'too_big' });
        if (this.incoming) return this.say({ t: 'reject', id, why: 'busy' });
        this.h.offer({ id, name: sanitizeFileName(m.name, this.fallbackName), size, mime: String(m.mime ?? '') });
        break;
      }
      case 'reject': this.cancelled.add(m.id); this.waiters.get('ack:' + m.id)?.(m); this.waiters.get(m.id)?.(m); this.wake?.(); break;
      case 'accept': case 'done': this.waiters.get(m.id)?.(m); break;
      case 'ack': this.waiters.get('ack:' + m.id)?.(m); break;
      case 'cancel':
        this.cancelled.add(m.id);
        this.waiters.get('ack:' + m.id)?.(m);
        this.wake?.();
        if (this.incoming?.id === m.id) this.abortIncoming('cancelled_by_peer');
        break;
      case 'end': this.finishIncoming(m); break;
    }
  }

  // ---------- sending ----------
  cancel(id: string) {
    this.cancelled.add(id);
    this.say({ t: 'cancel', id });
    this.wake?.();
    if (this.incoming?.id === id) this.abortIncoming('cancelled');
  }

  async sendFile(file: File): Promise<void> {
    const id = Math.random().toString(36).slice(2, 10);
    const name = sanitizeFileName(file.name, this.fallbackName);
    const base = { id, dir: 'out' as const, name, size: file.size };
    const fail = (reason: string, extra: Partial<Finished> = {}) =>
      this.h.finished({ ...base, ok: false, sha256: '', peerSha256: '', ms: 0, reason, ...extra });
    if (file.size > this.maxBytes) return fail('too_big');
    if (!this.matched || this.dc?.readyState !== 'open') return fail('connection_lost');
    const answer = new Promise<Json>((res) => this.waiters.set(id, res));
    this.say({ t: 'offer', id, name, size: file.size, mime: file.type });
    const a = await answer;
    this.waiters.delete(id);
    if (a.t !== 'accept') return fail(a.t === 'lost' ? 'connection_lost' : String(a.why ?? 'rejected'));

    const dc = this.dc!;
    const hasher = await createSHA256();
    const t0 = performance.now();
    let sent = 0, lastUi = 0;
    this.acked.set(id, 0);
    this.waiters.set('ack:' + id, (m) => { if (m.t === 'ack') this.acked.set(id, +(m.n as number)); this.wake?.(); });
    const report = () => {
      const now = performance.now();
      if (now - lastUi < 100) return;
      lastUi = now;
      const done = this.acked.get(id) ?? 0;
      this.h.progress({ ...base, done, bytesPerSec: done / Math.max(0.001, (now - t0) / 1000) });
    };
    const stop = () => this.cancelled.has(id) || dc.readyState !== 'open' || this.closed;

    for (let off = 0; off < file.size && !stop(); off += READ) {
      const block = new Uint8Array(await file.slice(off, Math.min(file.size, off + READ)).arrayBuffer());
      hasher.update(block);
      for (let i = 0; i < block.length && !stop(); i += CHUNK) {
        // Backpressure: the channel's own queue, then how much the receiver has written to disk.
        while (!stop() && gate(sent, this.acked.get(id) ?? 0, dc.bufferedAmount) !== 'go') await new Promise<void>((r) => (this.wake = r));
        if (stop()) break;
        const piece = block.slice(i, i + CHUNK); // a copy with its own ArrayBuffer
        dc.send(piece.buffer);
        sent += piece.length;
        report();
      }
    }
    this.wake = null;
    this.waiters.delete('ack:' + id);
    this.acked.delete(id);
    const sha = hasher.digest('hex');
    if (stop()) {
      return this.h.finished({ ...base, ok: false, sha256: sha, peerSha256: '', ms: performance.now() - t0, reason: this.cancelled.has(id) ? 'cancelled' : 'connection_lost' });
    }
    const fin = new Promise<Json>((res) => this.waiters.set(id, res));
    this.say({ t: 'end', id, size: file.size, sha256: sha });
    const d = await fin;
    this.waiters.delete(id);
    const ms = performance.now() - t0;
    this.h.progress({ ...base, done: file.size, bytesPerSec: file.size / Math.max(0.001, ms / 1000) });
    this.h.finished({ ...base, ok: d.ok === true, sha256: sha, peerSha256: String(d.sha256 ?? ''), ms, reason: d.ok === true ? undefined : String(d.t === 'lost' ? 'connection_lost' : d.why ?? 'hash_mismatch') });
  }

  // ---------- receiving ----------
  /**
   * Accept an offer. Called straight from the Accept click: the save dialog (Chromium desktop) can
   * only be opened from a click, so it comes first. Dismissing it is not a refusal: the file goes to
   * the browser's private storage and is offered for download when it is complete and checked.
   */
  async accept(o: Offer): Promise<void> {
    let handle: unknown;
    const picker = (window as any).showSaveFilePicker;
    if (typeof picker === 'function' && STORE_MODE === 'auto') {
      try { handle = await picker.call(window, { suggestedName: o.name }); } catch { /* dismissed, blocked or unsupported */ }
    }
    if (this.closed || this.incoming) return;
    const w = (this.worker = new Worker(new URL('./recv.worker.ts', import.meta.url), { type: 'module' }));
    this.incoming = { id: o.id, name: o.name, size: o.size, got: 0, acked: 0, t0: performance.now(), sha: '', endSize: -1, peerOk: false };
    w.onmessage = (e) => this.fromWorker(e.data);
    const ready = new Promise<Json>((res) => (this.resolveWorker = res));
    w.postMessage({ t: 'open', id: o.id, size: o.size, store: STORE_MODE, handle });
    const r = await ready;
    if (r.t !== 'ready') return this.abortIncoming(String(r.why ?? 'storage'));
    this.say({ t: 'accept', id: o.id });
  }
  decline(id: string, why = 'declined') { this.say({ t: 'reject', id, why }); }

  private bytes(buf: ArrayBuffer) {
    if (!this.matched) return this.fail('protocol'); // data before both people said "Match"
    const inc = this.incoming;
    if (!inc || !this.worker) return;
    inc.got += buf.byteLength;
    if (inc.got > inc.size) { this.say({ t: 'cancel', id: inc.id }); return this.abortIncoming('size_mismatch'); }
    this.worker.postMessage({ t: 'chunk', buf }, [buf]);
  }

  private fromWorker(m: any) {
    const inc = this.incoming;
    if ((m.t === 'ready' || m.t === 'failed') && this.resolveWorker) { const r = this.resolveWorker; this.resolveWorker = null; r(m); return; }
    if (!inc) return;
    const prog = (n: number) => this.h.progress({ id: inc.id, dir: 'in', name: inc.name, size: inc.size, done: n, bytesPerSec: n / Math.max(0.001, (performance.now() - inc.t0) / 1000) });
    if (m.t === 'written') {
      if (ackDue(m.n, inc.acked)) { inc.acked = m.n; this.say({ t: 'ack', id: inc.id, n: m.n }); }
      prog(m.n);
    } else if (m.t === 'done') {
      // every byte is in and hashed; the file only becomes a file if size and hash are what was announced
      const ok = m.n === inc.size && inc.endSize === inc.size && m.sha256 === inc.sha;
      if (ok) { inc.sha = m.sha256; this.worker?.postMessage({ t: 'commit', name: inc.name }); return; }
      this.worker?.postMessage({ t: 'abort' });
      this.say({ t: 'done', id: inc.id, ok: false, sha256: m.sha256, why: m.n !== inc.size ? 'size_mismatch' : 'hash_mismatch' });
      this.h.finished({ id: inc.id, dir: 'in', name: inc.name, size: inc.size, ok: false, sha256: m.sha256, peerSha256: inc.sha, ms: performance.now() - inc.t0, reason: m.n !== inc.size ? 'size_mismatch' : 'hash_mismatch' });
      this.endWorker();
    } else if (m.t === 'saved') {
      const ms = performance.now() - inc.t0;
      this.say({ t: 'done', id: inc.id, ok: true, sha256: inc.sha });
      prog(inc.size);
      this.h.finished({ id: inc.id, dir: 'in', name: inc.name, size: inc.size, ok: true, sha256: inc.sha, peerSha256: inc.sha, ms, file: m.file, store: m.store });
      this.endWorker();
    } else if (m.t === 'failed') {
      this.abortIncoming(String(m.why ?? 'storage'));
    }
  }

  private finishIncoming(m: any) {
    const inc = this.incoming;
    if (!inc || inc.id !== m.id) return;
    inc.sha = String(m.sha256 ?? '');
    inc.endSize = Number(m.size);
    this.worker?.postMessage({ t: 'finish' }); // queued after every chunk already posted
  }

  private abortIncoming(why: string) {
    const inc = this.incoming;
    if (!inc) return;
    this.worker?.postMessage({ t: 'abort' });
    this.say({ t: 'reject', id: inc.id, why });
    this.h.finished({ id: inc.id, dir: 'in', name: inc.name, size: inc.size, ok: false, sha256: '', peerSha256: '', ms: performance.now() - inc.t0, reason: why });
    this.endWorker();
  }

  // The worker is let go once it has cleaned up after an abort (or after a few seconds at most).
  private endWorker() {
    const w = this.worker;
    this.incoming = null;
    this.worker = null;
    if (!w) return;
    w.onmessage = (e) => { if (e.data?.t === 'aborted') w.terminate(); };
    setTimeout(() => w.terminate(), 3000);
  }
}

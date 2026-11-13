// The parts of /send that need no browser: flow-control numbers and their decision,
// file name sanitising, and the pairing arithmetic (fingerprints, commitments and the
// number both people compare). Kept free of imports so the unit tests can run them in Node.

export const CHUNK = 16 * 1024; // one message: the size every browser pair agrees on
export const READ = 1 << 20; // the file is read 1 MiB at a time and cut into chunks
export const HIGH = 4 << 20; // stop queueing while this much waits in the channel
export const LOW = 1 << 20; // ...and go on when it is down to this
export const WINDOW = 16 << 20; // bytes sent but not yet written by the receiver
export const ACK_EVERY = 4 << 20; // the receiver reports progress after this much is on disk
export const CONNECT_MS = 20000; // no open channel by then: say so
export const BLOB_LIMIT = 512 * 1024 * 1024; // last-resort in-memory copy
export const NAME_MAX = 200;

// A sender announces the group its file belongs to (n of count, total bytes). The receiver accepts
// the whole group only while its cumulative bytes stay under this cap: every received file lives in
// this tab's memory or private storage until the person saves it. Old peers send no group fields
// and nothing changes for them.
export const GROUP_CAP = 512 * 1024 * 1024;

/** The optional group fields of an offer, or null when they are absent or not believable. */
export function offerGroup(n: unknown, of: unknown, total: unknown): { n: number; of: number; total: number } | null {
  const nn = Number(n), no = Number(of), nt = Number(total);
  if (!Number.isInteger(nn) || !Number.isInteger(no) || !Number.isFinite(nt)) return null;
  if (nn < 1 || no < 1 || nn > no || nt < 0) return null;
  return { n: nn, of: no, total: nt };
}

/** What the sender should do before queueing the next chunk. */
export type Gate = 'go' | 'buffer' | 'ack';

/** Two layers of backpressure: the channel's own queue, then the receiver's write progress. */
export function gate(sent: number, acked: number, buffered: number): Gate {
  if (buffered > HIGH) return 'buffer';
  if (sent - acked > WINDOW) return 'ack';
  return 'go';
}

/** Cuts [0, len) into [start, end) pieces of at most `chunk` bytes. */
export function chunkRanges(len: number, chunk = CHUNK): Array<[number, number]> {
  const out: Array<[number, number]> = [];
  for (let i = 0; i < len; i += chunk) out.push([i, Math.min(len, i + chunk)]);
  return out;
}

/** True when the receiver has written enough since its last report to send another ack. */
export function ackDue(written: number, lastAcked: number): boolean {
  return written - lastAcked >= ACK_EVERY;
}

// ---------------------------------------------------------------- file names

const RESERVED = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i;
// C0 and C1 controls, bidi controls (incl. U+061C), line/paragraph separators, zero-width characters
const INVISIBLE = new RegExp(
  '[\u0000-\u001F\u007F-\u009F\u00AD\u034F\u061C\u115F\u1160\u180E\u200B-\u200F\u2028\u2029\u202A-\u202E' +
    '\u2060-\u2064\u2066-\u2069\u3164\uFE00-\uFE0F\uFEFF\uFFA0\u{E0000}-\u{E007F}]',
  'gu'
);

/**
 * A name from the other device is never trusted. It is only ever shown and used as a suggested
 * file name (never as a path): this removes what could disguise it or break a file system.
 * `fallback` is the (translated) name used when nothing is left.
 */
export function sanitizeFileName(raw: unknown, fallback = 'file'): string {
  let s = typeof raw === 'string' ? raw : '';
  s = s.normalize('NFC').replace(INVISIBLE, '').replace(/[<>:"/\\|?*]/g, '_');
  s = s.replace(/^[. ]+|[. ]+$/g, '');
  if (!s) return fallback;
  if (RESERVED.test(s.split('.')[0])) s = '_' + s;
  const chars = [...s];
  if (chars.length > NAME_MAX) {
    const dot = s.lastIndexOf('.');
    const ext = dot > 0 && s.length - dot <= 16 ? [...s.slice(dot)] : [];
    s = chars.slice(0, NAME_MAX - ext.length).join('').replace(/[. ]+$/g, '') + ext.join('');
  }
  return s || fallback;
}

/** Most answers a device gives to the other's repeated reveals in one session. */
export const MAX_REVEAL_ANSWERS = 3;

/**
 * Should a device answer an incoming `reveal` with its own? Only a plain repeat (the other side has not
 * seen ours yet) and only while the other side has not pressed "Match" (which proves it has). An answer
 * is marked and is never answered itself, so a message can never bounce back and forth.
 */
export function shouldAnswerReveal(isAnswer: boolean, peerMatched: boolean, answered: number): boolean {
  return !isAnswer && !peerMatched && answered < MAX_REVEAL_ANSWERS;
}

/** An offer id from the other device: short, plain, and not used before in this session. */
export function validOfferId(id: unknown, seen: ReadonlySet<string>): id is string {
  return typeof id === 'string' && /^[a-z0-9]{1,16}$/.test(id) && !seen.has(id);
}

// ---------------------------------------------------------------- pairing

/** The sha-256 DTLS fingerprint named in a session description, upper-case, or ''. */
export function fingerprintOf(sdp: string | undefined): string {
  return (sdp?.match(/a=fingerprint:sha-256 ([0-9A-Fa-f:]+)/i)?.[1] ?? '').toUpperCase();
}

const hexOf = (b: Uint8Array) => [...b].map((x) => x.toString(16).padStart(2, '0')).join('');
const sha256 = async (s: string) => new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s)));

export function newNonce(): string {
  return hexOf(crypto.getRandomValues(new Uint8Array(16)));
}

/** What a device sends before any session description: a hash that fixes its fingerprint without showing it. */
export async function commitOf(fingerprint: string, nonce: string): Promise<string> {
  return hexOf(await sha256(`fh-commit|${fingerprint.toUpperCase()}|${nonce}`));
}

/** Does the revealed nonce, with the fingerprint now seen in the description, match the earlier commitment? */
export async function revealMatches(commit: string, fingerprint: string, nonce: string): Promise<boolean> {
  return !!commit && /^[0-9a-f]{32}$/.test(nonce) && (await commitOf(fingerprint, nonce)) === commit;
}

/** The six digits both people compare: the two fingerprints (order-independent) and the room code. */
export async function verificationNumber(fpA: string, fpB: string, code: string): Promise<string> {
  const d = await sha256([fpA.toUpperCase(), fpB.toUpperCase()].sort().join('|') + '|' + code);
  const n = ((d[0] << 24) | (d[1] << 16) | (d[2] << 8) | d[3]) >>> 0;
  const s = String(n % 1000000).padStart(6, '0');
  return s.slice(0, 3) + ' ' + s.slice(3);
}

export type Route = 'host' | 'srflx' | 'prflx' | 'relay' | 'unknown';

/** Which route the selected candidate pair uses. */
export function routeOf(local?: string, remote?: string): Route {
  const kinds = [local, remote];
  if (kinds.includes('relay')) return 'relay';
  if (kinds.includes('srflx')) return 'srflx';
  if (kinds.includes('prflx')) return 'prflx';
  if (kinds.every((k) => k === 'host')) return 'host';
  return 'unknown';
}

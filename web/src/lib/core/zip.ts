/* Reading ZIP and TAR by hand, with limits applied before anything is inflated.

   The important detail: `unzipSync` allocates the whole result, so a bomb would
   already have filled memory by the time we could measure it. The central
   directory states every entry's uncompressed size, so we read that first and
   refuse before inflating a single byte. */

export interface Entry {
  name: string;
  size: number;
  data?: Uint8Array;
  dir: boolean;
}

const MAX_TOTAL = 1024 * 1024 * 1024; // 1 GB inflated, for a browser tab
const MAX_ENTRY = 512 * 1024 * 1024;  // 512 MB for any single file
const MAX_RATIO = 250;                // beyond this, treat it as a bomb
const RATIO_FLOOR = 32 * 1024 * 1024; // …but only once it is big enough to matter

export class ArchiveLimitError extends Error {
  constructor(kind: 'too_big' | 'ratio' | 'bad_zip' | 'unsafe_path') {
    super(`archive_${kind}`);
    this.name = 'ArchiveLimitError';
  }
}

/** Reject names that would write outside the archive (`../`, absolute paths). */
export function assertSafeName(name: string): string {
  const n = name.replace(/\\/g, '/');
  if (n.startsWith('/') || /^[a-zA-Z]:\//.test(n) || /(^|\/)\.\.(\/|$)/.test(n)) {
    throw new ArchiveLimitError('unsafe_path');
  }
  return n;
}

/** What a ZIP says it will expand to, read from the end-of-central-directory. */
export function zipDeclaredSize(buf: Uint8Array): { entries: number; total: number; largest: number } {
  // scan backwards for the EOCD signature 0x06054b50, within the last 64 KB + 22
  const maxScan = Math.min(buf.length, 65_557);
  for (let i = buf.length - 22; i >= buf.length - maxScan && i >= 0; i--) {
    if (buf[i] === 0x50 && buf[i + 1] === 0x4b && buf[i + 2] === 0x05 && buf[i + 3] === 0x06) {
      const dv = new DataView(buf.buffer, buf.byteOffset + i, 22);
      const entries = dv.getUint16(10, true);
      const cdOffset = dv.getUint32(16, true);
      const cdSize = dv.getUint32(12, true);
      if (cdOffset === 0xffffffff || cdSize === 0xffffffff) {
        // ZIP64: sizes live in an extra field we do not parse. Fall back to a
        // bounded inflate that we then verify, rather than trusting the header.
        return { entries, total: -1, largest: -1 };
      }
      let total = 0;
      let largest = 0;
      let p = cdOffset;
      for (let n = 0; n < entries; n++) {
        if (p + 46 > buf.length) break;
        if (!(buf[p] === 0x50 && buf[p + 1] === 0x4b && buf[p + 2] === 0x01 && buf[p + 3] === 0x02)) break;
        const cv = new DataView(buf.buffer, buf.byteOffset + p, 46);
        const uncompressed = cv.getUint32(24, true);
        total += uncompressed;
        if (uncompressed > largest) largest = uncompressed;
        const nameLen = cv.getUint16(28, true);
        const extraLen = cv.getUint16(30, true);
        const commentLen = cv.getUint16(32, true);
        p += 46 + nameLen + extraLen + commentLen;
      }
      return { entries, total, largest };
    }
  }
  throw new ArchiveLimitError('bad_zip');
}

/** Refuse an archive whose declared expansion is beyond what one tab should hold. */
export function checkLimits(declaredTotal: number, compressed: number, largest: number, entries: number): void {
  if (entries > 100_000) throw new ArchiveLimitError('too_big');
  if (declaredTotal > MAX_TOTAL) throw new ArchiveLimitError('too_big');
  if (largest > MAX_ENTRY) throw new ArchiveLimitError('too_big');
  if (declaredTotal > RATIO_FLOOR && compressed > 0 && declaredTotal / compressed > MAX_RATIO) {
    throw new ArchiveLimitError('ratio');
  }
}

/** After inflating, verify the guess was not wrong (a lying header). */
export function checkActual(total: number, largest: number, compressed: number, entries: number): void {
  checkLimits(total, compressed, largest, entries);
}

/** ustar reader: fixed 512-byte headers, size in octal, two zero blocks to end. */
export function readTar(buf: Uint8Array): Entry[] {
  const out: Entry[] = [];
  const dec = new TextDecoder();
  let off = 0;
  let total = 0;

  while (off + 512 <= buf.length) {
    const header = buf.subarray(off, off + 512);
    if (header.every(b => b === 0)) break;
    const rawName = dec.decode(header.subarray(0, 100)).replace(/\0.*$/, '');
    if (!rawName) break;
    const sizeStr = dec.decode(header.subarray(124, 136)).replace(/\0.*$/, '').trim();
    const size = parseInt(sizeStr, 8) || 0;
    const type = String.fromCharCode(header[156] || 48);
    const prefix = dec.decode(header.subarray(345, 500)).replace(/\0.*$/, '');
    const name = assertSafeName(prefix ? `${prefix}/${rawName}` : rawName);
    const dataStart = off + 512;
    const isDir = type === '5' || name.endsWith('/');
    if (!isDir) {
      total += size;
      if (total > MAX_TOTAL || size > MAX_ENTRY) throw new ArchiveLimitError('too_big');
    }
    out.push({ name, size: isDir ? 0 : size, data: isDir ? undefined : buf.subarray(dataStart, dataStart + size), dir: isDir });
    off = dataStart + Math.ceil(size / 512) * 512;
  }
  return out;
}

/* Camera RAW files (CR2, CR3, NEF, ARW, DNG, ORF, RW2, RAF, PEF, SRW, NRW) all
   carry a full JPEG preview the camera wrote itself. FileHop converts that
   preview: it is what the camera shows on its own screen, with the camera's
   colour processing already applied, and reading it needs no RAW developer.
   The preview is often full size (Canon, Nikon) but can be smaller (Sony ARW is
   about 1616 px wide), so the card says it is a preview.

   Nothing here parses TIFF. It looks for JPEG streams, walks each one marker
   by marker so the end is exact, and keeps the ones a browser can decode. */

export const RAW_EXT = new Set([
  'cr2', 'cr3', 'nef', 'nrw', 'arw', 'dng', 'orf', 'rw2', 'raf', 'pef', 'srw'
]);

export interface JpegSpan {
  offset: number;
  length: number;
  width: number;
  height: number;
}

interface Walked {
  end: number;
  width: number;
  height: number;
}

/** Walk one JPEG from its SOI to its EOI. Returns null for anything that is not a
    baseline, extended or progressive JPEG (lossless JPEG, used for raw sensor data
    inside CR2 and DNG, is SOF3 and no browser decodes it). */
function walk(b: Uint8Array, start: number): Walked | null {
  const n = b.length;
  let i = start + 2;
  let width = 0;
  let height = 0;
  let sof = false;
  while (i + 1 < n) {
    if (b[i] !== 0xff) return null;
    while (i + 1 < n && b[i + 1] === 0xff) i++; // fill bytes
    const m = b[i + 1];
    if (m === 0xd9) return sof ? { end: i + 2, width, height } : null;
    if (m === 0x00 || m === 0x01 || (m >= 0xd0 && m <= 0xd8)) {
      i += 2;
      continue;
    }
    if (i + 3 >= n) return null;
    const len = (b[i + 2] << 8) | b[i + 3];
    if (len < 2) return null;
    const isSof = m >= 0xc0 && m <= 0xcf && m !== 0xc4 && m !== 0xc8 && m !== 0xcc;
    if (isSof) {
      if (m !== 0xc0 && m !== 0xc1 && m !== 0xc2) return null;
      height = (b[i + 5] << 8) | b[i + 6];
      width = (b[i + 7] << 8) | b[i + 8];
      if (!width || !height) return null;
      sof = true;
    }
    i += 2 + len;
    if (m === 0xda) {
      // entropy-coded data: runs until the next real marker
      while (i + 1 < n) {
        if (b[i] === 0xff) {
          const c = b[i + 1];
          if (c === 0x00 || (c >= 0xd0 && c <= 0xd7)) {
            i += 2;
            continue;
          }
          if (c === 0xff) {
            i++;
            continue;
          }
          break;
        }
        i++;
      }
    }
  }
  return null;
}

/** Every complete, decodable JPEG inside the bytes, largest picture first. */
export function findEmbeddedJpegs(b: Uint8Array): JpegSpan[] {
  const found: JpegSpan[] = [];
  const n = b.length - 3;
  for (let i = 0; i < n; i++) {
    if (b[i] !== 0xff || b[i + 1] !== 0xd8 || b[i + 2] !== 0xff) continue;
    const w = walk(b, i);
    if (!w) continue;
    found.push({ offset: i, length: w.end - i, width: w.width, height: w.height });
    i = w.end - 1; // a JPEG nested inside this one is a thumbnail of it: skip past it
  }
  return found.sort((a, c) => c.width * c.height - a.width * a.height);
}

/** EXIF orientation (1..8) from a TIFF block starting at `base`; 0 when absent or unreadable. */
export function tiffOrientation(b: Uint8Array, base: number): number {
  if (base < 0 || base + 8 > b.length) return 0;
  const le = b[base] === 0x49 && b[base + 1] === 0x49;
  if (!le && !(b[base] === 0x4d && b[base + 1] === 0x4d)) return 0;
  const u16 = (o: number) => (o + 2 > b.length ? 0 : le ? b[o] | (b[o + 1] << 8) : (b[o] << 8) | b[o + 1]);
  const u32 = (o: number) =>
    o + 4 > b.length ? 0 : le
      ? (b[o] | (b[o + 1] << 8) | (b[o + 2] << 16) | (b[o + 3] << 24)) >>> 0
      : ((b[o] << 24) | (b[o + 1] << 16) | (b[o + 2] << 8) | b[o + 3]) >>> 0;
  const ifd = base + u32(base + 4);
  const count = u16(ifd);
  if (count === 0 || count > 512) return 0;
  for (let i = 0; i < count; i++) {
    const e = ifd + 2 + i * 12;
    if (u16(e) === 0x0112) {
      const v = u16(e + 8);
      return v >= 1 && v <= 8 ? v : 0;
    }
  }
  return 0;
}

/** Orientation written in a JPEG's own EXIF block; 0 when it has none. */
export function jpegOrientation(b: Uint8Array): number {
  let i = 2;
  const end = Math.min(b.length, 1 << 17);
  while (i + 4 < end && b[i] === 0xff) {
    const m = b[i + 1];
    const len = (b[i + 2] << 8) | b[i + 3];
    if (m === 0xe1 && b[i + 4] === 0x45 && b[i + 5] === 0x78 && b[i + 6] === 0x69 && b[i + 7] === 0x66) {
      return tiffOrientation(b, i + 10);
    }
    if (m === 0xda || len < 2) break;
    i += 2 + len;
  }
  return 0;
}

/** Canvas transform [a, b, c, d, e, f] that draws a w × h picture upright, and whether it swaps the sides. */
export function orientationMatrix(o: number, w: number, h: number): { m: [number, number, number, number, number, number]; swap: boolean } {
  switch (o) {
    case 2: return { m: [-1, 0, 0, 1, w, 0], swap: false };
    case 3: return { m: [-1, 0, 0, -1, w, h], swap: false };
    case 4: return { m: [1, 0, 0, -1, 0, h], swap: false };
    case 5: return { m: [0, 1, 1, 0, 0, 0], swap: true };
    case 6: return { m: [0, 1, -1, 0, h, 0], swap: true };
    case 7: return { m: [0, -1, -1, 0, h, w], swap: true };
    case 8: return { m: [0, -1, 1, 0, 0, w], swap: true };
    default: return { m: [1, 0, 0, 1, 0, 0], swap: false };
  }
}

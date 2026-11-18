/* WebAssembly engines, loaded the first time a file needs them and never before.
   Every engine ships inside this app and is fetched from this same origin, so the
   page still loads nothing from any other site and a file never leaves the tab.
   Licences are listed in CREDITS.md. */

import heifWasmUrl from 'libheif-js/libheif-wasm/libheif.wasm?url';
import jxlDecWasmUrl from '@jsquash/jxl/codec/dec/jxl_dec.wasm?url';
import jxlEncWasmUrl from '@jsquash/jxl/codec/enc/jxl_enc.wasm?url';

export interface Pixels {
  data: Uint8ClampedArray;
  width: number;
  height: number;
  /** EXIF orientation 1..8 when the format records one the decoder did not apply */
  orientation?: number;
}

async function fetchBytes(url: string): Promise<ArrayBuffer> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`engine_missing:${url}`);
  return res.arrayBuffer();
}

/* ---- HEIC / HEIF, read only (libheif, LGPL-3.0). ---- */

interface HeifImage {
  get_width(): number;
  get_height(): number;
  display(target: { data: Uint8ClampedArray; width: number; height: number }, cb: (r: unknown) => void): void;
}
interface HeifModule {
  HeifDecoder: new () => { decode(data: Uint8Array): HeifImage[] };
}

let heif: Promise<HeifModule> | undefined;

function loadHeif(): Promise<HeifModule> {
  heif ??= (async () => {
    const [{ default: factory }, wasmBinary] = await Promise.all([
      import('libheif-js/libheif-wasm/libheif.js'),
      fetchBytes(heifWasmUrl)
    ]);
    return (await (factory as (o: object) => Promise<HeifModule>)({ wasmBinary })) as HeifModule;
  })();
  heif.catch(() => { heif = undefined; });
  return heif;
}

export async function decodeHeic(bytes: Uint8Array): Promise<Pixels> {
  const lib = await loadHeif();
  const images = new lib.HeifDecoder().decode(bytes);
  if (!images?.length) throw new Error('cannot_decode:heic');
  const img = images[0];
  const width = img.get_width();
  const height = img.get_height();
  if (!width || !height) throw new Error('cannot_decode:heic');
  const target = { data: new Uint8ClampedArray(width * height * 4), width, height };
  await new Promise<void>((res, rej) => {
    img.display(target, out => (out ? res() : rej(new Error('cannot_decode:heic'))));
  });
  return target;
}

/* ---- JPEG XL, read and write (libjxl through jSquash, Apache-2.0). ----
   The single-thread encoder is used on purpose: the multi-thread build starts its
   own workers, which the page's Content Security Policy would have to allow. */

interface JxlDecoder { decode(b: ArrayBuffer): Pixels | null }
interface JxlEncoder { encode(data: Uint8ClampedArray, w: number, h: number, o: object): Uint8Array | null }

let jxlDec: Promise<JxlDecoder> | undefined;
let jxlEnc: Promise<JxlEncoder> | undefined;

export async function decodeJxl(bytes: Uint8Array): Promise<Pixels> {
  jxlDec ??= (async () => {
    const { default: factory } = await import('@jsquash/jxl/codec/dec/jxl_dec.js');
    return (await (factory as (o: object) => Promise<JxlDecoder>)({
      noInitialRun: true,
      locateFile: (f: string) => (f.endsWith('.wasm') ? jxlDecWasmUrl : f)
    })) as JxlDecoder;
  })();
  jxlDec.catch(() => { jxlDec = undefined; });
  const mod = await jxlDec;
  const copy = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
  const out = mod.decode(copy);
  if (!out) throw new Error('cannot_decode:jxl');
  return out;
}

export async function encodeJxl(px: Pixels, quality: number): Promise<Uint8Array> {
  jxlEnc ??= (async () => {
    const { default: factory } = await import('@jsquash/jxl/codec/enc/jxl_enc.js');
    return (await (factory as (o: object) => Promise<JxlEncoder>)({
      noInitialRun: true,
      locateFile: (f: string) => (f.endsWith('.wasm') ? jxlEncWasmUrl : f)
    })) as JxlEncoder;
  })();
  jxlEnc.catch(() => { jxlEnc = undefined; });
  const mod = await jxlEnc;
  const { defaultOptions } = await import('@jsquash/jxl/meta.js');
  const lossless = quality >= 100;
  const view = mod.encode(px.data, px.width, px.height, { ...defaultOptions, quality, lossless });
  if (!view) throw new Error('encoder_missing:image/jxl');
  return new Uint8Array(view.buffer, view.byteOffset, view.byteLength).slice();
}

/* ---- GIF, write only (gifenc, MIT). One frame, 256 colours. ---- */

export async function encodeGif(px: Pixels): Promise<Uint8Array> {
  const { GIFEncoder, quantize, applyPalette } = await import('gifenc');
  const palette = quantize(px.data, 256, { format: 'rgba4444', oneBitAlpha: true });
  const index = applyPalette(px.data, palette, 'rgba4444');
  const transparentIndex = palette.findIndex(c => c[3] === 0);
  const gif = GIFEncoder();
  gif.writeFrame(index, px.width, px.height, {
    palette,
    transparent: transparentIndex >= 0,
    transparentIndex: transparentIndex >= 0 ? transparentIndex : 0
  });
  gif.finish();
  return gif.bytes();
}

/* ---- TIFF, read only (UTIF.js, MIT). Chrome and Firefox have no TIFF decoder; Safari does. ---- */

export async function decodeTiff(bytes: Uint8Array): Promise<Pixels> {
  const { default: UTIF } = await import('utif2');
  const buf = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
  // UTIF's CMYK branch asks `window.UDOC`; a worker has no `window`, so give it an empty one just for this call
  const g = globalThis as { window?: unknown };
  const added = !('window' in g);
  if (added) g.window = {};
  try {
    const ifds = UTIF.decode(buf);
    if (!ifds.length) throw new Error('cannot_decode:tiff');
    const ifd = ifds[0];
    UTIF.decodeImage(buf, ifd);
    const rgba = UTIF.toRGBA8(ifd);
    if (!ifd.width || !ifd.height) throw new Error('cannot_decode:tiff');
    const o = ifd.t274?.[0];
    return {
      data: new Uint8ClampedArray(rgba.buffer, rgba.byteOffset, rgba.byteLength),
      width: ifd.width,
      height: ifd.height,
      orientation: typeof o === 'number' ? o : undefined
    };
  } finally {
    if (added) delete g.window;
  }
}

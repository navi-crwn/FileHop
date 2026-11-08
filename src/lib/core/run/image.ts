import { PDFDocument } from 'pdf-lib';
import type { JobResult } from '../types';
import { baseName } from '../detect';
import { throwIfAborted, type RunCtx } from '../run';
import { AVIF_ENCODABLE } from '../features';
import { decodeSvg, makeCanvas, context2d, encodeCanvas } from '../canvas';

/* Image work runs on canvas and createImageBitmap: the browser's own decoders,
   which is why JPEG/PNG/WebP/GIF/BMP and (where shipped) AVIF/JXL/HEIC all open
   without a megabyte of WebAssembly. Re-encoding through a canvas also drops
   EXIF/GPS, because a canvas has nowhere to keep it. */

interface Decoded {
  bitmap: ImageBitmap;
  width: number;
  height: number;
}

async function decode(file: File): Promise<Decoded> {
  // SVG has no bitmap decoder; it goes through <img>, in the page (see canvas.ts).
  if (file.type === 'image/svg+xml' || /\.svg$/i.test(file.name)) {
    return decodeSvg(file);
  }
  try {
    const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
    return { bitmap, width: bitmap.width, height: bitmap.height };
  } catch (e) {
    throw new Error(`cannot_decode:${(e as Error).message}`);
  }
}

/** Downscale to a maximum width, keeping the aspect ratio. */
function targetSize(w: number, h: number, maxW: number | undefined): [number, number] {
  if (!maxW || maxW <= 0 || w <= maxW) return [w, h];
  const s = maxW / w;
  return [Math.max(1, Math.round(w * s)), Math.max(1, Math.round(h * s))];
}

/** Downscale in halving steps: one huge jump loses detail, several small ones do not. */
function drawTo(bitmap: ImageBitmap, w: number, h: number, background?: string): OffscreenCanvas | HTMLCanvasElement {
  let srcW = bitmap.width;
  let srcH = bitmap.height;
  let cur: ImageBitmap | HTMLCanvasElement | OffscreenCanvas = bitmap;

  while (srcW > w * 2 && srcH > h * 2) {
    const nw = Math.round(srcW / 2);
    const nh = Math.round(srcH / 2);
    const step = makeCanvas(nw, nh);
    const ctx = context2d(step);
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(cur as CanvasImageSource, 0, 0, nw, nh);
    cur = step;
    srcW = nw;
    srcH = nh;
  }

  const canvas = makeCanvas(w, h);
  const ctx = context2d(canvas);
  ctx.imageSmoothingQuality = 'high';
  if (background) {
    ctx.fillStyle = background;
    ctx.fillRect(0, 0, w, h);
  }
  ctx.drawImage(cur as CanvasImageSource, 0, 0, w, h);
  return canvas;
}

const MIME: Record<string, string> = {
  webp: 'image/webp',
  jpeg: 'image/jpeg',
  jpg: 'image/jpeg',
  png: 'image/png',
  avif: 'image/avif'
};

export async function runImage(ctx: RunCtx): Promise<JobResult> {
  const { file, action, opts, onProgress, signal } = ctx;
  const target = action.slice('image:'.length);
  onProgress(0.05, 'decode');

  if (target === 'pdf') return imageToPdf(ctx);

  const mime = MIME[target];
  if (!mime) throw new Error(`unsupported_target:${target}`);
  if (target === 'avif' && !AVIF_ENCODABLE) {
    // an error, not a PNG quietly named .avif
    throw new Error('avif_not_supported');
  }

  const { bitmap } = await decode(file);
  throwIfAborted(signal);
  onProgress(0.35, 'resize');

  const maxW = typeof opts.width === 'number' ? opts.width : undefined;
  const [w, h] = targetSize(bitmap.width, bitmap.height, maxW);
  // JPEG cannot carry alpha: flatten onto white so a transparent PNG does not turn black
  const canvas = drawTo(bitmap, w, h, target === 'jpeg' ? '#ffffff' : undefined);
  throwIfAborted(signal);
  onProgress(0.65, 'encode');

  const quality = typeof opts.quality === 'number' ? opts.quality : 82;
  const blob = await encodeCanvas(canvas, mime, target === 'png' ? 100 : quality);
  if (blob.type !== mime) throw new Error(`encoder_missing:${mime}`);
  bitmap.close?.();

  return {
    blob,
    name: `${baseName(file.name)}.${target === 'jpeg' ? 'jpg' : target}`,
    size: blob.size,
    saving: 0,
    note: `${w}×${h}`
  };
}

async function imageToPdf(ctx: RunCtx): Promise<JobResult> {
  const { file, onProgress, signal } = ctx;
  const { bitmap } = await decode(file);
  throwIfAborted(signal);
  onProgress(0.4, 'encode');

  // pdf-lib embeds JPEG and PNG byte for byte; anything else goes through JPEG.
  let bytes: Uint8Array;
  let kind: 'jpg' | 'png';
  if (bitmap.width === 0) throw new Error('empty_image');
  const isJpeg = file.type === 'image/jpeg' || /\.jpe?g$/i.test(file.name);
  const isPng = file.type === 'image/png' || /\.png$/i.test(file.name);
  if (isJpeg || isPng) {
    bytes = new Uint8Array(await file.arrayBuffer());
    kind = isJpeg ? 'jpg' : 'png';
  } else {
    const canvas = drawTo(bitmap, bitmap.width, bitmap.height, '#ffffff');
    const blob = await encodeCanvas(canvas, 'image/jpeg', 90);
    bytes = new Uint8Array(await blob.arrayBuffer());
    kind = 'jpg';
  }

  const pdf = await PDFDocument.create();
  const img = kind === 'jpg' ? await pdf.embedJpg(bytes) : await pdf.embedPng(bytes);
  // one page, image fitted to A4 with a 24pt margin, portrait or landscape by aspect
  const A4 = { w: 595.28, h: 841.89 };
  const landscape = img.width > img.height;
  const pageW = landscape ? A4.h : A4.w;
  const pageH = landscape ? A4.w : A4.h;
  const margin = 24;
  const scale = Math.min((pageW - margin * 2) / img.width, (pageH - margin * 2) / img.height);
  const w = img.width * scale;
  const h = img.height * scale;
  const page = pdf.addPage([pageW, pageH]);
  page.drawImage(img, { x: (pageW - w) / 2, y: (pageH - h) / 2, width: w, height: h });
  pdf.setProducer('FileHop');
  pdf.setCreator('FileHop — processed in the browser');
  onProgress(0.85, 'save');
  const out = await pdf.save();
  bitmap.close?.();
  return {
    blob: new Blob([out as unknown as BlobPart], { type: 'application/pdf' }),
    name: `${baseName(file.name)}.pdf`,
    size: out.length,
    saving: 0
  };
}

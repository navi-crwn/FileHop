/* Decoding helpers that touch the DOM. Shared by the worker (OffscreenCanvas,
   no <img>) and the page (canvas), so each path is written once. */

export interface Decoded {
  bitmap: ImageBitmap;
  width: number;
  height: number;
}

/* An SVG has no bitmap decoder, so it is rendered through an <img>. An <img>
   never runs scripts or fetches subresources from an SVG, which is what makes
   this the safe path for untrusted vector files as well as the only one. */

function canUseImage(): boolean {
  return typeof Image !== 'undefined';
}

export async function decodeSvg(file: File): Promise<Decoded> {
  if (!canUseImage()) {
    // In a worker there is no <img>. OffscreenCanvas cannot render an SVG
    // document either, so say so plainly instead of producing a broken file.
    throw new Error('svg_needs_main_thread');
  }
  const url = URL.createObjectURL(new Blob([await file.arrayBuffer()], { type: 'image/svg+xml' }));
  try {
    const img = new Image();
    img.decoding = 'sync';
    await new Promise<void>((res, rej) => {
      img.onload = () => res();
      img.onerror = () => rej(new Error('cannot_decode:svg'));
      img.src = url;
    });
    // An SVG without width/height reports 0; give it a sane canvas.
    const w = img.naturalWidth || 1024;
    const h = img.naturalHeight || 1024;
    const max = 4096;
    const scale = Math.min(1, max / Math.max(w, h));
    const bitmap = await createImageBitmap(img, {
      resizeWidth: Math.round(w * scale),
      resizeHeight: Math.round(h * scale),
      resizeQuality: 'high'
    });
    return { bitmap, width: bitmap.width, height: bitmap.height };
  } finally {
    URL.revokeObjectURL(url);
  }
}

export function makeCanvas(w: number, h: number): OffscreenCanvas | HTMLCanvasElement {
  if (typeof OffscreenCanvas !== 'undefined') return new OffscreenCanvas(w, h);
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return c;
}

export function context2d(canvas: OffscreenCanvas | HTMLCanvasElement) {
  const ctx = (canvas as OffscreenCanvas).getContext('2d') as
    | OffscreenCanvasRenderingContext2D
    | CanvasRenderingContext2D
    | null;
  if (!ctx) throw new Error('no_2d_context');
  return ctx;
}

export async function encodeCanvas(
  canvas: OffscreenCanvas | HTMLCanvasElement,
  type: string,
  quality: number
): Promise<Blob> {
  const q = Math.min(1, Math.max(0.01, quality / 100));
  if ('convertToBlob' in canvas) {
    return canvas.convertToBlob({ type, quality: q });
  }
  return new Promise((res, rej) => {
    (canvas as HTMLCanvasElement).toBlob(b => (b ? res(b) : rej(new Error('encode_failed'))), type, q);
  });
}

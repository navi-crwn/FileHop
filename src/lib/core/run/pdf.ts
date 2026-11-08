import { PDFDocument, degrees } from 'pdf-lib';
import { zipSync } from 'fflate';
import type { JobResult } from '../types';
import { baseName } from '../detect';
import { throwIfAborted, type RunCtx } from '../run';
import { parsePages } from '../pages';
import { makeCanvas, context2d, encodeCanvas } from '../canvas';

/* PDFs are read with pdf.js (Apache-2.0) and written with pdf-lib (MIT).
   No MuPDF, no Ghostscript: nothing here is AGPL. */

let pdfjsPromise: Promise<typeof import('pdfjs-dist')> | null = null;

async function pdfjs() {
  if (!pdfjsPromise) {
    pdfjsPromise = import('pdfjs-dist').then(mod => {
      mod.GlobalWorkerOptions.workerSrc = '/vendor/pdf.worker.min.mjs';
      return mod;
    });
  }
  return pdfjsPromise;
}

async function openDoc(file: File) {
  const lib = await pdfjs();
  const data = new Uint8Array(await file.arrayBuffer());
  // pdf.js 6 has no eval path at all (the isEvalSupported switch is gone from the
  // API because the code it guarded was removed), so a PDF cannot run script here.
  const task = lib.getDocument({ data, useSystemFonts: true });
  const doc = await task.promise;
  return { doc, task };
}

/** "1-3,7,9-" → zero-based page indices, clamped to the document. */

export async function runPdf(ctx: RunCtx): Promise<JobResult> {
  const { file, action, opts } = ctx;
  switch (action) {
    case 'pdf:merge':
      return merge(ctx);
    case 'pdf:split':
      return split(ctx);
    case 'pdf:rotate':
      return rotate(ctx);
    case 'pdf:extract':
      return extract(ctx, String(opts.pages ?? '1-3'));
    case 'pdf:png':
      return rasterize(ctx, 'image/png', 'png');
    case 'pdf:jpeg':
      return rasterize(ctx, 'image/jpeg', 'jpg');
    case 'pdf:meta':
      return meta(ctx);
    default:
      throw new Error(`unsupported_action:${action}`);
  }
}

async function merge(ctx: RunCtx): Promise<JobResult> {
  const { file, group, onProgress, signal } = ctx;
  const files = group.length > 1 ? group : [file];
  if (files.length === 1) throw new Error('merge_needs_two');
  const out = await PDFDocument.create();
  let i = 0;
  for (const f of files) {
    throwIfAborted(signal);
    const src = await PDFDocument.load(await f.arrayBuffer(), { ignoreEncryption: true });
    const pages = await out.copyPages(src, src.getPageIndices());
    pages.forEach(p => out.addPage(p));
    i++;
    onProgress(i / (files.length + 1), 'merge');
  }
  out.setProducer('FileHop');
  out.setCreator('FileHop — processed in the browser');
  onProgress(0.9, 'save');
  const bytes = await out.save();
  return {
    blob: new Blob([bytes as unknown as BlobPart], { type: 'application/pdf' }),
    name: `${baseName(file.name)}-merged.pdf`,
    size: bytes.length,
    saving: 0,
    pages: out.getPageCount(),
    note: `${files.length} files`
  };
}

async function split(ctx: RunCtx): Promise<JobResult> {
  const { file, onProgress, signal } = ctx;
  const src = await PDFDocument.load(await file.arrayBuffer(), { ignoreEncryption: true });
  const total = src.getPageCount();
  const entries: Record<string, Uint8Array> = {};
  const stem = baseName(file.name);
  for (let i = 0; i < total; i++) {
    throwIfAborted(signal);
    const one = await PDFDocument.create();
    const [p] = await one.copyPages(src, [i]);
    one.addPage(p);
    one.setProducer('FileHop');
    entries[`${stem}-p${String(i + 1).padStart(2, '0')}.pdf`] = await one.save();
    onProgress(0.05 + 0.85 * ((i + 1) / total), 'split');
  }
  const zipped = zipSync(entries, { level: 6 });
  return {
    blob: new Blob([zipped as unknown as BlobPart], { type: 'application/zip' }),
    name: `${stem}-pages.zip`,
    size: zipped.length,
    saving: 0,
    pages: total,
    note: `${total} files`
  };
}

async function rotate(ctx: RunCtx): Promise<JobResult> {
  const { file, onProgress } = ctx;
  const doc = await PDFDocument.load(await file.arrayBuffer(), { ignoreEncryption: true });
  for (const page of doc.getPages()) {
    page.setRotation(degrees((page.getRotation().angle + 90) % 360));
  }
  doc.setProducer('FileHop');
  onProgress(0.8, 'save');
  const bytes = await doc.save();
  return {
    blob: new Blob([bytes as unknown as BlobPart], { type: 'application/pdf' }),
    name: `${baseName(file.name)}-rotated.pdf`,
    size: bytes.length,
    saving: 0
  };
}

async function extract(ctx: RunCtx, spec: string): Promise<JobResult> {
  const { file, onProgress } = ctx;
  const src = await PDFDocument.load(await file.arrayBuffer(), { ignoreEncryption: true });
  const idx = parsePages(spec, src.getPageCount());
  const out = await PDFDocument.create();
  const pages = await out.copyPages(src, idx);
  pages.forEach(p => out.addPage(p));
  out.setProducer('FileHop');
  onProgress(0.85, 'save');
  const bytes = await out.save();
  return {
    blob: new Blob([bytes as unknown as BlobPart], { type: 'application/pdf' }),
    name: `${baseName(file.name)}-selection.pdf`,
    size: bytes.length,
    saving: 0,
    pages: idx.length
  };
}

async function rasterize(ctx: RunCtx, mime: string, ext: string): Promise<JobResult> {
  const { file, onProgress, signal } = ctx;
  const { doc, task } = await openDoc(file);
  const total = doc.numPages;
  const entries: Record<string, Uint8Array> = {};
  const stem = baseName(file.name);
  // A 2x scale keeps text crisp on retina without blowing memory on long documents.
  const scale = 2;

  for (let n = 1; n <= total; n++) {
    throwIfAborted(signal);
    const page = await doc.getPage(n);
    const viewport = page.getViewport({ scale });
    // pdf.js wants a real canvas element; in a worker we use OffscreenCanvas
    // where pdf.js supports it, else a detached <canvas> from the page.
    const canvas = makeCanvas(Math.ceil(viewport.width), Math.ceil(viewport.height));
    const c2d = context2d(canvas);
    c2d.fillStyle = '#ffffff';
    c2d.fillRect(0, 0, canvas.width, canvas.height);
    await page.render({
      canvas: canvas as HTMLCanvasElement,
      canvasContext: c2d as CanvasRenderingContext2D,
      viewport
    }).promise;
    page.cleanup();
    const blob = await encodeCanvas(canvas, mime, 92);
    entries[`${stem}-p${String(n).padStart(2, '0')}.${ext}`] = new Uint8Array(await blob.arrayBuffer());
    onProgress(0.05 + 0.9 * (n / total), 'render');
  }
  await task.destroy();
  const zipped = zipSync(entries, { level: 0 }); // images are already compressed
  return {
    blob: new Blob([zipped as unknown as BlobPart], { type: 'application/zip' }),
    name: `${stem}-${ext}.zip`,
    size: zipped.length,
    saving: 0,
    pages: total,
    note: `${total} pages at ${scale}×`
  };
}

async function meta(ctx: RunCtx): Promise<JobResult> {
  const { file, onProgress } = ctx;
  const { doc, task } = await openDoc(file);
  const info = await doc.getMetadata().catch(() => null);
  const pages: { page: number; width: number; height: number; chars: number }[] = [];
  for (let n = 1; n <= doc.numPages; n++) {
    const page = await doc.getPage(n);
    const [, , w, h] = page.view;
    pages.push({
      page: n,
      width: Math.round(w),
      height: Math.round(h),
      chars: 0
    });
    page.cleanup();
    onProgress(0.1 + 0.5 * (n / doc.numPages), 'read');
  }
  const md = info?.info as Record<string, unknown> | undefined;
  const out = {
    file: file.name,
    pages: doc.numPages,
    encrypted: false,
    metadata: md ?? {},
    pageSizes: pages.map(p => ({ page: p.page, width: p.width, height: p.height }))
  };
  await task.destroy();
  const json = new TextEncoder().encode(JSON.stringify(out, null, 2));
  return {
    blob: new Blob([json as unknown as BlobPart], { type: 'application/json' }),
    name: `${baseName(file.name)}-info.json`,
    size: json.length,
    saving: 0,
    note: `${out.pages} pages`
  };
}

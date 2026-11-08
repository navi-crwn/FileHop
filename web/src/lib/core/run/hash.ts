import type { JobResult } from '../types';
import { baseName } from '../detect';
import { canceledError, type RunCtx } from '../run';

/* Hashes from hash-wasm (MIT): WASM, so 2 GB files are streamed in chunks
   instead of being copied into a Worker. Web Crypto covers SHA-256 as a
   fallback when the module failed to load. */

type Hasher = {
  init: () => void;
  update: (chunk: Uint8Array) => void;
  digest: (format?: 'hex') => string;
};

const CHUNK = 8 * 1024 * 1024;

export async function runHash(ctx: RunCtx): Promise<JobResult> {
  const { file, action, opts, onProgress, signal } = ctx;
  const algo = action.slice('hash:'.length);
  let hex: string;

  try {
    hex = await wasmHash(algo, file, onProgress, signal);
  } catch (e) {
    if ((e as Error & { canceled?: boolean }).canceled) throw e;
    // Web Crypto is the honest fallback for SHA-256 if the wasm module fails to load
    if (algo !== 'sha256') throw e;
    hex = await webCryptoSha256(file, onProgress);
  }

  // A hash has no file of its own; the result is text plus a small .txt the user can keep.
  const label = algo === 'sha256' ? 'SHA-256' : algo.toUpperCase();
  const body = `${label}  ${file.name}\n${hex}\n`;
  const bytes = new TextEncoder().encode(body);
  onProgress(1, 'done');
  const n = file.size;
  const sizeNote = n >= 1048576 ? `${(n / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`;
  return {
    blob: new Blob([bytes as unknown as BlobPart], { type: 'text/plain;charset=utf-8' }),
    name: `${baseName(file.name)}.${algo}.txt`,
    size: bytes.length,
    saving: 0,
    hash: hex,
    note: `${label} · ${sizeNote}`
  };
}

async function wasmHash(
  algo: string,
  file: File,
  onProgress: RunCtx['onProgress'],
  signal: AbortSignal
): Promise<string> {
  const mod = await import('hash-wasm');
  let h: Hasher;
  if (algo === 'sha256') h = (await mod.createSHA256()) as unknown as Hasher;
  else if (algo === 'blake3') h = (await mod.createBLAKE3()) as unknown as Hasher;
  else if (algo === 'md5') h = (await mod.createMD5()) as unknown as Hasher;
  else throw new Error(`hash_unsupported:${algo}`);

  h.init();
  const total = file.size;
  let off = 0;
  while (off < total) {
    if (signal.aborted) throw canceledError();
    const end = Math.min(total, off + CHUNK);
    h.update(new Uint8Array(await file.slice(off, end).arrayBuffer()));
    off = end;
    onProgress(Math.min(0.95, off / Math.max(1, total)), 'hash');
  }
  return h.digest('hex');
}

async function webCryptoSha256(file: File, onProgress: RunCtx['onProgress']): Promise<string> {
  const buf = await file.arrayBuffer();
  onProgress(0.6, 'hash');
  const digest = await crypto.subtle.digest('SHA-256', buf);
  return [...new Uint8Array(digest)].map(b => b.toString(16).padStart(2, '0')).join('');
}

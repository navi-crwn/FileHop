// Receives file bytes off the main thread and hashes them on the way, so memory stays flat
// however big the file is. Three places to put them, best first:
//   1. a file the person picked with the save dialog (File System Access, Chromium desktop):
//      written through createWritable(), which keeps the data in a temporary file and only
//      replaces the destination on close(), so a file that fails the check never appears;
//   2. the browser's private file system (OPFS), through a sync access handle;
//   3. a Blob in memory, capped at BLOB_LIMIT.
// Nothing is kept as "the file" until the page has compared the hash and size with what the
// sender announced and sent `commit`; `abort` throws the data away.
import { createSHA256 } from 'hash-wasm';
import { BLOB_LIMIT } from './pure';

type Store = 'fs' | 'opfs' | 'blob';
let hasher: Awaited<ReturnType<typeof createSHA256>>;
let store: Store = 'blob';
let access: any = null; // FileSystemSyncAccessHandle (opfs)
let handle: any = null; // FileSystemFileHandle (opfs)
let writable: any = null; // FileSystemWritableFileStream (fs)
let dir: any = null;
let entry = '';
let parts: Uint8Array<ArrayBuffer>[] = [];
let got = 0; // bytes received (hashed)
let wrote = 0; // bytes written
let size = 0;
let chain: Promise<void> = Promise.resolve();
let failed = false;

const post = (m: Record<string, unknown>) => (self as unknown as Worker).postMessage(m);

async function open(m: { id: string; size: number; store: string; handle?: unknown }) {
  size = m.size; got = 0; wrote = 0; parts = []; failed = false; chain = Promise.resolve();
  hasher = await createSHA256();
  if (m.handle && m.store !== 'opfs' && m.store !== 'blob') {
    try {
      writable = await (m.handle as any).createWritable();
      store = 'fs';
      return post({ t: 'ready', store });
    } catch { writable = null; /* fall through to the next tier */ }
  }
  const canOpfs = m.store !== 'blob' && !!navigator.storage?.getDirectory &&
    typeof (self as any).FileSystemFileHandle?.prototype?.createSyncAccessHandle === 'function';
  if (canOpfs) {
    try {
      const root = await navigator.storage.getDirectory();
      dir = await root.getDirectoryHandle('filehop-send', { create: true });
      for await (const k of (dir as any).keys()) await dir.removeEntry(k).catch(() => {}); // leftovers of earlier sessions
      entry = 'r' + m.id;
      handle = await dir.getFileHandle(entry, { create: true });
      access = await handle.createSyncAccessHandle();
      access.truncate(0);
      store = 'opfs';
      return post({ t: 'ready', store });
    } catch {
      access = null;
      if (m.store === 'opfs') return post({ t: 'failed', why: 'storage' });
    }
  }
  if (size > BLOB_LIMIT) return post({ t: 'failed', why: 'too_big_for_memory' });
  store = 'blob';
  post({ t: 'ready', store });
}

let lastReport = 0;
function report(force = false) {
  const now = performance.now();
  if (force || now - lastReport > 100) { lastReport = now; post({ t: 'written', n: wrote }); }
}

function chunk(buf: ArrayBuffer) {
  if (failed) return;
  const u = new Uint8Array(buf);
  hasher.update(u);
  got += u.length;
  if (store === 'fs') {
    const at = got - u.length;
    chain = chain.then(async () => {
      if (failed) return;
      await writable.write({ type: 'write', position: at, data: u });
      wrote += u.length;
      report();
    }).catch(() => { failed = true; post({ t: 'failed', why: 'storage_full' }); });
    return;
  }
  try {
    if (access) access.write(u, { at: got - u.length });
    else parts.push(u);
  } catch {
    failed = true;
    return post({ t: 'failed', why: 'storage_full' });
  }
  wrote += u.length;
  report();
}

async function finish() {
  await chain;
  if (failed) return;
  if (access) access.flush();
  report(true);
  post({ t: 'done', n: got, sha256: hasher.digest('hex'), store });
}

/** The page found the file correct: make it the file. */
async function commit(name: string) {
  try {
    if (store === 'fs') {
      await writable.close(); // only now does the destination change
      writable = null;
      return post({ t: 'saved', store });
    }
    let file: File;
    if (access) {
      access.close();
      access = null;
      file = await handle.getFile(); // backed by the disk, not by memory
    } else {
      file = new File(parts, name, { type: 'application/octet-stream' });
      parts = [];
    }
    post({ t: 'saved', store, file });
  } catch {
    post({ t: 'failed', why: 'storage' });
  }
}

async function abort() {
  failed = true;
  try { await writable?.abort(); } catch { /* */ }
  writable = null;
  try { access?.close(); } catch { /* */ }
  access = null;
  parts = [];
  try { if (dir && entry) await dir.removeEntry(entry); } catch { /* */ }
  post({ t: 'aborted' });
}

self.onmessage = (e: MessageEvent) => {
  const m = e.data;
  if (m.t === 'open') void open(m);
  else if (m.t === 'chunk') chunk(m.buf);
  else if (m.t === 'finish') void finish();
  else if (m.t === 'commit') void commit(String(m.name ?? 'file'));
  else if (m.t === 'abort') void abort();
};

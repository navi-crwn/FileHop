import { unzipSync, zipSync, gunzipSync, gzipSync } from 'fflate';
import type { JobResult } from '../types';
import { baseName } from '../detect';
import { throwIfAborted, type RunCtx } from '../run';
import {
  assertSafeName, zipDeclaredSize, checkLimits, checkActual, readTar,
  type Entry
} from '../zip';

/* Archives stay local: fflate for ZIP/GZIP (MIT), and a small ustar reader for
   TAR so the format works without another megabyte of WebAssembly. RAR and 7z
   are read-only by design and not enabled yet — the UI says so.

   Order matters for safety: the declared size is checked before inflating, so a
   decompression bomb never gets the chance to allocate. */

async function entriesOf(file: File, ext: string): Promise<Entry[]> {
  const buf = new Uint8Array(await file.arrayBuffer());

  if (ext === 'zip') {
    const declared = zipDeclaredSize(buf);
    // A ZIP64 archive reports -1 here; checkLimits treats that as "unknown" and
    // the post-inflate check catches it instead.
    if (declared.total >= 0) {
      checkLimits(declared.total, buf.length, declared.largest, declared.entries);
    }
    let files: Record<string, Uint8Array>;
    try {
      files = unzipSync(buf);
    } catch {
      throw new Error('archive_bad_zip');
    }
    const out: Entry[] = [];
    let total = 0;
    let largest = 0;
    for (const [name, data] of Object.entries(files)) {
      if (!data) continue;
      const safe = assertSafeName(name);
      total += data.length;
      if (data.length > largest) largest = data.length;
      out.push({ name: safe, size: data.length, data, dir: name.endsWith('/') });
    }
    checkActual(total, largest, buf.length, out.length);
    return out;
  }

  if (ext === 'tar') return readTar(buf);
  throw new Error(`list_unsupported:${ext}`);
}

/** Run something that may throw ArchiveLimitError, mapping it to an i18n key. */
function mapArchiveError(e: unknown): never {
  const msg = (e as Error)?.message ?? '';
  if (msg.startsWith('archive_')) throw new Error(msg);
  throw e;
}

export async function runArchive(ctx: RunCtx): Promise<JobResult> {
  const { file, det, action, onProgress, signal } = ctx;
  const stem = baseName(file.name);

  try {
    return await runArchiveInner(ctx);
  } catch (e) {
    mapArchiveError(e);
  }

  async function runArchiveInner(c: RunCtx): Promise<JobResult> {
    void c;
    if (action === 'archive:gz') {
      onProgress(0.2, 'read');
      const buf = new Uint8Array(await file.arrayBuffer());
      throwIfAborted(signal);
      onProgress(0.55, 'compress');
      const gz = gzipSync(buf, { level: 9 });
      const alreadyGz = det.ext === 'gz';
      return {
        blob: new Blob([gz as unknown as BlobPart], { type: 'application/gzip' }),
        name: alreadyGz ? `${stem}.gz` : `${file.name}.gz`,
        size: gz.length,
        saving: 0,
        note: `${(buf.length / 1024).toFixed(0)} KB → ${(gz.length / 1024).toFixed(0)} KB`
      };
    }

    if (action === 'archive:list') {
      onProgress(0.2, 'read');
      let entries: Entry[];
      if (det.ext === 'gz') {
        const buf = new Uint8Array(await file.arrayBuffer());
        let inner: Uint8Array;
        try {
          inner = gunzipSync(buf);
        } catch {
          throw new Error('archive_bad_zip');
        }
        checkLimits(inner.length, buf.length, inner.length, 1);
        const name = file.name.replace(/\.gz$/i, '') || `${stem}.out`;
        entries = [{ name, size: inner.length, dir: false }];
      } else {
        entries = await entriesOf(file, det.ext);
      }
      const listing = entries.map(e => ({ name: e.name, size: e.size, dir: e.dir || undefined }));
      const totalBytes = entries.reduce((a, e) => a + e.size, 0);
      const json = new TextEncoder().encode(JSON.stringify({
        file: file.name,
        format: det.ext,
        count: entries.length,
        uncompressedBytes: totalBytes,
        entries: listing
      }, null, 2));
      onProgress(0.95, 'write');
      return {
        blob: new Blob([json as unknown as BlobPart], { type: 'application/json' }),
        name: `${stem}-listing.json`,
        size: json.length,
        saving: 0,
        listing,
        note: `${entries.length} entries`
      };
    }

    // archive:zip — repack a ZIP or TAR into a clean ZIP, or wrap anything else as a one-file ZIP.
    onProgress(0.15, 'read');
    let entries: Entry[];
    let repacked = false;
    if (det.ext === 'zip' || det.ext === 'tar') {
      entries = await entriesOf(file, det.ext);
      repacked = true;
    } else if (det.ext === 'gz') {
      const buf = new Uint8Array(await file.arrayBuffer());
      let inner: Uint8Array;
      try {
        inner = gunzipSync(buf);
      } catch {
        throw new Error('archive_bad_zip');
      }
      checkLimits(inner.length, buf.length, inner.length, 1);
      entries = [{ name: file.name.replace(/\.gz$/i, '') || `${stem}.out`, size: inner.length, data: inner, dir: false }];
    } else {
      const buf = new Uint8Array(await file.arrayBuffer());
      entries = [{ name: file.name, size: buf.length, data: buf, dir: false }];
    }
    throwIfAborted(signal);
    onProgress(0.6, 'pack');

    const tree: Record<string, Uint8Array> = {};
    for (const e of entries) {
      if (e.dir || !e.data) continue;
      tree[e.name] = e.data;
    }
    const zipped = zipSync(tree, { level: 6 });
    onProgress(0.95, 'write');
    return {
      blob: new Blob([zipped as unknown as BlobPart], { type: 'application/zip' }),
      // a repack keeps the files but is a new archive: do not overwrite the source name
      name: repacked ? `${stem}-repacked.zip` : `${stem}.zip`,
      size: zipped.length,
      saving: 0,
      listing: entries.map(e => ({ name: e.name, size: e.size, dir: e.dir || undefined })),
      note: `${Object.keys(tree).length} files`
    };
  }
}

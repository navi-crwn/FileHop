/// <reference lib="webworker" />
import { runJob, CanceledError } from '../core/run';
import type { ActionId, Detection } from '../core/types';

/* One worker, one job at a time. The pool on the main thread decides how many
   of these exist; this file only knows how to convert the file it is given. */

export interface WorkerJob {
  id: string;
  file: File;
  group: File[];
  det: Detection;
  action: ActionId;
  opts: Record<string, number | string>;
}

export type WorkerOut =
  | { type: 'progress'; id: string; p: number; note?: string }
  | { type: 'done'; id: string; name: string; blob: Blob; note?: string; pages?: number; hash?: string; listing?: { name: string; size: number; dir?: boolean }[] }
  | { type: 'error'; id: string; message: string; canceled?: boolean };

const ctrl = new Map<string, AbortController>();

self.onmessage = async (e: MessageEvent<{ type: 'run'; job: WorkerJob } | { type: 'cancel'; id: string }>) => {
  const msg = e.data;
  if (msg.type === 'cancel') {
    ctrl.get(msg.id)?.abort();
    return;
  }
  if (msg.type !== 'run') return;

  const { job } = msg;
  const ac = new AbortController();
  ctrl.set(job.id, ac);
  const post = (m: WorkerOut) => (self as unknown as Worker).postMessage(m);

  try {
    const result = await runJob({
      file: job.file,
      group: job.group,
      det: job.det,
      action: job.action,
      opts: job.opts,
      signal: ac.signal,
      onProgress: (p, note) => post({ type: 'progress', id: job.id, p, note })
    });
    post({
      type: 'done',
      id: job.id,
      name: result.name,
      blob: result.blob,
      note: result.note,
      pages: result.pages,
      hash: result.hash,
      listing: result.listing
    });
  } catch (err) {
    const canceled = err instanceof CanceledError || (err as Error)?.name === 'CanceledError' ||
      (err as Error)?.message === 'canceled';
    post({
      type: 'error',
      id: job.id,
      message: (err as Error)?.message ?? String(err),
      canceled
    });
  } finally {
    ctrl.delete(job.id);
  }
};

export {};

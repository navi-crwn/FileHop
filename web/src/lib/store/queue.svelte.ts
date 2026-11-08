import { Pool } from '../core/pool';
import { detectFile, baseName } from '../core/detect';
import { actionDef, defaultActionFor, defaultOpts, isHash, mergeCarrier, mergeMembers } from '../core/actions';
import type { ActionId, Job, JobResult } from '../core/types';

/* The queue is the app's only state. `jobs` is a $state array of $state jobs,
   so a progress tick repaints one card instead of the whole list. `version`
   stays as a cheap counter for callers that only need "something changed". */

export interface QueueDeps {
  onChange: () => void;
  onDone?: (job: Job) => void;
}

/** Rough memory ceiling for this device, in MB. Chromium exposes deviceMemory;
    elsewhere assume 4 GB, which is the low end of what runs a modern browser. */
function deviceBudgetMb(): number {
  const mem = (navigator as Navigator & { deviceMemory?: number }).deviceMemory;
  const gb = typeof mem === 'number' && mem > 0 ? mem : 4;
  // leave room for the page, the worker and the encoded output; a decode peaks
  // around 4 bytes per pixel plus the source and the result
  return Math.max(128, Math.floor(gb * 1024 * 0.35));
}

/** Best-effort peak estimate. Deliberately pessimistic for images: 4 bytes per
    pixel for the bitmap and again for the canvas, plus the source and output. */
function estimateMb(job: Job): number {
  const mb = job.size / (1024 * 1024);
  if (job.det.category === 'image') {
    // without decoding we cannot know the pixel count; 40x the file size is a
    // reasonable ceiling for compressed photos and generous for screenshots
    return mb * 6 + 40;
  }
  if (job.det.category === 'pdf') {
    return job.action === 'pdf:png' || job.action === 'pdf:jpeg' ? mb * 8 + 80 : mb * 3 + 20;
  }
  if (job.det.category === 'archive') {
    // archives may expand; the zip guard also runs inside the engine
    return mb * 8 + 40;
  }
  return mb * 3 + 16;
}

let seq = 0;

export class Queue {
  jobs = $state<Job[]>([]);
  pool: Pool;
  maxBatch = 50;
  private deps: QueueDeps;
  private running = new Map<string, () => void>();

  constructor(pool: Pool, deps: QueueDeps) {
    this.pool = pool;
    this.deps = deps;
  }

  get pending(): Job[] {
    return this.jobs.filter(j => j.status === 'queued');
  }

  get busy(): boolean {
    return this.jobs.some(j => j.status === 'running');
  }

  get doneCount(): number {
    return this.jobs.filter(j => j.status === 'done').length;
  }

  async add(files: File[]): Promise<Job[]> {
    const room = Math.max(0, this.maxBatch - this.jobs.length);
    const accepted = files.slice(0, room);
    const added: Job[] = [];
    for (const file of accepted) {
      const det = await detectFile(file);
      const action = defaultActionFor(det.category, det.ext);
      const job = $state<Job>({
        id: `job-${++seq}-${Date.now().toString(36)}`,
        file,
        name: file.name,
        size: file.size,
        det,
        action,
        opts: defaultOpts(action),
        status: 'queued',
        progress: 0
      });
      this.jobs.push(job);
      added.push(job);
    }
    this.deps.onChange();
    return added;
  }

  /** the files that belong to the same conversion group (needed by PDF merge) */
  groupFor(job: Job): File[] {
    if (job.action !== 'pdf:merge') return [job.file];
    // the file the user pressed on carries the merge, so it comes first
    return [job.file, ...this.mergeGroup().filter(j => j.id !== job.id).map(j => j.file)];
  }

  /** PDFs that Merge will consume, in queue order: those set to Merge, nothing else */
  mergeGroup(): Job[] {
    return mergeMembers(this.jobs);
  }

  setAction(job: Job, action: ActionId): void {
    job.action = action;
    job.opts = { ...defaultOpts(action) };
    this.resetIfFinished(job);
    // Merge is one result for the whole group: a PDF joining it after a finished merge starts the group over.
    if (action === 'pdf:merge') {
      for (const j of this.mergeGroup()) this.resetIfFinished(j);
    }
    this.deps.onChange();
  }

  setOpt(job: Job, key: string, value: number | string): void {
    job.opts = { ...job.opts, [key]: value };
    this.resetIfFinished(job);
    this.deps.onChange();
  }

  /** apply one target to every job of a category */
  setActionForCategory(cat: string, action: ActionId): void {
    for (const j of this.jobs) {
      const def = actionDef(action);
      if (!def) continue;
      if (j.det.category !== cat) continue;
      if (!this.isRelevant(j, action)) continue;
      j.action = action;
      j.opts = { ...defaultOpts(action) };
      this.resetIfFinished(j);
    }
    this.deps.onChange();
  }

  /** a target only applies when it changes the bytes or adds information */
  private isRelevant(job: Job, action: ActionId): boolean {
    const def = actionDef(action);
    if (!def) return false;
    if (isHash(action)) return true;
    return !(def.ext === job.det.ext && !def.batch && !def.options?.length && def.ext !== 'zip');
  }

  private resetIfFinished(job: Job): void {
    if (job.status === 'done' || job.status === 'error' || job.status === 'canceled' || job.status === 'merged') {
      job.status = 'queued';
      job.result = undefined;
      job.error = undefined;
      job.progress = 0;
    }
  }

  remove(job: Job): void {
    this.running.get(job.id)?.();
    const i = this.jobs.indexOf(job);
    if (i >= 0) this.jobs.splice(i, 1);
    job.result = undefined;
    this.deps.onChange();
  }

  clearFinished(): void {
    this.jobs = this.jobs.filter(j => j.status !== 'done' && j.status !== 'error' && j.status !== 'canceled' && j.status !== 'merged');
    this.deps.onChange();
  }

  clearAll(): void {
    for (const c of this.running.values()) c();
    this.running.clear();
    this.jobs = [];
    this.deps.onChange();
  }

  cancel(job: Job): void {
    this.running.get(job.id)?.();
    if (job.status === 'queued') {
      job.status = 'canceled';
      this.deps.onChange();
    }
  }

  cancelAll(): void {
    for (const j of this.jobs) {
      if (j.status === 'queued' || j.status === 'running') this.cancel(j);
    }
  }

  async runOne(job: Job): Promise<void> {
    if (job.status === 'running') return;

    // Refuse what this device cannot hold instead of crashing the tab.
    const budget = deviceBudgetMb();
    const needMb = estimateMb(job);
    if (needMb > budget) {
      job.status = 'error';
      job.error = 'out_of_memory';
      job.progress = 0;
      this.deps.onChange();
      return;
    }

    job.status = 'running';
    job.progress = 0;
    job.error = undefined;
    job.startedAt = performance.now();
    this.deps.onChange();

    const { promise, cancel } = this.pool.run(
      {
        id: job.id,
        file: job.file,
        group: this.groupFor(job),
        // a $state proxy cannot cross into a worker; snapshot it to plain data
        det: $state.snapshot(job.det) as Job['det'],
        action: job.action,
        opts: $state.snapshot(job.opts) as Record<string, number | string>
      },
      (p) => {
        job.progress = Math.max(job.progress, Math.min(0.999, p));
        this.deps.onChange();
      }
    );
    this.running.set(job.id, cancel);

    try {
      const result: JobResult = await promise;
      job.result = { ...result, size: result.blob.size };
      job.status = 'done';
      job.progress = 1;
      job.endedAt = performance.now();
      if (job.action === 'pdf:merge') {
        // the other PDFs of the group are inside this result: they are finished too, with nothing of their own
        for (const j of this.mergeGroup()) {
          if (j.id !== job.id && j.status === 'queued') {
            j.status = 'merged';
            j.progress = 1;
            j.endedAt = job.endedAt;
          }
        }
      }
      this.deps.onDone?.(job);
    } catch (e) {
      const err = e as Error & { canceled?: boolean };
      if (err.canceled || err.message === 'canceled') {
        job.status = 'canceled';
      } else {
        job.status = 'error';
        job.error = err.message || 'unknown';
      }
      job.endedAt = performance.now();
    } finally {
      this.running.delete(job.id);
      this.deps.onChange();
    }
  }

  async runAll(): Promise<void> {
    // A merge consumes the whole PDF group; every other target runs per file.
    const carrier = mergeCarrier(this.jobs);
    const list = this.jobs.filter(j => {
      if (j.status !== 'queued') return false;
      if (j.action === 'pdf:merge' && (!carrier || carrier.id !== j.id)) return false;
      return true;
    });
    await Promise.all(list.map(j => this.runOne(j)));
  }

  isHashJob(job: Job): boolean {
    return isHash(job.action);
  }

  /** the name a finished job downloads as */
  outName(job: Job): string {
    if (job.result?.name) return job.result.name;
    const def = actionDef(job.action);
    return def?.ext ? `${baseName(job.name)}.${def.ext}` : job.name;
  }
}

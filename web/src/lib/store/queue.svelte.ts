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
    // Queue order, whichever card carries the merge: it is the order of the cards and
    // the order the carrier card lists, so the pages come out as the person sees them.
    const files = this.mergeGroup().map(j => j.file);
    return files.includes(job.file) ? files : [job.file, ...files];
  }

  /** PDFs that Merge will consume, in queue order: those set to Merge, nothing else */
  mergeGroup(): Job[] {
    return mergeMembers(this.jobs);
  }

  setAction(job: Job, action: ActionId): void {
    // A running conversion keeps the target it started with: the run captured
    // the action and options, and a mid-run change desyncs the card from it.
    if (job.status === 'running') return;
    job.action = action;
    job.opts = { ...defaultOpts(action) };
    this.resetIfFinished(job);
    // Merge is one result for the whole group: a PDF joining it after a finished
    // merge restarts absorbed members, not cards that own completed downloads.
    if (action === 'pdf:merge') {
      for (const j of this.mergeGroup()) {
        if (j.status !== 'done' || !j.result) this.resetIfFinished(j);
      }
    }
    this.deps.onChange();
  }

  setOpt(job: Job, key: string, value: number | string): void {
    if (job.status === 'running') return;
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
      // a running conversion keeps its target, and a finished card that already has
      // this target keeps its result: choosing the same target again changes nothing
      if (j.status === 'running') continue;
      if (j.action === action && j.status === 'done' && j.result) continue;
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
    // The merge result of a group went with its card: the members that were folded
    // into it are PDFs waiting for a merge again, not orphans of a result that is gone.
    const lostMerge = job.action === 'pdf:merge' && job.status === 'done' && job.result;
    job.result = undefined;
    if (job.action === 'pdf:merge') {
      const rest = this.mergeGroup();
      if (lostMerge) for (const j of rest) if (j.status === 'merged') this.resetIfFinished(j);
      // a merge needs two: a lone member that is still waiting goes back to its default target
      const waiting = rest.filter(j => j.status !== 'done' && j.status !== 'merged' && !(j.status === 'running'));
      if (rest.length === 1 && waiting.length === 1) {
        waiting[0].action = defaultActionFor(waiting[0].det.category, waiting[0].det.ext);
        waiting[0].opts = { ...defaultOpts(waiting[0].action) };
        this.resetIfFinished(waiting[0]);
      }
    }
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
    // One merge per group, ever: a card that is not the carrier has no merge of
    // its own to run, so it can never build the group a second time. (runAll
    // applies the same rule; a lone Merge card still runs and says it needs two.)
    // A failed or stopped card the person retries takes the group from a merely
    // queued member; a merge that is already running still wins.
    const carrier = job.action === 'pdf:merge' ? mergeCarrier(this.jobs) : undefined;
    const retrying = job.status === 'error' || job.status === 'canceled';
    if (carrier && carrier.id !== job.id && !(retrying && carrier.status !== 'running')) return;

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

    // the group this run builds, fixed at the start: a card that joins later is
    // not in the result and must not be marked as if it were
    const action = job.action;
    const groupRest = action === 'pdf:merge' ? this.mergeGroup().filter(j => j.id !== job.id) : [];
    const { promise, cancel } = this.pool.run(
      {
        id: job.id,
        file: job.file,
        group: this.groupFor(job),
        // a $state proxy cannot cross into a worker; snapshot it to plain data
        det: $state.snapshot(job.det) as Job['det'],
        action,
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
      if (action === 'pdf:merge') {
        // the PDFs of the group are inside this result: they are finished too, with
        // nothing of their own. That includes a member whose own attempt failed
        // earlier: its pages are in this result, so its old error no longer holds.
        // A stopped member was never part of the group and stays as it is.
        for (const j of groupRest) {
          if ((j.status === 'queued' || j.status === 'error') && j.action === 'pdf:merge') {
            j.status = 'merged';
            j.error = undefined;
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

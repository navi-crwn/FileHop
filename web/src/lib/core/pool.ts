import type { ActionId, Detection, JobResult } from './types';
import type { WorkerJob, WorkerOut } from './convert.worker';

/** Can a worker draw? OffscreenCanvas is the only canvas a worker has. */
const WORKER_CANVAS = typeof OffscreenCanvas !== 'undefined';

/** Actions that rasterise through a canvas (images, PDF pages to pictures). */
export function drawsOnCanvas(action: ActionId): boolean {
  return action.startsWith('image:') || action === 'pdf:png' || action === 'pdf:jpeg';
}

/* A worker pool sized by the machine, not by ambition: one core is left for the
   UI, mobile gets fewer slots, and a battery-saver switch drops it to one. */

interface Pending {
  resolve: (r: JobResult) => void;
  reject: (e: Error) => void;
  onProgress: (p: number, note?: string) => void;
  jobId: string;
  slot: Slot;
}

interface Slot {
  worker: Worker;
  busy: boolean;
  current?: Pending;
}

export interface PoolOptions {
  /** user setting: 0 = automatic */
  maxWorkers?: number;
  batterySaver?: boolean;
}

export function hardwareSlots(): number {
  const cores = navigator.hardwareConcurrency || 4;
  const base = Math.max(1, Math.min(cores - 1, 4));
  const mem = (navigator as Navigator & { deviceMemory?: number }).deviceMemory;
  const mobile = /Mobi|Android|iPhone|iPad/i.test(navigator.userAgent) ||
    (navigator as Navigator & { userAgentData?: { mobile?: boolean } }).userAgentData?.mobile === true;
  if (mobile || (typeof mem === 'number' && mem <= 4)) return Math.min(base, 2);
  return base;
}

export class Pool {
  private slots: Slot[] = [];
  private queue: Pending[] = [];
  private nextId = 1;
  private opts: PoolOptions;

  constructor(opts: PoolOptions = {}) {
    this.opts = opts;
  }

  /** SVG needs <img>, which only the page has: those jobs run here, one at a time. */
  private mainThreadBusy = false;
  private mainThreadQueue: Array<() => void> = [];

  private async acquireMainThread(): Promise<() => void> {
    if (!this.mainThreadBusy) {
      this.mainThreadBusy = true;
      return () => this.releaseMainThread();
    }
    await new Promise<void>(res => this.mainThreadQueue.push(res));
    return () => this.releaseMainThread();
  }

  private releaseMainThread(): void {
    const next = this.mainThreadQueue.shift();
    if (next) next();
    else this.mainThreadBusy = false;
  }

  get size(): number {
    return this.slots.length;
  }

  /** active worker count the user will see */
  get planned(): number {
    if (this.opts.batterySaver) return 1;
    if (this.opts.maxWorkers && this.opts.maxWorkers > 0) return Math.min(8, this.opts.maxWorkers);
    return hardwareSlots();
  }

  private spawn(): Slot {
    const worker = new Worker(new URL('./convert.worker.ts', import.meta.url), { type: 'module' });
    const slot: Slot = { worker, busy: false };
    worker.onmessage = (e: MessageEvent<WorkerOut>) => this.onMessage(slot, e.data);
    worker.onerror = (e) => {
      if (slot.current) {
        slot.current.reject(new Error(`worker_crash:${e.message || 'unknown'}`));
        slot.current = undefined;
      }
      slot.busy = false;
      this.drain();
    };
    this.slots.push(slot);
    return slot;
  }

  private onMessage(slot: Slot, msg: WorkerOut): void {
    const cur = slot.current;
    if (!cur || msg.id !== cur.jobId) return;
    if (msg.type === 'progress') {
      cur.onProgress(msg.p, msg.note);
      return;
    }
    if (msg.type === 'done') {
      cur.resolve({
        blob: msg.blob,
        name: msg.name,
        size: msg.blob.size,
        saving: 0,
        note: msg.note,
        pages: msg.pages,
        hash: msg.hash,
        listing: msg.listing
      });
    } else {
      cur.reject(Object.assign(new Error(msg.message), { canceled: msg.canceled }));
    }
    slot.current = undefined;
    slot.busy = false;
    this.drain();
  }

  private drain(): void {
    while (this.queue.length) {
      let slot = this.slots.find(s => !s.busy && s.worker);
      if (!slot) {
        if (this.slots.length < this.planned) slot = this.spawn();
        else break;
      }
      const p = this.queue.shift()!;
      slot.busy = true;
      slot.current = p;
      p.slot = slot;
      const job: WorkerJob = {
        id: p.jobId,
        file: (p as unknown as { payload: WorkerJob }).payload.file,
        group: (p as unknown as { payload: WorkerJob }).payload.group,
        det: (p as unknown as { payload: WorkerJob }).payload.det,
        action: (p as unknown as { payload: WorkerJob }).payload.action,
        opts: (p as unknown as { payload: WorkerJob }).payload.opts
      };
      slot.worker.postMessage({ type: 'run', job });
    }
    // give back idle workers beyond the current plan (the slider can move down)
    while (this.slots.length > this.planned) {
      const idle = [...this.slots].reverse().find(s => !s.busy);
      if (!idle) break;
      idle.worker.terminate();
      this.slots.splice(this.slots.indexOf(idle), 1);
    }
  }

  run(
    payload: { id: string; file: File; group: File[]; det: Detection; action: ActionId; opts: Record<string, number | string> },
    onProgress: (p: number, note?: string) => void
  ): { promise: Promise<JobResult>; cancel: () => void } {
    // SVG decoding needs the page's <img>; everything else goes to a worker,
    // unless it draws on a canvas and this browser has no OffscreenCanvas
    // (Safari before 16.4, WebKit ports): a worker has no <canvas> to fall back on.
    const needsMain = payload.det.mime === 'image/svg+xml' || (!WORKER_CANVAS && drawsOnCanvas(payload.action));
    if (needsMain) return this.runOnMainThread(payload, onProgress);

    const jobId = `j${this.nextId++}`;
    let settled = false;
    const promise = new Promise<JobResult>((resolve, reject) => {
      const p = {
        resolve: (r: JobResult) => { settled = true; resolve(r); },
        reject: (e: Error) => { settled = true; reject(e); },
        onProgress,
        jobId,
        slot: undefined as unknown as Slot
      } as Pending & { payload: typeof payload };
      p.payload = payload;
      this.queue.push(p);
      this.drain();
    });
    const cancel = () => {
      if (settled) return;
      const qi = this.queue.findIndex(q => (q as unknown as { payload: typeof payload }).payload.id === payload.id);
      if (qi >= 0) {
        const [removed] = this.queue.splice(qi, 1);
        removed.reject(Object.assign(new Error('canceled'), { canceled: true }));
        return;
      }
      const slot = this.slots.find(s => s.current && (s.current as unknown as { payload: typeof payload }).payload.id === payload.id);
      if (slot) {
        slot.worker.postMessage({ type: 'cancel', id: slot.current!.jobId });
        // if the engine cannot interrupt itself, replace the worker entirely
        setTimeout(() => {
          if (slot.current && (slot.current as unknown as { payload: typeof payload }).payload.id === payload.id) {
            slot.worker.terminate();
            slot.current.reject(Object.assign(new Error('canceled'), { canceled: true }));
            slot.current = undefined;
            slot.busy = false;
            this.slots.splice(this.slots.indexOf(slot), 1);
            this.drain();
          }
        }, 1500);
      }
    };
    return { promise, cancel };
  }

  reconfigure(opts: PoolOptions): void {
    this.opts = { ...this.opts, ...opts };
    this.drain();
  }

  /** The same job contract, executed in the page: SVG, and canvas work where workers cannot draw. */
  private runOnMainThread(
    payload: { id: string; file: File; group: File[]; det: Detection; action: ActionId; opts: Record<string, number | string> },
    onProgress: (p: number, note?: string) => void
  ): { promise: Promise<JobResult>; cancel: () => void } {
    const ac = new AbortController();
    let release: (() => void) | null = null;
    let canceled = false;

    const promise = (async () => {
      release = await this.acquireMainThread();
      if (canceled) throw Object.assign(new Error('canceled'), { canceled: true });
      const { runJob } = await import('./run');
      // let the browser paint the card before the main thread gets busy
      await new Promise(r => requestAnimationFrame(() => r(null)));
      return runJob({
        file: payload.file,
        group: payload.group,
        det: payload.det,
        action: payload.action,
        opts: payload.opts,
        signal: ac.signal,
        onProgress
      });
    })().finally(() => {
      release?.();
    });

    const cancel = () => {
      canceled = true;
      ac.abort();
    };
    return { promise, cancel };
  }

  dispose(): void {
    for (const s of this.slots) s.worker.terminate();
    this.slots = [];
    this.queue = [];
  }
}

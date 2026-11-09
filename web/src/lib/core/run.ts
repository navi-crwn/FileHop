import type { ActionId, Detection, JobResult } from './types';
import { baseName } from './detect';
import { actionDef } from './actions';
import { runImage } from './run/image';
import { runPdf } from './run/pdf';
import { runData } from './run/data';
import { runArchive } from './run/archive';
import { runText } from './run/text';
import { runHash } from './run/hash';

export interface RunCtx {
  file: File;
  /** the files of the same group in queue order, the current file among them */
  group: File[];
  det: Detection;
  action: ActionId;
  opts: Record<string, number | string>;
  onProgress: (p: number, note?: string) => void;
  signal: AbortSignal;
}

export class CanceledError extends Error {
  constructor() {
    super('canceled');
    this.name = 'CanceledError';
  }
}

export function throwIfAborted(signal: AbortSignal): void {
  if (signal.aborted) throw new CanceledError();
}

/** Reported by an engine that cannot interrupt itself; the card shows it as a stop. */
export function canceledError(): Error {
  return Object.assign(new CanceledError(), { canceled: true });
}

export async function runJob(ctx: RunCtx): Promise<JobResult> {
  const { action, det } = ctx;
  const def = actionDef(action);
  if (!def) throw new Error(`unknown action ${action}`);

  let result: JobResult;
  if (action.startsWith('image:')) result = await runImage(ctx);
  else if (action.startsWith('pdf:')) result = await runPdf(ctx);
  else if (action.startsWith('data:')) result = await runData(ctx);
  else if (action.startsWith('archive:')) result = await runArchive(ctx);
  else if (action.startsWith('text:')) result = await runText(ctx);
  else if (action.startsWith('hash:')) result = await runHash(ctx);
  else throw new Error(`unhandled action ${action}`);

  throwIfAborted(ctx.signal);
  const sourceExt = det.ext;
  const targetExt = def.ext || sourceExt;
  if (!result.name) {
    result.name = `${baseName(ctx.file.name)}.${targetExt}`;
  }
  result.size = result.blob.size;
  result.saving = ctx.file.size > 0 ? 1 - result.blob.size / ctx.file.size : 0;
  ctx.onProgress(1);
  return result;
}

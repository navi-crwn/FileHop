import type { ActionDef, ActionId, Category, Job } from './types';
import { AVIF_ENCODABLE } from './features';

/* What a file can become. One flat table keeps the UI, the radial menu and the
   command palette reading from the same source of truth. */

const QUALITY = {
  id: 'quality' as const,
  labelKey: 'opt.quality',
  type: 'range' as const,
  min: 1, max: 100, step: 1, default: 82
};

export const ACTIONS: ActionDef[] = [
  // images
  { id: 'image:webp', ext: 'webp', label: 'WebP', options: [QUALITY] },
  { id: 'image:avif', ext: 'avif', label: 'AVIF', options: [QUALITY], feature: 'avif' },
  { id: 'image:jpeg', ext: 'jpg', label: 'JPEG', options: [QUALITY] },
  { id: 'image:png', ext: 'png', label: 'PNG' },
  { id: 'image:pdf', ext: 'pdf', label: 'PDF', hintKey: 'hint.image_pdf' },
  // pdf
  { id: 'pdf:merge', ext: 'pdf', label: 'Merge', batch: true },
  { id: 'pdf:split', ext: 'zip', label: 'Split' },
  { id: 'pdf:rotate', ext: 'pdf', label: 'Rotate 90°' },
  { id: 'pdf:extract', ext: 'pdf', label: 'Pick pages', options: [{ id: 'pages', labelKey: 'opt.pages', type: 'text', default: '1-3' }] },
  { id: 'pdf:png', ext: 'zip', label: 'Pages → PNG' },
  { id: 'pdf:jpeg', ext: 'zip', label: 'Pages → JPEG' },
  { id: 'pdf:meta', ext: 'json', label: 'Info' },
  // data
  { id: 'data:json', ext: 'json', label: 'JSON' },
  { id: 'data:csv', ext: 'csv', label: 'CSV' },
  { id: 'data:tsv', ext: 'tsv', label: 'TSV' },
  { id: 'data:yaml', ext: 'yaml', label: 'YAML' },
  // archives
  { id: 'archive:zip', ext: 'zip', label: 'ZIP' },
  { id: 'archive:gz', ext: 'gz', label: 'GZIP' },
  { id: 'archive:list', ext: 'json', label: 'List' },
  // text
  { id: 'text:html', ext: 'html', label: 'HTML' },
  { id: 'text:md', ext: 'md', label: 'Markdown' },
  { id: 'text:txt', ext: 'txt', label: 'Plain text' },
  // hashes (no file out)
  { id: 'hash:sha256', ext: '', label: 'SHA-256' },
  { id: 'hash:blake3', ext: '', label: 'BLAKE3' },
  { id: 'hash:md5', ext: '', label: 'MD5' }
];

const BY_ID = new Map<ActionId, ActionDef>(ACTIONS.map(a => [a.id, a]));

export function actionDef(id: ActionId): ActionDef | undefined {
  return BY_ID.get(id);
}

const IMAGE_TARGETS: ActionId[] = ['image:webp', 'image:avif', 'image:jpeg', 'image:png', 'image:pdf'];
const DATA_TARGETS: ActionId[] = ['data:json', 'data:csv', 'data:tsv', 'data:yaml'];
const TEXT_TARGETS: ActionId[] = ['text:md', 'text:html', 'text:txt'];
const HASH_TARGETS: ActionId[] = ['hash:sha256', 'hash:blake3', 'hash:md5'];

/** The PDFs that take part in the merge: only those whose target is Merge, in queue
    order. A PDF set to Split or Rotate, or one already finished with another target,
    is not part of it. */
export function mergeMembers(jobs: Job[]): Job[] {
  return jobs.filter(j => j.action === 'pdf:merge' && j.status !== 'canceled');
}

/** One merge per group: the first PDF that asked for it carries the result,
    the rest are absorbed so the same document is not built twice. */
export function mergeCarrier(jobs: Job[]): Job | undefined {
  return mergeMembers(jobs)[0];
}

/** Targets offered for a category, in the order the radial ring and the card show them.
    A target this browser cannot write is never offered: no dead buttons. */
export function targetsFor(cat: Category, ext: string): ActionId[] {
  const filter = (ids: ActionId[]) =>
    ids.filter(id => {
      if (id === 'image:avif') return AVIF_ENCODABLE;
      if (id === 'image:png' && ext === 'png') return false;
      return true;
    });
  switch (cat) {
    case 'image':
      return filter(IMAGE_TARGETS);
    case 'pdf':
      return ['pdf:merge', 'pdf:split', 'pdf:rotate', 'pdf:extract', 'pdf:png', 'pdf:jpeg', 'pdf:meta'];
    case 'data':
      return DATA_TARGETS.filter(id => {
        if (ext === 'csv' && id === 'data:csv') return false;
        if (ext === 'tsv' && id === 'data:tsv') return false;
        if (ext === 'json' && id === 'data:json') return false;
        if ((ext === 'yaml' || ext === 'yml') && id === 'data:yaml') return false;
        return true;
      });
    case 'text':
      return TEXT_TARGETS.filter(id => !(ext === 'md' && id === 'text:md'));
    case 'archive':
      return ['archive:list', 'archive:zip'];
    case 'font':
    case 'media':
    case 'unknown':
      return HASH_TARGETS;
    default:
      return HASH_TARGETS;
  }
}

/** Has anything in this list already taken responsibility for the merge? */
export function isAbsorbed(job: Job, jobs: Job[]): boolean {
  if (job.action !== 'pdf:merge') return false;
  const carrier = mergeCarrier(jobs);
  return !!carrier && carrier.id !== job.id;
}

/** Default action picked when a file lands: the first sensible one, never a no-op
    and never one that cannot work alone. A single PDF cannot be merged, so PDFs
    start on Split; Merge is a deliberate choice from the card or the group chip. */
export function defaultActionFor(cat: Category, ext: string): ActionId {
  if (cat === 'pdf') return 'pdf:split';
  const t = targetsFor(cat, ext);
  return t[0] ?? 'hash:sha256';
}

export function defaultOpts(id: ActionId): Record<string, number | string> {
  const def = BY_ID.get(id);
  const out: Record<string, number | string> = {};
  for (const o of def?.options ?? []) out[o.id] = o.default;
  return out;
}

export function isHash(a: ActionId): boolean {
  return a.startsWith('hash:');
}

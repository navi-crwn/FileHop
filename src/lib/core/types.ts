export type Category = 'image' | 'pdf' | 'data' | 'archive' | 'text' | 'media' | 'font' | 'unknown';

export interface Detection {
  /** from magic bytes, not the file name */
  mime: string;
  ext: string;
  category: Category;
  /** file name says something else */
  mismatch: boolean;
  /** short human label, e.g. "WebP" */
  label: string;
  confidence: 'high' | 'low';
}

export type ActionId =
  | 'image:png' | 'image:jpeg' | 'image:webp' | 'image:avif' | 'image:pdf'
  | 'pdf:merge' | 'pdf:split' | 'pdf:rotate' | 'pdf:extract' | 'pdf:meta' | 'pdf:png' | 'pdf:jpeg'
  | 'data:json' | 'data:csv' | 'data:tsv' | 'data:yaml'
  | 'archive:zip' | 'archive:gz' | 'archive:list'
  | 'text:html' | 'text:md' | 'text:txt'
  | 'hash:sha256' | 'hash:blake3' | 'hash:md5';

export interface ActionOption {
  id: 'quality' | 'width' | 'pages' | 'title';
  labelKey: string;
  type: 'range' | 'number' | 'text';
  min?: number;
  max?: number;
  step?: number;
  default: number | string;
}

export interface ActionDef {
  id: ActionId;
  /** output extension, empty when the action does not produce a file (list/hash) */
  ext: string;
  label: string;
  hintKey?: string;
  options?: ActionOption[];
  /** needs more than one file of the same group */
  batch?: boolean;
  /** true when the browser may not support it; checked at runtime */
  feature?: 'avif';
}

export type JobStatus = 'queued' | 'running' | 'done' | 'error' | 'canceled' | 'merged';

export interface JobResult {
  blob: Blob;
  name: string;
  size: number;
  /** 0..1, how much smaller than the source (negative = bigger) */
  saving: number;
  hash?: string;
  pages?: number;
  listing?: { name: string; size: number; dir?: boolean }[];
  note?: string;
}

export interface Job {
  id: string;
  file: File;
  name: string;
  size: number;
  det: Detection;
  action: ActionId;
  opts: Record<string, number | string>;
  status: JobStatus;
  progress: number;
  result?: JobResult;
  error?: string;
  startedAt?: number;
  endedAt?: number;
}

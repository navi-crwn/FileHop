import Papa from 'papaparse';
import YAML from 'yaml';
import type { JobResult } from '../types';
import { baseName } from '../detect';
import type { RunCtx } from '../run';

/* Tabular data: one in-memory table model, then out to whatever was asked.
   CSV/TSV through Papa Parse, JSON natively, YAML through `yaml`. */

type Cell = string | number | boolean | null;
interface Table {
  headers: string[];
  rows: Cell[][];
  /** plain data for JSON/YAML output, set when the source was structured */
  raw?: unknown;
}

async function textOf(file: File): Promise<string> {
  // Excel and friends may ship UTF-16 with a BOM; sniff it before defaulting to UTF-8.
  const buf = await file.arrayBuffer();
  const head = new Uint8Array(buf.slice(0, 4));
  if (head[0] === 0xff && head[1] === 0xfe) return new TextDecoder('utf-16le').decode(buf.slice(2));
  if (head[0] === 0xfe && head[1] === 0xff) return new TextDecoder('utf-16be').decode(buf.slice(2));
  if (head[0] === 0xef && head[1] === 0xbb && head[2] === 0xbf) return new TextDecoder('utf-8').decode(buf.slice(3));
  return new TextDecoder('utf-8', { fatal: false }).decode(buf);
}

function uniqHeaders(names: string[]): string[] {
  const seen = new Map<string, number>();
  return names.map((n, i) => {
    const clean = (n ?? '').trim() || `column_${i + 1}`;
    const c = seen.get(clean) ?? 0;
    seen.set(clean, c + 1);
    return c === 0 ? clean : `${clean}_${c + 1}`;
  });
}

/** A CSV cell is a string, but "3" should become 3 when it converts both ways
    exactly: 007 and 1.50 stay text, 12345678901234567890 stays text too. */
function typedCell(raw: string): Cell {
  const t = raw.trim();
  if (t === '') return '';
  if (t === 'true') return true;
  if (t === 'false') return false;
  if (/^-?(0|[1-9]\d*)(\.\d+)?$/.test(t)) {
    const n = Number(t);
    if (String(n) === t && Number.isFinite(n)) return n;
  }
  return raw;
}

function csvTable(text: string, ext: string): Table {
  const res = Papa.parse<string[]>(text, {
    delimiter: ext === 'tsv' ? '\t' : '',
    skipEmptyLines: 'greedy'
  });
  if (res.errors.length && res.data.length === 0) {
    throw new Error(`csv_parse:${res.errors[0].message}`);
  }
  const [head, ...rest] = res.data;
  if (!head) return { headers: [], rows: [] };
  const headers = uniqHeaders(head.map(String));
  const rows = rest.map(r => {
    const out: Cell[] = [];
    for (let i = 0; i < headers.length; i++) out.push(typedCell(r[i] ?? ''));
    return out;
  });
  return { headers, rows };
}

function structuredToTable(value: unknown): Table {
  // array of objects → union of keys, in first-seen order
  if (Array.isArray(value)) {
    if (value.length && typeof value[0] === 'object' && value[0] !== null && !Array.isArray(value[0])) {
      const keys: string[] = [];
      for (const row of value) {
        if (row && typeof row === 'object') {
          for (const k of Object.keys(row as Record<string, unknown>)) {
            if (!keys.includes(k)) keys.push(k);
          }
        }
      }
      const headers = uniqHeaders(keys);
      const rows = value.map(row => keys.map(k => flattenCell((row as Record<string, unknown>)?.[k])));
      return { headers, rows, raw: value };
    }
    if (value.length && Array.isArray(value[0])) {
      const arrs = value as unknown[][];
      const width = Math.max(...arrs.map(a => a.length));
      const headers = Array.from({ length: width }, (_, i) => `column_${i + 1}`);
      return { headers, rows: arrs.map(a => headers.map((_, i) => flattenCell(a[i]))), raw: value };
    }
    return { headers: ['value'], rows: value.map(v => [flattenCell(v)]), raw: value };
  }
  if (value && typeof value === 'object') {
    const obj = value as Record<string, unknown>;
    // { items: [...] } is a very common API shape; unwrap it when it is the only array
    const keys = Object.keys(obj);
    if (keys.length === 1 && Array.isArray(obj[keys[0]])) return structuredToTable(obj[keys[0]]);
    return { headers: keys, rows: [keys.map(k => flattenCell(obj[k]))], raw: value };
  }
  return { headers: ['value'], rows: [[flattenCell(value)]], raw: value };
}

function flattenCell(v: unknown): Cell {
  if (v === null || v === undefined) return '';
  if (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean') return v;
  return JSON.stringify(v);
}

function toCsv(table: Table, delim: string): string {
  return Papa.unparse(
    { fields: table.headers, data: table.rows.map(r => r.map(c => (c === null ? '' : String(c)))) },
    { delimiter: delim, newline: '\n' }
  ) + '\n';
}

function fromRaw(raw: unknown, headers: string[], rows: Cell[]): Record<string, Cell> {
  void raw;
  const o: Record<string, Cell> = {};
  headers.forEach((h, i) => { o[h] = rows[i] ?? ''; });
  return o;
}

export async function runData(ctx: RunCtx): Promise<JobResult> {
  const { file, det, action, onProgress } = ctx;
  const text = await textOf(file);
  onProgress(0.3, 'parse');

  const srcExt = det.ext === 'yml' ? 'yaml' : det.ext;
  let table: Table;
  if (srcExt === 'csv' || srcExt === 'tsv') {
    table = csvTable(text, srcExt);
  } else if (srcExt === 'json') {
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch (e) {
      throw new Error(`json_parse:${(e as Error).message}`);
    }
    table = structuredToTable(parsed);
  } else if (srcExt === 'yaml') {
    let parsed: unknown;
    try {
      parsed = YAML.parse(text);
    } catch (e) {
      throw new Error(`yaml_parse:${(e as Error).message}`);
    }
    table = structuredToTable(parsed);
  } else {
    throw new Error(`unsupported_source:${srcExt}`);
  }
  onProgress(0.6, 'convert');

  const stem = baseName(file.name);
  const rowsAsObjects = () => table.rows.map(r => fromRaw(table.raw, table.headers, r));

  let out: string;
  let ext: string;
  let mime: string;
  switch (action) {
    case 'data:csv':
      out = toCsv(table, ',');
      ext = 'csv'; mime = 'text/csv';
      break;
    case 'data:tsv':
      out = toCsv(table, '\t');
      ext = 'tsv'; mime = 'text/tab-separated-values';
      break;
    case 'data:yaml':
      out = YAML.stringify(table.raw ?? rowsAsObjects(), { lineWidth: 0 });
      ext = 'yaml'; mime = 'text/yaml';
      break;
    case 'data:json':
    default:
      out = JSON.stringify(table.raw ?? rowsAsObjects(), null, 2) + '\n';
      ext = 'json'; mime = 'application/json';
      break;
  }

  const bytes = new TextEncoder().encode(out);
  onProgress(0.9, 'write');
  return {
    blob: new Blob([bytes as unknown as BlobPart], { type: `${mime};charset=utf-8` }),
    name: `${stem}.${ext}`,
    size: bytes.length,
    saving: 0,
    note: `${table.rows.length} rows × ${table.headers.length}`
  };
}

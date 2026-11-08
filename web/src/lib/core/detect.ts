import type { Category, Detection } from './types';

/* Type detection from magic bytes. The file name is only a hint: a JPEG named
   .txt must still be read as a JPEG, and a PNG with a .jpg name is flagged. */

interface Sig {
  mime: string;
  ext: string;
  category: Category;
  label: string;
  /** bytes at offset 0, "??" matches any byte */
  head?: string;
  off?: number;
}

const SIGS: Sig[] = [
  { mime: 'image/png', ext: 'png', category: 'image', label: 'PNG', head: '89504e470d0a1a0a' },
  { mime: 'image/jpeg', ext: 'jpg', category: 'image', label: 'JPEG', head: 'ffd8ff' },
  { mime: 'image/gif', ext: 'gif', category: 'image', label: 'GIF', head: '474946383' },
  { mime: 'image/bmp', ext: 'bmp', category: 'image', label: 'BMP', head: '424d' },
  { mime: 'image/webp', ext: 'webp', category: 'image', label: 'WebP', head: '52494646????????57454250565038' },
  { mime: 'image/tiff', ext: 'tiff', category: 'image', label: 'TIFF', head: '49492a00' },
  { mime: 'image/tiff', ext: 'tiff', category: 'image', label: 'TIFF', head: '4d4d002a' },
  { mime: 'image/x-icon', ext: 'ico', category: 'image', label: 'ICO', head: '00000100' },
  { mime: 'image/jxl', ext: 'jxl', category: 'image', label: 'JPEG XL', head: '0000000c4a584c200d0a870a' },
  { mime: 'image/avif', ext: 'avif', category: 'image', label: 'AVIF', head: '????????6674797061766966', off: 0 },
  { mime: 'image/heic', ext: 'heic', category: 'image', label: 'HEIC', head: '????????6674797068656963' },
  { mime: 'image/heic', ext: 'heic', category: 'image', label: 'HEIC', head: '????????667479706d696631' },
  { mime: 'application/pdf', ext: 'pdf', category: 'pdf', label: 'PDF', head: '255044462d' },
  { mime: 'application/zip', ext: 'zip', category: 'archive', label: 'ZIP', head: '504b0304' },
  { mime: 'application/zip', ext: 'zip', category: 'archive', label: 'ZIP (empty)', head: '504b0506' },
  { mime: 'application/gzip', ext: 'gz', category: 'archive', label: 'GZIP', head: '1f8b08' },
  { mime: 'application/x-rar-compressed', ext: 'rar', category: 'archive', label: 'RAR', head: '526172211a0700' },
  { mime: 'application/x-7z-compressed', ext: '7z', category: 'archive', label: '7z', head: '377abcaf271c' },
  { mime: 'audio/mpeg', ext: 'mp3', category: 'media', label: 'MP3', head: '494433' },
  { mime: 'audio/mpeg', ext: 'mp3', category: 'media', label: 'MP3', head: 'fffb' },
  { mime: 'audio/wav', ext: 'wav', category: 'media', label: 'WAV', head: '52494646????????57415645' },
  { mime: 'audio/flac', ext: 'flac', category: 'media', label: 'FLAC', head: '664c6143' },
  { mime: 'audio/ogg', ext: 'ogg', category: 'media', label: 'OGG', head: '4f676753' },
  { mime: 'video/mp4', ext: 'mp4', category: 'media', label: 'MP4', head: '????????66747970' },
  { mime: 'video/webm', ext: 'webm', category: 'media', label: 'WebM', head: '1a45dfa3' },
  { mime: 'font/woff2', ext: 'woff2', category: 'font', label: 'WOFF2', head: '774f4632' },
  { mime: 'font/woff', ext: 'woff', category: 'font', label: 'WOFF', head: '774f4646' },
  { mime: 'font/ttf', ext: 'ttf', category: 'font', label: 'TTF', head: '00010000' },
  { mime: 'font/otf', ext: 'otf', category: 'font', label: 'OTF', head: '4f54544f' }
];

const NAME_MIME: Record<string, string> = {
  png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif',
  webp: 'image/webp', bmp: 'image/bmp', tif: 'image/tiff', tiff: 'image/tiff',
  ico: 'image/x-icon', avif: 'image/avif', heic: 'image/heic', heif: 'image/heic',
  jxl: 'image/jxl', svg: 'image/svg+xml',
  pdf: 'application/pdf', zip: 'application/zip', gz: 'application/gzip',
  tar: 'application/x-tar', rar: 'application/x-rar-compressed', '7z': 'application/x-7z-compressed',
  mp3: 'audio/mpeg', wav: 'audio/wav', flac: 'audio/flac', ogg: 'audio/ogg',
  mp4: 'video/mp4', webm: 'video/webm', mov: 'video/quicktime', mkv: 'video/x-matroska',
  csv: 'text/csv', tsv: 'text/tab-separated-values', txt: 'text/plain',
  json: 'application/json', yaml: 'text/yaml', yml: 'text/yaml',
  md: 'text/markdown', markdown: 'text/markdown', html: 'text/html', htm: 'text/html',
  xml: 'text/xml', woff2: 'font/woff2', woff: 'font/woff', ttf: 'font/ttf', otf: 'font/otf'
};

const EXT_OF: Record<string, string> = {
  'image/png': 'png', 'image/jpeg': 'jpg', 'image/gif': 'gif', 'image/webp': 'webp',
  'image/bmp': 'bmp', 'image/tiff': 'tiff', 'image/x-icon': 'ico', 'image/avif': 'avif',
  'image/heic': 'heic', 'image/jxl': 'jxl', 'image/svg+xml': 'svg',
  'application/pdf': 'pdf', 'application/zip': 'zip', 'application/gzip': 'gz',
  'application/x-tar': 'tar', 'application/x-rar-compressed': 'rar',
  'application/x-7z-compressed': '7z',
  'audio/mpeg': 'mp3', 'audio/wav': 'wav', 'audio/flac': 'flac', 'audio/ogg': 'ogg',
  'video/mp4': 'mp4', 'video/webm': 'webm',
  'text/csv': 'csv', 'text/tab-separated-values': 'tsv', 'text/plain': 'txt',
  'application/json': 'json', 'text/yaml': 'yaml', 'text/markdown': 'md',
  'text/html': 'html', 'text/xml': 'xml',
  'font/woff2': 'woff2', 'font/woff': 'woff', 'font/ttf': 'ttf', 'font/otf': 'otf'
};

export function extOfName(name: string): string {
  const m = /\.([a-z0-9]+)$/i.exec(name);
  return m ? m[1].toLowerCase() : '';
}

export function baseName(name: string): string {
  return name.replace(/\.[^./\\]+$/, '');
}

export function mimeForExt(ext: string): string | undefined {
  return NAME_MIME[ext];
}

export function extForMime(mime: string): string {
  return EXT_OF[mime] ?? 'bin';
}

function hex(b: Uint8Array, n: number): string {
  let s = '';
  for (let i = 0; i < Math.min(n, b.length); i++) s += b[i].toString(16).padStart(2, '0');
  return s;
}

function matchHead(head: string, hexed: string): boolean {
  if (head.length > hexed.length) return false;
  for (let i = 0; i < head.length; i++) {
    const c = head[i];
    if (c !== '?' && c !== hexed[i]) return false;
  }
  return true;
}

/** tar has "ustar" at 257; pick it up separately so the table stays readable */
function isTar(b: Uint8Array): boolean {
  if (b.length < 265) return false;
  const s = String.fromCharCode(...b.subarray(257, 262));
  return s === 'ustar';
}

const TEXT_EXT = new Set(['csv', 'tsv', 'txt', 'json', 'yaml', 'yml', 'md', 'markdown', 'html', 'htm', 'xml', 'svg', 'log', 'srt', 'vtt', 'js', 'ts', 'css']);

function decodeHead(b: Uint8Array): string {
  return new TextDecoder('utf-8', { fatal: false }).decode(b.subarray(0, Math.min(b.length, 4096)));
}

/** Heuristics for text formats: the name decides, the content confirms. */
function detectText(b: Uint8Array, name: string): Detection | null {
  const ext = extOfName(name);
  const head = decodeHead(b);
  if (head.trimStart().startsWith('<?xml') && /<svg[\s>]/i.test(head)) {
    return det('image/svg+xml', 'svg', 'image', 'SVG', ext === 'svg');
  }
  if (/^\s*<svg[\s>]/i.test(head)) return det('image/svg+xml', 'svg', 'image', 'SVG', ext === 'svg');

  const trimmed = head.trimStart();
  if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
    try {
      JSON.parse(decodeHead(b).length < 4096 ? decodeHead(b) : head);
      return det('application/json', 'json', 'data', 'JSON', ext === 'json');
    } catch {
      /* not JSON, keep going */
    }
  }
  // YAML: the name says so, or the first non-blank lines look like "key: value"
  if (ext === 'yaml' || ext === 'yml' || looksLikeYaml(head)) {
    return det('text/yaml', 'yaml', 'data', 'YAML', ext === 'yaml' || ext === 'yml');
  }
  if (ext === 'csv' || ext === 'tsv') {
    const isTsv = ext === 'tsv';
    return det(isTsv ? 'text/tab-separated-values' : 'text/csv', ext, 'data',
      isTsv ? 'TSV' : 'CSV', true);
  }
  if (ext === 'md' || ext === 'markdown') return det('text/markdown', 'md', 'text', 'Markdown', true);
  if (ext === 'html' || ext === 'htm') return det('text/html', 'html', 'text', 'HTML', true);
  if (ext === 'srt' || ext === 'vtt') return det('text/plain', ext, 'text', ext.toUpperCase(), true);
  if (TEXT_EXT.has(ext)) return det('text/plain', ext, 'text', 'Text', true);
  if (ext) return null;
  // no extension: sniff for a CSV-ish or prose-ish body
  if (/^[^\n]*,[^\n]*\n/.test(head)) return det('text/csv', 'csv', 'data', 'CSV', true);
  if (/^[\x20-\x7e\t\r\n]+$/.test(head.slice(0, 512)) && head.length > 0) {
    return det('text/plain', 'txt', 'text', 'Text', true);
  }
  return null;
}

function looksLikeYaml(head: string): boolean {
  const lines = head.split(/\r?\n/).slice(0, 12);
  let pairs = 0;
  let dashes = 0;
  for (const l of lines) {
    if (/^\s*[A-Za-z0-9_.-]+\s*:(\s|$)/.test(l)) pairs++;
    if (/^\s*-\s+\S/.test(l)) dashes++;
  }
  // a JSON body would already have been caught above, so treat "key: value"
  // and "- key: value" lists as YAML
  if (/^\s*[{[]/.test(head.trimStart())) return false;
  return pairs >= 1 || (dashes >= 1 && pairs >= 1);
}

function det(mime: string, ext: string, category: Category, label: string, nameMatches: boolean): Detection {
  return { mime, ext, category, label, mismatch: !nameMatches, confidence: 'high' };
}

export async function detectFile(file: File): Promise<Detection> {
  const slice = new Uint8Array(await file.slice(0, 4096).arrayBuffer());
  const hexed = hex(slice, 4096);
  const nameExt = extOfName(file.name);

  for (const sig of SIGS) {
    if (!sig.head) continue;
    const off = sig.off ?? 0;
    const view = off === 0 ? hexed : hex(slice.subarray(off), 4096);
    if (matchHead(sig.head, view)) {
      const nameExtNormalized = nameExt === 'jpeg' ? 'jpg' : nameExt === 'tif' ? 'tiff' : nameExt;
      const ok = nameExtNormalized === sig.ext || (sig.ext === 'jpg' && nameExt === 'jpeg') ||
        (sig.ext === 'zip' && (nameExt === 'zip' || nameExt === '')) ||
        (sig.ext === 'jpg' && (nameExt === 'jfif' || nameExt === 'jpe'));
      return {
        mime: sig.mime, ext: sig.ext, category: sig.category, label: sig.label,
        mismatch: nameExt !== '' && !ok, confidence: 'high'
      };
    }
  }
  if (isTar(slice)) {
    return { mime: 'application/x-tar', ext: 'tar', category: 'archive', label: 'TAR', mismatch: nameExt !== 'tar', confidence: 'high' };
  }

  const text = detectText(slice, file.name);
  if (text) {
    // text bodies are a guess: the name may disagree without being "wrong"
    return { ...text, mismatch: false, confidence: 'low' };
  }

  const byName = NAME_MIME[nameExt];
  if (byName) {
    return {
      mime: byName, ext: nameExt, category: catOfMime(byName), label: byName.split('/')[1].toUpperCase(),
      mismatch: false, confidence: 'low'
    };
  }
  return { mime: 'application/octet-stream', ext: nameExt || 'bin', category: 'unknown', label: 'File', mismatch: false, confidence: 'low' };
}

export function catOfMime(mime: string): Category {
  if (mime.startsWith('image/')) return 'image';
  if (mime === 'application/pdf') return 'pdf';
  if (mime.startsWith('font/')) return 'font';
  if (mime.startsWith('audio/') || mime.startsWith('video/')) return 'media';
  if (['application/zip', 'application/gzip', 'application/x-tar', 'application/x-rar-compressed', 'application/x-7z-compressed'].includes(mime)) return 'archive';
  if (mime.startsWith('text/') || mime === 'application/json') {
    if (['text/csv', 'text/tab-separated-values', 'application/json', 'text/yaml'].includes(mime)) return 'data';
    return 'text';
  }
  return 'unknown';
}

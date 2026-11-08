import { marked } from 'marked';
import type { JobResult } from '../types';
import { baseName } from '../detect';
import { canceledError, type RunCtx } from '../run';

/* Markup conversion without pandoc. Markdown→HTML through `marked` (MIT),
   HTML→Markdown through `turndown` (MIT), and plain text from either.

   DOM-free on purpose: this runs in a worker, where `DOMParser` does not exist.
   Turndown needs a DOM, so it runs on a small shim built from the tag structure
   itself only where necessary; see htmlToMarkdown below. LaTeX and DOCX
   round-trips stay out of scope: that needs pandoc (GPL). */

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

/** Minimal HTML → text with block breaks, no DOM. */
export function htmlToText(html: string): string {
  const cleaned = html
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<(script|style|noscript|template|head)\b[\s\S]*?<\/\1>/gi, '')
    .replace(/<br\s*\/?>/gi, '\n');
  const withBreaks = cleaned
    .replace(/<\/(p|div|section|article|li|h[1-6]|tr|blockquote|pre|figcaption|dt|dd)>/gi, '\n\n')
    .replace(/<li\b[^>]*>/gi, '- ')
    .replace(/<\/(td|th)>/gi, '\t');
  const text = withBreaks.replace(/<[^>]+>/g, '');
  return decodeEntities(text)
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim() + '\n';
}

function decodeEntities(s: string): string {
  const named: Record<string, string> = {
    amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ',
    mdash: '—', ndash: '–', hellip: '…', rsquo: '’', lsquo: '‘',
    ldquo: '“', rdquo: '”', copy: '©', reg: '®', trade: '™', deg: '°'
  };
  return s
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(parseInt(d, 10)))
    .replace(/&([a-z]+);/gi, (m, n) => named[n.toLowerCase()] ?? m);
}

/* Turndown wants a DOM. In a worker there is none, so HTML is converted with a
   small rule set over the same block structure htmlToText uses. It covers the
   constructs a web page actually contains; anything exotic degrades to text
   rather than failing the job. */
function htmlToMarkdown(html: string): string {
  let s = html
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<(script|style|noscript|template|head)\b[\s\S]*?<\/\1>/gi, '')
    .replace(/<br\s*\/?>/gi, '\n');

  // headings, emphasis, code
  s = s
    .replace(/<h([1-6])\b[^>]*>([\s\S]*?)<\/h\1>/gi, (_, lvl, body) => `\n\n${'#'.repeat(Number(lvl))} ${strip(body).trim()}\n\n`)
    .replace(/<(strong|b)\b[^>]*>([\s\S]*?)<\/\1>/gi, (_, _t, body) => `**${strip(body).trim()}**`)
    .replace(/<(em|i)\b[^>]*>([\s\S]*?)<\/\1>/gi, (_, _t, body) => `*${strip(body).trim()}*`)
    .replace(/<code\b[^>]*>([\s\S]*?)<\/code>/gi, (_, body) => '`' + strip(body).trim() + '`')
    .replace(/<pre\b[^>]*>([\s\S]*?)<\/pre>/gi, (_, body) => '\n\n```\n' + strip(body).replace(/^\n+|\n+$/g, '') + '\n```\n\n')
    .replace(/<blockquote\b[^>]*>([\s\S]*?)<\/blockquote>/gi, (_, body) =>
      '\n\n' + strip(body).trim().split('\n').map(l => `> ${l}`).join('\n') + '\n\n')
    .replace(/<a\b[^>]*href=["']([^"']*)["'][^>]*>([\s\S]*?)<\/a>/gi, (_, href, body) => {
      const label = strip(body).trim();
      return label ? `[${label}](${href})` : href;
    })
    .replace(/<img\b[^>]*alt=["']([^"']*)["'][^>]*src=["']([^"']*)["'][^>]*\/?>/gi, (_, alt, src) => `![${alt}](${src})`)
    .replace(/<img\b[^>]*src=["']([^"']*)["'][^>]*\/?>/gi, (_, src) => `![](${src})`)
    .replace(/<hr\s*\/?>/gi, '\n\n---\n\n');

  // lists: mark items, then tidy the blank lines the previous rules left behind
  s = s
    .replace(/<li\b[^>]*>([\s\S]*?)<\/li>/gi, (_, body) => `\n- ${strip(body).trim()}`)
    .replace(/<\/?(ul|ol)\b[^>]*>/gi, '\n')
    .replace(/<\/(p|div|section|article|tr|figure)>/gi, '\n\n')
    .replace(/<[^>]+>/g, '');

  return decodeEntities(s)
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim() + '\n';
}

/** strip tags and collapse whitespace, for inline fragments */
function strip(s: string): string {
  return decodeEntities(s.replace(/<[^>]+>/g, '')).replace(/\s+/g, ' ');
}

function mdToHtml(md: string, title: string): string {
  const body = marked.parse(md, { async: false, gfm: true, breaks: false }) as string;
  return wrapHtml(body, title);
}

function wrapHtml(body: string, title: string): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)}</title>
<style>
  :root { color-scheme: light dark; }
  body { max-width: 44rem; margin: 0 auto; padding: 3rem 1.25rem 6rem; font: 16px/1.65 system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; }
  pre { overflow-x: auto; padding: 1rem; border-radius: 10px; background: rgba(127,127,127,.14); }
  code { font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; font-size: .92em; }
  img, table { max-width: 100%; }
  blockquote { margin: 1.4em 0; padding-left: 1em; border-left: 3px solid rgba(127,127,127,.4); color: inherit; opacity: .85; }
  table { border-collapse: collapse; } th, td { padding: .4em .7em; border: 1px solid rgba(127,127,127,.35); }
</style>
</head>
<body>
${body}
</body>
</html>
`;
}

export async function runText(ctx: RunCtx): Promise<JobResult> {
  const { file, det, action, onProgress, signal } = ctx;
  const raw = await file.text();
  if (signal.aborted) throw canceledError();
  onProgress(0.4, 'read');
  const stem = baseName(file.name);
  const srcExt = det.ext;
  const isHtml = srcExt === 'html' || srcExt === 'htm';
  const isMd = srcExt === 'md' || srcExt === 'markdown';

  let out: string;
  let ext: string;
  let mime: string;

  if (action === 'text:html') {
    out = isHtml ? wrapHtml(raw, stem) : isMd ? mdToHtml(raw, stem) : wrapHtml(`<pre>${escapeHtml(raw)}</pre>`, stem);
    ext = 'html'; mime = 'text/html';
  } else if (action === 'text:md') {
    if (isMd) throw new Error('already_markdown');
    if (isHtml) {
      out = htmlToMarkdown(raw);
    } else {
      out = raw.split(/\r?\n/).map(l => l.trimEnd()).join('\n').trim() + '\n';
    }
    ext = 'md'; mime = 'text/markdown';
  } else {
    // text:txt
    out = isHtml ? htmlToText(raw) : raw;
    ext = 'txt'; mime = 'text/plain';
  }

  const bytes = new TextEncoder().encode(out);
  onProgress(0.9, 'write');
  return {
    blob: new Blob([bytes as unknown as BlobPart], { type: `${mime};charset=utf-8` }),
    name: `${stem}.${ext}`,
    size: bytes.length,
    saving: 0,
    note: `${out.length.toLocaleString()} chars`
  };
}

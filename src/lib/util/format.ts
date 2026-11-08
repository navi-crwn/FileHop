import { i18n } from '../i18n/index.svelte';

export function fmtSize(bytes: number): string {
  const b = i18n.t('size.b');
  if (!Number.isFinite(bytes) || bytes < 0) return `0 ${b}`;
  if (bytes < 1024) return `${bytes} ${b}`;
  const kb = bytes / 1024;
  if (kb < 1024) return `${kb < 10 ? kb.toFixed(1) : Math.round(kb)} ${i18n.t('size.kb')}`;
  const mb = kb / 1024;
  if (mb < 1024) return `${mb < 10 ? mb.toFixed(1) : Math.round(mb)} ${i18n.t('size.mb')}`;
  const gb = mb / 1024;
  return `${gb < 10 ? gb.toFixed(2) : gb.toFixed(1)} ${i18n.t('size.gb')}`;
}

export function fmtPct(v: number): string {
  return `${Math.round(Math.abs(v) * 100)}%`;
}

export function fmtNum(n: number, locale: string): string {
  try {
    return new Intl.NumberFormat(locale).format(n);
  } catch {
    return String(n);
  }
}

export function safeFileName(name: string): string {
  // keep the extension, strip what file systems dislike
  const clean = name
    .replace(/[\\/:*?"<>|\u0000-\u001f]/g, '-')
    .replace(/\s+/g, ' ')
    .trim();
  return clean.slice(0, 180) || 'file';
}

export function download(blob: Blob, name: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = safeFileName(name);
  a.rel = 'noopener';
  document.body.appendChild(a);
  a.click();
  a.remove();
  // give the browser a moment to start the write before revoking
  setTimeout(() => URL.revokeObjectURL(url), 20_000);
}

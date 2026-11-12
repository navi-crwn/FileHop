// "Save to PixelHop": the page side. Pure helpers (which results qualify, which message an error
// code gets) plus the one same-origin call. The file goes to FileHop's own endpoint, which signs it
// and forwards it to PixelHop; the page never talks to PixelHop with the file.

/** The kinds PixelHop's store accepts from FileHop (it checks the bytes itself). */
const TYPES: Record<string, string> = {
  png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp', bmp: 'image/bmp', pdf: 'application/pdf'
};
const MIMES = new Set(Object.values(TYPES));

/** Does a finished result qualify for the action? `max` is the size cap the server advertises. */
export function canSaveToPixelHop(r: { name: string; size: number; blob: { type: string } } | undefined, max: number): boolean {
  if (!r || r.size <= 0 || r.size > max) return false;
  const ext = r.name.split('.').pop()?.toLowerCase() ?? '';
  return MIMES.has(r.blob.type) || (!r.blob.type && ext in TYPES);
}

const KNOWN = ['no_account', 'quota_exceeded', 'too_large', 'unsupported_type', 'rate_limited', 'not_signed_in', 'busy'];

/** The translation key for an error code from the server; anything unknown is a plain failure. */
export function saveErrorKey(code: unknown): string {
  return 'save.err_' + (typeof code === 'string' && KNOWN.includes(code) ? code : 'failed');
}

export type SaveResult = { ok: true; pageUrl: string; duplicate: boolean } | { ok: false; error: string };

/** Sends one result file through FileHop's server to the member's PixelHop library. */
export async function saveToPixelHop(blob: Blob, name: string, fetcher: typeof fetch = fetch): Promise<SaveResult> {
  try {
    // the name goes in a header, not the address, so it never shows in an access log of this app
    const res = await fetcher('/api/v1/pixelhop/save', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'X-Requested-With': 'filehop', 'X-FileHop-Name': encodeURIComponent(Array.from(name).slice(0, 200).join('')), 'Content-Type': 'application/octet-stream' },
      body: blob
    });
    const j = await res.json().catch(() => null);
    if (res.ok && j?.ok === true) {
      // stored is stored: a missing or odd page address only means there is nothing to link to.
      // The server has already checked the host (PixelHop's own, its link host or the family domain), so
      // only the scheme is checked here: https, or http while this page itself is plain http (a local or
      // self-hosted copy without TLS, whose PixelHop is plain http too).
      const plain = typeof location !== 'undefined' && location.protocol === 'http:';
      const page = typeof j.page_url === 'string' && (j.page_url.startsWith('https://') || (plain && j.page_url.startsWith('http://'))) ? j.page_url : '';
      return { ok: true, pageUrl: page, duplicate: j.duplicate === true };
    }
    if (typeof j?.error === 'string') return { ok: false, error: j.error };
    // an answer that is not ours (a proxy's HTML page): 413 can only mean too large, 503 only busy
    return { ok: false, error: res.status === 413 ? 'too_large' : res.status === 503 ? 'busy' : 'failed' };
  } catch {
    return { ok: false, error: 'failed' };
  }
}

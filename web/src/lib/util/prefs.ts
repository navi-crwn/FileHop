/* The family's preference cookies, shared by every HOP app: hop_theme (light | dark) and hop_lang (one
   of the nine languages). On *.hel.ink they are set for the whole family (domain=.hel.ink, Secure);
   anywhere else (localhost, a self-hosted copy) for this host only. Plain text, never HttpOnly: the
   other apps read them from scripts too. public/theme.js and public/changelog.js write the same
   string by hand (they cannot import this module); a unit test keeps the three equal. */

export const FAMILY_HOST = /(^|\.)hel\.ink$/;

/** The Set-Cookie text for a family preference on this host. */
export function prefCookie(name: string, value: string, host: string): string {
  return `${name}=${value}; Path=/; Max-Age=31536000; SameSite=Lax${FAMILY_HOST.test(host) ? '; domain=.hel.ink; Secure' : ''}`;
}

/** A cookie's value, or null. */
export function readCookie(name: string, cookies: string): string | null {
  const m = cookies.match(new RegExp('(?:^|; )' + name + '=([^;]*)'));
  return m ? m[1] : null;
}

export function getPref(name: string): string | null {
  try { return readCookie(name, document.cookie); } catch { return null; }
}

export function setPref(name: string, value: string): void {
  try { document.cookie = prefCookie(name, value, location.hostname); } catch { /* cookies blocked */ }
}

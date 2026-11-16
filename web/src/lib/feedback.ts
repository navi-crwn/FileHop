/* The Feedback link: it opens the HOP ID form in a new tab, nothing else. The address is built from the hub
   address this app already uses for the family announcement (hub_url of /api/v1/me), the screen name (never the
   real address) and the running version. Without a hub address there is no link at all.
   The contract is F-1 of the family feedback checklist: app, from (A-Za-z0-9._:/{}- up to 80), v (A-Za-z0-9.+- up to 24).
   internal/app/feedback.go builds the same address for the pages the server paints. */

export const FEEDBACK_APP = 'filehop';

// Screen names are fixed per route, so what the person is looking at never reaches the hub: no ids, send codes, queries or fragments.
const SCREENS: Record<string, string> = { '/': 'home', '/send': 'send', '/dashboard': 'dashboard', '/changelog': 'changelog' };

export function screenName(path: string): string {
  const p = String(path ?? '').split(/[?#]/)[0].replace(/\/+$/, '') || '/';
  return Object.prototype.hasOwnProperty.call(SCREENS, p) ? SCREENS[p] : 'other';
}

/** The hub address without a trailing slash, or '' when it is empty or not an http(s) address. */
export function hubBase(hubUrl: string): string {
  try {
    const u = new URL(String(hubUrl ?? ''));
    if (u.protocol !== 'https:' && u.protocol !== 'http:') return '';
    return u.origin + u.pathname.replace(/\/+$/, '');
  } catch {
    return '';
  }
}

/** {hub}/feedback?app=filehop&from=<screen>&v=<version>, or '' (no link) without a usable hub address. */
export function feedbackUrl(hubUrl: string, path: string, version: string): string {
  const base = hubBase(hubUrl);
  if (!base) return '';
  const from = screenName(path).replace(/[^A-Za-z0-9._:/{}-]/g, '').slice(0, 80);
  const v = String(version ?? '').replace(/[^A-Za-z0-9.+-]/g, '').slice(0, 24);
  const q = new URLSearchParams({ app: FEEDBACK_APP });
  if (from) q.set('from', from);
  if (v) q.set('v', v);
  return base + '/feedback?' + q.toString();
}

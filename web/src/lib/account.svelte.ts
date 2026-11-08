/* Who is signed in, if anyone. The converter never needs this: a guest has the
   whole app. It only decides what the account control in the topbar shows.

   The Go server answers /api/v1/me; the static dev servers (vite, tools/serve.mjs)
   answer with the HTML shell instead, which is read as "sign-in not set up" and
   hides the control, so the standalone build keeps working unchanged. */

export interface Account {
  ready: boolean;
  sso: boolean;
  signedIn: boolean;
  name: string;
  email: string;
  hubUrl: string;
  logoutUrl: string;
}

export const account: Account = $state({
  ready: false,
  sso: false,
  signedIn: false,
  name: '',
  email: '',
  hubUrl: '',
  logoutUrl: ''
});

export async function loadAccount(): Promise<void> {
  try {
    const res = await fetch('/api/v1/me', { headers: { accept: 'application/json' }, credentials: 'same-origin' });
    if (!res.ok || !(res.headers.get('content-type') ?? '').includes('application/json')) return;
    const me = await res.json();
    account.sso = me.sso === true;
    account.signedIn = me.signed_in === true;
    account.name = typeof me.name === 'string' ? me.name : '';
    account.email = typeof me.email === 'string' ? me.email : '';
    account.hubUrl = typeof me.hub_url === 'string' ? me.hub_url : '';
    account.logoutUrl = typeof me.logout_url === 'string' ? me.logout_url : '';
  } catch {
    /* offline or no server: stay a guest */
  } finally {
    account.ready = true;
  }
}

/** Two letters for the avatar circle; no remote picture (COEP would block it anyway). */
export function initials(name: string, email: string): string {
  const src = (name || email.split('@')[0] || '?').trim();
  const parts = src.split(/[\s._-]+/).filter(Boolean);
  const letters = parts.length > 1 ? parts[0][0] + parts[1][0] : src.slice(0, 2);
  return letters.toUpperCase();
}

/** The sign-in error code the server put in ?auth=, removed from the address bar once read. */
export function takeAuthError(): string | null {
  const url = new URL(location.href);
  const code = url.searchParams.get('auth');
  if (!code) return null;
  url.searchParams.delete('auth');
  history.replaceState(null, '', url.pathname + url.search + url.hash);
  return ['expired', 'invalid', 'suspended', 'failed'].includes(code) ? code : 'failed';
}

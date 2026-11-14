/* Runs before first paint so the saved theme never flashes.
   An external file, not an inline script: the CSP has no 'unsafe-inline'
   for scripts, and a hash would have to be maintained on every edit.
   The theme is the family cookie hop_theme, which every HOP app reads and writes (any value
   other than light or dark there means the system setting); without the cookie, this app's
   old key hop-theme, moved once into the cookie; else the system setting (in CSS). */
try {
  var m = document.cookie.match(/(?:^|; )hop_theme=([^;]*)/);
  var t = m ? m[1] : null;
  if (t === null) {
    try { t = localStorage.getItem('hop-theme'); } catch (e) { t = null; }
    if (t === 'light' || t === 'dark') {
      document.cookie = 'hop_theme=' + t + '; Path=/; Max-Age=31536000; SameSite=Lax' + (/(^|\.)hel\.ink$/.test(location.hostname) ? '; domain=.hel.ink; Secure' : '');
    }
  }
  if (t === 'light' || t === 'dark') document.documentElement.dataset.theme = t;
  if (/(?:^|; )hop_ui=clean(?:;|$)/.test(document.cookie)) document.documentElement.dataset.ui = 'clean';
  /* The family colour palette (hop_palette: classic | mist | sand), on the dashboard only: the public pages stay classic.
     Classic, anything else or no cookie means no attribute. Only scripts write the cookie; the server never reads it. */
  var pm = document.cookie.match(/(?:^|; )hop_palette=([^;]*)/), pal = pm ? decodeURIComponent(pm[1]) : null;
  if ((pal === 'mist' || pal === 'sand') && /^\/dashboard(\/|$)/.test(location.pathname)) document.documentElement.dataset.palette = pal;
} catch (e) {
  /* cookies blocked: fall back to the system preference in CSS */
}

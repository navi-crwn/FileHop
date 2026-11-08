/* Runs before first paint so the saved theme never flashes.
   An external file, not an inline script: the CSP has no 'unsafe-inline'
   for scripts, and a hash would have to be maintained on every edit. */
try {
  var t = localStorage.getItem('hop-theme');
  if (t === 'light' || t === 'dark') document.documentElement.dataset.theme = t;
} catch (e) {
  /* private mode: fall back to the system preference in CSS */
}

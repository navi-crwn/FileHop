/* /changelog: theme button and remembered language. An external file because the CSP has no
   'unsafe-inline' for scripts. Uses the same storage keys as the app (hop-theme, hop-lang). */
(function () {
  var LANGS = ['en', 'zh-CN', 'de', 'id', 'ja', 'pt-BR', 'es', 'fr', 'ru'];
  var root = document.documentElement;
  try {
    var q = new URLSearchParams(location.search);
    var saved = localStorage.getItem('hop-lang');
    // No explicit ?lang=: use the language chosen in the app, if it differs from what the server picked.
    if (!q.get('lang') && saved && LANGS.indexOf(saved) >= 0 && saved !== root.lang) {
      q.set('lang', saved);
      location.replace(location.pathname + '?' + q.toString());
      return;
    }
  } catch (e) { /* storage blocked: keep the server's choice */ }

  document.querySelectorAll('a[data-lang]').forEach(function (a) {
    a.addEventListener('click', function () {
      try { localStorage.setItem('hop-lang', a.getAttribute('data-lang')); } catch (e) { /* ignore */ }
    });
  });

  var btn = document.getElementById('theme');
  if (btn) {
    btn.addEventListener('click', function () {
      var dark = root.dataset.theme ? root.dataset.theme === 'dark' : !matchMedia('(prefers-color-scheme: light)').matches;
      var next = dark ? 'light' : 'dark';
      root.dataset.theme = next;
      try { localStorage.setItem('hop-theme', next); } catch (e) { /* ignore */ }
    });
  }
})();

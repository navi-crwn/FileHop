/* /changelog: theme button and remembered language. An external file because the CSP has no
   'unsafe-inline' for scripts. Uses the family cookies (hop_theme, hop_lang: every HOP app reads them)
   and keeps the app's old keys (hop-theme, hop-lang) up to date, as the app does. */
(function () {
  var LANGS = ['en', 'zh-CN', 'de', 'id', 'ja', 'pt-BR', 'es', 'fr', 'ru'];
  var root = document.documentElement;
  // as web/src/lib/util/prefs.ts: for the whole family on *.hel.ink, for this host elsewhere
  function setPref(name, value) {
    try { document.cookie = name + '=' + value + '; Path=/; Max-Age=31536000; SameSite=Lax' + (/(^|\.)hel\.ink$/.test(location.hostname) ? '; domain=.hel.ink; Secure' : ''); } catch (e) { /* ignore */ }
  }
  try {
    var q = new URLSearchParams(location.search);
    // the server already follows ?lang= and the hop_lang cookie; the old key is only read without them
    var family = (document.cookie.match(/(?:^|; )hop_lang=([^;]*)/) || [])[1];
    var saved = LANGS.indexOf(family) >= 0 ? null : localStorage.getItem('hop-lang');
    // No explicit ?lang=: use the language chosen in the app, if it differs from what the server picked.
    if (!q.get('lang') && saved && LANGS.indexOf(saved) >= 0 && saved !== root.lang) {
      q.set('lang', saved);
      location.replace(location.pathname + '?' + q.toString());
      return;
    }
  } catch (e) { /* storage blocked: keep the server's choice */ }

  document.querySelectorAll('a[data-lang]').forEach(function (a) {
    a.addEventListener('click', function () {
      setPref('hop_lang', a.getAttribute('data-lang'));
      try { localStorage.setItem('hop-lang', a.getAttribute('data-lang')); } catch (e) { /* ignore */ }
    });
  });

  var btn = document.getElementById('theme');
  if (btn) {
    btn.addEventListener('click', function () {
      var dark = root.dataset.theme ? root.dataset.theme === 'dark' : !matchMedia('(prefers-color-scheme: light)').matches;
      var next = dark ? 'light' : 'dark';
      root.dataset.theme = next;
      setPref('hop_theme', next);
      try { localStorage.setItem('hop-theme', next); } catch (e) { /* ignore */ }
    });
  }

  // Account control, as in the app: /api/v1/me tells whether someone is signed in.
  var acct = document.getElementById('acct');
  if (acct) {
    fetch('/api/v1/me', { credentials: 'same-origin' }).then(function (r) { return r.json(); }).then(function (me) {
      var hub = (me.hub_url || '').replace(/\/+$/, '');
      if (me.signed_in && hub) {
        document.querySelectorAll('a[data-app]').forEach(function (a) {
          var slug = a.getAttribute('data-app');
          a.href = slug === 'hub' ? hub + '/dashboard' : hub + '/apps/' + slug;
        });
      }
      var d = acct.dataset;
      if (me.signed_in) {
        // a signed-in person goes back to the dashboard, not to the public home page
        document.querySelectorAll('a.brand, #add, p.back a').forEach(function (a) { a.href = '/dashboard'; });
        var name = me.name || me.email || '';
        var ini = (name.match(/\S/g) || ['?']).slice(0, 2).join('').toUpperCase();
        var det = document.createElement('details');
        det.className = 'acct';
        var sum = document.createElement('summary');
        sum.setAttribute('aria-label', d.menu);
        sum.title = me.email || name;
        var av = document.createElement('span'); av.className = 'avatar'; av.textContent = ini;
        var nm = document.createElement('span'); nm.className = 'acct-name'; nm.textContent = name;
        sum.append(av, nm);
        var menu = document.createElement('div'); menu.className = 'acct-menu';
        var p = document.createElement('p'); p.append(d.in, document.createElement('br'));
        var st = document.createElement('strong'); st.textContent = me.email || name; p.append(st);
        menu.append(p);
        var dsh = document.createElement('a'); dsh.href = '/dashboard'; dsh.textContent = d.dash; menu.append(dsh);
        if (hub) { var h = document.createElement('a'); h.href = hub; h.textContent = d.hub; menu.append(h); }
        var o = document.createElement('a'); o.href = me.logout_url || '/auth/sso/logout'; o.textContent = d.out; menu.append(o);
        det.append(sum, menu);
        acct.replaceWith(det);
      } else if (me.sso) {
        var a = document.createElement('a');
        a.className = 'btn'; a.href = '/auth/sso?next=%2Fchangelog'; a.textContent = d.sign;
        acct.replaceWith(a);
      }
    }).catch(function () { /* offline: no account control */ });
  }
})();

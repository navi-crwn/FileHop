<script lang="ts">
  import { onMount, tick } from 'svelte';
  import Icon from './lib/components/Icon.svelte';
  import JobCard from './lib/components/JobCard.svelte';
  import FormatRing from './lib/components/FormatRing.svelte';
  import SettingsDrawer from './lib/components/SettingsDrawer.svelte';
  import { i18n, guessLocale, chooseLocale, actionLabel, LOCALES, LOCALE_NAMES } from './lib/i18n/index.svelte';
  import { getPref, setPref } from './lib/util/prefs';
  import { Queue } from './lib/store/queue.svelte';
  import { Pool, hardwareSlots } from './lib/core/pool';
  import { detectFile } from './lib/core/detect';
  import { targetsFor, actionDef, isAbsorbed, mergeCarrier, mergeMembers } from './lib/core/actions';
  import type { ActionId, Category, Job } from './lib/core/types';
  import { download, safeFileName } from './lib/util/format';
  import { confirmAction } from './lib/util/confirm';
  import { zipSync } from 'fflate';
  import Announcement from './lib/components/Announcement.svelte';
  import { account, loadAccount, initials, takeAuthError, takeRecheckMark, recheckQuietly } from './lib/account.svelte';

  /* The other HOP apps, as the family manifest (hel.ink/hop-assets/apps.json) lists them.
     Written out rather than fetched: the page loads nothing from another origin. */
  const FAMILY = [
    { slug: 'hub', name: 'HOP ID', url: 'https://hel.ink', mark: '/hop-id-mark.png' },
    { slug: 'linkhop', name: 'LinkHop', url: 'https://link.hel.ink', mark: '/hop-marks/linkhop.svg' },
    { slug: 'biohop', name: 'BioHop', url: 'https://bio.hel.ink', mark: '/hop-marks/biohop.svg' },
    { slug: 'pixelhop', name: 'PixelHop', url: 'https://pixel.hel.ink', mark: '/hop-marks/pixelhop.svg' },
    { slug: 'notehop', name: 'NoteHop', url: 'https://note.hel.ink', mark: '/hop-marks/notehop.svg' },
    { slug: 'payhop', name: 'PayHop', url: 'https://pay.hel.ink', mark: '/hop-marks/payhop.svg' }
  ];

  /* Signed in through the hub, another app opens through the hub's launcher (/apps/{slug}),
     which signs the person in there too; the bare address would land them signed out in an
     app they have not used yet. Signed out, the public address is the right one. */
  function familyHref(app: (typeof FAMILY)[number]): string {
    if (!account.signedIn || !account.hubUrl) return app.url;
    const hub = account.hubUrl.replace(/\/+$/, '');
    return app.slug === 'hub' ? `${hub}/dashboard` : `${hub}/apps/${app.slug}`;
  }

  /* ------------------------------------------------------------------ state */

  /* /dashboard is the same app for someone signed in with HOP ID: the workspace
     without the marketing page, inside the family's dashboard chrome. The server
     only serves it to a verified session; this is the page's own check. */
  const dash = typeof location !== 'undefined' && location.pathname.replace(/\/+$/, '') === '/dashboard';
  /* /send is the other half of the app: a file straight from one device to another. It sits in the
     same chrome as the dashboard, but needs no account, so guests get it too. */
  const sendPage = typeof location !== 'undefined' && location.pathname.replace(/\/+$/, '') === '/send';
  let navOpen = $state(false);
  /* Where the logo, Convert and the main button of /send lead: a signed-in person's dashboard, a visitor's home page. */
  const home = $derived(dash || (account.ready && account.signedIn) ? '/dashboard' : '/');

  let locale = $state(guessLocale());
  let settingsOpen = $state(false);
  let langOpen = $state(false);
  let langBtn = $state<HTMLButtonElement>();
  let langList = $state<HTMLElement>();
  const langCode = (l: string) => l.split('-')[0].toUpperCase();

  function openLang() {
    langOpen = true;
    queueMicrotask(() => (langList?.querySelector<HTMLElement>('[aria-selected="true"]') ?? langList?.querySelector<HTMLElement>('[role="option"]'))?.focus());
  }
  function closeLang(refocus = false) {
    langOpen = false;
    if (refocus) langBtn?.focus();
  }
  function pickLang(l: string) {
    locale = l as typeof locale;
    chooseLocale(locale);
    closeLang(true);
  }
  function onLangKey(e: KeyboardEvent) {
    const items = [...(langList?.querySelectorAll<HTMLElement>('[role="option"]') ?? [])];
    const i = items.indexOf(document.activeElement as HTMLElement);
    if (e.key === 'ArrowDown') { e.preventDefault(); items[(i + 1) % items.length]?.focus(); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); items[(i - 1 + items.length) % items.length]?.focus(); }
    else if (e.key === 'Home') { e.preventDefault(); items[0]?.focus(); }
    else if (e.key === 'End') { e.preventDefault(); items[items.length - 1]?.focus(); }
    else if (e.key === 'Tab') closeLang();
  }
  let licensesOpen = $state(false);
  let toast = $state('');
  let dragging = $state(false);
  let dragPoint = $state({ x: 0, y: 0 });
  let dragCategory = $state<Category | null>(null);
  let dragExt = $state('');
  let dragCount = $state(0);
  let maxWorkers = $state(0);
  let batterySaver = $state(false);
  let networkCount = $state(0);
  let version = $state(0);
  let toastTimer: number | undefined;
  let fileInput: HTMLInputElement;
  let acctEl = $state<HTMLDetailsElement | undefined>();

  const pool = new Pool();
  const queue = new Queue(pool, { onChange: () => bump() });

  function bump() { version++; }

  // read the version so every derived below re-runs when the queue changes
  const jobs = $derived.by(() => { void version; return [...queue.jobs]; });
  const groups = $derived.by(() => {
    void version;
    const map = new Map<Category, Job[]>();
    for (const j of queue.jobs) {
      const list = map.get(j.det.category) ?? [];
      list.push(j);
      map.set(j.det.category, list);
    }
    // a stable, sensible order: pictures first, then documents, then the rest
    const order: Category[] = ['image', 'pdf', 'data', 'text', 'archive', 'font', 'media', 'unknown'];
    return order.filter(c => map.has(c)).map(c => ({ cat: c, items: map.get(c)! }));
  });
  const doneCount = $derived.by(() => { void version; return queue.jobs.filter(j => j.status === 'done').length; });
  const totalCount = $derived.by(() => { void version; return queue.jobs.length; });
  const running = $derived.by(() => { void version; return queue.jobs.some(j => j.status === 'running'); });

  /* ------------------------------------------------------- language + theme */

  // loading a dictionary is async; the state object swaps it in and every t() repaints.
  // The tab title follows too, so a bookmark made in Japanese does not read English.
  $effect(() => {
    void i18n.load(locale).then(() => {
      document.title = i18n.t(dash ? 'dash.title' : sendPage ? 'send.title' : 'app.title');
    });
  });

  // Japanese and Chinese put no space after their punctuation, and their text wraps
  // between any two characters, which left a lone character hanging after the comma.
  // There the accent phrase starts on its own line; every other language has a space.
  const heroBreak = $derived(/[、，。]$/.test(i18n.t('hero.h1_pre')));

  let theme = $state<'dark' | 'light'>(readTheme());

  // The family cookie hop_theme first (any other value there means the system setting), then this app's
  // old key, then the system setting: the order public/theme.js used before the first paint.
  function readTheme(): 'dark' | 'light' {
    const family = getPref('hop_theme');
    if (family === 'light' || family === 'dark') return family;
    if (family === null) {
      try {
        const t = localStorage.getItem('hop-theme');
        if (t === 'light' || t === 'dark') return t;
      } catch { /* ignore */ }
    }
    return matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
  }

  function toggleTheme() {
    theme = theme === 'dark' ? 'light' : 'dark';
    document.documentElement.dataset.theme = theme;
    setPref('hop_theme', theme); // every HOP app follows it
    try { localStorage.setItem('hop-theme', theme); } catch { /* ignore */ }
  }

  $effect(() => {
    document.documentElement.dataset.theme = theme;
  });

  /* -------------------------------------------------------------- settings */

  function loadPrefs() {
    try {
      const raw = localStorage.getItem('filehop-prefs');
      if (!raw) return;
      const p = JSON.parse(raw) as { maxWorkers?: number; battery?: boolean };
      if (typeof p.maxWorkers === 'number') maxWorkers = p.maxWorkers;
      if (typeof p.battery === 'boolean') batterySaver = p.battery;
    } catch { /* first visit */ }
  }

  function savePrefs() {
    try {
      localStorage.setItem('filehop-prefs', JSON.stringify({ maxWorkers, battery: batterySaver }));
    } catch { /* ignore */ }
  }

  $effect(() => {
    loadPrefs();
  });

  $effect(() => {
    pool.reconfigure({ maxWorkers, batterySaver });
    savePrefs();
  });

  // who is signed in (HOP ID); a guest keeps the whole app
  onMount(() => {
    const justBack = takeRecheckMark();
    void loadAccount().then(() => {
      // a session the hub has not vouched for lately: ask it once, quietly, on this page load only
      // (never when files are queued or a conversion runs: leaving the page would drop them; the next load checks)
      if (!dash && !justBack && account.stale && queue.jobs.length === 0 && !running) recheckQuietly('/');
    });
    const code = takeAuthError();
    if (code) showToast(i18n.t('auth.err_' + code));
  });

  // the dashboard is for a signed-in account: if the session is gone, go through the hub and come back
  $effect(() => {
    if (dash && account.ready && !account.signedIn && account.sso) location.replace('/auth/sso?next=%2Fdashboard');
  });

  // count the network requests this tab makes, so the claim is checkable
  $effect(() => {
    if (typeof PerformanceObserver === 'undefined') return;
    try {
      const obs = new PerformanceObserver((list) => {
        networkCount += list.getEntries().length;
      });
      obs.observe({ type: 'resource', buffered: true });
      return () => obs.disconnect();
    } catch {
      return;
    }
  });

  /* --------------------------------------------------------------- helpers */

  function showToast(msg: string) {
    toast = msg;
    clearTimeout(toastTimer);
    toastTimer = window.setTimeout(() => (toast = ''), 2200);
  }

  /* ------------------------------------------------------------- add files */

  async function addFiles(files: File[]) {
    if (!files.length) return;
    const added = await queue.add(files);
    bump();
    if (!added.length) {
      showToast(i18n.t('toast.limit', { added: 0, total: files.length }));
    } else if (added.length < files.length) {
      // the 50-file cap is a product rule, not a browser limit: say it plainly
      showToast(i18n.t('toast.limit', { added: added.length, total: files.length }));
    } else {
      showToast(i18n.t('toast.added', { n: added.length }));
    }
  }

  function pickFiles() {
    fileInput?.click();
  }

  function onInputChange(e: Event) {
    const input = e.currentTarget as HTMLInputElement;
    void addFiles([...(input.files ?? [])]);
    input.value = '';
  }

  /* ---------------------------------------------------------------- drop */

  let dragDepth = 0;

  function onDragEnter(e: DragEvent) {
    if (!hasFiles(e)) return;
    e.preventDefault();
    dragDepth++;
    dragging = true;
    dragPoint = { x: e.clientX, y: e.clientY };
    void previewDrag(e.dataTransfer);
  }

  function onDragOver(e: DragEvent) {
    if (!hasFiles(e)) return;
    e.preventDefault();
    if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy';
    dragPoint = { x: e.clientX, y: e.clientY };
  }

  function onDragLeave(e: DragEvent) {
    if (!hasFiles(e)) return;
    dragDepth = Math.max(0, dragDepth - 1);
    if (dragDepth === 0) dragging = false;
    void e;
  }

  async function onDrop(e: DragEvent) {
    if (!hasFiles(e)) return;
    e.preventDefault();
    dragDepth = 0;
    dragging = false;
    dragCategory = null;
    const files = [...(e.dataTransfer?.files ?? [])];
    await addFiles(files);
  }

  function hasFiles(e: DragEvent): boolean {
    const t = e.dataTransfer;
    if (!t) return false;
    // some browsers report "Files", others "files"
    return [...t.types].some(x => x.toLowerCase() === 'files');
  }

  let previewTimer: number | undefined;
  async function previewDrag(dt: DataTransfer | null) {
    if (!dt) return;
    clearTimeout(previewTimer);
    previewTimer = window.setTimeout(async () => {
      // reading the first item's name is allowed during drag; the bytes are not
      const item = dt.items?.[0];
      if (!item || item.kind !== 'file') return;
      const probe = item.getAsFile();
      if (!probe) return;
      dragCount = dt.items.length;
      const d = await detectFile(probe);
      dragCategory = d.category;
      dragExt = d.ext;
    }, 90);
  }

  function pickFromRing(id: ActionId, files: File[]) {
    dragging = false;
    const cat = dragCategory;
    dragCategory = null;
    if (files.length) {
      // the ring item took the drop: add the files and set the chosen target
      void (async () => {
        const added = await queue.add(files);
        for (const j of added) {
          queue.setAction(j, id);
        }
        bump();
      })();
      return;
    }
    if (cat) queue.setActionForCategory(cat, id);
    bump();
  }

  /* ----------------------------------------------------------- clipboard */

  function onPaste(e: ClipboardEvent) {
    const items = e.clipboardData?.items;
    if (!items) return;
    const files: File[] = [];
    for (const it of items) {
      if (it.kind === 'file') {
        const f = it.getAsFile();
        if (f) {
          // a pasted screenshot has no name; give it one the encoders accept
          const named = f.name && f.name !== 'image.png'
            ? f
            : new File([f], `pasted-${stamp()}.png`, { type: f.type || 'image/png' });
          files.push(named);
        }
      }
    }
    if (files.length) {
      e.preventDefault();
      void addFiles(files);
    }
  }

  function stamp(): string {
    const d = new Date();
    return `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}-${String(d.getHours()).padStart(2, '0')}${String(d.getMinutes()).padStart(2, '0')}${String(d.getSeconds()).padStart(2, '0')}`;
  }

  /* --------------------------------------------------------------- run */

  async function runAll() {
    await queue.runAll();
    bump();
  }

  async function runOne(job: Job) {
    await queue.runOne(job);
    bump();
  }

  /* Drop one file. With the keyboard on its X, focus moves to the X of the next row (the previous one
     when it was the last), and to the add button when the list is now empty. No confirmation: it is one file. */
  async function removeJob(job: Job) {
    const xs = () => [...document.querySelectorAll<HTMLElement>('.card [data-rm]')];
    const at = xs().indexOf(document.activeElement as HTMLElement);
    queue.remove(job);
    bump();
    if (at < 0) return;
    await tick();
    const rest = xs();
    (rest[at] ?? rest[at - 1] ?? document.querySelector<HTMLElement>('.topbar .tbtn.primary'))?.focus();
  }

  function downloadOne(job: Job) {
    if (!job.result) return;
    download(job.result.blob, queue.outName(job));
  }

  async function downloadAll() {
    const done = queue.jobs.filter(j => j.status === 'done' && j.result);
    if (!done.length) return;
    if (done.length === 1) {
      downloadOne(done[0]);
      return;
    }
    const tree: Record<string, Uint8Array> = {};
    const used = new Set<string>();
    for (const j of done) {
      let name = safeFileName(queue.outName(j));
      let i = 1;
      while (used.has(name)) {
        const dot = name.lastIndexOf('.');
        name = dot > 0 ? `${name.slice(0, dot)}-${i}${name.slice(dot)}` : `${name}-${i}`;
        i++;
      }
      used.add(name);
      tree[name] = new Uint8Array(await j.result!.blob.arrayBuffer());
    }
    const zipped = zipSync(tree, { level: 6 });
    download(new Blob([zipped as unknown as BlobPart], { type: 'application/zip' }), `filehop-${stamp()}.zip`);
  }

  /* Both clearing actions throw results away for good, so both ask first. An empty
     queue has nothing to lose and is not asked about. */
  async function clearAll(anchor?: Element | null) {
    if (queue.jobs.length > 0) {
      const yes = await confirmAction({
        title: i18n.t('confirm.drop_title'),
        message: i18n.t('confirm.drop_body', { n: queue.jobs.length }),
        ok: i18n.t('confirm.drop_ok'),
        danger: true,
        anchor
      });
      if (!yes) return;
    }
    queue.clearAll();
    bump();
    showToast(i18n.t('privacy.cleared'));
  }

  async function clearFinished(anchor?: Element | null) {
    // the same statuses queue.clearFinished() removes: failed and stopped cards go too
    const n = queue.jobs.filter(j => j.status === 'done' || j.status === 'error' || j.status === 'canceled' || j.status === 'merged').length;
    if (n === 0) return;
    const yes = await confirmAction({
      title: i18n.t('confirm.clear_title'),
      message: i18n.t('confirm.clear_body', { n }),
      ok: i18n.t('queue.clear_done'),
      anchor
    });
    if (!yes) return;
    queue.clearFinished();
    bump();
  }

  /* --------------------------------------------------- group-level helpers */

  function groupTargets(cat: Category, ext: string): ActionId[] {
    return targetsFor(cat, ext);
  }

  function groupExt(group: { items: Job[] }): string {
    return group.items[0]?.det.ext ?? '';
  }

  function handleAction(job: Job, id: ActionId) {
    queue.setAction(job, id);
    bump();
  }

  function handleOpt(job: Job, key: string, value: number | string) {
    queue.setOpt(job, key, value);
    bump();
  }

  /* --------------------------------------------------------- account menu */

  /* The menu is a <details>, which only closes on its own summary. On a phone the
     header is sticky, so an open menu would cover the page until the avatar is
     tapped again: Escape, a tap outside and scrolling close it as well. */
  function closeAccountMenu() {
    if (acctEl?.open) acctEl.open = false;
  }

  function onPointerDown(e: PointerEvent) {
    if (acctEl?.open && !acctEl.contains(e.target as Node)) acctEl.open = false;
    if (langOpen && !(e.target as HTMLElement).closest?.('.lang')) langOpen = false;
  }

  /* While the settings drawer or the licenses dialog is open the page behind does not
     scroll, so a swipe on the panel does not move the page under it. */
  $effect(() => {
    document.body.classList.toggle('modal-open', settingsOpen || licensesOpen);
  });

  /* ------------------------------------------------------------- keyboard */

  function onKeydown(e: KeyboardEvent) {
    const target = e.target as HTMLElement | null;
    const typing = target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT' || target.isContentEditable);
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'o' && !typing) {
      e.preventDefault();
      pickFiles();
    }
    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
      e.preventDefault();
      void runAll();
    }
    if (e.key === 'Escape') {
      // a family dialog on top takes Escape for itself; what is under it stays open
      if (document.querySelector('dialog.hop-dialog[open]')) return;
      settingsOpen = false;
      licensesOpen = false;
      navOpen = false;
      dragging = false;
      closeAccountMenu();
      if (langOpen) { e.preventDefault(); closeLang(true); }
    }
  }
</script>

<svelte:window
  ondragover={onDragOver}
  ondrop={onDrop}
  ondragenter={onDragEnter}
  ondragleave={onDragLeave}
  onpaste={onPaste}
  onkeydown={onKeydown}
  onpointerdown={onPointerDown}
  onscroll={closeAccountMenu}
/>

<a class="skip" href="#main">{i18n.t('nav.skip')}</a>

{#snippet tools()}
    {#if sendPage}
      <a class="tbtn primary" href={home}><Icon name="refresh" size={17} /><span class="tlabel">{i18n.t('send.convert')}</span></a>
    {:else}
    <button class="tbtn primary" type="button" onclick={pickFiles}>
      <Icon name="plus" size={17} /><span class="tlabel">{i18n.t('nav.add')}</span>
    </button>
    {/if}

    <div class="lang">
      <button
        bind:this={langBtn}
        class="tbtn lang-btn"
        type="button"
        aria-haspopup="listbox"
        aria-expanded={langOpen}
        aria-label={i18n.t('nav.language')}
        title={LOCALE_NAMES[locale] ?? locale}
        onclick={() => (langOpen ? closeLang() : openLang())}
      >
        <Icon name="net" size={16} /><span>{langCode(locale)}</span>
      </button>
      {#if langOpen}
        <ul class="lang-list" role="listbox" aria-label={i18n.t('nav.language')} bind:this={langList} onkeydown={onLangKey}>
          {#each LOCALES as l (l)}
            <li role="option" tabindex="-1" aria-selected={l === locale} lang={l} onclick={() => pickLang(l)} onkeydown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); pickLang(l); } }}>
              <span>{LOCALE_NAMES[l] ?? l}</span><code>{langCode(l)}</code>
            </li>
          {/each}
        </ul>
      {/if}
    </div>

    <button class="tbtn icon" type="button" onclick={toggleTheme} aria-label={i18n.t('nav.theme')} title={i18n.t('nav.theme')}>
      <Icon name={theme === 'dark' ? 'sun' : 'moon'} size={17} />
    </button>

    {#if account.ready && account.signedIn}
      <details class="acct" bind:this={acctEl}>
        <summary class="tbtn" aria-label={i18n.t('account.menu')} title={account.email || account.name}>
          <span class="avatar" aria-hidden="true">{initials(account.name, account.email)}</span>
          <span class="acct-name">{account.name || account.email}</span>
        </summary>
        <div class="acct-menu">
          <p class="small muted">{i18n.t('account.signed_in_as')}<br /><strong>{account.email || account.name}</strong></p>
          <button class="acct-item" type="button" onclick={() => { closeAccountMenu(); settingsOpen = true; }}><Icon name="gear" size={15} />{i18n.t('nav.settings')}</button>
          {#if !dash}<a href="/dashboard">{i18n.t('dash.nav')}</a>{/if}
          {#if account.hubUrl}<a href={account.hubUrl}>{i18n.t('account.hop_id')}</a>{/if}
          <a href={account.logoutUrl || '/auth/sso/logout'}>{i18n.t('account.sign_out')}</a>
        </div>
      </details>
    {:else if account.ready && account.sso}
      <a class="tbtn signin" href="/auth/sso?next=%2F" title={i18n.t('account.sign_in')}>{i18n.t('account.sign_in')}</a>
    {/if}
{/snippet}

{#snippet workspace()}
      <input
        bind:this={fileInput}
        class="filepicker"
        type="file"
        multiple
        onchange={onInputChange}
      />

      <section class="queue" aria-labelledby="queue-h">
        <div class="queue-head">
          <h2 id="queue-h">
            {i18n.t('queue.title')}
            {#if totalCount > 0}<span class="count">{totalCount}</span>{/if}
          </h2>
          <span class="spacer"></span>
          {#if totalCount > 0}
            <button class="tbtn secondary" type="button" onclick={runAll} disabled={running}>
              <Icon name="play" size={16} />{i18n.t('queue.run_all')}
            </button>
            {#if doneCount > 1}
              <button class="tbtn" type="button" onclick={downloadAll}>
                <Icon name="download" size={16} />{i18n.t('queue.download_all')}
              </button>
            {/if}
            <button class="tbtn" type="button" onclick={(e) => clearFinished(e.currentTarget)}>
              {i18n.t('queue.clear_done')}
            </button>
          {/if}
        </div>

        {#if totalCount === 0}
          <p class="queue-empty">{i18n.t('queue.empty')}<button class="tbtn primary empty-add" type="button" onclick={pickFiles}><Icon name="plus" size={17} />{i18n.t('nav.add')}</button></p>
        {:else}
          {#each groups as g (g.cat)}
            <div class="group">
              <div class="group-head">
                <h3>{i18n.t('group.' + g.cat)} · {g.items.length}</h3>
                {#if g.items.length > 1}
                  <div class="chips">
                    {#each groupTargets(g.cat, g.items[0]?.det.ext ?? '') as t (t)}
                      {@const d = actionDef(t)}
                      {#if d}
                        <button
                          type="button"
                          class="chip"
                          onclick={() => { queue.setActionForCategory(g.cat, t); bump(); }}
                          title={i18n.t('group.all_to') + ' ' + actionLabel(d)}
                        >{actionLabel(d)}</button>
                      {/if}
                    {/each}
                  </div>
                {/if}
              </div>

              {#each g.items as job (job.id)}
                <JobCard
                  {job}
                  pdfCount={g.items.length}
                  absorbed={isAbsorbed(job, queue.jobs)}
                  mergeBusy={mergeCarrier(queue.jobs)?.status === 'running'}
                  mergeNames={job.action === 'pdf:merge' && !isAbsorbed(job, queue.jobs) ? mergeMembers(queue.jobs).map(j => j.name) : []}
                  onAction={(id) => handleAction(job, id)}
                  onOpt={(k, v) => handleOpt(job, k, v)}
                  onRun={() => runOne(job)}
                  onCancel={() => { queue.cancel(job); bump(); }}
                  onRemove={() => removeJob(job)}
                  onDownload={() => downloadOne(job)}
                />
              {/each}
            </div>
          {/each}
        {/if}
      </section>
{/snippet}

{#snippet dropzone()}
        <div
          class="zone"
          class:over={dragging}
          role="button"
          tabindex="0"
          aria-label="{i18n.t('drop.title')} — {i18n.t('drop.hint').replace('{kbd}', 'Ctrl/⌘ V')}"
          onclick={pickFiles}
          onkeydown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); pickFiles(); } }}
        >
          <div class="halo"></div>
          <div class="zicon"><Icon name="upload" size={26} /></div>
          <h2>{i18n.t('drop.title')}</h2>
          <p>
            {@html i18n.t('drop.hint').replace('{kbd}', '<kbd>Ctrl/⌘ V</kbd>')}
          </p>
        </div>
{/snippet}

{#if dash || sendPage}
<div class="shell" class:open={navOpen}>
  <aside class="shell-side" id="shell-side" aria-label="FileHop">
    <a class="shell-brand" href={home}>
      <img src="/mark.svg" alt="" width="26" height="26" />
      <span class="hop-name hop-name-filehop">FileHop</span>
    </a>
    <nav class="shell-nav" aria-label="FileHop">
      <a href={home} aria-current={dash ? 'page' : undefined}><Icon name="refresh" size={18} />{i18n.t('dash.convert')}</a>
      <a href="/send" aria-current={sendPage ? 'page' : undefined}><Icon name="upload" size={18} />{i18n.t('send.nav')}</a>
      <a href="/changelog"><Icon name="text" size={18} />{i18n.t('footer.changelog')}</a>
    </nav>
    <p class="shell-label">{i18n.t('footer.family')}</p>
    <nav class="shell-nav" aria-label={i18n.t('footer.family')}>
      {#each FAMILY as app (app.url)}
        <a href={familyHref(app)} rel="noopener"><img src={app.mark} alt="" width="18" height="18" />{app.name}</a>
      {/each}
    </nav>
    <div class="shell-side-foot">
      <a href="/#privacy">{i18n.t('footer.privacy')}</a>
      <a href="https://hel.ink/terms" rel="noopener">{i18n.t('footer.terms')}</a>
      <a href="https://github.com/navi-crwn/FileHop" rel="noopener">{i18n.t('footer.source')}</a>
      <button class="ft-link" type="button" onclick={() => (licensesOpen = true)}>{i18n.t('footer.licenses')}</button>
    </div>
    <a class="ft-part" href="https://hel.ink" rel="noopener">
      <img src="/hop-id-mark.png" alt="" width="20" height="20" />
      <span>{#each i18n.t('footer.part_of').split('{name}') as part, i}{#if i > 0}<b>Hop Easy Link</b>{/if}{part}{/each}</span>
    </a>
  </aside>
  {#if navOpen}<div class="shell-scrim" onclick={() => (navOpen = false)} role="presentation"></div>{/if}

  <div class="shell-body">
    <header class="topbar shell-top">
      <button class="tbtn icon shell-burger" type="button" aria-label={i18n.t('dash.menu')} aria-controls="shell-side" aria-expanded={navOpen} onclick={() => (navOpen = !navOpen)}>
        <Icon name={navOpen ? 'close' : 'menu'} size={17} />
      </button>
      {#if sendPage}<p class="shell-title">{i18n.t('send.nav')}</p>{:else}<h1 class="shell-title">{i18n.t('dash.convert')}</h1>{/if}
      <span class="spacer"></span>
      {@render tools()}
    </header>

    <main id="main" class="shell-main">
      {#if sendPage}
        {#await import('./lib/send/Send.svelte') then m}<m.default />{/await}
      {:else}
      <Announcement locale={i18n.locale} />
      <div class="dash-grid">
        <div class="dash-work">
          {@render dropzone()}
          {@render workspace()}
        </div>
        <div class="dash-side">
          <section class="dash-card" aria-labelledby="sendcard-h">
            <h2 id="sendcard-h">{i18n.t('dash.send_card_h')}</h2>
            <p class="acc-note">{i18n.t('dash.send_card_p')}</p>
            <a class="tbtn" href="/send"><Icon name="upload" size={17} />{i18n.t('dash.send_card_cta')}</a>
          </section>
          <section class="dash-card" aria-labelledby="acc-h">
            <h2 id="acc-h">{i18n.t('dash.account')}</h2>
            {#if account.ready && account.signedIn}
              <div class="acc-id">
                <span class="dash-avatar" aria-hidden="true">{initials(account.name, account.email)}</span>
                <div class="acc-who"><strong>{account.name || account.email}</strong>{#if account.name && account.email}<span class="small muted">{account.email}</span>{/if}</div>
              </div>
            {/if}
            <p class="acc-note"><Icon name="shield" size={16} />{i18n.t('dash.never_uploaded')}</p>
            <span class="counter"><Icon name="net" size={14} />{i18n.t('privacy.network', { n: networkCount })}</span>
            {#if account.hubUrl}<a class="tbtn" href={account.hubUrl} rel="noopener">{i18n.t('account.hop_id')}</a>{/if}
          </section>
        </div>
      </div>
      {/if}
    </main>
  </div>
</div>
{/if}

{#if !dash && !sendPage}
<div class="app">
  <header class="topbar">
    <span class="brand">
      <img src="/mark.svg" alt="" width="26" height="26" />
      <span class="hop-name hop-name-filehop">FileHop</span>
    </span>

    <span class="spacer"></span>

    <a class="tbtn topnav-send" href="/send"><Icon name="upload" size={17} /><span class="tlabel">{i18n.t('send.nav')}</span></a>

    {@render tools()}
  </header>

  <main id="main">
    <div class="wrap">
      <section class="hero">
        <div class="hero-copy">
          <span class="eyebrow"><i></i>{i18n.t('hero.eyebrow')}</span>
          <h1>{i18n.t('hero.h1_pre')}{#if heroBreak}<br />{:else}{' '}{/if}<em class="acc">{i18n.t('hero.h1_accent')}</em></h1>
          <p class="lead">{i18n.t('hero.lead')}</p>
          <div class="cta">
            <button class="tbtn secondary lg" type="button" onclick={pickFiles}>
              <Icon name="upload" size={17} />{i18n.t('hero.cta')}
            </button>
            <a class="tbtn lg" href="/send">
              <Icon name="upload" size={17} />{i18n.t('home.send_cta')}
            </a>
            <button class="tbtn ghost" type="button" onclick={() => (settingsOpen = true)}>
              <Icon name="gear" size={17} />{i18n.t('nav.settings')}
            </button>
          </div>
          <p class="proof"><Icon name="shield" size={15} />{i18n.t('hero.proof')}</p>
        </div>

        <div class="hero-side">
        <figure class="hero-art" aria-hidden="true">
          <picture><source srcset="/hop-home/home/filehop-dark.webp" media="(prefers-color-scheme: dark)"><img src="/hop-home/home/filehop-light.webp" alt="" width="200" height="200" /></picture>
          <canvas data-hop-hero="filehop"></canvas>
        </figure>
        {@render dropzone()}
        </div>
      </section>

      <section class="sec two-things" aria-labelledby="two-h">
        <h2 id="two-h">{i18n.t('home.two_title')}</h2>
        <div class="things">
          <article class="thing">
            <h3><Icon name="refresh" size={16} />{i18n.t('home.two_convert_h')}</h3>
            <p>{i18n.t('home.two_convert_p')}</p>
            <button class="tbtn" type="button" onclick={pickFiles}><Icon name="upload" size={16} />{i18n.t('hero.cta')}</button>
          </article>
          <article class="thing">
            <h3><Icon name="upload" size={16} />{i18n.t('home.two_send_h')}</h3>
            <p>{i18n.t('home.two_send_p')}</p>
            <ol class="thing-steps">
              <li>{i18n.t('home.two_send_s1')}</li>
              <li>{i18n.t('home.two_send_s2')}</li>
              <li>{i18n.t('home.two_send_s3')}</li>
            </ol>
            <a class="tbtn secondary" href="/send">{i18n.t('home.two_send_cta')}<Icon name="arrow" size={16} /></a>
          </article>
        </div>
      </section>

      {@render workspace()}

      <section class="sec" aria-labelledby="how-h">
        <h2 id="how-h">{i18n.t('how.title')}</h2>
        <div class="steps">
          <article class="step">
            <span class="n">01</span>
            <h3>{i18n.t('how.s1_h')}</h3>
            <p>{i18n.t('how.s1_p')}</p>
          </article>
          <article class="step">
            <span class="n">02</span>
            <h3>{i18n.t('how.s2_h')}</h3>
            <p>{i18n.t('how.s2_p')}</p>
          </article>
          <article class="step">
            <span class="n">03</span>
            <h3>{i18n.t('how.s3_h')}</h3>
            <p>{i18n.t('how.s3_p')}</p>
          </article>
        </div>
      </section>

      <section class="sec" id="features" aria-labelledby="fmt-h">
        <h2 id="fmt-h">{i18n.t('formats.title')}</h2>
        <div class="hop-bento fmts">
          <article class="fmt" data-spot data-scene><h3><Icon name="image" size={16} />{i18n.t('formats.images')}</h3><p>{i18n.t('formats.images_v')}</p><div class="sc sc-img" aria-hidden="true"><i class="a">PNG</i><i class="b">WebP</i></div></article>
          <article class="fmt" data-spot data-scene><h3><Icon name="pdf" size={16} />{i18n.t('formats.pdf')}</h3><p>{i18n.t('formats.pdf_v')}</p><div class="sc sc-pdf" aria-hidden="true"><i></i><i></i><i></i></div></article>
          <article class="fmt" data-spot data-scene><h3><Icon name="data" size={16} />{i18n.t('formats.data')}</h3><p>{i18n.t('formats.data_v')}</p><div class="sc sc-data" aria-hidden="true"><i class="a">a,b,c</i><i class="b">&#123;&#125;</i></div></article>
          <article class="fmt" data-spot data-scene><h3><Icon name="text" size={16} />{i18n.t('formats.text')}</h3><p>{i18n.t('formats.text_v')}</p><div class="sc sc-text" aria-hidden="true"><i class="a"># md</i><i class="b">H</i></div></article>
          <article class="fmt" data-spot data-scene><h3><Icon name="archive" size={16} />{i18n.t('formats.archive')}</h3><p>{i18n.t('formats.archive_v')}</p><div class="sc sc-zip" aria-hidden="true"><i class="bar"></i></div></article>
          <article class="fmt" data-spot data-scene><h3><Icon name="hash" size={16} />{i18n.t('formats.hash')}</h3><p>{i18n.t('formats.hash_v')}</p><div class="sc sc-hash" aria-hidden="true"><i>9f2c</i><i>e41a</i><i>07bd</i></div></article>
          <article class="fmt soon" data-spot data-span="6"><h3><Icon name="alert" size={16} />{i18n.t('formats.soon')}</h3><p></p></article>
        </div>
      </section>

      <section class="sec" id="privacy">
        <div class="privacy-card">
          <h2>{i18n.t('privacy.title')}</h2>
          <p>{i18n.t('privacy.body')}</p>
          <span class="counter"><Icon name="net" size={14} />{i18n.t('privacy.network', { n: networkCount })}</span>
          <p class="small faint" style="margin-top:10px">{i18n.t('privacy.network_note')}</p>
          <button class="tbtn danger-outline" type="button" style="margin-top:14px" onclick={(e) => clearAll(e.currentTarget)}>
            <Icon name="trash" size={16} />{i18n.t('confirm.drop_ok')}
          </button>
        </div>
      </section>

      <footer class="ft">
        <a class="ft-part" href="https://hel.ink" rel="noopener">
          <img src="/hop-id-mark.png" alt="" width="20" height="20" />
          <span>{#each i18n.t('footer.part_of').split('{name}') as part, i}{#if i > 0}<b>Hop Easy Link</b>{/if}{part}{/each}</span>
        </a>
        <div class="ft-grid">
          <div class="ft-col ft-brand">
            <b><img src="/mark.svg" alt="" width="20" height="20" /><span class="hop-name hop-name-filehop">FileHop</span></b>
            <p>{i18n.t('footer.note')}</p>
          </div>
          <div class="ft-col">
            <h2 class="ft-h">{i18n.t('footer.support')}</h2>
            <nav aria-label={i18n.t('footer.support')}>
              <a href="/send">{i18n.t('send.footer_link')}</a>
              <a href="/changelog">{i18n.t('footer.changelog')}</a>
              <a href="https://github.com/navi-crwn/FileHop" rel="noopener">{i18n.t('footer.source')}</a>
              <button class="ft-link" type="button" data-settings onclick={() => (settingsOpen = true)}>{i18n.t('nav.settings')}</button>
            </nav>
          </div>
          <div class="ft-col">
            <h2 class="ft-h">{i18n.t('footer.policies')}</h2>
            <nav aria-label={i18n.t('footer.policies')}>
              <a href="#privacy">{i18n.t('footer.privacy')}</a>
              <a href="https://hel.ink/terms" rel="noopener">{i18n.t('footer.terms')}</a>
              <button class="ft-link" type="button" onclick={() => (licensesOpen = true)}>{i18n.t('footer.licenses')}</button>
            </nav>
          </div>
          <div class="ft-col">
            <h2 class="ft-h">{i18n.t('footer.family')}</h2>
            <nav aria-label={i18n.t('footer.family')}>
              {#each FAMILY as app (app.url)}
                <a href={familyHref(app)} rel="noopener"><img src={app.mark} alt="" width="16" height="16" />{app.name}</a>
              {/each}
            </nav>
          </div>
        </div>
        <p class="ft-copy">© 2026 navi-crwn · MIT License</p>
      </footer>
    </div>
  </main>
</div>
{/if}

{#if dragging && dragCategory}
  <FormatRing
    x={dragPoint.x}
    y={dragPoint.y}
    category={dragCategory}
    ext={dragExt}
    count={dragCount}
    queuedPdfs={queue.jobs.filter(j => j.det.category === 'pdf').length}
    onPick={pickFromRing}
  />
{/if}

{#if settingsOpen}
  <div class="scrim" onclick={() => (settingsOpen = false)} role="presentation"></div>
  <SettingsDrawer
    {locale}
    onLocale={(l) => { locale = l as typeof locale; chooseLocale(locale); }}
    {maxWorkers}
    autoWorkers={hardwareSlots()}
    {batterySaver}
    onWorkers={(n) => (maxWorkers = n)}
    onBattery={(v) => (batterySaver = v)}
    {networkCount}
    onClearAll={clearAll}
    onClose={() => (settingsOpen = false)}
  />
{/if}

{#if licensesOpen}
  <div class="scrim" onclick={() => (licensesOpen = false)} role="presentation"></div>
  <div class="dlg" role="dialog" aria-modal="true" aria-labelledby="lic-h">
    <div class="dlg-in">
      <div class="dhead" style="display:flex;justify-content:space-between;align-items:center;gap:10px">
        <h2 id="lic-h">{i18n.t('licenses.title')}</h2>
        <button class="tbtn icon ghost" type="button" onclick={() => (licensesOpen = false)} aria-label={i18n.t('licenses.close')}>
          <Icon name="close" size={17} />
        </button>
      </div>
      <p class="small muted">{i18n.t('licenses.body')}</p>
      <ul>
        <li><b>pdf.js</b> 6.5 — Apache-2.0, Mozilla</li>
        <li><b>Foxit standard PDF fonts</b> (via pdf.js) — BSD-3-Clause, PDFium</li>
        <li><b>pdf-lib</b> 1.17 — MIT</li>
        <li><b>fflate</b> 0.8 — MIT</li>
        <li><b>hash-wasm</b> 4 — MIT</li>
        <li><b>marked</b> 18 — MIT</li>
        <li><b>papaparse</b> 5 — MIT</li>
        <li><b>yaml</b> 2 — ISC</li>
        <li><b>Inter, Instrument Serif, JetBrains Mono</b> — SIL OFL 1.1</li>
      </ul>
      <p class="small faint" style="margin-top:12px">{i18n.t('licenses.no_agpl')}</p>
    </div>
  </div>
{/if}

{#if toast}
  <div class="toast" role="status" aria-live="polite">{toast}</div>
{/if}

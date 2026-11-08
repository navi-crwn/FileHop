<script lang="ts">
  import { onMount } from 'svelte';
  import Icon from './lib/components/Icon.svelte';
  import JobCard from './lib/components/JobCard.svelte';
  import FormatRing from './lib/components/FormatRing.svelte';
  import SettingsDrawer from './lib/components/SettingsDrawer.svelte';
  import { i18n, guessLocale, LOCALES, LOCALE_NAMES } from './lib/i18n/index.svelte';
  import { Queue } from './lib/store/queue.svelte';
  import { Pool, hardwareSlots } from './lib/core/pool';
  import { categoryLabel, detectFile } from './lib/core/detect';
  import { targetsFor, actionDef, isAbsorbed } from './lib/core/actions';
  import type { ActionId, Category, Job } from './lib/core/types';
  import { download, safeFileName } from './lib/util/format';
  import { zipSync } from 'fflate';
  import { account, loadAccount, initials, takeAuthError } from './lib/account.svelte';

  /* ------------------------------------------------------------------ state */

  let locale = $state(guessLocale());
  let settingsOpen = $state(false);
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

  // loading a dictionary is async; the state object swaps it in and every t() repaints
  $effect(() => {
    void i18n.load(locale);
  });

  let theme = $state<'dark' | 'light'>(readTheme());

  function readTheme(): 'dark' | 'light' {
    try {
      const t = localStorage.getItem('hop-theme');
      if (t === 'light' || t === 'dark') return t;
    } catch { /* ignore */ }
    return matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
  }

  function toggleTheme() {
    theme = theme === 'dark' ? 'light' : 'dark';
    document.documentElement.dataset.theme = theme;
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
    void loadAccount();
    const code = takeAuthError();
    if (code) showToast(i18n.t('auth.err_' + code));
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

  function clearAll() {
    queue.clearAll();
    bump();
    showToast(i18n.t('privacy.cleared'));
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
      settingsOpen = false;
      licensesOpen = false;
      dragging = false;
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
/>

<a class="skip" href="#main">{i18n.t('nav.skip')}</a>

<div class="app">
  <header class="topbar">
    <span class="brand">
      <img src="/mark.svg" alt="" width="26" height="26" />
      <span class="word"><b>File</b><span>Hop</span></span>
    </span>

    <span class="spacer"></span>

    <button class="tbtn primary" type="button" onclick={pickFiles}>
      <Icon name="plus" size={17} />{i18n.t('nav.add')}
    </button>

    <label class="sr" for="top-lang">{i18n.t('nav.language')}</label>
    <select
      id="top-lang"
      class="select"
      value={locale}
      onchange={(e) => (locale = (e.currentTarget as HTMLSelectElement).value as typeof locale)}
    >
      {#each LOCALES as l (l)}
        <option value={l}>{LOCALE_NAMES[l] ?? l}</option>
      {/each}
    </select>

    <button class="tbtn icon" type="button" onclick={toggleTheme} aria-label={i18n.t('nav.theme')} title={i18n.t('nav.theme')}>
      <Icon name={theme === 'dark' ? 'sun' : 'moon'} size={17} />
    </button>

    <button class="tbtn icon" type="button" onclick={() => (settingsOpen = true)} aria-label={i18n.t('nav.settings')} title={i18n.t('nav.settings')}>
      <Icon name="gear" size={17} />
    </button>

    {#if account.ready && account.signedIn}
      <details class="acct">
        <summary class="tbtn" aria-label={i18n.t('account.menu')} title={account.email || account.name}>
          <span class="avatar" aria-hidden="true">{initials(account.name, account.email)}</span>
          <span class="acct-name">{account.name || account.email}</span>
        </summary>
        <div class="acct-menu">
          <p class="small muted">{i18n.t('account.signed_in_as')}<br /><strong>{account.email || account.name}</strong></p>
          {#if account.hubUrl}<a href={account.hubUrl}>{i18n.t('account.hop_id')}</a>{/if}
          <a href={account.logoutUrl || '/auth/sso/logout'}>{i18n.t('account.sign_out')}</a>
        </div>
      </details>
    {:else if account.ready && account.sso}
      <a class="tbtn" href="/auth/sso?next=%2F">{i18n.t('account.sign_in')}</a>
    {/if}
  </header>

  <main id="main">
    <div class="wrap">
      <section class="hero">
        <div class="hero-copy">
          <span class="eyebrow"><i></i>{i18n.t('hero.eyebrow')}</span>
          <h1>{i18n.t('hero.h1_pre')} <em class="acc">{i18n.t('hero.h1_accent')}</em></h1>
          <p class="lead">{i18n.t('hero.lead')}</p>
          <div class="cta">
            <button class="tbtn primary" type="button" onclick={pickFiles}>
              <Icon name="upload" size={17} />{i18n.t('hero.cta')}
            </button>
            <button class="tbtn" type="button" onclick={() => (settingsOpen = true)}>
              <Icon name="gear" size={17} />{i18n.t('nav.settings')}
            </button>
          </div>
          <p class="proof"><Icon name="shield" size={15} />{i18n.t('hero.proof')}</p>
        </div>

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
      </section>

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
            <button class="tbtn" type="button" onclick={runAll} disabled={running}>
              <Icon name="play" size={16} />{i18n.t('queue.run_all')}
            </button>
            {#if doneCount > 1}
              <button class="tbtn" type="button" onclick={downloadAll}>
                <Icon name="download" size={16} />{i18n.t('queue.download_all')}
              </button>
            {/if}
            <button class="tbtn" type="button" onclick={() => { queue.clearFinished(); bump(); }}>
              {i18n.t('queue.clear_done')}
            </button>
          {/if}
        </div>

        {#if totalCount === 0}
          <p class="queue-empty">{i18n.t('queue.empty')}</p>
        {:else}
          {#each groups as g (g.cat)}
            <div class="group">
              <div class="group-head">
                <h3>{categoryLabel(g.cat)} · {g.items.length}</h3>
                {#if g.items.length > 1}
                  <div class="chips">
                    {#each groupTargets(g.cat, g.items[0]?.det.ext ?? '') as t (t)}
                      {@const d = actionDef(t)}
                      {#if d}
                        <button
                          type="button"
                          class="chip"
                          onclick={() => { queue.setActionForCategory(g.cat, t); bump(); }}
                          title={i18n.t('group.all_to') + ' ' + d.label}
                        >{d.label}</button>
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
                  onAction={(id) => handleAction(job, id)}
                  onOpt={(k, v) => handleOpt(job, k, v)}
                  onRun={() => runOne(job)}
                  onCancel={() => { queue.cancel(job); bump(); }}
                  onRemove={() => { queue.remove(job); bump(); }}
                  onDownload={() => downloadOne(job)}
                />
              {/each}
            </div>
          {/each}
        {/if}
      </section>

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

      <section class="sec" aria-labelledby="fmt-h">
        <h2 id="fmt-h">{i18n.t('formats.title')}</h2>
        <div class="fmts">
          <article class="fmt"><h3><Icon name="image" size={16} />{i18n.t('formats.images')}</h3><p>{i18n.t('formats.images_v')}</p></article>
          <article class="fmt"><h3><Icon name="pdf" size={16} />{i18n.t('formats.pdf')}</h3><p>{i18n.t('formats.pdf_v')}</p></article>
          <article class="fmt"><h3><Icon name="data" size={16} />{i18n.t('formats.data')}</h3><p>{i18n.t('formats.data_v')}</p></article>
          <article class="fmt"><h3><Icon name="text" size={16} />{i18n.t('formats.text')}</h3><p>{i18n.t('formats.text_v')}</p></article>
          <article class="fmt"><h3><Icon name="archive" size={16} />{i18n.t('formats.archive')}</h3><p>{i18n.t('formats.archive_v')}</p></article>
          <article class="fmt"><h3><Icon name="hash" size={16} />{i18n.t('formats.hash')}</h3><p>{i18n.t('formats.hash_v')}</p></article>
          <article class="fmt soon"><h3><Icon name="alert" size={16} />{i18n.t('formats.soon')}</h3><p></p></article>
        </div>
      </section>

      <section class="sec">
        <div class="privacy-card">
          <h2>{i18n.t('privacy.title')}</h2>
          <p>{i18n.t('privacy.body')}</p>
          <span class="counter"><Icon name="net" size={14} />{i18n.t('privacy.network', { n: networkCount })}</span>
          <p class="small faint" style="margin-top:10px">{i18n.t('privacy.network_note')}</p>
          <button class="tbtn" type="button" style="margin-top:14px" onclick={clearAll}>
            <Icon name="trash" size={16} />{i18n.t('privacy.clear')}
          </button>
        </div>
      </section>

      <footer class="ft">
        <div class="ft-in">
          <span class="brand" style="gap:8px">
            <img src="/mark.svg" alt="" width="22" height="22" />
            <span class="word"><b>File</b><span>Hop</span></span>
          </span>
          <a href="https://hel.ink" rel="noopener">{i18n.t('footer.family')}</a>
          <a href="#privacy">{i18n.t('footer.privacy')}</a>
          <button class="tbtn" type="button" style="height:30px;padding:0 10px;font-size:12.5px" onclick={() => (licensesOpen = true)}>
            {i18n.t('footer.licenses')}
          </button>
          <span class="grow"></span>
          <span class="note">{i18n.t('footer.note')}</span>
        </div>
      </footer>
    </div>
  </main>
</div>

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
    onLocale={(l) => (locale = l as typeof locale)}
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
        <button class="tbtn icon" type="button" onclick={() => (licensesOpen = false)} aria-label={i18n.t('licenses.close')}>
          <Icon name="close" size={17} />
        </button>
      </div>
      <p class="small muted">{i18n.t('licenses.body')}</p>
      <ul>
        <li><b>pdf.js</b> 6.5 — Apache-2.0, Mozilla</li>
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

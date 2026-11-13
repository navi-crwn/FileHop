<script lang="ts">
  import { onMount } from 'svelte';
  import qrcode from 'qrcode-generator';
  import { zipSync } from 'fflate';
  import Icon from '../components/Icon.svelte';
  import { i18n } from '../i18n/index.svelte';
  import { confirmAction } from '../util/confirm';
  import { fmtSize, download } from '../util/format';
  import { sanitizeFileName, GROUP_CAP } from './pure';
  import { Session, type Phase, type Route, type Offer, type Progress, type Finished } from './p2p';

  const t = (k: string, v?: Record<string, string | number>) => i18n.t(k, v);

  let phase = $state<Phase>('idle');
  let detail = $state('');
  let diag = $state('');
  let code = $state('');
  let typed = $state('');
  let sas = $state('');
  let route = $state<Route>('unknown');
  let myOk = $state(false);
  let limits = $state<[number, number] | null>(null);
  let offers = $state<Offer[]>([]);
  let copied = $state(false);
  let autoOn = $state(false); // "Accept all" is on: later files are taken without asking
  let zipping = $state(false);
  let howEl = $state<HTMLDetailsElement>();
  type Row = Progress & { state: 'queued' | 'run' | 'done' | 'failed'; res?: Finished; url?: string; saved?: boolean; group?: { n: number; of: number; total: number } };
  let rows = $state<Record<string, Row>>({});
  let receiving = $derived(Object.values(rows).some((r) => r.dir === 'in' && r.state === 'run'));
  let link = $derived(code ? `${location.origin}/send#${code}` : '');
  let qr = $derived.by(() => {
    if (!link) return '';
    const q = qrcode(0, 'M');
    q.addData(link);
    q.make();
    return q.createSvgTag({ cellSize: 6, margin: 0, scalable: true });
  });
  const validCode = (s: string) => /^\d{6}$/.test(s);

  /* The sender's queue: every picked file gets a row at once ("Waiting for the other device…") with
     its own Cancel, and the files travel one after another. Files announce their group (n of count,
     total bytes) so the receiver can show it and accept the whole group. */
  type Queued = { id: string; file: File; key: number; n: number; of: number; total: number };
  let outQueue = $state<Queued[]>([]);
  let pumping = false;
  let groupSeq = 0;
  const queuedRest = $derived(outQueue.filter((q) => rows[q.id]?.state === 'queued').length);
  const saveList = $derived(Object.values(rows).filter((r) => r.dir === 'in' && r.state === 'done' && r.res?.ok && r.url && !r.saved));
  const saveBytes = $derived(saveList.reduce((s, r) => s + r.size, 0));
  const canZip = $derived(saveList.length > 1 && saveBytes <= GROUP_CAP);
  const showTransfers = $derived(phase === 'ready' || offers.length > 0 || Object.keys(rows).length > 0);

  const hooks = {
    phase: (p: Phase, d = '') => {
      phase = p;
      detail = d;
      // a queue that will never run: every row still waiting gets its honest end
      if (p === 'error' || p === 'closed') {
        outQueue = [];
        for (const r of Object.values(rows)) if (r.state === 'queued') markCancelled(r.id, p === 'closed' ? 'cancelled' : 'connection_lost');
      }
    },
    code: (c: string) => (code = c),
    sas: (s: string) => (sas = s),
    route: (r: Route) => (route = r),
    limits: (mine: number, peer: number) => (limits = [mine, peer]),
    diag: (s: string) => (diag = s),
    verified: () => {},
    offer: (o: Offer) => (offers = [...offers, o]),
    offerGone: (id: string) => (offers = offers.filter((x) => x.id !== id)),
    progress: (p: Progress) => {
      const prev = rows[p.id];
      rows[p.id] = { ...prev, ...p, state: prev?.state === 'done' || prev?.state === 'failed' ? prev.state : 'run' };
    },
    finished: (f: Finished) => {
      const prev = rows[f.id] ?? { id: f.id, dir: f.dir, name: f.name, size: f.size, done: f.size, bytesPerSec: 0, group: f.group };
      if (prev.url) URL.revokeObjectURL(prev.url);
      const url = f.file && f.ok ? URL.createObjectURL(f.file) : undefined;
      rows[f.id] = { ...prev, state: f.ok ? 'done' : 'failed', res: f, url };
    }
  };
  const session = new Session(hooks);
  $effect(() => { session.fallbackName = t('send.default_name'); });

  onMount(() => {
    // on a phone the "How it works" panel starts folded; the cards and the code come first
    if (matchMedia('(max-width: 640px)').matches && howEl) howEl.open = false;
    // A scanned QR code carries the room code in the #fragment, which never reaches a server.
    // It is read once and removed from the address bar.
    const m = location.hash.match(/^#(\d{6})$/);
    if (location.hash) history.replaceState(null, '', location.pathname + location.search);
    if (m) { typed = m[1]; void session.join(m[1]); }
    // A code opened while this page is already on /send (a second scan in the same tab or installed
    // app) only changes the #fragment: nothing reloads. Start over with the new code, asking first
    // when a pairing or a transfer would be ended by it.
    const onHash = async () => {
      const n = location.hash.match(/^#(\d{6})$/);
      if (!n) return;
      const live = phase === 'verify' || phase === 'ready' || (phase === 'connecting' && !!sas);
      if (n[1] === code && phase !== 'error' && phase !== 'closed') return history.replaceState(null, '', location.pathname + location.search);
      if (live && !(await confirmAction({ title: t('send.switch_title'), message: t('send.switch_body'), ok: t('send.leave'), danger: true }))) {
        return history.replaceState(null, '', location.pathname + location.search);
      }
      session.leave();
      location.reload(); // the address keeps the new #code, which the fresh page joins
    };
    const onShow = (e: PageTransitionEvent) => { if (e.persisted) void onHash(); };
    addEventListener('hashchange', onHash);
    addEventListener('pageshow', onShow);
    return () => {
      removeEventListener('hashchange', onHash);
      removeEventListener('pageshow', onShow);
      session.leave();
      for (const r of Object.values(rows)) if (r.url) URL.revokeObjectURL(r.url); // the received files are released with the page
    };
  });

  async function pick(e: Event) {
    const input = e.currentTarget as HTMLInputElement;
    const files = [...(input.files ?? [])];
    input.value = '';
    if (!files.length) return;
    const key = ++groupSeq;
    const total = files.reduce((s, f) => s + f.size, 0);
    files.forEach((f, i) => {
      const id = Math.random().toString(36).slice(2, 10);
      const group = { n: i + 1, of: files.length, total };
      outQueue = [...outQueue, { id, file: f, key, ...group }];
      rows[id] = { id, dir: 'out', name: sanitizeFileName(f.name, t('send.default_name')), size: f.size, done: 0, bytesPerSec: 0, state: 'queued', group };
    });
    void pump();
  }
  async function pump() {
    if (pumping) return;
    pumping = true;
    try {
      while (outQueue.length) {
        const it = outQueue[0];
        const res = await session.sendFile(it.file, { id: it.id, group: { n: it.n, of: it.of, total: it.total } });
        outQueue = outQueue.slice(1);
        // the other device declined the whole group: what is still queued of it will not be sent
        if (!res.ok && res.reason === 'declined_all') {
          for (const q of outQueue) if (q.key === it.key) markCancelled(q.id, 'cancelled');
          outQueue = outQueue.filter((q) => q.key !== it.key);
        }
      }
    } finally { pumping = false; }
  }
  function markCancelled(id: string, reason: string) {
    const r = rows[id];
    if (!r || r.state !== 'queued') return;
    rows[id] = { ...r, state: 'failed', res: { id, dir: 'out', name: r.name, size: r.size, ok: false, sha256: '', peerSha256: '', ms: 0, reason } };
  }
  function cancelOut(id: string) {
    // the file the pump is already offering can only be stopped through the session: it tells the
    // other device, which takes the offer card away
    if (!(pumping && outQueue[0]?.id === id) && rows[id]?.state === 'queued') {
      outQueue = outQueue.filter((q) => q.id !== id);
      markCancelled(id, 'cancelled');
      return;
    }
    session.cancel(id);
  }
  function cancelRest() {
    outQueue = outQueue.filter((q) => {
      if (pumping && outQueue[0]?.id === q.id) return true; // the one the pump is on keeps its own Cancel
      if (rows[q.id]?.state === 'queued') { markCancelled(q.id, 'cancelled'); return false; }
      return true;
    });
  }
  function accept(o: Offer) {
    offers = offers.filter((x) => x.id !== o.id);
    rows[o.id] = { id: o.id, dir: 'in', name: o.name, size: o.size, done: 0, bytesPerSec: 0, state: 'run', group: o.group };
    void session.accept(o); // straight from the click: the save dialog needs it
  }
  function acceptAll(o: Offer) {
    session.autoAccept = true;
    autoOn = true;
    for (const x of [...offers]) accept(x); // in practice one card waits at a time; the flag takes the rest
  }
  function decline(o: Offer) {
    offers = offers.filter((x) => x.id !== o.id);
    session.decline(o.id);
  }
  function declineAll(o: Offer) {
    offers = [];
    autoOn = false;
    session.declineAll(o.id); // this file and every later one of the group; the sender stops its queue
  }
  async function copyLink() {
    try { await navigator.clipboard.writeText(link); copied = true; setTimeout(() => (copied = false), 2000); } catch { /* */ }
  }
  const restart = () => { session.leave(); location.href = '/send'; };
  function confirmSas() { myOk = true; session.confirmShortCode(); }
  const markSaved = (id: string) => { rows[id] = { ...rows[id], saved: true }; };

  /** "Save all": one ZIP of every received file that is not saved yet, while the group stays small
      enough for one tab; above the cap each file keeps its own Save button. */
  async function saveAll() {
    const list = saveList;
    if (!list.length || zipping) return;
    zipping = true;
    try {
      const tree: Record<string, Uint8Array> = {};
      const used = new Set<string>();
      const uniq = (n: string) => {
        if (!used.has(n)) { used.add(n); return n; }
        const dot = n.lastIndexOf('.');
        const base = dot > 0 ? n.slice(0, dot) : n, ext = dot > 0 ? n.slice(dot) : '';
        let i = 2;
        while (used.has(`${base} (${i})${ext}`)) i++;
        const out = `${base} (${i})${ext}`;
        used.add(out);
        return out;
      };
      for (const r of list) tree[uniq(r.name)] = new Uint8Array(await r.res!.file!.arrayBuffer());
      const zipped = zipSync(tree, { level: 0 });
      download(new Blob([zipped as unknown as BlobPart], { type: 'application/zip' }), `filehop-${new Date().toISOString().slice(0, 19).replace(/[T:]/g, '-')}.zip`);
      for (const r of list) markSaved(r.id);
    } finally { zipping = false; }
  }

  const reasonText = (r: string | undefined) => {
    const alias: Record<string, string> = { cancelled_by_peer: 'cancelled', storage_full: 'storage', declined_all: 'declined' };
    const known = ['too_big', 'hash_mismatch', 'size_mismatch', 'cancelled', 'declined', 'busy', 'storage', 'too_big_for_memory', 'connection_lost', 'group_too_big'];
    const k = alias[r ?? ''] ?? r ?? '';
    return t('send.why_' + (known.includes(k) ? k : 'other'));
  };
  const ERRORS = ['no_direct', 'room_unknown', 'room_empty', 'room_full', 'room_expired', 'rate_limited', 'rate_limited_rooms', 'signal_lost', 'connection_lost', 'busy', 'protocol', 'commit_mismatch', 'handshake_stalled', 'unsupported'];
  const errText = (r: string) => t('send.err_' + (ERRORS.includes(r) ? r : 'signal_lost'));
  const routeText = (r: Route) => (r === 'host' ? t('send.route_host') : r === 'relay' ? t('send.route_relay') : r === 'unknown' ? '' : t('send.route_srflx'));
  const grouped = (c: string) => (c.length === 6 ? c.slice(0, 3) + ' ' + c.slice(3) : c);
  const ofN = (g?: { n: number; of: number }) => (g && g.of > 1 ? t('send.file_x_of_n', { n: g.n, of: g.of }) : '');
</script>

<div class="send">
  <header class="intro">
    <h1>{t('send.h1_pre')} <em class="acc">{t('send.h1_accent')}</em></h1>
    <p class="lead">{t('send.lead')}</p>
  </header>

  <div class="cols">
    <div class="col-main">
      {#if phase === 'idle'}
        <div class="two">
          <section class="sc">
            <h2>{t('home.two_send_h')}</h2>
            <p class="muted small">{t('send.start_hint')}</p>
            <button id="start" class="tbtn primary lg" type="button" onclick={() => session.create()}><Icon name="plus" size={17} />{t('send.start')}</button>
          </section>
          <form class="sc join" onsubmit={(e) => { e.preventDefault(); if (validCode(typed)) void session.join(typed); }}>
            <label for="code-in">{t('send.join_title')}</label>
            <p class="muted small">{t('send.join_hint')}</p>
            <div class="srow">
              <input id="code-in" class="sfield mono" inputmode="numeric" autocomplete="off" maxlength="6" placeholder="000000" aria-label={t('send.code_label')} pattern={'[0-9]{6}'} bind:value={typed} />
              <button id="join" class="tbtn" type="submit" disabled={!validCode(typed)}>{t('send.join')}</button>
            </div>
          </form>
        </div>
        <p class="note"><Icon name="shield" size={15} />{t('send.unscanned')}</p>
      {:else if phase === 'waiting' || (phase === 'connecting' && !sas)}
        <section class="sc pair" aria-live="polite">
          {#if qr && phase === 'waiting'}<div class="qr" aria-hidden="true">{@html qr}</div>{/if}
          <div class="pair-body">
            {#if code}<p class="label">{t('send.code_label')}</p>
            <p id="room-code" class="mono big">{grouped(code)}</p>{/if}
            {#if phase === 'waiting'}<p class="muted">{t('send.scan')}</p>{/if}
            <p id="status" class="muted"><span class="dot" aria-hidden="true"></span>{phase === 'waiting' ? t('send.waiting') : t('send.connecting')}</p>
            <div class="srow">
              {#if phase === 'waiting'}<button class="tbtn" type="button" onclick={copyLink}><Icon name="copy" size={16} />{copied ? t('send.copied') : t('send.copy_link')}</button>{/if}
              <button class="tbtn ghost" type="button" onclick={restart}>{t('send.leave')}</button>
            </div>
          </div>
        </section>
        <p class="note"><Icon name="shield" size={15} />{t('send.privacy_note')}</p>
      {:else if phase === 'verify'}
        <section class="sc" aria-live="polite">
          <h2>{t('send.verify_title')}</h2>
          <p id="sas" class="mono big">{sas}</p>
          <p class="muted">{t('send.verify_hint')}</p>
          <div class="srow">
            <button id="sas-ok" class="tbtn primary" type="button" disabled={myOk} onclick={confirmSas}>{t('send.match')}</button>
            <button id="sas-no" class="tbtn" type="button" onclick={restart}>{t('send.nomatch')}</button>
          </div>
          {#if myOk}<p class="muted">{t('send.verify_wait')}</p>{/if}
          <p class="muted small">{t('send.verify_note')}</p>
        </section>
      {:else if phase === 'ready'}
        <section class="sc sticky">
          <h2>{t('send.connection')}</h2>
          <p id="status" class="ok"><Icon name="check" size={16} />{t('send.ready')}</p>
          <p class="muted small" id="route" data-route={route}>{routeText(route)}</p>
          {#if code}<p class="mono num muted small">{grouped(code)}</p>{/if}
          {#if limits}<p class="muted small">{t('send.limit', { mine: fmtSize(limits[0]), peer: fmtSize(limits[1]) })}</p>{/if}
          <div class="srow">
            <label class="tbtn primary lg" for="pick"><Icon name="upload" size={17} />{t('send.choose')}</label>
            <input id="pick" type="file" multiple hidden onchange={pick} />
            <button class="tbtn ghost" type="button" onclick={restart}>{t('send.leave')}</button>
          </div>
        </section>
      {:else if phase === 'error'}
        <section class="sc fail" role="alert">
          {#if detail === 'no_direct'}
            <h2 id="error" data-reason={detail}>{t('send.err_no_direct')}</h2>
            <p>{t('send.err_no_direct_body')}</p>
            <ul class="ways">
              <li>{t('send.way_wifi')}</li>
              <li>{t('send.way_hotspot')}</li>
              <li>{t('send.way_apps')}</li>
            </ul>
          {:else}
            <p id="error" data-reason={detail}>{errText(detail)}</p>
          {/if}
          {#if diag}<details class="tech"><summary>{t('send.tech')}</summary><code>{diag}</code></details>{/if}
          <button class="tbtn" type="button" onclick={restart}>{t('send.start_over')}</button>
        </section>
      {:else if phase === 'closed'}
        <section class="sc"><button class="tbtn" type="button" onclick={restart}>{t('send.start_over')}</button></section>
      {/if}
    </div>

    <aside class="col-side">
      {#if showTransfers}
        <section class="sc xfers">
          <h2>{t('send.transfers')}</h2>
          {#if offers.length}
            <div class="incoming">
              {#each offers as o (o.id)}
                <section class="sc offer" data-offer={o.id}>
                  <p class="label">{t('send.incoming')}</p>
                  <p><b class="mono sname">{o.name}</b> <span class="num muted">{fmtSize(o.size)}</span></p>
                  {#if ofN(o.group)}<p class="muted small">{ofN(o.group)}{#if o.group} · {t('send.group_summary', { n: o.group.of, size: fmtSize(o.group.total) })}{/if}</p>{/if}
                  <p class="muted small">{t('send.unscanned')}</p>
                  <div class="srow">
                    <button class="tbtn primary offer-accept" type="button" disabled={receiving} onclick={() => accept(o)}>{t('send.accept')}</button>
                    {#if o.group && o.group.of > 1}<button class="tbtn offer-accept-all" type="button" onclick={() => acceptAll(o)}>{t('send.accept_all')}</button>{/if}
                    <button class="tbtn" type="button" onclick={() => decline(o)}>{t('send.decline')}</button>
                    {#if o.group && o.group.of > 1}<button class="tbtn ghost" type="button" onclick={() => declineAll(o)}>{t('send.decline_all')}</button>{/if}
                  </div>
                </section>
              {/each}
            </div>
          {/if}
          {#if autoOn}<p class="muted small auto"><Icon name="check" size={14} />{t('send.auto_note')}</p>{/if}
          {#if canZip}
            <div class="srow saveall">
              <button class="tbtn primary" type="button" disabled={zipping} onclick={saveAll}><Icon name="archive" size={16} />{t('send.save_all')}</button>
              <span class="muted small num">{saveList.length} · {fmtSize(saveBytes)}</span>
            </div>
          {/if}
          {#if queuedRest > 1}
            <p class="srow"><button class="tbtn sm" type="button" onclick={cancelRest}>{t('send.cancel_rest')}</button><span class="muted small">{t('send.waiting')}</span></p>
          {/if}
          {#each Object.values(rows) as r (r.id)}
            <section class="sc xfer" data-state={r.state} data-dir={r.dir}>
              <p class="label">{r.dir === 'out' ? t('send.sending') : t('send.receiving')}{#if ofN(r.group)} · {ofN(r.group)}{/if}</p>
              <p><b class="mono sname">{r.name}</b> <span class="num muted">{fmtSize(r.done)} / {fmtSize(r.size)}</span></p>
              {#if r.state === 'queued'}
                <p class="num muted srow"><span>{t('send.waiting')}</span>
                  <button class="tbtn sm" type="button" onclick={() => cancelOut(r.id)}>{t('send.cancel')}</button></p>
              {:else}
                <progress max={r.size || 1} value={r.done}></progress>
                {#if r.state === 'run'}
                  <p class="num muted srow">{t('send.speed', { n: ((r.bytesPerSec * 8) / 1e6).toFixed(0) })}
                    <button class="tbtn sm" type="button" onclick={() => cancelOut(r.id)}>{t('send.cancel')}</button></p>
                {:else if r.res}
                  <p class="result" data-ok={r.res.ok}>
                    {#if r.res.ok}<Icon name="check" size={16} />{r.dir === 'out' ? t('send.done_out') : t('send.done_in')}
                    {:else}<Icon name="alert" size={16} />{t('send.failed')}: {reasonText(r.res.reason)}{/if}
                  </p>
                  {#if r.res.ok}
                    <p class="small muted">{t('send.sha')} <code class="hash">{r.res.sha256}</code></p>
                    {#if r.url}
                      {#if r.saved}
                        <div class="srow">
                          <button class="tbtn primary save" type="button" disabled><Icon name="check" size={16} />{t('send.saved')}</button>
                          <a class="tbtn sm save-again" href={r.url} download={r.name} onclick={() => markSaved(r.id)}>{t('send.save_again')}</a>
                        </div>
                      {:else}
                        <a class="tbtn primary save" href={r.url} download={r.name} onclick={() => markSaved(r.id)}><Icon name="download" size={16} />{t('send.save')}</a>
                      {/if}
                      <p class="small muted">{t('send.saved_private')}</p>
                    {:else if r.dir === 'in'}
                      <p class="small muted">{t('send.saved_fs')}</p>
                    {/if}
                  {/if}
                {/if}
              {/if}
            </section>
          {/each}
          {#if !offers.length && !Object.keys(rows).length}
            <p class="muted small">{t('send.transfers_hint')}</p>
          {/if}
          <p class="note"><Icon name="shield" size={15} />{t('send.unscanned')}</p>
        </section>
      {:else}
        <details class="sc how" open bind:this={howEl}>
          <summary><h2>{t('send.how_title')}</h2></summary>
          <div class="steps">
            <article class="step">
              <span class="n">01</span>
              <h3>{t('send.how_s1_h')}</h3>
              <p>{t('send.how_s1_p')}</p>
            </article>
            <article class="step">
              <span class="n">02</span>
              <h3>{t('send.how_s2_h')}</h3>
              <p>{t('send.how_s2_p')}</p>
            </article>
            <article class="step">
              <span class="n">03</span>
              <h3>{t('send.how_s3_h')}</h3>
              <p>{t('send.how_s3_p')}</p>
            </article>
          </div>
        </details>
        <section class="sc assure">
          <p><Icon name="shield" size={15} />{t('send.assure_a')}</p>
          <p>{t('send.assure_b')}</p>
          {#if limits}<p class="small">{t('send.limit', { mine: fmtSize(limits[0]), peer: fmtSize(limits[1]) })}</p>{/if}
          <p class="small">{t('send.hint_connect')}</p>
        </section>
      {/if}
    </aside>
  </div>
</div>

<style>
  .send { max-width: 1180px; margin-inline: auto; display: grid; gap: 16px; }
  .intro h1 { margin: 6px 0 10px; font-size: clamp(28px, 3.6vw, 42px); line-height: 1.05; font-weight: 800; letter-spacing: -.04em; text-wrap: balance; }
  .lead { margin: 0; color: var(--muted); max-width: 60ch; }
  h2 { margin: 0; font-size: 17px; }
  .cols { display: grid; gap: 16px; grid-template-columns: minmax(0, 7fr) minmax(0, 5fr); align-items: start; }
  .col-main, .col-side { display: grid; gap: 16px; min-width: 0; align-content: start; }
  @media (max-width: 1023px) { .cols { grid-template-columns: minmax(0, 1fr); } }
  .sc { background: var(--panel); border: 1px solid var(--line-2); border-radius: var(--radius); padding: 18px; display: grid; gap: 12px; justify-items: start; }
  .two { display: grid; gap: 16px; grid-template-columns: 1fr 1fr; align-items: stretch; }
  .two .sc { align-content: start; }
  @media (max-width: 640px) { .two { grid-template-columns: 1fr; } .two .join { order: -1; } }
  .sticky { position: sticky; top: 88px; }
  .srow { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; }
  .sfield { height: var(--hop-ctl-h, 36px); padding: 0 12px; border-radius: var(--radius-sm); border: 1px solid var(--line-2); background: var(--bg-2); color: var(--text); font-size: 16px; width: 9rem; letter-spacing: .12em; font-variant-numeric: tabular-nums; }
  .sfield:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
  label { font-size: 13px; font-weight: 600; }
  .label { margin: 0; font-size: 12px; font-weight: 700; letter-spacing: .08em; text-transform: uppercase; color: var(--muted); }
  .pair { grid-template-columns: auto 1fr; align-items: center; gap: 24px; }
  @media (max-width: 640px) { .pair { grid-template-columns: 1fr; } }
  .pair-body { display: grid; gap: 10px; justify-items: start; }
  .qr { width: 176px; background: #fff; padding: 12px; border-radius: 12px; line-height: 0; }
  .qr :global(svg) { width: 100%; height: auto; }
  .big { font-size: clamp(30px, 6vw, 40px); letter-spacing: .1em; margin: 0; font-variant-numeric: tabular-nums; font-weight: 600; }
  .mono { font-family: var(--mono); }
  .muted { color: var(--muted); margin: 0; }
  .small { font-size: 13px; }
  .num { font-variant-numeric: tabular-nums; }
  .sname { overflow-wrap: anywhere; }
  .hash { font-family: var(--mono); font-size: 11px; overflow-wrap: anywhere; }
  .note { display: flex; gap: 8px; align-items: flex-start; margin: 0; font-size: 13px; color: var(--muted); }
  .note :global(svg) { flex: none; margin-top: 2px; }
  .ok { display: flex; gap: 8px; align-items: center; margin: 0; color: var(--green); font-weight: 600; }
  .result { display: flex; gap: 8px; align-items: flex-start; margin: 0; }
  .result[data-ok='true'] { color: var(--green); }
  .result[data-ok='false'] { color: var(--red); }
  progress { width: 100%; height: 8px; accent-color: var(--accent); }
  .sc.fail { border-color: var(--red); }
  .sc.fail h2 { color: var(--red); }
  .ways { margin: 0; padding-inline-start: 20px; display: grid; gap: 4px; }
  .tech summary { cursor: pointer; font-size: 13px; color: var(--muted); }
  .tech code { display: block; margin-top: 6px; font-size: 12px; overflow-wrap: anywhere; color: var(--muted); }
  .dot { display: inline-block; width: 8px; height: 8px; border-radius: 50%; background: var(--accent); margin-inline-end: 8px; animation: pulse 1.4s ease-in-out infinite; }
  @keyframes pulse { 50% { opacity: .3; } }
  @media (prefers-reduced-motion: reduce) { .dot { animation: none; } }
  p { margin: 0; }
  /* the right-hand panels: How it works (foldable on a phone) and the reassurance card */
  .how { gap: 0; }
  .how summary { cursor: pointer; list-style: none; display: flex; align-items: center; gap: 10px; width: 100%; }
  .how summary::-webkit-details-marker { display: none; }
  .how summary::after { content: '−'; margin-inline-start: auto; color: var(--muted); font-family: var(--mono); }
  .how:not([open]) summary::after { content: '+'; }
  .how[open] summary { margin-bottom: 12px; }
  .how .steps { grid-template-columns: minmax(0, 1fr); }
  .assure { gap: 8px; }
  .assure p { display: flex; gap: 8px; align-items: flex-start; font-size: 13.5px; color: var(--muted); }
  .assure :global(svg) { flex: none; margin-top: 2px; color: var(--green); }
  /* Transfers: the incoming offers ride along at the top, so a Save button never moves under a finger */
  .xfers { gap: 12px; }
  .incoming { position: sticky; top: 88px; z-index: 5; display: grid; gap: 12px; }
  .incoming .offer { box-shadow: 0 8px 24px rgb(2 6 23 / .18); }
  .auto { display: flex; gap: 6px; align-items: center; }
  .saveall { padding-top: 2px; }
</style>

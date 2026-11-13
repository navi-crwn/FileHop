<script lang="ts">
  import Icon from './Icon.svelte';
  import { i18n, actionLabel } from '../i18n/index.svelte';
  import { targetsFor, actionDef, isHash } from '../core/actions';
  import type { Job } from '../core/types';
  import { fmtSize } from '../util/format';
  import { looksLikePages } from '../core/pages';
  import { account } from '../account.svelte';
  import { canSaveToPixelHop, saveToPixelHop, saveErrorKey } from '../core/pixelhop';

  interface Props {
    job: Job;
    /** how many PDFs are in the queue: Merge only exists with two or more */
    pdfCount: number;
    /** this PDF is folded into another card's merge, so it has no result of its own */
    absorbed?: boolean;
    /** the group's merge is running on another card: this card's retry waits for it */
    mergeBusy?: boolean;
    /** when this card carries the merge: the names of the PDFs it will join, in queue order */
    mergeNames?: string[];
    onAction: (id: Job['action']) => void;
    onOpt: (key: string, value: number | string) => void;
    onRun: () => void;
    onCancel: () => void;
    onRemove: () => void;
    onDownload: () => void;
  }

  let { job, pdfCount, absorbed = false, mergeBusy = false, mergeNames = [], onAction, onOpt, onRun, onCancel, onRemove, onDownload }: Props = $props();

  // Save to PixelHop: the one place a result leaves the browser, so it asks first and says so.
  let px = $state<'idle' | 'confirm' | 'sending' | 'done' | 'error'>('idle');
  let pxLink = $state('');
  let pxDup = $state(false);
  let pxErr = $state('failed');
  async function sendToPixel() {
    if (!job.result) return;
    px = 'sending';
    const r = await saveToPixelHop(job.result.blob, job.result.name);
    if (r.ok) { pxLink = r.pageUrl; pxDup = r.duplicate; px = 'done'; } else { pxErr = r.error; px = 'error'; }
  }
  let copied = $state(false);

  // While another card is building the group's merge, this card's retry waits:
  // native disabled, with a visible line under the error that the button points at
  // for screen readers. Only a failed or stopped card has a Retry to block.
  const retryBlocked = $derived(
    mergeBusy && job.action === 'pdf:merge' && !absorbed && (job.status === 'error' || job.status === 'canceled')
  );

  const targets = $derived(
    targetsFor(job.det.category, job.det.ext).filter(id => (id === 'pdf:merge' ? pdfCount > 1 : true))
  );
  const def = $derived(actionDef(job.action));
  const icon = $derived(
    job.det.category === 'pdf' ? 'pdf'
    : job.det.category === 'image' ? 'image'
    : job.det.category === 'data' ? 'data'
    : job.det.category === 'text' ? 'text'
    : job.det.category === 'archive' ? 'archive'
    : job.det.category === 'media' ? 'media'
    : job.det.category === 'font' ? 'font'
    : 'file'
  );

  // A picture we already decoded is a better icon than a generic glyph.
  let previewUrl = $state<string | null>(null);
  $effect(() => {
    if (job.det.category !== 'image' || job.size > 40 * 1024 * 1024) return;
    if (!/^(image\/(png|jpeg|webp|gif|avif|bmp))$/.test(job.det.mime)) return;
    const url = URL.createObjectURL(job.file);
    previewUrl = url;
    return () => {
      URL.revokeObjectURL(url);
      previewUrl = null;
    };
  });

  const errorKey = $derived(    job.error ? job.error.split(':')[0].replace(/[^a-z_]/gi, '') : ''
  );
  const errText = $derived.by(() => {
    if (!job.error) return '';
      const known = ['cannot_decode', 'avif_not_supported', 'encoder_missing', 'bad_page_selection',
        'archive_too_big', 'archive_ratio', 'archive_unsafe_path', 'archive_bad_zip',
        'json_parse', 'csv_parse', 'yaml_parse', 'unsupported_action', 'worker_crash',
        'already_markdown', 'merge_needs_two', 'svg_needs_main_thread', 'out_of_memory'];
    if (known.includes(errorKey)) {
      const key = errorKey === 'unsupported_action' ? 'err.unsupported' : `err.${errorKey}`;
      return i18n.t(key);
    }
    return job.error;
  });

  const saving = $derived.by(() => {
    if (!job.result || isHash(job.action)) return null;
    // A size delta only means something when the result is the same artefact in a
    // smaller container. CSV→JSON is not "236% bigger", an SVG is instructions,
    // and PDF→PNG is a set of rendered pages rather than a lighter PDF.
    const comparable = (job.action.startsWith('image:') && job.det.mime !== 'image/svg+xml') ||
      job.action === 'image:pdf' ||
      job.action === 'archive:zip' || job.action === 'archive:gz';
    if (!comparable) return null;
    const d = 1 - job.result.blob.size / Math.max(1, job.size);
    if (Math.abs(d) < 0.005) return i18n.t('job.same_size');
    return d > 0 ? i18n.t('job.saved', { pct: Math.round(d * 100) }) : i18n.t('job.bigger', { pct: Math.round(-d * 100) });
  });

  async function copyHash() {
    if (!job.result?.hash) return;
    try {
      await navigator.clipboard.writeText(job.result.hash);
      copied = true;
      setTimeout(() => (copied = false), 1600);
    } catch {
      /* clipboard blocked: select the text instead */
    }
  }

  function optValue(id: string): number | string {
    return job.opts[id] ?? '';
  }

  /** the page-range box is the one free-text option; check it before it runs */
  const pagesOk = $derived.by(() => {
    const spec = job.opts.pages;
    if (typeof spec !== 'string') return true;
    return looksLikePages(spec);
  });
</script>

<article class="card {job.status}">
  <div class="ico" aria-hidden="true">
    {#if previewUrl}
      <img src={previewUrl} alt="" />
    {:else}
      <Icon name={icon} size={20} />
    {/if}
  </div>

  <div class="meta">
    <div class="name">
      <span class="fname" title={job.name}>{job.name}</span>
      <span class="badge">{job.det.label}</span>
      {#if job.det.mismatch}
        <span class="badge warn" title={i18n.t('job.mismatch_title')}>{i18n.t('job.mismatch')}</span>
      {/if}
      {#if absorbed || job.status === 'merged'}
        <span class="badge">{i18n.t('job.absorbed')}</span>
      {:else if job.status === 'done'}
        <span class="badge ok">{i18n.t('job.done')}</span>
      {:else if job.status === 'error'}
        <span class="badge bad">{i18n.t('job.error')}</span>
      {:else if job.status === 'canceled'}
        <span class="badge">{i18n.t('job.canceled')}</span>
      {/if}
    </div>

    <div class="sub">
      <span>{fmtSize(job.size)}</span>
      <span class="dot"></span>
      <span class="mono">{job.det.mime}</span>
      {#if job.result?.note}
        <span class="dot"></span>
        <span>{job.result.note}</span>
      {/if}
    </div>

    {#if mergeNames.length > 1 && job.status !== 'done'}
      <p class="merge-list" title={mergeNames.join(', ')}>
        <strong>{i18n.t('job.merge_of', { n: mergeNames.length })}:</strong>
        {mergeNames.join(' · ')}
      </p>
    {/if}

    {#if job.status !== 'done' && job.status !== 'merged' && job.status !== 'running' && !absorbed}
      <div class="targets" role="group" aria-label={i18n.t('job.target')}>
        {#each targets as t (t)}
          {@const td = actionDef(t)}
          {#if td}
            <button
              type="button"
              class="chip"
              class:on={job.action === t}
              aria-pressed={job.action === t}
              onclick={() => onAction(t)}
            >{actionLabel(td)}</button>
          {/if}
        {/each}
      </div>

      {#if def?.options?.length}
        <div class="opts">
          {#each def.options as o (o.id)}
            {#if o.type === 'range'}
              <label class="opt">
                <span>{i18n.t(o.labelKey)}</span>
                <input
                  type="range"
                  aria-label={i18n.t(o.labelKey)}
                  min={o.min}
                  max={o.max}
                  step={o.step}
                  value={optValue(o.id)}
                  oninput={(e) => onOpt(o.id, Number((e.currentTarget as HTMLInputElement).value))}
                />
                <span class="val">{optValue(o.id)}</span>
              </label>
            {:else if o.type === 'number'}
              <label class="opt">
                <span>{i18n.t(o.labelKey)}</span>
                <input
                  class="field-input"
                  type="number"
                  value={optValue(o.id)}
                  oninput={(e) => onOpt(o.id, Number((e.currentTarget as HTMLInputElement).value))}
                />
              </label>
            {:else}
              <label class="opt">
                <span>{i18n.t(o.labelKey)}</span>
                <input
                  class="field-input"
                  type="text"
                  inputmode="numeric"
                  placeholder="1-3,7"
                  aria-invalid={!pagesOk}
                  value={optValue(o.id)}
                  oninput={(e) => onOpt(o.id, (e.currentTarget as HTMLInputElement).value)}
                />
              </label>
              {#if !pagesOk}
                <span class="small" style="color:var(--red)">{i18n.t('opt.pages_bad')}</span>
              {/if}
            {/if}
          {/each}
        </div>
      {/if}
    {/if}

    {#if job.status === 'running'}
      <div class="bar"><i style="width:{Math.round(job.progress * 100)}%"></i></div>
    {:else if job.status === 'done' && job.result}
      <div class="result">
        <span class="badge ok">{fmtSize(job.result.size)}</span>
        {#if saving}<span class="muted">{saving}</span>{/if}
        {#if job.result.pages}<span class="muted">{job.result.pages} pages</span>{/if}
        {#if job.result.hash}
          <code class="hash">{job.result.hash}</code>
        {/if}
        {#if job.result.listing?.length}
          <span class="muted">{job.result.listing.length} entries</span>
        {/if}
      </div>
      {#if account.signedIn && account.pixelhop && canSaveToPixelHop(job.result, account.pixelhop.max)}
        <div class="px" data-state={px}>
          {#if px === 'idle'}
            <button class="mini secondary save-px" type="button" onclick={() => (px = 'confirm')}><Icon name="upload" size={14} />{i18n.t('save.action')}</button>
          {:else if px === 'confirm'}
            <p class="muted small px-note">{i18n.t('save.notice')}</p>
            <span class="px-row">
              <button class="mini secondary save-px-go" type="button" onclick={sendToPixel}>{i18n.t('save.confirm')}</button>
              <button class="mini" type="button" onclick={() => (px = 'idle')}>{i18n.t('save.cancel')}</button>
            </span>
          {:else if px === 'sending'}
            <span class="muted small" aria-live="polite">{i18n.t('save.sending')}</span>
          {:else if px === 'done'}
            <span class="small ok-text" aria-live="polite">{i18n.t(pxDup ? 'save.duplicate' : 'save.done')} {#if pxLink}<a class="px-link" href={pxLink} target="_blank" rel="noopener">{i18n.t('save.open')}</a>{/if}</span>
          {:else}
            <p class="err px-err" role="alert"><Icon name="alert" size={15} /><span>{i18n.t(saveErrorKey(pxErr), { max: fmtSize(account.pixelhop.max) })}</span></p>
            <span class="px-row">
              {#if pxErr === 'no_account' || pxErr === 'unsure'}<a class="mini secondary" href={account.pixelhop.url} target="_blank" rel="noopener">{i18n.t('save.open_pixelhop')}</a>{/if}
              <button class="mini" type="button" onclick={() => (px = 'confirm')}>{i18n.t('job.retry')}</button>
            </span>
          {/if}
        </div>
      {/if}
    {:else if job.status === 'error'}
      <p class="err"><Icon name="alert" size={15} /><span>{errText}</span></p>
    {/if}
    {#if retryBlocked}
      <p class="wait" id="retry-wait-{job.id}">{i18n.t('job.retry_wait')}</p>
    {/if}
  </div>

  <div class="side">
    {#if absorbed || job.status === 'merged' || job.status === 'running'}
      <!-- nothing of its own: the X at the end of the row removes it or stops it -->
    {:else if job.status === 'queued'}
      <button class="mini secondary" type="button" onclick={onRun}><Icon name="play" size={14} />{i18n.t('job.run')}</button>
    {:else if job.status === 'done'}
      <button class="mini secondary" type="button" onclick={onDownload}><Icon name="download" size={14} />{i18n.t('job.download')}</button>
      {#if job.result?.hash}
        <button class="mini" type="button" onclick={copyHash}>{copied ? i18n.t('job.copied') : i18n.t('job.copy_hash')}</button>
      {/if}
    {:else}
      <button class="mini" type="button" onclick={onRun} disabled={retryBlocked} aria-describedby={retryBlocked ? 'retry-wait-' + job.id : undefined}><Icon name="refresh" size={14} />{i18n.t('job.retry')}</button>
    {/if}
  </div>

  <!-- One X at the end of every row. A running file is stopped (the others keep going and the row stays,
       with Try again); any other file leaves the list. A finished file's download is not affected. -->
  <button
    class="rm"
    type="button"
    data-rm
    onclick={job.status === 'running' ? onCancel : onRemove}
    aria-label={i18n.t(job.status === 'running' ? 'job.cancel_file' : 'job.remove_file', { name: job.name })}
    title={i18n.t(job.status === 'running' ? 'job.cancel_file' : 'job.remove_file', { name: job.name })}
  ><Icon name="close" size={16} /></button>
</article>

<style>
  .px { margin-top: 10px; display: flex; flex-direction: column; align-items: flex-start; gap: 8px; }
  .px-note { margin: 0; max-width: 52ch; }
  .px-row { display: flex; gap: 8px; flex-wrap: wrap; }
  .px-err { margin: 0; }
  .ok-text { color: var(--green); }
  .px-link { color: inherit; text-decoration: underline; }
  .card .side :global(svg) { flex: none; }
  .merge-list {
    margin: 2px 0 0;
    font-size: 12px;
    line-height: 1.4;
    color: var(--muted);
    overflow: hidden;
    display: -webkit-box;
    -webkit-box-orient: vertical;
    -webkit-line-clamp: 2;
    line-clamp: 2;
    word-break: break-word;
  }
  .merge-list strong { color: var(--text); font-weight: 600; }
  .wait { margin: 6px 0 0; font-size: 12.5px; line-height: 1.4; color: var(--muted); }
</style>

<script lang="ts">
  import Icon from './Icon.svelte';
  import { i18n } from '../i18n/index.svelte';
  import { LOCALES, LOCALE_NAMES } from '../i18n/index.svelte';
  import { AVIF_ENCODABLE } from '../core/features';
  import { hardwareSlots } from '../core/pool';

  interface Props {
    locale: string;
    onLocale: (l: string) => void;
    maxWorkers: number;
    autoWorkers: number;
    batterySaver: boolean;
    onWorkers: (n: number) => void;
    onBattery: (v: boolean) => void;
    networkCount: number;
    onClearAll: () => void;
    onClose: () => void;
  }

  let {
    locale, onLocale, maxWorkers, autoWorkers, batterySaver,
    onWorkers, onBattery, networkCount, onClearAll, onClose
  }: Props = $props();

  const isolated = $derived(typeof crossOriginIsolated !== 'undefined' && crossOriginIsolated);

  // a dialog takes focus when it opens, so the next Tab and Escape land in it
  let root: HTMLDivElement | undefined;
  $effect(() => {
    root?.focus();
  });
  const auto = $derived(autoWorkers || hardwareSlots());
</script>

<div class="drawer" role="dialog" aria-modal="true" aria-labelledby="settings-h" tabindex="-1" bind:this={root}>
  <div class="dhead">
    <h2 id="settings-h">{i18n.t('settings.title')}</h2>
    <button class="tbtn icon" type="button" onclick={onClose} aria-label={i18n.t('licenses.close')}>
      <Icon name="close" size={17} />
    </button>
  </div>

  <div class="slider-row">
    <label class="lbl" for="workers">
      <span>{i18n.t('settings.workers')}</span>
      <span class="mono">{maxWorkers === 0 ? i18n.t('settings.workers_auto', { n: auto }) : maxWorkers}</span>
    </label>
    <input
      id="workers"
      type="range"
      min="0"
      max="8"
      step="1"
      value={maxWorkers}
      disabled={batterySaver}
      oninput={(e) => onWorkers(Number((e.currentTarget as HTMLInputElement).value))}
    />
    <span class="small faint">{i18n.t('settings.workers_auto', { n: auto })}</span>
  </div>

  <div class="row">
    <span class="lbl">{i18n.t('settings.battery')}</span>
    <button
      type="button"
      class="switch"
      class:on={batterySaver}
      role="switch"
      aria-checked={batterySaver}
      aria-label={i18n.t('settings.battery')}
      onclick={() => onBattery(!batterySaver)}
    ></button>
  </div>

  <div class="row">
    <span class="lbl">{i18n.t('settings.isolation')}</span>
    <span class="val">{isolated ? i18n.t('settings.isolation_on') : i18n.t('settings.isolation_off')}</span>
  </div>

  <div class="row">
    <span class="lbl">AVIF</span>
    <span class="val">{AVIF_ENCODABLE ? i18n.t('settings.avif_on') : i18n.t('settings.avif_off')}</span>
  </div>

  <h3 class="small" style="margin:22px 0 8px;font:700 11px var(--mono);letter-spacing:.06em;text-transform:uppercase;color:var(--muted)">
    {i18n.t('settings.engines')}
  </h3>
  <dl>
    <dt>{i18n.t('group.image')}</dt><dd>{i18n.t('settings.engine_image')}</dd>
    <dt>PDF</dt><dd>{i18n.t('settings.engine_pdf', { pv: '6', lv: '1.17' })}</dd>
    <dt>{i18n.t('formats.hash')}</dt><dd>{i18n.t('settings.engine_hash')}</dd>
    <dt>ZIP</dt><dd>{i18n.t('settings.engine_zip')}</dd>
  </dl>
  <p class="small faint" style="margin:-8px 0 18px">{i18n.t('settings.no_wasm')}</p>

  <h3 class="small" style="margin:0 0 8px;font:700 11px var(--mono);letter-spacing:.06em;text-transform:uppercase;color:var(--muted)">
    {i18n.t('nav.language')}
  </h3>
  <label class="sr" for="lang-select">{i18n.t('nav.language')}</label>
  <select
    id="lang-select"
    class="select"
    style="width:100%"
    value={locale}
    onchange={(e) => onLocale((e.currentTarget as HTMLSelectElement).value)}
  >
    {#each LOCALES as l (l)}
      <option value={l}>{LOCALE_NAMES[l] ?? l}</option>
    {/each}
  </select>

  <p class="small muted" style="margin:16px 0 0">{i18n.t('privacy.network', { n: networkCount })}</p>
  <p class="small faint" style="margin:4px 0 20px">{i18n.t('privacy.network_note')}</p>

  <button class="tbtn" type="button" style="width:100%;justify-content:center" onclick={onClearAll}>
    <Icon name="trash" size={16} />{i18n.t('privacy.clear')}
  </button>
  <p class="small faint" style="margin:10px 0 0">{i18n.t('settings.prefs_saved')}</p>
</div>

<script lang="ts">
  import Icon from './Icon.svelte';
  import { i18n } from '../i18n/index.svelte';
  import { ANNOUNCEMENTS, HIDE_DAYS, announceKey, type Announcement } from '../announcements';

  /* The first notice that is not hidden. Closing one keeps it away for seven days (localStorage, key with the
     notice id, no server). Nothing is drawn when there is none. */
  let { items = ANNOUNCEMENTS, locale = 'en' }: { items?: Announcement[]; locale?: string } = $props();

  function hidden(id: string): boolean {
    try {
      const at = Number(localStorage.getItem(announceKey(id)));
      return at > 0 && Date.now() - at < HIDE_DAYS * 864e5;
    } catch {
      return false;
    }
  }
  let closed = $state<Record<string, boolean>>({});
  const shown = $derived(items.find((a) => !closed[a.id] && !hidden(a.id)));

  function close(id: string) {
    try {
      localStorage.setItem(announceKey(id), String(Date.now()));
    } catch {
      /* storage blocked: it is hidden until the page is closed */
    }
    closed[id] = true;
  }
  const pick = (m: Partial<Record<string, string>> & { en: string }) => m[locale] ?? m.en;
</script>

{#if shown}
  <section class="announce" aria-labelledby="announce-h">
    <span class="announce-ic" aria-hidden="true"><Icon name="bell" size={18} /></span>
    <div class="announce-body">
      <h2 id="announce-h">{i18n.t('announce.title')}</h2>
      <p>{pick(shown.text)}{#if shown.href && shown.linkText} <a href={shown.href} rel="noopener">{pick(shown.linkText)}</a>{/if}</p>
    </div>
    <button class="announce-x" type="button" aria-label={i18n.t('announce.close')} title={i18n.t('announce.close')} onclick={() => close(shown.id)}>
      <Icon name="close" size={16} />
    </button>
  </section>
{/if}

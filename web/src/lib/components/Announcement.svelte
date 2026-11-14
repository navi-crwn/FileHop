<script lang="ts">
  import Icon from './Icon.svelte';
  import { i18n } from '../i18n/index.svelte';
  import { account } from '../account.svelte';
  import { HIDE_DAYS, announceKey, type Announcement } from '../announcements';

  /* The first notice that is not hidden, one card at most. Closing one keeps it away for seven days (localStorage,
     key with the notice id, no server); a critical notice has no close button and is never hidden. The notices come
     from the hub through /api/v1/me; nothing is drawn when there are none. */
  let { items = account.announcements ?? [] }: { items?: Announcement[] } = $props();

  function hidden(a: Announcement): boolean {
    if (!a.closable) return false;
    try {
      const at = Number(localStorage.getItem(announceKey(a.id)));
      return at > 0 && Date.now() - at < HIDE_DAYS * 864e5;
    } catch {
      return false;
    }
  }
  let closed = $state<Record<string, boolean>>({});
  const shown = $derived(items.find((a) => !closed[a.id] && !hidden(a)));

  function close(id: string) {
    try {
      localStorage.setItem(announceKey(id), String(Date.now()));
    } catch {
      /* storage blocked: it is hidden until the page is closed */
    }
    closed[id] = true;
  }
</script>

{#if shown}
  <section class="announce" aria-labelledby="announce-h">
    <span class="announce-ic" aria-hidden="true"><Icon name="bell" size={18} /></span>
    <div class="announce-body">
      <h2 id="announce-h">{i18n.t('announce.title')}</h2>
      <p><strong>{#if shown.url}<a href={shown.url} rel="noopener">{shown.title}</a>{:else}{shown.title}{/if}</strong>{#if shown.body}{' ' + shown.body}{/if}</p>
    </div>
    {#if shown.closable}
      <button class="announce-x" type="button" aria-label={i18n.t('announce.close')} title={i18n.t('announce.close')} onclick={() => close(shown.id)}>
        <Icon name="close" size={16} />
      </button>
    {/if}
  </section>
{/if}

<script lang="ts">
  import { i18n, actionLabel } from '../i18n/index.svelte';
  import { targetsFor, actionDef } from '../core/actions';
  import type { Job } from '../core/types';

  /* The ring appears around the pointer while files are being dragged, and
     shows only the targets that fit what was grabbed. Releasing a file on a
     target is the drop: the item takes the drop itself, so a normal drag works
     without a second click. Touch and reduced motion use the chips instead. */

  interface Props {
    x: number;
    y: number;
    category: Job['det']['category'] | null;
    ext: string;
    count: number;
    /** PDFs already in the queue, so Merge can be offered honestly */
    queuedPdfs: number;
    onPick: (id: Job['action'], files: File[]) => void;
  }

  let { x, y, category, ext, count, queuedPdfs, onPick }: Props = $props();

  const items = $derived(
    (category ? targetsFor(category, ext) : [])
      // merging one file with itself is not a conversion
      .filter(id => (id === 'pdf:merge' ? count + queuedPdfs > 1 : true))
      .slice(0, 8)
  );
  const radius = 134;

  function pos(i: number): { left: string; top: string } {
    const n = items.length || 1;
    // start at 12 o'clock and go clockwise
    const angle = (-Math.PI / 2) + (i / n) * Math.PI * 2;
    return {
      left: `${Math.cos(angle) * radius}px`,
      top: `${Math.sin(angle) * radius}px`
    };
  }

  function takeDrop(e: DragEvent, id: Job['action']) {
    e.preventDefault();
    e.stopPropagation();
    const files = [...(e.dataTransfer?.files ?? [])];
    onPick(id, files);
  }
</script>

<div class="ring" style="left:{x}px; top:{y}px">
  <div class="ring-core">
    {count} {count === 1 ? i18n.t('queue.file') : i18n.t('queue.files', { n: count })}
  </div>
  {#each items as id, i (id)}
    {@const d = actionDef(id)}
    <button
      type="button"
      class="ring-item"
      style={Object.entries(pos(i)).map(([k, v]) => `${k}:${v}`).join(';')}
      ondragover={(e) => { e.preventDefault(); if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy'; }}
      ondrop={(e) => takeDrop(e, id)}
      onclick={() => onPick(id, [])}
    >{d ? actionLabel(d) : id}</button>
  {/each}
</div>

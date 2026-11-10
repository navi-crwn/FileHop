<script lang="ts">
  /* One sprite, drawn inline. No icon font, no network request. */
  interface Props {
    name: string;
    size?: number;
  }
  let { name, size = 18 }: Props = $props();
  const paths: Record<string, string> = {
    add: 'M12 5v14M5 12h14',
    upload: 'M12 16V4m0 0-4 4m4-4 4 4M4 16v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2',
    download: 'M12 4v12m0 0 4-4m-4 4-4-4M4 18v2h16v-2',
    file: 'M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8zM14 3v5h5',
    image: 'M4 5h16v14H4zM4 15l4.5-4.5 4 4 3-3L20 15m-11-6.5a1.25 1.25 0 1 1-2.5 0 1.25 1.25 0 0 1 2.5 0',
    pdf: 'M7 3h7l5 5v13H7zM14 3v5h5M9.5 17v-4h1.2a1.3 1.3 0 0 1 0 2.6H9.5',
    data: 'M4 6c0-1.7 3.6-3 8-3s8 1.3 8 3-3.6 3-8 3-8-1.3-8-3zM4 6v12c0 1.7 3.6 3 8 3s8-1.3 8-3V6M4 12c0 1.7 3.6 3 8 3s8-1.3 8-3',
    text: 'M5 5h14M5 10h9M5 15h14M5 20h7',
    archive: 'M4 4h16v5H4zM4 9h16v11H4zM12 12v4m0 0-2-2m2 2 2-2',
    media: 'M9 18V6l10-2v12M9 18a3 3 0 1 1-6 0 3 3 0 0 1 6 0zM19 16a3 3 0 1 1-6 0 3 3 0 0 1 6 0z',
    font: 'M5 19 11 5h2l6 14M8 14h8',
    hash: 'M9 4 7 20M17 4l-2 16M4 9h16M3 15h16',
    close: 'M6 6l12 12M18 6 6 18',
    check: 'M4 12.5 9 17.5 20 6.5',
    alert: 'M12 8v5m0 3h.01M10.3 4.3 2.6 18a1.8 1.8 0 0 0 1.6 2.7h15.6a1.8 1.8 0 0 0 1.6-2.7L13.7 4.3a1.9 1.9 0 0 0-3.4 0z',
    gear: 'M12 15.5a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7zM19.4 15a1.7 1.7 0 0 0 .34 1.87l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.7 1.7 0 0 0-1.87-.34 1.7 1.7 0 0 0-1 1.55V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.56 1.7 1.7 0 0 0-1.87.34l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.7 1.7 0 0 0 .34-1.87 1.7 1.7 0 0 0-1.55-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.56-1.1 1.7 1.7 0 0 0-.34-1.87l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.7 1.7 0 0 0 1.87.34H9a1.7 1.7 0 0 0 1-1.55V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.55 1.7 1.7 0 0 0 1.87-.34l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.7 1.7 0 0 0-.34 1.87V9a1.7 1.7 0 0 0 1.55 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z',
    sun: 'M12 4V2m0 20v-2m8-8h2M2 12h2m13.7-5.7 1.4-1.4M4.9 19.1l1.4-1.4m11.4 0 1.4 1.4M4.9 4.9l1.4 1.4M16 12a4 4 0 1 1-8 0 4 4 0 0 1 8 0z',
    moon: 'M20 14.5A8.5 8.5 0 0 1 9.5 4a8.5 8.5 0 1 0 10.5 10.5z',
    trash: 'M4 7h16M9 7V5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2m-9 0 1 12a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1l1-12',
    play: 'M6 4l14 8-14 8z',
    stop: 'M7 7h10v10H7z',
    refresh: 'M20 12a8 8 0 1 1-2.3-5.7M20 4v4h-4',
    copy: 'M9 9h10v10H9zM15 9V5a1 1 0 0 0-1-1H5a1 1 0 0 0-1 1v9a1 1 0 0 0 1 1h4',
    lock: 'M6 11h12v9H6zM9 11V8a3 3 0 0 1 6 0v3',
    net: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM3 12h18M12 3a13 13 0 0 1 0 18 13 13 0 0 1 0-18z',
    shield: 'M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z',
    code: 'M9 8l-4 4 4 4M15 8l4 4-4 4',
    arrow: 'M5 12h14m0 0-5-5m5 5-5 5',
    menu: 'M4 7h16M4 12h16M4 17h16'
  };
</script>

<svg
  width={size}
  height={size}
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="1.7"
  stroke-linecap="round"
  stroke-linejoin="round"
  aria-hidden="true"
  focusable="false"
>
  <path d={paths[name] ?? paths.file} />
</svg>

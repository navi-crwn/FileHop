import { mount, tick } from 'svelte';
import App from './App.svelte';
import { i18n, guessLocale } from './lib/i18n/index.svelte';

const root = document.getElementById('root');
if (!root) throw new Error('missing #root');

// The server writes a first view of the page into #root (internal/app/pages.go): the app's own markup,
// in the visitor's language and theme. The app is mounted behind it, unseen (a rule of the page's style
// hides whatever follows the first view), and takes its place once it can show the same screen: its
// dictionary is loaded and, on /send, the send screen as well. So nothing jumps or flashes in English.
const first = root.querySelector<HTMLElement>(':scope > .hop-static');
if (!first) root.replaceChildren();
const app = mount(App, { target: root });
if (first) {
  const sendRoute = location.pathname.replace(/\/+$/, '') === '/send';
  const ready = Promise.allSettled([i18n.load(guessLocale()), sendRoute ? import('./lib/send/Send.svelte') : null]);
  // A request that hangs must not leave the visitor with a first view whose buttons do nothing: after 3 s
  // the app is shown as it is (in English until its dictionary arrives, then it switches by itself).
  void Promise.race([ready, new Promise((r) => setTimeout(r, 3000))])
    .then(() => tick())
    .then(() => new Promise((r) => requestAnimationFrame(r)))
    .then(() => first.remove());
}

export default app;

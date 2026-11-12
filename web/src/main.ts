import { mount } from 'svelte';
import App from './App.svelte';

const root = document.getElementById('root');
if (!root) throw new Error('missing #root');

// The server puts a plain summary of the page in #root for readers without scripts
// (internal/app/pages.go); the app takes its place.
root.replaceChildren();

export default mount(App, { target: root });

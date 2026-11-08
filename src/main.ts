import { mount } from 'svelte';
import App from './App.svelte';

const root = document.getElementById('root');
if (!root) throw new Error('missing #root');

export default mount(App, { target: root });

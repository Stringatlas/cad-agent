import { mount } from 'svelte';
// Keep the scene workspace and its geometry dependencies out of the inspector route.
const { default: Page } = window.location.pathname.replace(/\/+$/, '') === '/tools'
  ? await import('./chat/ToolsInspector.svelte')
  : await import('./App.svelte');
mount(Page, { target: document.getElementById('app')! });

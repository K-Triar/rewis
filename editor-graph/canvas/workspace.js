import { h, clear } from '../dom.js';

export function createWorkspace(container, { ribbon = false } = {}) {
  clear(container);

  const left = h('div', { class: 'g-ws-left' });
  const toolbar = h('div', { class: 'g-ws-toolbar' });
  const banner = h('div', { class: 'g-banner', hidden: true });
  const canvasHost = h('div', { class: 'g-ws-canvas-host' });
  const ribbonHost = ribbon ? h('div', { class: 'g-ws-ribbon' }) : null;
  const right = h('div', { class: 'g-ws-right' });

  const canvasCol = h('div', { class: 'g-ws-canvas' }, toolbar, banner, canvasHost, ribbonHost);

  container.appendChild(h('div', { class: 'g-workspace' }, left, canvasCol, right));

  function setBanner(text) {
    if (text) {
      banner.textContent = text;
      banner.hidden = false;
    } else {
      banner.hidden = true;
    }
  }

  return { left, canvasHost, toolbar, banner, ribbonHost, right, setBanner };
}

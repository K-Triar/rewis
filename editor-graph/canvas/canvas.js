import { s, clear } from '../../editor-shared/dom.js';
import { graphUi } from './ui-state.js';

const MIN_K = 0.25;
const MAX_K = 3;

function clamp(v, min, max) {
  return Math.max(min, Math.min(max, v));
}

export function trackPointer(event, { onClick, onDragStart, onDragMove, onDragEnd } = {}) {
  const startX = event.clientX;
  const startY = event.clientY;
  let dragging = false;

  // move/up は window で受ける。ドラッグ中に対象の要素が再描画で作り直される
  // （キャンバスの render は毎フレーム world を作り直す）ため、要素へ setPointerCapture
  // したり要素自身にリスナーを付けたりすると、作り直された瞬間に移動が止まってしまう。
  function onMove(e) {
    const dx = e.clientX - startX;
    const dy = e.clientY - startY;
    if (!dragging) {
      if (Math.hypot(dx, dy) < 4) return;
      dragging = true;
      if (onDragStart) onDragStart(event, { dx, dy });
    }
    if (onDragMove) onDragMove(e, { dx, dy });
  }

  function onUp(e) {
    window.removeEventListener('pointermove', onMove);
    window.removeEventListener('pointerup', onUp);
    window.removeEventListener('pointercancel', onUp);
    if (dragging) {
      if (onDragEnd) onDragEnd(e);
    } else if (onClick) {
      onClick(event);
    }
  }

  window.addEventListener('pointermove', onMove);
  window.addEventListener('pointerup', onUp);
  window.addEventListener('pointercancel', onUp);
}

export function createCanvas(host, { onBackgroundClick, onBackgroundDoubleClick, viewportKey } = {}) {
  const saved = viewportKey ? graphUi.viewports[viewportKey] : null;
  let tx = saved ? saved.tx : 0;
  let ty = saved ? saved.ty : 0;
  let k = saved ? saved.k : 1;

  const svg = s('svg', { class: 'g-canvas', width: '100%', height: '100%' });
  const bg = s('rect', { class: 'g-canvas-bg', x: 0, y: 0, width: '100%', height: '100%' });
  const world = s('g', { class: 'g-world' });
  svg.appendChild(bg);
  svg.appendChild(world);
  host.appendChild(svg);

  function applyTransform() {
    world.setAttribute('transform', `translate(${tx},${ty}) scale(${k})`);
  }
  applyTransform();

  function saveViewport() {
    if (viewportKey) graphUi.viewports[viewportKey] = { tx, ty, k };
  }

  function hostRect() {
    return host.getBoundingClientRect();
  }

  let renderScheduled = false;
  let pendingBuild = null;

  function render(buildFn) {
    pendingBuild = buildFn;
    if (renderScheduled) return;
    renderScheduled = true;
    requestAnimationFrame(() => {
      renderScheduled = false;
      const fn = pendingBuild;
      pendingBuild = null;
      clear(world);
      if (fn) fn(world);
    });
  }

  function screenToWorld(clientX, clientY) {
    const rect = hostRect();
    const x = clientX - rect.left;
    const y = clientY - rect.top;
    return { x: (x - tx) / k, y: (y - ty) / k };
  }

  function fitTo(bounds) {
    const rect = hostRect();
    const w = Math.max(bounds.maxX - bounds.minX, 1);
    const h = Math.max(bounds.maxY - bounds.minY, 1);
    const pad = 60;
    const availW = Math.max(rect.width - pad * 2, 1);
    const availH = Math.max(rect.height - pad * 2, 1);
    k = clamp(Math.min(availW / w, availH / h), MIN_K, MAX_K);
    const cx = (bounds.minX + bounds.maxX) / 2;
    const cy = (bounds.minY + bounds.maxY) / 2;
    tx = rect.width / 2 - cx * k;
    ty = rect.height / 2 - cy * k;
    applyTransform();
    saveViewport();
  }

  function centerOn(x, y) {
    const rect = hostRect();
    tx = rect.width / 2 - x * k;
    ty = rect.height / 2 - y * k;
    applyTransform();
    saveViewport();
  }

  function zoomBy(factor) {
    const rect = hostRect();
    const cx = rect.width / 2;
    const cy = rect.height / 2;
    const newK = clamp(k * factor, MIN_K, MAX_K);
    tx = cx - (cx - tx) * (newK / k);
    ty = cy - (cy - ty) * (newK / k);
    k = newK;
    applyTransform();
    saveViewport();
  }

  function onWheel(event) {
    event.preventDefault();
    const rect = hostRect();
    const cx = event.clientX - rect.left;
    const cy = event.clientY - rect.top;
    const factor = event.deltaY < 0 ? 1.1 : 1 / 1.1;
    const newK = clamp(k * factor, MIN_K, MAX_K);
    tx = cx - (cx - tx) * (newK / k);
    ty = cy - (cy - ty) * (newK / k);
    k = newK;
    applyTransform();
    saveViewport();
  }

  let panStart = null;
  function onBgPointerDown(event) {
    if (event.button !== undefined && event.button !== 0) return;
    trackPointer(event, {
      onClick: (ev) => { if (onBackgroundClick) onBackgroundClick(ev); },
      onDragStart: () => { panStart = { tx, ty }; },
      onDragMove: (ev, { dx, dy }) => {
        tx = panStart.tx + dx;
        ty = panStart.ty + dy;
        applyTransform();
      },
      onDragEnd: () => { panStart = null; saveViewport(); }
    });
  }

  function onBgDoubleClick(event) {
    if (onBackgroundDoubleClick) onBackgroundDoubleClick(event);
  }

  svg.addEventListener('wheel', onWheel, { passive: false });
  bg.addEventListener('pointerdown', onBgPointerDown);
  bg.addEventListener('dblclick', onBgDoubleClick);

  function destroy() {
    svg.removeEventListener('wheel', onWheel);
    bg.removeEventListener('pointerdown', onBgPointerDown);
    bg.removeEventListener('dblclick', onBgDoubleClick);
    svg.remove();
  }

  return {
    svg,
    world,
    render,
    screenToWorld,
    fitTo,
    centerOn,
    zoomBy,
    destroy,
    hasSavedViewport: !!saved
  };
}

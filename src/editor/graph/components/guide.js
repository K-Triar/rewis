import { h, clear } from '../../common/dom.js';

const BALLOON_WIDTH = 320;

function resolveSteps(steps) {
  return steps
    .map((step) => ({ ...step, el: document.querySelector(step.selector) }))
    .filter((step) => !!step.el);
}

export function openGuide(steps) {
  const resolved = resolveSteps(steps);
  if (resolved.length === 0) return;

  let index = 0;

  const edges = {
    top: h('div', { class: 'g-guide-backdrop' }),
    bottom: h('div', { class: 'g-guide-backdrop' }),
    left: h('div', { class: 'g-guide-backdrop' }),
    right: h('div', { class: 'g-guide-backdrop' })
  };
  const balloon = h('div', { class: 'g-overlay g-guide-balloon' });

  Object.values(edges).forEach((el) => document.body.appendChild(el));
  document.body.appendChild(balloon);

  function close() {
    Object.values(edges).forEach((el) => el.remove());
    balloon.remove();
    document.removeEventListener('keydown', onKeyDown);
    window.removeEventListener('resize', layout);
  }

  function onKeyDown(event) {
    if (event.key === 'Escape') close();
  }
  document.addEventListener('keydown', onKeyDown);
  window.addEventListener('resize', layout);

  function setRect(el, x, y, w, h2) {
    el.style.left = `${x}px`;
    el.style.top = `${y}px`;
    el.style.width = `${Math.max(0, w)}px`;
    el.style.height = `${Math.max(0, h2)}px`;
  }

  function layout() {
    const step = resolved[index];
    const rect = step.el.getBoundingClientRect();
    const vw = window.innerWidth;
    const vh = window.innerHeight;

    setRect(edges.top, 0, 0, vw, rect.top);
    setRect(edges.bottom, 0, rect.bottom, vw, vh - rect.bottom);
    setRect(edges.left, 0, rect.top, rect.left, rect.height);
    setRect(edges.right, rect.right, rect.top, vw - rect.right, rect.height);

    renderBalloon(step, rect);
  }

  function renderBalloon(step, rect) {
    clear(balloon);
    const isLast = index === resolved.length - 1;

    balloon.appendChild(h('div', { class: 'g-dialog__title' }, step.title));
    balloon.appendChild(h('p', { class: 'g-dialog__message' }, step.body));
    balloon.appendChild(h('p', { class: 'g-ws-right__note' }, `${index + 1} / ${resolved.length}`));

    balloon.appendChild(h('div', { class: 'g-guide-balloon__nav' },
      h('button', { type: 'button', class: 'g-btn', onClick: close }, '閉じる'),
      h('div', { class: 'g-guide-balloon__spacer' }),
      index > 0 ? h('button', {
        type: 'button', class: 'g-btn',
        onClick: () => { index -= 1; layout(); }
      }, '戻る') : null,
      isLast
        ? h('button', { type: 'button', class: 'g-btn g-btn--primary', onClick: close }, '終わる')
        : h('button', {
            type: 'button', class: 'g-btn g-btn--primary',
            onClick: () => { index += 1; layout(); }
          }, '次へ')
    ));

    balloon.style.width = `${BALLOON_WIDTH}px`;
    const preferredTop = rect.bottom + 8;
    const fitsBelow = preferredTop + 180 <= window.innerHeight;
    const top = fitsBelow ? preferredTop : Math.max(8, rect.top - 8 - balloon.offsetHeight);
    const maxLeft = window.innerWidth - BALLOON_WIDTH - 8;
    const left = Math.max(8, Math.min(rect.left, maxLeft));
    balloon.style.top = `${top}px`;
    balloon.style.left = `${left}px`;

    step.el.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }

  layout();
}

export function maybeOpenGuideOnce(steps, storageKey) {
  let seen = null;
  try {
    seen = localStorage.getItem(storageKey);
  } catch (e) {
    seen = null;
  }
  if (seen) return;
  try {
    localStorage.setItem(storageKey, '1');
  } catch (e) {
    // localStorage が使えない環境ではガイドは出すが、記録できないため毎回出る
  }
  openGuide(steps);
}

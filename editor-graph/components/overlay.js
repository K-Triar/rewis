import { h } from '../dom.js';

let current = null;

export function openPopover(anchorClientX, anchorClientY, contentEl) {
  closeCurrent();

  const box = h('div', { class: 'g-overlay', style: 'position:fixed; z-index:900;' }, contentEl);
  document.body.appendChild(box);

  const rect = box.getBoundingClientRect();
  const maxX = window.innerWidth - rect.width - 8;
  const maxY = window.innerHeight - rect.height - 8;
  const x = Math.max(8, Math.min(anchorClientX, maxX));
  const y = Math.max(8, Math.min(anchorClientY, maxY));
  box.style.left = `${x}px`;
  box.style.top = `${y}px`;

  function close() {
    if (current && current.box === box) current = null;
    box.removeEventListener('keydown', onKeyDown);
    document.removeEventListener('pointerdown', onOutsidePointerDown, true);
    box.remove();
  }

  function onKeyDown(event) {
    if (event.key === 'Escape') {
      event.stopPropagation();
      close();
    }
  }

  function onOutsidePointerDown(event) {
    if (!box.contains(event.target)) close();
  }

  box.addEventListener('keydown', onKeyDown);
  // 開いた瞬間のクリックで即座に閉じないよう、次のイベントループから監視する
  setTimeout(() => document.addEventListener('pointerdown', onOutsidePointerDown, true), 0);

  const firstField = box.querySelector('input, select, textarea, button');
  if (firstField) firstField.focus();

  current = { box, close };
  return close;
}

function closeCurrent() {
  if (current) current.close();
}

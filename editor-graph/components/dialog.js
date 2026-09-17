import { h } from '../dom.js';

export function openDialog(build) {
  return new Promise((resolve) => {
    const backdrop = h('div', { class: 'g-dialog-backdrop' });

    function close(result) {
      document.removeEventListener('keydown', onKeyDown);
      backdrop.remove();
      resolve(result);
    }

    function onKeyDown(event) {
      if (event.key === 'Escape') {
        event.preventDefault();
        close(false);
      } else if (event.key === 'Tab') {
        trapFocus(event, dialog);
      }
    }

    const dialog = build(close);
    backdrop.appendChild(dialog);
    backdrop.addEventListener('pointerdown', (event) => {
      if (event.target === backdrop) close(false);
    });
    document.addEventListener('keydown', onKeyDown);
    document.body.appendChild(backdrop);

    const focusTarget = dialog.querySelector('[data-autofocus]') || dialog.querySelector('button');
    if (focusTarget) focusTarget.focus();
  });
}

function trapFocus(event, dialog) {
  const focusable = [...dialog.querySelectorAll('button, input, select, textarea, [tabindex]')]
    .filter((el) => !el.disabled);
  if (focusable.length === 0) return;
  const first = focusable[0];
  const last = focusable[focusable.length - 1];
  if (event.shiftKey && document.activeElement === first) {
    event.preventDefault();
    last.focus();
  } else if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault();
    first.focus();
  }
}

export function alertDialog(message, { title = null } = {}) {
  return openDialog((close) => {
    const okBtn = h('button', { class: 'g-btn g-btn--primary', type: 'button', 'data-autofocus': true, onClick: () => close(true) }, 'OK');
    return h('div', { class: 'g-dialog', role: 'alertdialog', 'aria-modal': 'true' },
      title ? h('div', { class: 'g-dialog__title' }, title) : null,
      h('div', { class: 'g-dialog__message' }, message),
      h('div', { class: 'g-dialog__actions' }, okBtn)
    );
  }).then(() => undefined);
}

export function confirmDialog(message, { title = null, confirmLabel = 'OK', danger = false } = {}) {
  return openDialog((close) => {
    const cancelBtn = h('button', { class: 'g-btn', type: 'button', onClick: () => close(false) }, 'キャンセル');
    const confirmBtn = h('button', {
      class: `g-btn ${danger ? 'g-btn--danger' : 'g-btn--primary'}`,
      type: 'button',
      'data-autofocus': true,
      onClick: () => close(true)
    }, confirmLabel);
    return h('div', { class: 'g-dialog', role: 'alertdialog', 'aria-modal': 'true' },
      title ? h('div', { class: 'g-dialog__title' }, title) : null,
      h('div', { class: 'g-dialog__message' }, message),
      h('div', { class: 'g-dialog__actions' }, cancelBtn, confirmBtn)
    );
  });
}

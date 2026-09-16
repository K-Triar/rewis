import { h, clear } from '../dom.js';

let root = null;

function ensureRoot() {
  if (root) return root;
  root = h('div', { class: 'ed2-dialog-root', hidden: true });
  document.body.appendChild(root);
  return root;
}

export function alertDialog(message) {
  return new Promise((resolve) => {
    const r = ensureRoot();
    clear(r);
    const close = () => {
      r.hidden = true;
      resolve();
    };
    const okBtn = h('button', { class: 'ed2-dialog-btn ed2-dialog-btn-primary', type: 'button', onClick: close }, 'OK');
    const box = h('div', { class: 'ed2-dialog-box' },
      h('p', { class: 'ed2-dialog-message' }, message),
      h('div', { class: 'ed2-dialog-actions' }, okBtn)
    );
    r.appendChild(h('div', { class: 'ed2-dialog-backdrop', onClick: close }));
    r.appendChild(box);
    r.hidden = false;
    okBtn.focus();
  });
}

export function confirmDialog(message) {
  return new Promise((resolve) => {
    const r = ensureRoot();
    clear(r);
    const finish = (result) => {
      r.hidden = true;
      resolve(result);
    };
    const cancelBtn = h('button', { class: 'ed2-dialog-btn', type: 'button', onClick: () => finish(false) }, 'キャンセル');
    const okBtn = h('button', { class: 'ed2-dialog-btn ed2-dialog-btn-primary', type: 'button', onClick: () => finish(true) }, 'OK');
    const box = h('div', { class: 'ed2-dialog-box' },
      h('p', { class: 'ed2-dialog-message' }, message),
      h('div', { class: 'ed2-dialog-actions' }, cancelBtn, okBtn)
    );
    r.appendChild(h('div', { class: 'ed2-dialog-backdrop', onClick: () => finish(false) }));
    r.appendChild(box);
    r.hidden = false;
    okBtn.focus();
  });
}

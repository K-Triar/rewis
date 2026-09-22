import { h, clear, icon } from '../dom.js';

const KIND_LABEL = { network: '路線網', operations: '運行情報' };

function docStatusLabel(store, kind) {
  const meta = store.state.meta[kind];
  const parts = [h('span', {}, KIND_LABEL[kind])];
  if (!store.state.docs[kind]) {
    parts.push(h('span', { class: 'g-label' }, '未読込'));
  } else {
    parts.push(h('span', { class: 'g-label' }, `版 ${meta ? meta.revision : 0}`));
    if (store.hasUnsavedChanges(kind)) {
      parts.push(h('span', { class: 'g-label g-label--attention' }, '未保存の変更あり'));
    }
  }
  return h('div', { class: 'g-status-doc' }, parts);
}

export function renderStatusRow(container, ctx) {
  clear(container);
  const { store } = ctx;

  const errorCount = (store.state.validation.network.errors.length) + (store.state.validation.operations.errors.length);
  const warningCount = (store.state.validation.network.warnings.length) + (store.state.validation.operations.warnings.length);

  const errorBtn = h('button', {
    type: 'button',
    class: 'g-btn g-btn--invisible g-btn--small',
    style: errorCount > 0 ? 'color: var(--fgColor-danger);' : null,
    onClick: () => ctx.onOpenIssues && ctx.onOpenIssues('errors')
  }, icon('x-circle-fill'), `エラー ${errorCount}`);

  const warningBtn = h('button', {
    type: 'button',
    class: 'g-btn g-btn--invisible g-btn--small',
    style: warningCount > 0 ? 'color: var(--fgColor-attention);' : null,
    onClick: () => ctx.onOpenIssues && ctx.onOpenIssues('warnings')
  }, icon('alert-fill'), `注意 ${warningCount}`);

  const saveBtn = h('button', {
    type: 'button',
    class: 'g-btn g-btn--primary g-save-btn',
    disabled: !store.hasAnyUnsavedChanges(),
    onClick: () => ctx.onSave && ctx.onSave()
  }, icon('upload'), 'サーバーに保存');

  const right = h('div', { class: 'g-status-actions' });

  if (typeof store.canUndo === 'function') {
    right.appendChild(h('button', {
      type: 'button',
      class: 'g-icon-btn g-btn--invisible',
      'aria-label': '元に戻す（Ctrl+Z）',
      title: '元に戻す（Ctrl+Z）',
      disabled: !store.canUndo(),
      onClick: () => ctx.onUndo && ctx.onUndo()
    }, icon('undo')));
    right.appendChild(h('button', {
      type: 'button',
      class: 'g-icon-btn g-btn--invisible',
      'aria-label': 'やり直す（Ctrl+Y）',
      title: 'やり直す（Ctrl+Y）',
      disabled: !store.canRedo(),
      onClick: () => ctx.onRedo && ctx.onRedo()
    }, icon('redo')));
  }

  right.appendChild(saveBtn);

  if (ctx.switchView) {
    right.appendChild(h('button', {
      type: 'button',
      class: 'g-btn',
      onClick: () => ctx.switchView.onClick && ctx.switchView.onClick()
    }, icon(ctx.switchView.iconName), ctx.switchView.label));
  }

  if (ctx.onOpenGuide) {
    right.appendChild(h('button', {
      type: 'button',
      class: 'g-btn g-btn--invisible',
      onClick: () => ctx.onOpenGuide()
    }, icon('question'), '操作ガイド'));
  }

  container.appendChild(h('div', { class: 'g-status-row__docs' },
    docStatusLabel(store, 'network'),
    docStatusLabel(store, 'operations'),
    errorBtn,
    warningBtn
  ));
  container.appendChild(right);
}

import { h, clear, icon } from '../dom.js';
import { describeIssueLocation } from '../../editor-core/issue-location.js';

let currentClose = null;

function collect(store, severity) {
  const key = severity === 'errors' ? 'errors' : 'warnings';
  const list = [];
  ['network', 'operations'].forEach((kind) => {
    (store.state.validation[kind][key] || []).forEach((issue) => {
      list.push({ kind, issue });
    });
  });
  return list;
}

export function openIssuesDrawer(initialFilter, ctx) {
  if (currentClose) currentClose();

  const { store, onNavigate } = ctx;
  let filter = initialFilter === 'warnings' ? 'warnings' : 'errors';

  const backdrop = h('div', { class: 'g-issues-backdrop' });
  const panel = h('div', { class: 'g-issues-drawer g-overlay' });
  backdrop.appendChild(panel);

  function close() {
    document.removeEventListener('keydown', onKeyDown);
    backdrop.remove();
    if (currentClose === close) currentClose = null;
  }

  function onKeyDown(event) {
    if (event.key === 'Escape') close();
  }

  function renderList() {
    clear(panel);

    const switchRow = h('div', { class: 'g-issues-drawer__switch' },
      h('button', {
        type: 'button',
        class: 'g-btn g-btn--small' + (filter === 'errors' ? ' g-btn--primary' : ''),
        onClick: () => { filter = 'errors'; renderList(); }
      }, 'エラー'),
      h('button', {
        type: 'button',
        class: 'g-btn g-btn--small' + (filter === 'warnings' ? ' g-btn--primary' : ''),
        onClick: () => { filter = 'warnings'; renderList(); }
      }, '注意'),
      h('button', {
        type: 'button',
        class: 'g-icon-btn g-btn--invisible',
        'aria-label': '閉じる',
        title: '閉じる',
        onClick: close
      }, icon('x'))
    );
    panel.appendChild(switchRow);

    const items = collect(store, filter);
    const listEl = h('ul', { class: 'g-issues-drawer__list' });
    if (items.length === 0) {
      listEl.appendChild(h('li', { class: 'g-issues-drawer__empty' }, filter === 'errors' ? 'エラーはありません。' : '注意はありません。'));
    }
    items.forEach(({ kind, issue }) => {
      const location = describeIssueLocation(kind, issue, store.state.docs);
      const row = h('li', {},
        h('button', {
          type: 'button',
          class: 'g-issues-drawer__item',
          title: issue.code,
          onClick: () => {
            close();
            onNavigate && onNavigate(kind, issue);
          }
        },
          icon(filter === 'errors' ? 'x-circle-fill' : 'alert-fill', { size: 16 }),
          h('div', {},
            h('div', {}, issue.message),
            h('div', { class: 'g-issues-drawer__location' }, `場所: ${location}`)
          )
        )
      );
      listEl.appendChild(row);
    });
    panel.appendChild(listEl);
  }

  renderList();
  document.addEventListener('keydown', onKeyDown);
  backdrop.addEventListener('pointerdown', (event) => {
    if (event.target === backdrop) close();
  });
  document.body.appendChild(backdrop);

  currentClose = close;
  return close;
}

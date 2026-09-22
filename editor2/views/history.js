import { h, clear } from '../../editor-shared/dom.js';
import * as api from '../api.js';
import { alertDialog, confirmDialog } from '../../editor-shared/components/dialog.js';

const KIND_LABEL = { network: '路線網', operations: '運行情報' };

function currentToken() {
  const session = api.getSavedSession();
  return session ? session.token : null;
}

export function renderHistoryView(container, ctx) {
  clear(container);
  const { store, refreshAll, getApiBase } = ctx;

  let activeKind = 'network';

  const status = h('div', { class: 'g-text-muted' }, '未取得');
  const tbody = h('tbody', {});
  const table = h('table', { class: 'g-table' },
    h('thead', {}, h('tr', {},
      h('th', {}, '#'),
      h('th', {}, '版'),
      h('th', {}, '保存日時'),
      h('th', {}, '更新者'),
      h('th', {}, 'クライアント'),
      h('th', {}, '操作')
    )),
    tbody
  );

  function makeTabButton(kind) {
    return h('button', {
      class: 'g-btn g-toggle-btn g-btn--small',
      type: 'button',
      'aria-pressed': kind === activeKind ? 'true' : 'false',
      onClick: () => {
        activeKind = kind;
        renderTabs();
        renderList();
      }
    }, KIND_LABEL[kind]);
  }

  const tabsContainer = h('div', { class: 'g-actions-row' });
  function renderTabs() {
    clear(tabsContainer);
    tabsContainer.appendChild(makeTabButton('network'));
    tabsContainer.appendChild(makeTabButton('operations'));
  }
  renderTabs();

  async function renderList() {
    clear(tbody);
    status.textContent = '取得中...';
    const base = getApiBase();
    const token = currentToken();
    if (!base || !token) {
      status.textContent = 'Workers API URL とログインが必要です（保存/読込タブで設定してください）。';
      return;
    }
    const res = await api.getHistory(base, token, activeKind, { limit: 50 });
    if (!res.ok) {
      status.textContent = `取得に失敗しました: ${res.body.error || res.status}`;
      return;
    }
    status.textContent = `${res.body.items.length}件`;
    res.body.items.forEach((item, i) => {
      tbody.appendChild(h('tr', {},
        h('td', {}, String(i + 1)),
        h('td', {}, String(item.revision)),
        h('td', {}, item.savedAt || ''),
        h('td', {}, item.updatedBy || ''),
        h('td', {}, item.client || ''),
        h('td', {},
          h('button', { class: 'g-btn g-btn--small', type: 'button', onClick: () => onCompare(item) }, '比較'),
          h('button', { class: 'g-btn g-btn--small', type: 'button', onClick: () => onLoadIntoEditor(item) }, 'エディタに読込'),
          h('button', { class: 'g-btn g-btn--primary g-btn--small', type: 'button', onClick: () => onRollback(item) }, 'この版に戻す')
        )
      ));
    });
  }

  async function onCompare(item) {
    const base = getApiBase();
    const token = currentToken();
    const res = await api.getHistoryItem(base, token, activeKind, item.key);
    if (!res.ok) {
      await alertDialog('取得に失敗しました: ' + (res.body.error || res.status));
      return;
    }
    const currentText = JSON.stringify(store.state.docs[activeKind], null, 2);
    const targetText = JSON.stringify(res.body.doc, null, 2);
    console.log('[REWIS editor2] history compare', {
      key: item.key,
      current: store.state.docs[activeKind],
      target: res.body.doc
    });
    await alertDialog(
      currentText === targetText
        ? '現在エディタ上にある内容と同じです。'
        : '現在エディタ上にある内容と異なります（詳細はブラウザのコンソールに出力しました）。'
    );
  }

  async function onLoadIntoEditor(item) {
    const base = getApiBase();
    const token = currentToken();
    const res = await api.getHistoryItem(base, token, activeKind, item.key);
    if (!res.ok) {
      await alertDialog('取得に失敗しました: ' + (res.body.error || res.status));
      return;
    }
    const ok = await confirmDialog(`版 ${item.revision} の内容をエディタに読み込みます（未保存の状態として扱います）。よろしいですか？`);
    if (!ok) return;
    store.replaceDocLocally(activeKind, res.body.doc);
    refreshAll();
  }

  async function onRollback(item) {
    const ok = await confirmDialog(`版 ${item.revision} にロールバックします。よろしいですか？`);
    if (!ok) return;
    const base = getApiBase();
    const token = currentToken();
    const res = await api.rollback(base, token, activeKind, item.key, store.state.baseRevision[activeKind]);
    if (res.status === 409) {
      await alertDialog(`競合が発生しました（最新版 ${res.body.latestRevision}）。保存/読込タブで読み込み直してから再度お試しください。`);
      return;
    }
    if (res.status === 422) {
      const messages = (res.body.errors || []).map((e) => e.message).join(' / ');
      await alertDialog('検証エラーがありロールバックできませんでした: ' + messages);
      return;
    }
    if (!res.ok) {
      await alertDialog('ロールバックに失敗しました: ' + (res.body.error || res.status));
      return;
    }
    await alertDialog(`版 ${res.body.revision} としてロールバックしました。`);
    renderList();
  }

  const refreshBtn = h('button', { class: 'g-btn g-btn--small', type: 'button', onClick: renderList }, '更新');

  container.appendChild(h('div', { class: 'g-card' },
    h('div', { class: 'g-card__header' }, 'Worker 保存履歴（v2）'),
    h('div', { class: 'g-card__body' },
      tabsContainer,
      h('div', { class: 'g-actions-row' }, refreshBtn, status),
      h('div', { class: 'g-table-wrap' }, table)
    )
  ));

  renderList();
}

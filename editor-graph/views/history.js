import { h, clear } from '../dom.js';
import * as api from '../../editor2/api.js';
import { alertDialog, confirmDialog } from '../components/dialog.js';

const KIND_LABEL = { network: '路線網', operations: '運行情報' };

const FIELD_LABEL = {
  companies: '鉄道会社', stations: '駅', lines: '路線', services: '運行系統',
  transfers: '乗換', stationGroups: '駅グループ', notices: '運行情報'
};

function summarizeCounts(kind, doc) {
  if (!doc) return {};
  if (kind === 'network') {
    return {
      companies: (doc.companies || []).length,
      stations: (doc.stations || []).length,
      lines: (doc.lines || []).length,
      services: (doc.services || []).length,
      transfers: (doc.transfers || []).length,
      stationGroups: (doc.stationGroups || []).length
    };
  }
  return { notices: (doc.notices || []).length };
}

function formatDateTime(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}/${pad(d.getMonth() + 1)}/${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function renderHistoryView(container, ctx) {
  const { store, refreshStatus } = ctx;

  let activeKind = 'network';
  let items = [];
  let cursor = null;
  let selectedKey = null;
  let status = '';

  const view = h('div', { class: 'g-view' });
  container.appendChild(view);

  function base() { return api.getSavedApiBase(); }
  function token() {
    const session = api.getSavedSession();
    return session ? session.token : null;
  }

  async function loadFirst() {
    selectedKey = null;
    status = '読込中…';
    render();
    const res = await api.getHistory(base(), token(), activeKind, { limit: 50 });
    if (!res.ok) {
      status = `取得に失敗しました: ${res.body.error || res.status}`;
      items = [];
      cursor = null;
      render();
      return;
    }
    items = res.body.items;
    cursor = res.body.cursor;
    status = '';
    render();
  }

  async function loadMore() {
    const res = await api.getHistory(base(), token(), activeKind, { limit: 50, cursor });
    if (!res.ok) {
      status = `取得に失敗しました: ${res.body.error || res.status}`;
      render();
      return;
    }
    items = items.concat(res.body.items);
    cursor = res.body.cursor;
    render();
  }

  function render() {
    clear(view);

    const kindSwitch = h('div', { style: 'display:flex; gap:var(--stack-gap-condensed);' },
      ['network', 'operations'].map((kind) => h('button', {
        type: 'button',
        class: 'g-btn g-toggle-btn',
        'aria-pressed': String(kind === activeKind),
        onClick: () => {
          if (activeKind === kind) return;
          activeKind = kind;
          loadFirst();
        }
      }, KIND_LABEL[kind]))
    );

    const list = h('div', { class: 'g-list' });
    items.forEach((item) => {
      list.appendChild(h('button', {
        type: 'button',
        class: 'g-list__item' + (selectedKey === item.key ? ' is-selected' : ''),
        onClick: () => { selectedKey = item.key; render(); }
      },
        h('div', {}, `版 ${item.revision}`),
        h('div', { class: 'g-ws-right__note' }, formatDateTime(item.savedAt)),
        h('div', { class: 'g-ws-right__note' }, `${item.updatedBy || '?'} / ${item.client || '?'}`),
        item.rollbackFrom ? h('div', { class: 'g-ws-right__note' }, `ロールバック元: ${item.rollbackFrom}`) : null
      ));
    });

    const listWrap = h('div', { class: 'g-history-detail__list' },
      h('div', { class: 'g-card' },
        h('div', { class: 'g-card__header' }, `${KIND_LABEL[activeKind]} の履歴`),
        h('div', { class: 'g-card__body' },
          status ? h('p', {}, status) : null,
          list,
          cursor ? h('button', { type: 'button', class: 'g-btn', onClick: loadMore }, 'さらに読み込む') : null
        )
      )
    );

    const selected = items.find((it) => it.key === selectedKey);
    const body = h('div', { class: 'g-history-detail' }, listWrap);
    if (selected) {
      body.appendChild(h('div', { class: 'g-history-detail__panel' }, renderDetailPanel(selected)));
    }

    view.appendChild(h('div', { class: 'g-single-col g-single-col--wide' }, kindSwitch, body));
  }

  function renderDetailPanel(item) {
    const resultEl = h('div', {});
    const unsaved = store.hasUnsavedChanges(activeKind);

    const compareBtn = h('button', {
      type: 'button', class: 'g-btn',
      onClick: async () => {
        clear(resultEl);
        const res = await api.getHistoryItem(base(), token(), activeKind, item.key);
        if (!res.ok) { await alertDialog('取得に失敗しました: ' + (res.body.error || res.status)); return; }
        resultEl.appendChild(renderDiffTable(activeKind, store.state.docs[activeKind], res.body.doc));
      }
    }, '今のデータと比べる');

    const loadBtn = h('button', {
      type: 'button', class: 'g-btn',
      onClick: async () => {
        const res = await api.getHistoryItem(base(), token(), activeKind, item.key);
        if (!res.ok) { await alertDialog('取得に失敗しました: ' + (res.body.error || res.status)); return; }
        if (store.hasUnsavedChanges(activeKind)) {
          const ok = await confirmDialog('未保存の変更は失われます。', { confirmLabel: '編集中のデータにする', danger: true });
          if (!ok) return;
        }
        store.replaceDocLocally(activeKind, res.body.doc);
        if (refreshStatus) refreshStatus();
      }
    }, 'この版を編集中のデータにする');

    const rollbackBtn = h('button', {
      type: 'button', class: 'g-btn g-btn--danger', disabled: unsaved,
      onClick: async () => {
        const ok = await confirmDialog('この版の内容を、新しい版としてサーバーに保存します。', { confirmLabel: 'この版に戻す', danger: true });
        if (!ok) return;
        const res = await api.rollback(base(), token(), activeKind, item.key, store.state.baseRevision[activeKind]);
        if (res.status === 409) {
          await alertDialog(`競合が発生しました（最新版 ${res.body.latestRevision}）。`);
          return;
        }
        if (!res.ok) { await alertDialog('ロールバックに失敗しました: ' + (res.body.error || res.status)); return; }
        const docRes = await api.getDoc(base(), token(), activeKind);
        if (docRes.ok) store.setDoc(activeKind, docRes.body.doc, docRes.body.meta);
        if (refreshStatus) refreshStatus();
        loadFirst();
      }
    }, 'この版に戻す');

    return h('div', { class: 'g-card' },
      h('div', { class: 'g-card__header' }, `版 ${item.revision}`),
      h('div', { class: 'g-card__body' },
        h('p', { class: 'g-ws-right__note' }, formatDateTime(item.savedAt)),
        h('p', { class: 'g-ws-right__note' }, `更新した人: ${item.updatedBy || '?'} / client: ${item.client || '?'}`),
        item.rollbackFrom ? h('p', { class: 'g-ws-right__note' }, `ロールバック元: ${item.rollbackFrom}`) : null,
        h('div', { style: 'display:flex; flex-direction:column; gap:var(--stack-gap-condensed);' }, compareBtn, loadBtn, rollbackBtn),
        unsaved ? h('p', { class: 'g-field__hint' }, '先にサーバーに保存するか、変更を取り消してください。') : null,
        resultEl
      )
    );
  }

  function renderDiffTable(kind, currentDoc, targetDoc) {
    const before = summarizeCounts(kind, currentDoc);
    const after = summarizeCounts(kind, targetDoc);
    const rows = Object.keys(after).map((key) => h('tr', {},
      h('td', {}, FIELD_LABEL[key] || key),
      h('td', {}, String(before[key] ?? 0)),
      h('td', {}, String(after[key] ?? 0))
    ));
    return h('table', { class: 'g-diff-table' },
      h('thead', {}, h('tr', {}, h('th', {}, '項目'), h('th', {}, '今のデータ'), h('th', {}, 'この版'))),
      h('tbody', {}, rows)
    );
  }

  loadFirst();
  return { destroy() {} };
}

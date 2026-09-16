import { h, clear, icon } from './dom.js';
import { createStore } from '../editor-core/store.js';
import { renderStartView } from './views/start.js';
import { renderDataView } from './views/data.js';
import * as api from '../editor2/api.js';

const TAB_STORAGE_KEY = 'rewis_graph_tab';

function placeholderView(container) {
  clear(container);
  container.appendChild(h('div', { class: 'g-view' }, h('p', {}, '準備中です。')));
  return { destroy() {} };
}

const TABS = [
  { id: 'stations', label: '駅', render: placeholderView },
  { id: 'lines', label: '路線', render: placeholderView },
  { id: 'services', label: '運行系統', render: placeholderView },
  { id: 'transfers', label: '乗換・駅グループ', render: placeholderView },
  { id: 'companies', label: '鉄道会社', render: placeholderView },
  { id: 'vehicle-types', label: '車両種別', render: placeholderView },
  { id: 'history', label: '履歴', render: placeholderView },
  { id: 'data', label: 'データの読込と書出', render: renderDataView }
];

const store = createStore();

function getSavedTab() {
  const saved = sessionStorage.getItem(TAB_STORAGE_KEY);
  return TABS.some((t) => t.id === saved) ? saved : 'services';
}

let activeTabId = getSavedTab();
let activeTabHandle = null;
let pendingFocus = null;

const root = document.getElementById('g-app');

const header = h('header', { class: 'g-header' });
const pageHeader = h('div', { class: 'g-page-header' });
const statusRow = h('div', { class: 'g-status-row' }); // 状態の行の枠。4.5-2 で作る
const nav = h('nav', { class: 'g-underline-nav' });
const main = h('div', { class: 'g-main' });

pageHeader.appendChild(statusRow);
pageHeader.appendChild(nav);
root.appendChild(header);
root.appendChild(pageHeader);
root.appendChild(main);

function renderHeader() {
  clear(header);
  const session = api.getSavedSession();

  const left = h('div', { class: 'g-header__left' },
    h('img', { class: 'g-header__logo', src: 'src/rewis_logo_w.svg', alt: '' }),
    h('div', { class: 'g-header__title' },
      '| 路線データ編集',
      h('span', { class: 'g-label' }, '試験用')
    )
  );

  const right = h('div', { class: 'g-header__right' });
  if (session) {
    right.appendChild(h('span', {}, `${session.userId} でログイン中`));
    right.appendChild(h('button', {
      class: 'g-btn g-btn--invisible',
      type: 'button',
      onClick: async () => {
        const base = api.getSavedApiBase();
        await api.logout(base, session.token);
        refreshStatus();
      }
    }, icon('sign-out'), 'ログアウト'));
  }

  header.appendChild(left);
  header.appendChild(right);
}

function renderNav() {
  clear(nav);
  TABS.forEach((tab) => {
    const btn = h('button', {
      type: 'button',
      class: 'g-underline-nav__item' + (tab.id === activeTabId ? ' is-selected' : ''),
      onClick: () => {
        if (activeTabId === tab.id) return;
        activeTabId = tab.id;
        sessionStorage.setItem(TAB_STORAGE_KEY, activeTabId);
        renderNav();
        renderMain();
      }
    }, tab.label);
    nav.appendChild(btn);
  });
}

function requestNavigate(target) {
  if (!target) return;
  activeTabId = target.tab;
  sessionStorage.setItem(TAB_STORAGE_KEY, activeTabId);
  pendingFocus = { id: target.id, sub: target.sub };
  renderNav();
  renderMain();
}

function refreshStatus() {
  renderHeader();
}

const ctx = {
  store,
  requestNavigate,
  refreshStatus,
  onLoaded() {
    renderMain();
  }
};

function renderMain() {
  if (activeTabHandle && typeof activeTabHandle.destroy === 'function') {
    activeTabHandle.destroy();
  }
  clear(main);

  const networkLoaded = !!store.state.docs.network;
  if (!networkLoaded && activeTabId !== 'data') {
    activeTabHandle = renderStartView(main, ctx);
    return;
  }

  const tab = TABS.find((t) => t.id === activeTabId);
  if (!tab) return;
  const focus = pendingFocus;
  pendingFocus = null;
  activeTabHandle = tab.render(main, { ...ctx, focus });
}

// beforeunload での離脱警告は、未保存の変更を検出できるようになる 4.5-2 で追加する

renderHeader();
renderNav();
renderMain();

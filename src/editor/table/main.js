import { h, clear, icon } from '../common/dom.js';
import { createStore } from './store.js';
import { saveChangedDocs } from '../core/save-actions.js';
import { renderStartView } from '../common/views/start-view.js';
import { renderStatusRow } from '../common/components/status-row.js';
import { openIssuesDrawer } from '../common/components/issues-drawer.js';
import { alertDialog, confirmDialog } from '../common/components/dialog.js';
import { renderDataView } from '../common/views/data-view.js';
import { renderHistoryView } from './views/history.js';
import { renderCompaniesView } from './views/companies.js';
import { renderVehicleTypesView } from './views/vehicle-types.js';
import { renderStationsView } from './views/stations.js';
import { renderLinesView } from './views/lines.js';
import { renderServicesView } from './views/services.js';
import { renderTransfersView } from './views/transfers.js';
import { renderOperationsView } from './views/operations.js';
import * as api from '../common/api.js';
import { resolveIssueFocus } from './navigate.js';
import { getTabFromUrl, setTabInUrl, onTabPopState } from '../common/tab-url.js';

const TABS = [
  { id: 'stations', label: '駅', render: renderStationsView },
  { id: 'lines', label: '路線', render: renderLinesView },
  { id: 'services', label: '運行系統', render: renderServicesView },
  { id: 'transfers', label: '乗換・駅グループ', render: renderTransfersView },
  { id: 'operations', label: '運行情報', render: renderOperationsView },
  { id: 'companies', label: '鉄道会社', render: renderCompaniesView, selfWraps: true },
  { id: 'vehicle-types', label: '車両種別', render: renderVehicleTypesView, selfWraps: true },
  { id: 'history', label: '履歴', render: renderHistoryView, selfWraps: true },
  { id: 'data', label: 'データの読込と書出', render: renderDataView, selfWraps: true }
];

const store = createStore();
let activeTabId = getTabFromUrl(TABS.map((t) => t.id), 'stations');
let activeTabHandle = null;
let pendingFocus = null;
let forceStartView = false;
let saveBannerTimer = null;

const root = document.getElementById('ed2-app');

const header = h('header', { class: 'g-header' });
const pageHeader = h('div', { class: 'g-page-header' });
const statusRow = h('div', { class: 'g-status-row' });
const saveBanner = h('div', { class: 'g-banner g-banner--success', hidden: true });
const nav = h('nav', { class: 'g-underline-nav' });
const main = h('div', { class: 'g-main' });

pageHeader.appendChild(statusRow);
pageHeader.appendChild(saveBanner);
pageHeader.appendChild(nav);
root.appendChild(header);
root.appendChild(pageHeader);
root.appendChild(main);

function getApiBase() {
  return api.getSavedApiBase();
}

function renderHeader() {
  clear(header);
  const session = api.getSavedSession();

  const left = h('div', { class: 'g-header__left' },
    h('img', { class: 'g-header__logo', src: '../assets/icons/rewis_logo_w.svg', alt: '' }),
    h('div', { class: 'g-header__title' }, '| 路線データ編集システム')
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
        setTabInUrl(activeTabId);
        renderNav();
        renderStatus();
        renderMain();
      }
    }, tab.label);
    nav.appendChild(btn);
  });
}

function requestNavigate(focus) {
  if (!focus) return;
  activeTabId = focus.tab;
  setTabInUrl(activeTabId);
  pendingFocus = focus;
  renderNav();
  renderStatus();
  renderMain();
}

function handleIssueNavigate(kind, issue) {
  const focus = resolveIssueFocus(kind, issue, store.state.docs);
  if (focus) requestNavigate(focus);
}

function openIssues(filter) {
  openIssuesDrawer(filter, { store, onNavigate: handleIssueNavigate });
}

function refreshStatus() {
  renderHeader();
  renderStatus();
}

function renderStatus() {
  renderStatusRow(statusRow, {
    store,
    onOpenIssues: openIssues,
    onSave: handleSave,
    switchView: { label: '図形式で編集', iconName: 'workflow', onClick: handleSwitchToGraph }
  });
}

function showSaveBanner(text) {
  saveBanner.textContent = text;
  saveBanner.hidden = false;
  if (saveBannerTimer) clearTimeout(saveBannerTimer);
  saveBannerTimer = setTimeout(() => { saveBanner.hidden = true; }, 4000);
}

function exportDocToFile(kind) {
  const doc = store.state.docs[kind];
  if (!doc) return;
  const blob = new Blob([JSON.stringify(doc, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = h('a', { href: url, download: `${kind}.json` });
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

async function handleSave() {
  const base = api.getSavedApiBase();
  const session = api.getSavedSession();
  const { results } = await saveChangedDocs(store, {
    base,
    token: session ? session.token : null,
    saveDoc: api.saveDoc
  });
  renderStatus();

  if (results.length === 0) return;
  if (results.every((r) => r.status === 'saved')) {
    showSaveBanner('保存しました。');
    return;
  }

  const last = results[results.length - 1];
  if (last.status === 'conflict') {
    const ok = await confirmDialog(last.message, { confirmLabel: 'ファイルに書き出す' });
    if (ok) exportDocToFile(last.kind);
    return;
  }

  await alertDialog(last.message);
  if (last.status === 'invalid') {
    openIssues('errors');
  } else if (/ログイン/.test(last.message)) {
    api.clearSession();
    forceStartView = true;
    refreshStatus();
    renderMain();
  }
}

async function handleSwitchToGraph() {
  if (store.hasAnyUnsavedChanges()) {
    const ok = await confirmDialog(
      '未保存の変更は図形式のエディタに引き継がれません。先にサーバーに保存してください。',
      { confirmLabel: '保存せずに移動', danger: true }
    );
    if (!ok) return;
  }
  window.location.href = '../editor-graph/';
}

function refreshAll() {
  renderStatus();
}

const ctx = {
  store,
  refreshAll,
  refreshStatus,
  getApiBase,
  requestNavigate,
  onLoaded() {
    forceStartView = false;
    refreshStatus();
    renderMain();
  }
};

function renderMain() {
  if (activeTabHandle && typeof activeTabHandle.destroy === 'function') {
    activeTabHandle.destroy();
  }
  clear(main);

  const networkLoaded = !!store.state.docs.network;
  if ((!networkLoaded || forceStartView) && activeTabId !== 'data') {
    activeTabHandle = renderStartView(main, ctx);
    return;
  }

  const tab = TABS.find((t) => t.id === activeTabId);
  if (!tab) return;
  const focus = pendingFocus;
  pendingFocus = null;
  const container = tab.selfWraps ? main : h('div', { class: 'g-view' });
  if (!tab.selfWraps) main.appendChild(container);
  activeTabHandle = tab.render(container, { ...ctx, focus });
}

window.addEventListener('beforeunload', (event) => {
  if (store.hasAnyUnsavedChanges()) {
    event.preventDefault();
    event.returnValue = '';
  }
});

store.subscribe(() => {
  renderStatus();
});

onTabPopState(TABS.map((t) => t.id), (tabId) => {
  if (tabId === activeTabId) return;
  activeTabId = tabId;
  pendingFocus = null;
  renderNav();
  renderStatus();
  renderMain();
});

setTabInUrl(activeTabId, { push: false });
renderHeader();
renderNav();
renderStatus();
renderMain();

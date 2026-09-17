import { createStore } from './store.js';
import { renderIssuesPanel } from './components/issues-panel.js';
import { renderIoView } from './views/io.js';
import { renderHistoryView } from './views/history.js';
import { renderCompaniesView } from './views/companies.js';
import { renderVehicleTypesView } from './views/vehicle-types.js';
import { renderStationsView } from './views/stations.js';
import { renderLinesView } from './views/lines.js';
import { renderServicesView } from './views/services.js';
import { renderTransfersView } from './views/transfers.js';
import { renderOperationsView } from './views/operations.js';
import { getSavedApiBase } from './api.js';
import { resolveIssueFocus } from './navigate.js';

const TABS = [
  { id: 'companies', label: '鉄道会社', render: renderCompaniesView },
  { id: 'vehicle-types', label: '車両種別', render: renderVehicleTypesView },
  { id: 'stations', label: '駅', render: renderStationsView },
  { id: 'lines', label: '路線', render: renderLinesView },
  { id: 'services', label: '運行系統', render: renderServicesView },
  { id: 'transfers', label: '乗換・駅グループ', render: renderTransfersView },
  { id: 'operations', label: '運行情報', render: renderOperationsView },
  { id: 'export', label: '保存/読込', render: renderIoView },
  { id: 'history', label: '履歴', render: renderHistoryView }
];

const store = createStore();
let activeTabId = 'export';

const nav = document.getElementById('ed2-nav');
const main = document.getElementById('ed2-main');
const issuesPanel = document.getElementById('ed2-issues-panel');

function getApiBase() {
  const el = document.getElementById('ed2-api-base');
  return el ? el.value.trim() : getSavedApiBase();
}

function renderIssues() {
  renderIssuesPanel(issuesPanel, store.state.validation, {
    onNavigate(kind, issue) {
      const focus = resolveIssueFocus(kind, issue, store.state.docs);
      if (focus) {
        requestNavigate(focus);
      } else {
        console.log('[REWIS editor2] issue clicked (飛び先なし)', kind, issue);
      }
    }
  });
}

function renderActiveTab(focus) {
  const tab = TABS.find((t) => t.id === activeTabId);
  if (!tab) return;
  tab.render(main, { store, refreshAll, getApiBase, requestNavigate, focus });
}

// issues-panel のクリックや、各タブの「参照箇所」一覧のクリックから呼ばれる。
// 対象のタブに切り替えて、そのタブに focus を渡す（該当行を開いてスクロールするのは各タブの役目）
function requestNavigate(focus) {
  if (!focus) return;
  activeTabId = focus.tab;
  renderNav();
  renderActiveTab(focus);
}

// 各タブは、自分の中身を変えたときは自分でDOMを更新する（store.mutateDoc等の呼び出し後に
// 自前のrender/renderList相当を呼ぶ）。refreshAllはグローバルなissues-panelの更新だけを担う
// （store.subscribeでも同じことが起きるが、呼び出し側で明示したい場合のために残す）。
// タブ全体を毎回作り直すと、駅タブの展開状態などローカルなUI状態が失われるため、ここでは
// アクティブなタブの再マウントは行わない。
function refreshAll() {
  renderIssues();
}

function renderNav() {
  nav.textContent = '';
  TABS.forEach((tab) => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'nav-btn' + (tab.id === activeTabId ? ' active' : '');
    btn.textContent = tab.label;
    btn.addEventListener('click', () => {
      if (activeTabId === tab.id) return;
      activeTabId = tab.id;
      renderNav();
      renderActiveTab();
    });
    nav.appendChild(btn);
  });
}

window.addEventListener('beforeunload', (event) => {
  if (store.hasAnyUnsavedChanges()) {
    event.preventDefault();
    event.returnValue = '';
  }
});

store.subscribe(() => {
  renderIssues();
});

renderNav();
renderActiveTab();
renderIssues();

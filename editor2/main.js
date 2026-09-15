import { createStore } from './store.js';
import { renderIssuesPanel } from './components/issues-panel.js';
import { renderIoView } from './views/io.js';
import { renderHistoryView } from './views/history.js';
import { getSavedApiBase } from './api.js';

function renderPlaceholder(container) {
  container.textContent = '';
  const p = document.createElement('p');
  p.className = 'ed2-placeholder';
  p.textContent = 'このタブは次のステップで実装します。';
  container.appendChild(p);
}

const TABS = [
  { id: 'companies', label: '鉄道会社', render: renderPlaceholder },
  { id: 'vehicle-types', label: '車両種別', render: renderPlaceholder },
  { id: 'stations', label: '駅', render: renderPlaceholder },
  { id: 'lines', label: '路線', render: renderPlaceholder },
  { id: 'services', label: '運行系統', render: renderPlaceholder },
  { id: 'transfers', label: '乗換・駅グループ', render: renderPlaceholder },
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
      // 行の位置に飛ぶ仕組みは、各タブ（4-4以降）を作るときに追加する
      console.log('[REWIS editor2] issue clicked', kind, issue);
    }
  });
}

function renderActiveTab() {
  const tab = TABS.find((t) => t.id === activeTabId);
  if (!tab) return;
  tab.render(main, { store, refreshAll, getApiBase });
}

function refreshAll() {
  renderIssues();
  const tab = TABS.find((t) => t.id === activeTabId);
  if (tab && tab.id !== 'export' && tab.id !== 'history') {
    tab.render(main, { store, refreshAll, getApiBase });
  }
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

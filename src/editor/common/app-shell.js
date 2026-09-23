// 表形式・図形式エディタで共通の画面の骨組み（ヘッダー・ステータス行・タブ・保存・読込前の開始画面）。
// 各エディタの main.js は、固有のタブと設定を渡して createEditorApp() を呼ぶだけにする。

import { h, clear, icon } from './dom.js';
import { saveChangedDocs } from '../core/save-actions.js';
import { renderStartView } from './views/start-view.js';
import { renderDataView } from './views/data-view.js';
import { renderCompaniesView } from './views/companies.js';
import { renderVehicleTypesView } from './views/vehicle-types.js';
import { renderHistoryView } from './views/history.js';
import { renderStatusRow } from './components/status-row.js';
import { openIssuesDrawer } from './components/issues-drawer.js';
import { alertDialog, confirmDialog } from './components/dialog.js';
import * as api from './api.js';
import { getTabFromUrl, setTabInUrl, onTabPopState } from './tab-url.js';

// 両エディタの末尾に並ぶ、中身が同じタブ。selfWraps のタブは自分で g-view を作る。
const COMMON_TABS = [
  { id: 'companies', label: '鉄道会社', render: renderCompaniesView, selfWraps: true },
  { id: 'vehicle-types', label: '車両種別', render: renderVehicleTypesView, selfWraps: true },
  { id: 'history', label: '履歴', render: renderHistoryView, selfWraps: true },
  { id: 'data', label: 'データの読込と書出', render: renderDataView, selfWraps: true }
];

// options:
//   rootId        画面を描く要素の id
//   store         core/store.js の createStore() の戻り値（undo を持つかどうかで元に戻す系の UI が変わる）
//   tabs          エディタ固有のタブ（COMMON_TABS の前に並ぶ）。selfWraps でないタブは g-view で包んで描く
//   resolveIssue  (kind, issue, docs) => 飛び先 | null。エラー・注意の一覧から飛ぶときに使う
//   switchView    { label, iconName, editorName, href } もう一方のエディタへ移るボタン
//   guideFor      (tabId) => 開く関数 | null（省略可）。ステータス行の「使い方」ボタン
export function createEditorApp({ rootId, store, tabs, resolveIssue, switchView, guideFor }) {
  const TABS = [...tabs, ...COMMON_TABS];
  const tabIds = TABS.map((t) => t.id);
  const hasUndo = typeof store.undo === 'function';

  let activeTabId = getTabFromUrl(tabIds, 'stations');
  let activeTabHandle = null;
  let pendingFocus = null;
  let forceStartView = false;
  let saveBannerTimer = null;

  const root = document.getElementById(rootId);

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
        onClick: () => logout(session)
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

  // focus は { tab, ... }。tab 以外の中身（表形式は type/id、図形式は id/sub）はそのままビューに渡す
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
    const focus = resolveIssue(kind, issue, store.state.docs);
    if (focus) requestNavigate(focus);
  }

  function openIssues(filter) {
    openIssuesDrawer(filter, { store, onNavigate: handleIssueNavigate });
  }

  function refreshStatus() {
    renderHeader();
    renderStatus();
  }

  // ログアウトしたら編集中のタブは閉じてログイン画面（開始画面）に切り替える。
  // 読込済みのデータは消さないので、ログインし直せば開始画面から編集を続けられる
  async function logout(session) {
    if (store.hasAnyUnsavedChanges()) {
      const ok = await confirmDialog(
        '未保存の変更があります。ログアウトしても変更は残りますが、保存するにはもう一度ログインする必要があります。',
        { confirmLabel: 'ログアウト' }
      );
      if (!ok) return;
    }
    await api.logout(api.getSavedApiBase(), session.token);
    forceStartView = true;
    refreshStatus();
    renderMain();
  }

  function undo() { store.undo(); renderMain(); }
  function redo() { store.redo(); renderMain(); }

  function renderStatus() {
    const openGuide = guideFor ? guideFor(activeTabId) : null;
    renderStatusRow(statusRow, {
      store,
      onOpenIssues: openIssues,
      onUndo: hasUndo ? undo : undefined,
      onRedo: hasUndo ? redo : undefined,
      onSave: handleSave,
      switchView: { label: switchView.label, iconName: switchView.iconName, onClick: handleSwitchView },
      onOpenGuide: openGuide
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
      showLoginAgain();
    }
  }

  // セッションを消してログイン画面（開始画面）に切り替える。読込済みのデータは残す
  function showLoginAgain() {
    api.clearSession();
    forceStartView = true;
    refreshStatus();
    renderMain();
  }

  // 各タブでサーバーから 401 が返ったときに呼ぶ
  async function handleUnauthorized() {
    const message = api.getSavedSession()
      ? 'ログインの有効期限が切れました。もう一度ログインしてください。'
      : 'ログインが必要です。';
    await alertDialog(message);
    showLoginAgain();
  }

  async function handleSwitchView() {
    if (store.hasAnyUnsavedChanges()) {
      const ok = await confirmDialog(
        `未保存の変更は${switchView.editorName}のエディタに引き継がれません。先にサーバーに保存してください。`,
        { confirmLabel: '保存せずに移動', danger: true }
      );
      if (!ok) return;
    }
    window.location.href = switchView.href;
  }

  function refreshAll() {
    renderStatus();
  }

  const ctx = {
    store,
    refreshAll,
    refreshStatus,
    requestNavigate,
    logout,
    onUnauthorized: handleUnauthorized,
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

  function isDialogOpen() {
    return !!document.querySelector('.g-dialog-backdrop');
  }

  if (hasUndo) {
    window.addEventListener('keydown', (event) => {
      const tag = document.activeElement && document.activeElement.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
      if (isDialogOpen()) return;

      const mod = event.ctrlKey || event.metaKey;
      if (!mod) return;

      const key = event.key.toLowerCase();
      if (key === 'z' && event.shiftKey) {
        event.preventDefault();
        redo();
      } else if (key === 'z') {
        event.preventDefault();
        undo();
      } else if (key === 'y') {
        event.preventDefault();
        redo();
      }
    });
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

  onTabPopState(tabIds, (tabId) => {
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
}

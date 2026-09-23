import { createStore } from '../core/store.js';
import { resolveIssueTarget } from '../core/issue-location.js';
import { createEditorApp } from '../common/app-shell.js';
import { renderStationsView } from './views/stations.js';
import { renderLinesView } from './views/lines.js';
import { renderServicesView } from './views/services.js';
import { renderTransfersView } from './views/transfers.js';
import { renderOperationsView } from './views/operations.js';
import { openGuide } from './components/guide.js';
import { GUIDE_STEPS } from './guide-steps.js';

// 図形式のタブは、どれも自分でワークスペース（g-view）を作る
createEditorApp({
  rootId: 'g-app',
  store: createStore(),
  tabs: [
    { id: 'stations', label: '駅', render: renderStationsView, selfWraps: true },
    { id: 'lines', label: '路線', render: renderLinesView, selfWraps: true },
    { id: 'services', label: '運行系統', render: renderServicesView, selfWraps: true },
    { id: 'transfers', label: '乗換・駅グループ', render: renderTransfersView, selfWraps: true },
    { id: 'operations', label: '運行情報', render: renderOperationsView, selfWraps: true }
  ],
  resolveIssue: resolveIssueTarget,
  switchView: { label: '表形式で編集', iconName: 'table', editorName: '表形式', href: '../editor.html' },
  guideFor(tabId) {
    const steps = GUIDE_STEPS[tabId];
    return steps ? () => openGuide(steps) : null;
  }
});

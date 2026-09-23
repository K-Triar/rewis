import { createStore } from '../core/store.js';
import { createEditorApp } from '../common/app-shell.js';
import { renderStationsView } from './views/stations.js';
import { renderLinesView } from './views/lines.js';
import { renderServicesView } from './views/services.js';
import { renderTransfersView } from './views/transfers.js';
import { renderOperationsView } from './views/operations.js';
import { resolveIssueFocus } from './navigate.js';

createEditorApp({
  rootId: 'ed2-app',
  store: createStore({ undo: false }),
  tabs: [
    { id: 'stations', label: '駅', render: renderStationsView },
    { id: 'lines', label: '路線', render: renderLinesView },
    { id: 'services', label: '運行系統', render: renderServicesView },
    { id: 'transfers', label: '乗換・駅グループ', render: renderTransfersView },
    { id: 'operations', label: '運行情報', render: renderOperationsView }
  ],
  resolveIssue: resolveIssueFocus,
  switchView: { label: '図形式で編集', iconName: 'workflow', editorName: '図形式', href: '../editor-graph/' }
});

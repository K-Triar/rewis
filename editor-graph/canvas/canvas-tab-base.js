import { createWorkspace } from './workspace.js';
import { createCanvas } from './canvas.js';
import { createNodeDragHandler } from './node-drag.js';
import { renderStationNode } from './station-node.js';
import * as layoutStore from './layout-store.js';
import { resolvePositions } from '../../editor-core/auto-layout.js';
import { boundsOf } from '../../editor-core/graph-geometry.js';
import { h, icon } from '../dom.js';
import { confirmDialog, alertDialog } from '../components/dialog.js';
import { helpTip } from '../components/help-tip.js';

const LAYOUT_HELP_TEXT = '駅の配置はこのブラウザにだけ保存されます。ほかの人と同じ配置にしたいときは、書き出したファイルを読み込んでもらってください。';

// ツールバーの拡大・縮小・全体表示・配置の自動化/書き出し/読み込みボタンを組み立てて workspace.toolbar に足す。
// getBounds() は表示中のノードの範囲（boundsOf の戻り値）を返す関数。onReset は「配置を自動に戻す」「配置を読み込む」の後に呼ばれる。
export function attachCanvasToolbar(workspace, canvas, { getBounds, onReset }) {
  function fitAll() {
    canvas.fitTo(getBounds());
  }

  const zoomInBtn = h('button', { type: 'button', class: 'g-icon-btn', 'aria-label': '拡大', title: '拡大', onClick: () => canvas.zoomBy(1.2) }, icon('zoom-in'));
  const zoomOutBtn = h('button', { type: 'button', class: 'g-icon-btn', 'aria-label': '縮小', title: '縮小', onClick: () => canvas.zoomBy(1 / 1.2) }, icon('zoom-out'));
  const fitBtn = h('button', { type: 'button', class: 'g-icon-btn', 'aria-label': '全体表示', title: '全体表示', onClick: fitAll }, icon('screen-full'));

  const syncBtn = h('button', {
    type: 'button',
    class: 'g-btn',
    onClick: async () => {
      const ok = await confirmDialog('すべての駅の配置を自動配置に戻します。', { confirmLabel: '自動配置に戻す' });
      if (!ok) return;
      layoutStore.clearAll();
      if (onReset) onReset();
    }
  }, icon('sync'), '配置を自動に戻す');

  const exportBtn = h('button', {
    type: 'button',
    class: 'g-btn',
    onClick: () => {
      const blob = new Blob([layoutStore.exportJson()], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = h('a', { href: url, download: 'rewis-layout.json' });
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    }
  }, icon('download'), '配置を書き出す');

  const fileInput = h('input', {
    type: 'file',
    accept: 'application/json',
    hidden: true,
    onChange: async (event) => {
      const file = event.target.files && event.target.files[0];
      event.target.value = '';
      if (!file) return;
      const text = await file.text();
      const result = layoutStore.importJson(text);
      await alertDialog(result.message);
      if (result.ok && onReset) onReset();
    }
  });

  const importBtn = h('button', {
    type: 'button',
    class: 'g-btn',
    onClick: () => fileInput.click()
  }, icon('upload'), '配置を読み込む');

  workspace.toolbar.appendChild(zoomInBtn);
  workspace.toolbar.appendChild(zoomOutBtn);
  workspace.toolbar.appendChild(fitBtn);
  workspace.toolbar.appendChild(h('span', { class: 'g-ws-toolbar__sep' }));
  workspace.toolbar.appendChild(syncBtn);
  workspace.toolbar.appendChild(exportBtn);
  workspace.toolbar.appendChild(importBtn);
  workspace.toolbar.appendChild(fileInput);
  workspace.toolbar.appendChild(helpTip(LAYOUT_HELP_TEXT));

  return { fitAll };
}

export function createStationCanvasTab(container, ctx, { viewportKey, ribbon = false, requireShiftDrag = false, leftTitle = '' } = {}) {
  const network = ctx.store.state.docs.network;
  const workspace = createWorkspace(container, { ribbon });

  workspace.right.appendChild(h('p', { class: 'g-ws-right__note' }, '選択すると、ここに設定が表示されます（今後の手順で追加します）。'));

  const positions = new Map();
  function resyncPositions() {
    positions.clear();
    resolvePositions(network, layoutStore.loadSaved()).forEach((pos, id) => positions.set(id, pos));
  }
  resyncPositions();

  workspace.left.appendChild(h('div', { class: 'g-ws-left__title' }, leftTitle));
  workspace.left.appendChild(h('p', { class: 'g-ws-left__note' }, `図に表示中の駅：${positions.size} / ${network.stations.length} 件（一覧・絞り込みは今後の手順で追加します）`));

  const canvas = createCanvas(workspace.canvasHost, { viewportKey });

  const dragHandler = createNodeDragHandler(canvas, positions, {
    requireShift: requireShiftDrag,
    onChange: () => draw(),
    onCommit: (id, pos) => layoutStore.savePosition(id, pos)
  });

  function draw() {
    canvas.render((world) => {
      network.stations.forEach((station) => {
        const pos = positions.get(station.id);
        if (!pos) return;
        renderStationNode(world, station, pos, { onBodyPointerDown: dragHandler });
      });
    });
  }

  draw();

  const { fitAll } = attachCanvasToolbar(workspace, canvas, {
    getBounds: () => boundsOf([...positions.values()]),
    onReset: () => { resyncPositions(); draw(); }
  });
  if (!canvas.hasSavedViewport) fitAll();

  return {
    destroy() {
      canvas.destroy();
    }
  };
}

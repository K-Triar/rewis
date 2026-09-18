import { createWorkspace } from './workspace.js';
import { createCanvas } from './canvas.js';
import { createNodeDragHandler } from './node-drag.js';
import { renderStationNode } from './station-node.js';
import { resolvePositions, setLayout } from '../../editor-core/auto-layout.js';
import { boundsOf } from '../../editor-core/graph-geometry.js';
import { h, icon } from '../dom.js';
import { helpTip } from '../components/help-tip.js';

const LAYOUT_HELP_TEXT = '駅の配置は、［サーバーに保存］を押すとほかの人にも共有されます。';

// ツールバーの拡大・縮小・全体表示ボタンを組み立てて workspace.toolbar に足す。
// getBounds() は表示中のノードの範囲（boundsOf の戻り値）を返す関数。
export function attachCanvasToolbar(workspace, canvas, { getBounds }) {
  function fitAll() {
    canvas.fitTo(getBounds());
  }

  const zoomInBtn = h('button', { type: 'button', class: 'g-icon-btn', 'aria-label': '拡大', title: '拡大', onClick: () => canvas.zoomBy(1.2) }, icon('zoom-in'));
  const zoomOutBtn = h('button', { type: 'button', class: 'g-icon-btn', 'aria-label': '縮小', title: '縮小', onClick: () => canvas.zoomBy(1 / 1.2) }, icon('zoom-out'));
  const fitBtn = h('button', { type: 'button', class: 'g-icon-btn', 'aria-label': '全体表示', title: '全体表示', onClick: fitAll }, icon('screen-full'));

  workspace.toolbar.appendChild(zoomInBtn);
  workspace.toolbar.appendChild(zoomOutBtn);
  workspace.toolbar.appendChild(fitBtn);
  workspace.toolbar.appendChild(h('span', { class: 'g-ws-toolbar__sep' }));
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
    resolvePositions(network).forEach((pos, id) => positions.set(id, pos));
  }
  resyncPositions();

  workspace.left.appendChild(h('div', { class: 'g-ws-left__title' }, leftTitle));
  workspace.left.appendChild(h('p', { class: 'g-ws-left__note' }, `図に表示中の駅：${positions.size} / ${network.stations.length} 件（一覧・絞り込みは今後の手順で追加します）`));

  const canvas = createCanvas(workspace.canvasHost, { viewportKey });

  const dragHandler = createNodeDragHandler(canvas, positions, {
    requireShift: requireShiftDrag,
    onChange: () => draw(),
    onCommit: (id, pos) => ctx.store.mutateDoc('network', (doc) => setLayout(doc, id, pos))
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
    getBounds: () => boundsOf([...positions.values()])
  });
  if (!canvas.hasSavedViewport) fitAll();

  return {
    destroy() {
      canvas.destroy();
    }
  };
}

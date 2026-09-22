import { createWorkspace } from '../canvas/workspace.js';
import { createCanvas, trackPointer } from '../canvas/canvas.js';
import { renderStationNode } from '../canvas/station-node.js';
import { attachCanvasToolbar } from '../canvas/canvas-tab-base.js';
import { graphUi } from '../canvas/ui-state.js';
import { resolvePositions, setLayout } from '../../editor-core/auto-layout.js';
import { boundsOf, portPoint, edgeMidpoint, nodeRect } from '../../editor-core/graph-geometry.js';
import * as transferOps from '../../editor-core/transfer-ops.js';
import * as groupOps from '../../editor-core/group-ops.js';
import { h, s, clear, icon } from '../../editor-shared/dom.js';
import { alertDialog, confirmDialog, openDialog } from '../../editor-shared/components/dialog.js';
import { openPopover } from '../../editor-shared/components/overlay.js';
import { helpTip } from '../../editor-shared/components/help-tip.js';
import { createStationSearch } from '../components/station-search.js';
import { maybeOpenGuideOnce } from '../components/guide.js';
import { GUIDE_STEPS } from '../guide-steps.js';

const SHIFT_HELP_TEXT = 'このタブでは、駅の移動は Shift を押しながらのドラッグだけです。ドラッグだけで始めると、乗換の登録になります。';

function stationOf(network, stationId) {
  return (network.stations || []).find((st) => st.id === stationId) || null;
}

function stationLabel(network, stationId) {
  const station = stationOf(network, stationId);
  return station ? station.name : stationId;
}

function platformLabelOf(station, platformId) {
  if (platformId == null) return null;
  const platform = station && (station.platforms || []).find((p) => p.id === platformId);
  return platform ? platform.label : platformId;
}

function endpointLabel(network, endpoint) {
  const station = stationOf(network, endpoint.stationId);
  const name = station ? station.name : endpoint.stationId;
  const platformLabel = platformLabelOf(station, endpoint.platformId);
  return platformLabel ? `${name} ${platformLabel}` : name;
}

function dropTargetAt(clientX, clientY) {
  const el = document.elementFromPoint(clientX, clientY);
  if (!el) return null;
  const portHit = el.closest('.g-port__hit');
  if (portHit) {
    const group = portHit.closest('[data-station-id]');
    if (!group) return null;
    return { stationId: group.getAttribute('data-station-id'), platformId: portHit.getAttribute('data-platform-id') };
  }
  const bodyHit = el.closest('.g-node__body');
  if (bodyHit) {
    const group = bodyHit.closest('[data-station-id]');
    if (!group) return null;
    return { stationId: group.getAttribute('data-station-id'), platformId: null };
  }
  return null;
}

export function renderTransfersView(container, ctx) {
  const { store, focus } = ctx;
  const network = store.state.docs.network;

  const ui = graphUi.transfers;
  if (ui.selectedId && !network.transfers.some((t) => t.id === ui.selectedId)) ui.selectedId = null;
  if (ui.selectedStationId && !network.stations.some((st) => st.id === ui.selectedStationId)) ui.selectedStationId = null;

  let focusGroupId = null;
  if (focus && focus.id) {
    if (focus.sub && focus.sub.type === 'group') {
      ui.pane = 'tables';
      focusGroupId = focus.id;
    } else {
      ui.pane = 'graph';
      ui.selectedId = focus.id;
      ui.selectedStationId = null;
    }
  }

  clear(container);
  const root = h('div', { class: 'g-tr-root' });
  const switchBar = h('div', { class: 'g-tr-pane-switch' });
  const bodyHost = h('div', { class: 'g-tr-body' });
  root.appendChild(switchBar);
  root.appendChild(bodyHost);
  container.appendChild(root);

  const graphBtn = h('button', {
    type: 'button', class: 'g-btn g-toggle-btn', 'aria-pressed': String(ui.pane === 'graph'),
    onClick: () => setPane('graph')
  }, '乗換');
  const tablesBtn = h('button', {
    type: 'button', class: 'g-btn g-toggle-btn', 'aria-pressed': String(ui.pane === 'tables'),
    onClick: () => setPane('tables')
  }, '乗換の既定値と駅グループ');
  switchBar.appendChild(graphBtn);
  switchBar.appendChild(tablesBtn);

  let teardownGraph = null;

  function setPane(pane) {
    if (ui.pane === pane) return;
    ui.pane = pane;
    graphBtn.setAttribute('aria-pressed', String(pane === 'graph'));
    tablesBtn.setAttribute('aria-pressed', String(pane === 'tables'));
    mountBody();
  }

  function mountBody() {
    if (teardownGraph) { teardownGraph(); teardownGraph = null; }
    clear(bodyHost);
    if (ui.pane === 'graph') {
      teardownGraph = mountGraphPane(bodyHost, ctx);
    } else {
      mountTablesPane(bodyHost, ctx, focusGroupId);
    }
  }

  mountBody();

  return {
    destroy() {
      if (teardownGraph) teardownGraph();
    }
  };
}

// 14.1 乗換（pane: 'graph'）
function mountGraphPane(container, ctx) {
  const { store } = ctx;
  const network = store.state.docs.network;
  const ui = graphUi.transfers;

  const workspace = createWorkspace(container, { ribbon: false });
  workspace.left.appendChild(h('div', { class: 'g-ws-left__title' }, '乗換'));
  workspace.left.appendChild(h('p', { class: 'g-ws-left__note' }, 'のりばの点、または駅の本体からドラッグすると、乗換を登録できます。何も選んでいないときは、右側に乗換の一覧が出ます。'));

  const positions = new Map();
  function resyncPositions() {
    positions.clear();
    resolvePositions(network).forEach((pos, id) => positions.set(id, pos));
  }
  resyncPositions();

  function selectedTransfer() {
    return network.transfers.find((t) => t.id === ui.selectedId) || null;
  }
  function selectedStation() {
    return stationOf(network, ui.selectedStationId);
  }

  function selectTransfer(id) {
    ui.selectedId = id;
    ui.selectedStationId = null;
    refreshView();
  }
  function selectStation(id) {
    ui.selectedStationId = id;
    ui.selectedId = null;
    refreshView();
  }
  function clearSelection() {
    ui.selectedId = null;
    ui.selectedStationId = null;
    refreshView();
  }

  const canvas = createCanvas(workspace.canvasHost, {
    viewportKey: 'transfers',
    onBackgroundClick: () => { if (ui.selectedId || ui.selectedStationId) clearSelection(); }
  });

  function handleBodyPointerDown(event, station) {
    if (event.shiftKey) {
      startStationMove(event, station);
      return;
    }
    startTransferDrag(event, station, null);
  }

  function handlePortPointerDown(event, station, platformId) {
    event.stopPropagation();
    startTransferDrag(event, station, platformId);
  }

  function startStationMove(event, station) {
    event.preventDefault();
    const startWorld = canvas.screenToWorld(event.clientX, event.clientY);
    const startPos = positions.get(station.id) || { x: 0, y: 0 };
    trackPointer(event, {
      onClick: () => selectStation(station.id),
      onDragMove: (ev) => {
        const nowWorld = canvas.screenToWorld(ev.clientX, ev.clientY);
        positions.set(station.id, {
          x: startPos.x + (nowWorld.x - startWorld.x),
          y: startPos.y + (nowWorld.y - startWorld.y)
        });
        drawCanvas();
      },
      onDragEnd: () => store.mutateDoc('network', (doc) => setLayout(doc, station.id, positions.get(station.id)))
    });
  }

  function startTransferDrag(event, fromStation, fromPlatformId) {
    event.preventDefault();
    const from = { stationId: fromStation.id, platformId: fromPlatformId };
    let rubberLine = null;

    trackPointer(event, {
      onClick: () => selectStation(fromStation.id),
      onDragStart: () => {
        const p1 = portPoint(fromStation, positions.get(fromStation.id), fromPlatformId);
        rubberLine = s('line', { class: 'g-transfer-drag', x1: p1.x, y1: p1.y, x2: p1.x, y2: p1.y });
        canvas.world.appendChild(rubberLine);
      },
      onDragMove: (ev) => {
        if (!rubberLine) return;
        const world = canvas.screenToWorld(ev.clientX, ev.clientY);
        rubberLine.setAttribute('x2', world.x);
        rubberLine.setAttribute('y2', world.y);
      },
      onDragEnd: (ev) => {
        if (rubberLine) { rubberLine.remove(); rubberLine = null; }
        const target = dropTargetAt(ev.clientX, ev.clientY);
        if (target) openTransferCreatePopover(from, target, ev.clientX, ev.clientY);
      }
    });
  }

  function drawCanvas() {
    canvas.render((world) => {
      network.transfers.forEach((t) => {
        if (transferOps.transferKind(t) === 'walk') drawWalkTransfer(world, t);
      });
      network.stations.forEach((station) => {
        const pos = positions.get(station.id);
        if (!pos) return;
        renderStationNode(world, station, pos, {
          selected: ui.selectedStationId === station.id,
          onBodyPointerDown: handleBodyPointerDown,
          onPortPointerDown: handlePortPointerDown
        });
        const intraCount = network.transfers.filter((t) => transferOps.transferKind(t) === 'intra' && t.from.stationId === station.id).length;
        if (intraCount > 0) drawIntraBadge(world, station, pos, intraCount);
      });
    });
  }

  function pointAt(p1, p2, t) {
    return { x: p1.x + (p2.x - p1.x) * t, y: p1.y + (p2.y - p1.y) * t };
  }

  function drawWalkTransfer(world, transfer) {
    const fromStation = stationOf(network, transfer.from.stationId);
    const toStation = stationOf(network, transfer.to.stationId);
    const fromPos = positions.get(transfer.from.stationId);
    const toPos = positions.get(transfer.to.stationId);
    if (!fromStation || !toStation || !fromPos || !toPos) return;
    const p1 = portPoint(fromStation, fromPos, transfer.from.platformId);
    const p2 = portPoint(toStation, toPos, transfer.to.platformId);
    const selected = graphUi.transfers.selectedId === transfer.id;

    world.appendChild(s('line', {
      class: 'g-walk-line' + (selected ? ' is-selected' : ''),
      x1: p1.x, y1: p1.y, x2: p2.x, y2: p2.y
    }));
    const hit = s('line', { class: 'g-walk-hit', x1: p1.x, y1: p1.y, x2: p2.x, y2: p2.y });
    hit.addEventListener('pointerdown', (event) => { event.stopPropagation(); selectTransfer(transfer.id); });
    world.appendChild(hit);

    const angle = Math.atan2(p2.y - p1.y, p2.x - p1.x) * 180 / Math.PI;
    const toArrow = pointAt(p1, p2, 0.85);
    world.appendChild(s('polygon', { class: 'g-walk-arrow', points: '-5,-4 5,0 -5,4', transform: `translate(${toArrow.x},${toArrow.y}) rotate(${angle})` }));
    if (transfer.bidirectional) {
      const fromArrow = pointAt(p1, p2, 0.15);
      world.appendChild(s('polygon', { class: 'g-walk-arrow', points: '-5,-4 5,0 -5,4', transform: `translate(${fromArrow.x},${fromArrow.y}) rotate(${angle + 180})` }));
    }

    const mid = edgeMidpoint(p1, p2);
    const width = 56;
    const fo = s('foreignObject', { x: mid.x - width / 2, y: mid.y - 10, width, height: 20 });
    fo.appendChild(h('div', { class: 'g-walk-badge' }, h('span', { class: 'g-walk-icon', 'aria-hidden': 'true' }), `${transfer.seconds}秒`));
    world.appendChild(fo);
  }

  function drawIntraBadge(world, station, pos, count) {
    const rect = nodeRect(station, pos);
    const label = `乗換 ${count}`;
    const width = 24 + label.length * 7;
    const group = s('g', { class: 'g-intra-badge', transform: `translate(${rect.x + rect.w},${rect.y})` });
    group.appendChild(s('rect', { x: -width, y: -10, width, height: 20, rx: 10 }));
    group.appendChild(s('text', { x: -width / 2, 'text-anchor': 'middle', dy: 4 }, label));
    world.appendChild(group);
  }

  // 右パネル
  function renderRightPanel() {
    clear(workspace.right);
    const transfer = selectedTransfer();
    const station = selectedStation();
    if (transfer) {
      renderTransferPanel(transfer);
    } else if (station) {
      renderStationPanel(station);
    } else {
      renderTransferListPanel();
    }
  }

  function renderTransferPanel(transfer) {
    workspace.right.appendChild(h('div', { class: 'g-field__label' },
      `${endpointLabel(network, transfer.from)} → ${endpointLabel(network, transfer.to)}`
    ));

    const errorEl = h('div', { class: 'g-field__error' });
    const secondsInput = h('input', { type: 'number', class: 'g-input', value: transfer.seconds });
    secondsInput.addEventListener('change', () => {
      const value = Number(secondsInput.value);
      if (!Number.isInteger(value) || value < 0) {
        secondsInput.value = transfer.seconds;
        errorEl.textContent = '乗換秒数は0以上の整数で入力してください。';
        return;
      }
      errorEl.textContent = '';
      mutateTransfer(transfer.id, (t) => transferOps.updateTransfer(t, { seconds: value }));
    });
    workspace.right.appendChild(h('div', { class: 'g-field' },
      h('label', { class: 'g-field__label' }, '乗換時間（秒）'),
      secondsInput,
      errorEl
    ));

    const bidirInput = h('input', { type: 'checkbox', checked: !!transfer.bidirectional });
    bidirInput.addEventListener('change', () => {
      mutateTransfer(transfer.id, (t) => transferOps.updateTransfer(t, { bidirectional: bidirInput.checked }));
    });
    workspace.right.appendChild(h('div', { class: 'g-checkbox' }, bidirInput, h('span', {}, '逆向きにも同じ時間で乗り換えられる')));

    const noteInput = h('input', { type: 'text', class: 'g-input', value: transfer.note || '' });
    noteInput.addEventListener('change', () => {
      mutateTransfer(transfer.id, (t) => transferOps.updateTransfer(t, { note: noteInput.value.trim() }));
    });
    workspace.right.appendChild(h('div', { class: 'g-field' },
      h('label', { class: 'g-field__label' }, 'メモ（任意）'),
      noteInput
    ));

    workspace.right.appendChild(h('div', { class: 'g-svc-actions' },
      h('button', {
        type: 'button', class: 'g-btn',
        onClick: () => mutateTransfer(transfer.id, (t) => transferOps.swapTransferDirection(t))
      }, icon('arrow-both'), '向きを入れ替える'),
      h('button', {
        type: 'button', class: 'g-btn g-btn--danger',
        onClick: async () => {
          const ok = await confirmDialog(`乗換「${endpointLabel(network, transfer.from)} → ${endpointLabel(network, transfer.to)}」を削除します。`, { confirmLabel: '乗換を削除', danger: true });
          if (!ok) return;
          store.mutateDoc('network', (doc) => {
            doc.transfers = doc.transfers.filter((t) => t.id !== transfer.id);
          });
          ui.selectedId = null;
          refreshView();
        }
      }, icon('trash'), '乗換を削除')
    ));
  }

  function mutateTransfer(id, fn) {
    store.mutateDoc('network', (doc) => {
      const idx = doc.transfers.findIndex((t) => t.id === id);
      if (idx === -1) return;
      doc.transfers[idx] = fn(doc.transfers[idx]);
    });
    refreshView();
  }

  function renderStationPanel(station) {
    workspace.right.appendChild(h('div', { class: 'g-field__label' }, station.name));

    const platforms = station.platforms || [];
    if (platforms.length <= 1) {
      workspace.right.appendChild(h('p', { class: 'g-ws-right__note' }, 'のりばが2つ以上ある駅で使えます。'));
    } else {
      workspace.right.appendChild(renderIntraTable(station, platforms));
    }

    const walks = network.transfers.filter((t) => transferOps.transferKind(t) === 'walk' && (t.from.stationId === station.id || t.to.stationId === station.id));
    workspace.right.appendChild(h('div', { class: 'g-field__label' }, '徒歩連絡'));
    if (walks.length === 0) {
      workspace.right.appendChild(h('p', { class: 'g-ws-right__note' }, 'この駅の徒歩連絡はありません。'));
    } else {
      const list = h('div', { class: 'g-list' });
      walks.forEach((t) => {
        list.appendChild(h('button', {
          type: 'button', class: 'g-list__item',
          onClick: () => selectTransfer(t.id)
        }, `${endpointLabel(network, t.from)} → ${endpointLabel(network, t.to)}`));
      });
      workspace.right.appendChild(list);
    }
  }

  function renderIntraTable(station, platforms) {
    const table = h('table', { class: 'g-tr-intra-grid' });
    table.appendChild(h('thead', {}, h('tr', {}, h('th', {}),
      platforms.map((p) => h('th', {}, p.label))
    )));
    const tbody = h('tbody', {});
    platforms.forEach((fromP) => {
      const row = h('tr', {}, h('th', {}, fromP.label));
      platforms.forEach((toP) => {
        if (fromP.id === toP.id) {
          row.appendChild(h('td', {}, '—'));
          return;
        }
        const looked = transferOps.lookupIntraTransfer(network, station.id, fromP.id, toP.id);
        const input = h('input', {
          type: 'number', class: 'g-input' + (looked && looked.reversed ? ' g-tr-intra-reversed' : ''),
          value: looked ? looked.transfer.seconds : '',
          title: looked && looked.reversed ? '逆向きの登録と同じ時間です' : null
        });
        input.addEventListener('change', async () => {
          const raw = input.value.trim();
          if (raw === '') {
            if (looked) {
              if (looked.reversed) {
                const ok = await confirmDialog('逆向きの乗換も一緒に削除されます。', { confirmLabel: '削除する', danger: true });
                if (!ok) { input.value = looked.transfer.seconds; return; }
              }
              store.mutateDoc('network', (doc) => {
                doc.transfers = doc.transfers.filter((t) => t.id !== looked.transfer.id);
              });
              refreshView();
            }
            return;
          }
          const value = Number(raw);
          if (!Number.isInteger(value) || value < 0) {
            input.value = looked ? looked.transfer.seconds : '';
            await alertDialog('乗換秒数は0以上の整数で入力してください。');
            return;
          }
          if (looked) {
            mutateTransfer(looked.transfer.id, (t) => transferOps.updateTransfer(t, { seconds: value }));
          } else {
            const draft = transferOps.createTransfer({
              from: { stationId: station.id, platformId: fromP.id },
              to: { stationId: station.id, platformId: toP.id },
              seconds: value,
              bidirectional: false
            });
            store.mutateDoc('network', (doc) => { doc.transfers.push(draft); });
            refreshView();
          }
        });
        row.appendChild(h('td', {}, input));
      });
      tbody.appendChild(row);
    });
    table.appendChild(tbody);
    return h('div', { class: 'g-tr-intra-table' }, table);
  }

  function renderTransferListPanel() {
    const searchInput = h('input', { type: 'text', class: 'g-input', placeholder: '駅名・かなで絞り込み', value: ui.search });
    const searchWrap = h('div', { class: 'g-search-field' }, icon('search', { size: 14 }), searchInput);
    const list = h('div', { class: 'g-list' });

    function renderList() {
      clear(list);
      const needle = ui.search.trim();
      network.transfers
        .filter((t) => {
          if (!needle) return true;
          const a = stationOf(network, t.from.stationId);
          const b = stationOf(network, t.to.stationId);
          return [a, b].some((st) => st && (st.name.includes(needle) || (st.kana || '').includes(needle)));
        })
        .forEach((t) => {
          list.appendChild(h('button', {
            type: 'button', class: 'g-list__item',
            onClick: () => selectTransfer(t.id)
          }, `${endpointLabel(network, t.from)} → ${endpointLabel(network, t.to)}`));
        });
    }
    renderList();

    searchInput.addEventListener('input', () => {
      ui.search = searchInput.value;
      renderList();
    });

    workspace.right.appendChild(h('div', { class: 'g-field__label' }, '乗換'));
    workspace.right.appendChild(searchWrap);
    workspace.right.appendChild(list);
  }

  function openTransferCreatePopover(from, to, clientX, clientY) {
    const secondsInput = h('input', { type: 'number', class: 'g-input', value: 60 });
    const bidirInput = h('input', { type: 'checkbox' });
    const noteInput = h('input', { type: 'text', class: 'g-input', placeholder: 'メモ（任意）' });
    const errorEl = h('div', { class: 'g-field__error' });

    const submit = () => {
      const seconds = Number(secondsInput.value);
      const draft = transferOps.createTransfer({
        from, to, seconds, bidirectional: bidirInput.checked, note: noteInput.value.trim()
      });
      const err = transferOps.validateTransferDraft(network, draft);
      if (err) { errorEl.textContent = err; return; }
      store.mutateDoc('network', (doc) => { doc.transfers.push(draft); });
      close();
      selectTransfer(draft.id);
    };

    const form = h('div', { class: 'g-popover-form' },
      h('div', { class: 'g-field__label' }, `${endpointLabel(network, from)} → ${endpointLabel(network, to)}`),
      h('div', { class: 'g-field' }, h('label', { class: 'g-field__label' }, '乗換時間（秒）'), secondsInput),
      h('div', { class: 'g-checkbox' }, bidirInput, h('span', {}, '逆向きにも同じ時間で乗り換えられる')),
      h('div', { class: 'g-field' }, h('label', { class: 'g-field__label' }, 'メモ（任意）'), noteInput),
      errorEl,
      h('div', { class: 'g-popover-actions' },
        h('button', { type: 'button', class: 'g-btn', onClick: () => close() }, 'キャンセル'),
        h('button', { type: 'button', class: 'g-btn g-btn--primary', onClick: submit }, '乗換を登録')
      )
    );

    const close = openPopover(clientX, clientY, form);
  }

  function refreshView() {
    drawCanvas();
    renderRightPanel();
  }

  function onKeyDown(event) {
    if (event.key !== 'Escape') return;
    const tag = document.activeElement && document.activeElement.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
    if (document.querySelector('.g-dialog-backdrop')) return;
    if (ui.selectedId || ui.selectedStationId) clearSelection();
  }
  window.addEventListener('keydown', onKeyDown);

  refreshView();

  const { fitAll } = attachCanvasToolbar(workspace, canvas, {
    getBounds: () => boundsOf([...positions.values()])
  });
  workspace.toolbar.appendChild(helpTip(SHIFT_HELP_TEXT));
  if (!canvas.hasSavedViewport) fitAll();

  maybeOpenGuideOnce(GUIDE_STEPS.transfers, 'rewis_editor_graph_guide_transfers');

  return () => {
    window.removeEventListener('keydown', onKeyDown);
    canvas.destroy();
  };
}

// 14.2 乗換の既定値と駅グループ（pane: 'tables'）
function mountTablesPane(container, ctx, focusGroupId) {
  const { store } = ctx;
  const network = store.state.docs.network;

  const wrap = h('div', { class: 'g-tr-tables' });
  container.appendChild(wrap);

  function refresh() {
    clear(wrap);
    wrap.appendChild(renderDefaultsCard());
    wrap.appendChild(renderGroupsCard());
  }

  function renderDefaultsCard() {
    const defaults = network.transferDefaults || { samePlatform: 5, unknown: 10 };
    const sameInput = h('input', { type: 'number', class: 'g-input', value: String(defaults.samePlatform) });
    const unknownInput = h('input', { type: 'number', class: 'g-input', value: String(defaults.unknown) });

    async function applyChange(key, input) {
      const value = Number(input.value);
      if (!Number.isInteger(value) || value < 0) {
        await alertDialog('乗換秒数は0以上の整数で入力してください。');
        input.value = String(network.transferDefaults[key]);
        return;
      }
      store.mutateDoc('network', (doc) => { doc.transferDefaults[key] = value; });
    }
    sameInput.addEventListener('change', () => applyChange('samePlatform', sameInput));
    unknownInput.addEventListener('change', () => applyChange('unknown', unknownInput));

    return h('div', { class: 'g-card' },
      h('div', { class: 'g-card__header' }, '乗換の既定値'),
      h('div', { class: 'g-card__body' },
        h('div', { class: 'g-field' }, h('label', { class: 'g-field__label' }, '同じのりばでの乗換時間（秒）'), sameInput),
        h('div', { class: 'g-field' }, h('label', { class: 'g-field__label' }, 'のりばがわからない乗換の時間（秒）'), unknownInput)
      )
    );
  }

  function renderGroupsCard() {
    const list = h('div', { class: 'g-list' });
    (network.stationGroups || []).forEach((group) => {
      const row = h('div', { class: 'g-list__row' + (group.id === focusGroupId ? ' is-selected' : '') },
        h('div', {},
          h('div', {}, group.name),
          h('div', { class: 'g-svc-row__badges' }, group.stationIds.map((id) => h('span', { class: 'g-label' }, stationLabel(network, id))))
        ),
        h('div', { class: 'g-tr-group-actions' },
          h('button', {
            type: 'button', class: 'g-btn g-btn--small',
            onClick: async () => { await openGroupDialog(group); refresh(); }
          }, '編集'),
          h('button', {
            type: 'button', class: 'g-btn g-btn--small g-btn--danger',
            onClick: async () => {
              const ok = await confirmDialog(`駅グループ「${group.name}」を削除します。`, { confirmLabel: '駅グループを削除', danger: true });
              if (!ok) return;
              store.mutateDoc('network', (doc) => {
                doc.stationGroups = doc.stationGroups.filter((g) => g.id !== group.id);
              });
              refresh();
            }
          }, '駅グループを削除')
        )
      );
      list.appendChild(row);
      if (group.id === focusGroupId) {
        queueMicrotask(() => row.scrollIntoView({ block: 'center' }));
      }
    });

    const addBtn = h('button', {
      type: 'button', class: 'g-btn',
      onClick: async () => { await openGroupDialog(null); refresh(); }
    }, icon('plus'), '駅グループを追加');

    return h('div', { class: 'g-card' },
      h('div', { class: 'g-card__header' }, '駅グループ'),
      h('div', { class: 'g-card__body' },
        h('p', { class: 'g-ws-right__note' }, '別々の駅名でも、同じ場所として検索の候補にまとめて出すための設定です。'),
        list,
        addBtn
      )
    );
  }

  function openGroupDialog(existingGroup) {
    return openDialog((close) => {
      const isNew = !existingGroup;
      const nameInput = h('input', { type: 'text', class: 'g-input', value: isNew ? '' : existingGroup.name });
      let stationIds = isNew ? [] : existingGroup.stationIds.slice();
      const listEl = h('div', { class: 'g-list' });
      const errorEl = h('div', { class: 'g-field__error' });

      function renderStations() {
        clear(listEl);
        stationIds.forEach((id) => {
          listEl.appendChild(h('div', { class: 'g-list__row' },
            h('span', {}, stationLabel(network, id)),
            h('button', {
              type: 'button', class: 'g-btn g-btn--small',
              onClick: () => { stationIds = stationIds.filter((sid) => sid !== id); renderStations(); }
            }, '外す')
          ));
        });
      }
      renderStations();

      const search = createStationSearch(network.stations, (station) => {
        if (stationIds.includes(station.id)) {
          errorEl.textContent = '同じ駅が既にこのグループに含まれています。';
          return;
        }
        errorEl.textContent = '';
        stationIds.push(station.id);
        renderStations();
      });

      const submit = () => {
        const draft = groupOps.createGroup(nameInput.value.trim(), stationIds);
        if (!isNew) draft.id = existingGroup.id;
        const err = groupOps.validateGroupDraft(network, draft, { excludeId: isNew ? undefined : existingGroup.id });
        if (err) { errorEl.textContent = err; return; }
        if (isNew) {
          store.mutateDoc('network', (doc) => { doc.stationGroups.push(draft); });
        } else {
          store.mutateDoc('network', (doc) => {
            const idx = doc.stationGroups.findIndex((g) => g.id === existingGroup.id);
            if (idx !== -1) doc.stationGroups[idx] = draft;
          });
        }
        close(true);
      };

      return h('div', { class: 'g-dialog', role: 'dialog', 'aria-modal': 'true' },
        h('div', { class: 'g-dialog__title' }, isNew ? '駅グループを追加' : '駅グループを編集'),
        h('div', { class: 'g-field' }, h('label', { class: 'g-field__label' }, 'グループ名'), nameInput),
        h('div', { class: 'g-field' }, h('span', { class: 'g-field__label' }, '駅'), listEl),
        h('div', { class: 'g-field' }, h('label', { class: 'g-field__label' }, '駅を追加'), search),
        errorEl,
        h('div', { class: 'g-dialog__actions' },
          h('button', { type: 'button', class: 'g-btn', onClick: () => close(false) }, 'キャンセル'),
          h('button', { type: 'button', class: 'g-btn g-btn--primary', onClick: submit }, isNew ? '作成' : '変更を反映')
        )
      );
    });
  }

  refresh();
}

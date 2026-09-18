import { createWorkspace } from '../canvas/workspace.js';
import { createCanvas } from '../canvas/canvas.js';
import { createNodeDragHandler } from '../canvas/node-drag.js';
import { renderStationNode } from '../canvas/station-node.js';
import { renderRibbon } from '../canvas/ribbon.js';
import { attachCanvasToolbar } from '../canvas/canvas-tab-base.js';
import { graphUi } from '../canvas/ui-state.js';
import { resolvePositions, setLayout } from '../../editor-core/auto-layout.js';
import { boundsOf, nodeRect, edgeMidpoint } from '../../editor-core/graph-geometry.js';
import * as lineOps from '../../editor-core/line-ops.js';
import { suggestCategoryId } from '../../editor-core/id-suggest.js';
import { serviceTitle } from '../../editor-core/issue-location.js';
import { findReferences } from '../../editor2/refs.js';
import { isValidId } from '../../shared/ids.js';
import { h, s, clear, icon } from '../dom.js';
import { alertDialog, confirmDialog } from '../components/dialog.js';
import { openPopover } from '../components/overlay.js';
import { maybeOpenGuideOnce } from '../components/guide.js';
import { GUIDE_STEPS } from '../guide-steps.js';

const MUTED_COLOR = '#999999';
const REF_TAB_BY_KIND = { service: 'services' };

function stationOf(network, stationId) {
  return (network.stations || []).find((st) => st.id === stationId) || null;
}

function stationLabel(network, stationId) {
  const station = stationOf(network, stationId);
  return station ? station.name : stationId;
}

function shapeOf(line) {
  if (!line.loop) return 'normal';
  return line.loop.startIndex === 0 ? 'circular' : 'racket';
}

function shapeLabel(line) {
  const shape = shapeOf(line);
  if (shape === 'circular') return '環状線';
  if (shape === 'racket') return 'ラケット型';
  return '端あり';
}

function shapeIconSvg(kind) {
  const svg = s('svg', { viewBox: '0 0 24 16', width: 24, height: 16, 'aria-hidden': 'true', class: 'g-shape-icon' });
  if (kind === 'normal') {
    svg.appendChild(s('line', { x1: 3, y1: 8, x2: 21, y2: 8, stroke: 'currentColor', 'stroke-width': 2 }));
    svg.appendChild(s('circle', { cx: 3, cy: 8, r: 2, fill: 'currentColor' }));
    svg.appendChild(s('circle', { cx: 21, cy: 8, r: 2, fill: 'currentColor' }));
  } else if (kind === 'circular') {
    svg.appendChild(s('circle', { cx: 12, cy: 8, r: 6, fill: 'none', stroke: 'currentColor', 'stroke-width': 2 }));
  } else {
    svg.appendChild(s('path', { d: 'M7 2 V14 M7 2 H14 A4 4 0 0 1 14 10 H7', fill: 'none', stroke: 'currentColor', 'stroke-width': 2 }));
  }
  return svg;
}

function refTarget(ref) {
  const tab = REF_TAB_BY_KIND[ref.kind];
  if (!tab) return null;
  return { tab, id: ref.id, sub: null };
}

function renderRefList(refs, requestNavigate) {
  const list = h('div', { class: 'g-list' });
  refs.forEach((ref) => {
    const target = refTarget(ref);
    if (target) {
      list.appendChild(h('button', {
        type: 'button',
        class: 'g-list__item',
        onClick: () => requestNavigate(target)
      }, ref.label));
    } else {
      list.appendChild(h('div', { class: 'g-list__row' }, ref.label));
    }
  });
  return list;
}

export function renderLinesView(container, ctx) {
  const { store, requestNavigate, focus } = ctx;
  const network = store.state.docs.network;
  const operations = store.state.docs.operations;
  const ui = graphUi.lines;

  if (ui.selectedId && !network.lines.some((l) => l.id === ui.selectedId)) {
    ui.selectedId = null;
    ui.selectedIndex = null;
  }

  let blockedCategoryId = null;

  const workspace = createWorkspace(container, { ribbon: true });

  const positions = new Map();
  function resyncPositions() {
    positions.clear();
    resolvePositions(network).forEach((pos, id) => positions.set(id, pos));
  }
  resyncPositions();

  let bannerTimer = null;
  function flashBanner(text, variant, duration = 3000) {
    workspace.setBanner(text, variant);
    if (bannerTimer) clearTimeout(bannerTimer);
    if (duration > 0) {
      bannerTimer = setTimeout(() => {
        if (ui.mode === 'idle') workspace.setBanner(null);
        else updateModeBanner();
      }, duration);
    }
  }

  function selectedLine() {
    return network.lines.find((l) => l.id === ui.selectedId) || null;
  }

  function mutateSelectedLine(fn) {
    const id = ui.selectedId;
    if (!id) return;
    store.mutateDoc('network', (doc) => {
      const idx = doc.lines.findIndex((l) => l.id === id);
      if (idx === -1) return;
      doc.lines[idx] = fn(doc.lines[idx]);
    });
    refreshView();
  }

  function selectLine(id) {
    ui.selectedId = id;
    ui.selectedIndex = null;
    ui.mode = 'idle';
    ui.insertIndex = null;
    workspace.setBanner(null);
    refreshView();
  }

  function selectStationIndex(index) {
    ui.selectedIndex = index;
    refreshView();
  }

  const canvas = createCanvas(workspace.canvasHost, {
    viewportKey: 'lines',
    onBackgroundClick: () => {
      if (ui.mode === 'idle' && ui.selectedIndex != null) selectStationIndex(null);
    }
  });

  const dragHandler = createNodeDragHandler(canvas, positions, {
    onChange: () => drawCanvas(),
    onCommit: (id, pos) => store.mutateDoc('network', (doc) => setLayout(doc, id, pos)),
    onClick: (station) => handleNodeClick(station)
  });

  function handleNodeClick(station) {
    const line = selectedLine();

    if (ui.mode === 'append' || ui.mode === 'insert') {
      if (!line) return;
      if (line.stations.includes(station.id)) {
        flashBanner('この駅はすでに路線に含まれています。');
        return;
      }
      if (ui.mode === 'append') {
        mutateSelectedLine((l) => lineOps.addStationToLine(l, station.id));
      } else {
        const index = ui.insertIndex;
        mutateSelectedLine((l) => lineOps.insertStationToLine(l, index, station.id));
        finishMode();
      }
      return;
    }

    if (ui.mode === 'pickLoop') {
      if (!line) return;
      const idx = line.stations.indexOf(station.id);
      if (idx === -1) return;
      mutateSelectedLine((l) => lineOps.setLineShape(l, 'racket', idx));
      finishMode();
      return;
    }

    if (!line) return;
    const idx = line.stations.indexOf(station.id);
    if (idx === -1) return;
    selectStationIndex(idx);
  }

  function drawCanvas() {
    canvas.render((world) => {
      network.lines.forEach((line) => {
        if (line.id !== ui.selectedId) drawLinePath(world, line, false);
      });

      network.stations.forEach((station) => {
        const pos = positions.get(station.id);
        if (!pos) return;
        renderStationNode(world, station, pos, { onBodyPointerDown: dragHandler });
      });

      const line = selectedLine();
      if (line) {
        drawLinePath(world, line, true);
        drawStationNumbers(world, line);
        drawDirectionLabels(world, line);
      }
    });
  }

  function lineEdges(line) {
    const stations = line.stations || [];
    const edges = [];
    for (let i = 0; i < stations.length - 1; i++) edges.push({ afterIndex: i, from: i, to: i + 1 });
    if (line.loop && stations.length > 1) edges.push({ afterIndex: stations.length - 1, from: stations.length - 1, to: line.loop.startIndex });
    return edges;
  }

  function drawLinePath(world, line, selected) {
    lineEdges(line).forEach((edge) => {
      const stations = line.stations;
      const p1 = positions.get(stations[edge.from]);
      const p2 = positions.get(stations[edge.to]);
      if (!p1 || !p2) return;

      world.appendChild(s('line', {
        class: 'g-line-path' + (selected ? ' is-selected' : ''),
        x1: p1.x, y1: p1.y, x2: p2.x, y2: p2.y,
        stroke: line.color || MUTED_COLOR
      }));

      const hit = s('line', { class: 'g-line-hit', x1: p1.x, y1: p1.y, x2: p2.x, y2: p2.y });
      hit.addEventListener('pointerdown', (event) => {
        event.stopPropagation();
        if (ui.mode !== 'idle') return;
        if (!selected) { selectLine(line.id); return; }
        startInsertMode(edge.afterIndex);
      });
      world.appendChild(hit);
    });
  }

  function drawStationNumbers(world, line) {
    (line.stations || []).forEach((stationId, index) => {
      const station = stationOf(network, stationId);
      const pos = positions.get(stationId);
      if (!station || !pos) return;
      const rect = nodeRect(station, pos);
      const group = s('g', { class: 'g-line-num-badge', transform: `translate(${rect.x},${rect.y})` });
      group.appendChild(s('circle', { r: 10 }));
      group.appendChild(s('text', { 'text-anchor': 'middle', dy: 4 }, String(index + 1)));
      world.appendChild(group);
    });
  }

  function drawDirectionLabels(world, line) {
    const stations = line.stations || [];
    if (stations.length < 2) return;
    const p1 = positions.get(stations[0]);
    const p2 = positions.get(stations[1]);
    if (!p1 || !p2) return;
    const mid = edgeMidpoint(p1, p2);
    world.appendChild(s('text', { class: 'g-line-dir-label', x: mid.x, y: mid.y - 16, 'text-anchor': 'middle' }, `${line.directions.forward} →`));
    world.appendChild(s('text', { class: 'g-line-dir-label', x: mid.x, y: mid.y + 24, 'text-anchor': 'middle' }, `← ${line.directions.backward}`));
  }

  // 左パネル
  const leftTitle = h('div', { class: 'g-ws-left__title' }, '路線');
  const listEl = h('div', { class: 'g-list g-ws-left__list' });
  const addLineBtn = h('button', {
    type: 'button',
    class: 'g-btn',
    onClick: (event) => openAddLinePopover(event.clientX, event.clientY)
  }, icon('plus'), '路線を追加');

  workspace.left.appendChild(leftTitle);
  workspace.left.appendChild(listEl);
  workspace.left.appendChild(addLineBtn);

  function renderLeftList() {
    clear(listEl);
    network.lines.forEach((line) => {
      listEl.appendChild(h('button', {
        type: 'button',
        class: 'g-list__item' + (ui.selectedId === line.id ? ' is-selected' : ''),
        onClick: () => selectLine(line.id)
      },
        h('div', { class: 'g-svc-row__line1' },
          h('span', { class: 'g-svc-dot', style: `background:${line.color || MUTED_COLOR};` }),
          h('span', {}, line.name)
        ),
        h('div', { class: 'g-svc-row__badges' },
          h('span', { class: 'g-label' }, shapeLabel(line)),
          h('span', { class: 'g-ws-right__note' }, `${(line.stations || []).length} 駅`)
        )
      ));
    });
    addLineBtn.disabled = ui.mode !== 'idle';
  }

  // リボン
  function renderRibbonPanel() {
    const line = selectedLine();
    if (!line || !workspace.ribbonHost) {
      if (workspace.ribbonHost) clear(workspace.ribbonHost);
      return;
    }
    const items = (line.stations || []).map((stationId) => ({ label: stationLabel(network, stationId) }));
    const connectors = [];
    for (let i = 0; i < (line.stations || []).length - 1; i++) {
      connectors.push({ label: '', color: line.color, dashed: false });
    }
    const selected = ui.selectedIndex != null ? { type: 'item', index: ui.selectedIndex } : null;

    renderRibbon(workspace.ribbonHost, {
      items,
      connectors,
      closed: !!line.loop,
      selected,
      onSelect: (type, index) => { if (type === 'item') selectStationIndex(index); },
      onMove: (from, to) => moveStationIndex(from, to)
    });
  }

  function moveStationIndex(from, to) {
    if (ui.selectedIndex === from) ui.selectedIndex = to;
    mutateSelectedLine((l) => lineOps.moveStationInLine(l, from, to));
  }

  // モード（append / insert / pickLoop）
  function startAppendMode() {
    ui.mode = 'append';
    refreshView();
  }

  function startInsertMode(afterIndex) {
    ui.mode = 'insert';
    ui.insertIndex = afterIndex + 1;
    refreshView();
  }

  function startPickLoopMode() {
    ui.mode = 'pickLoop';
    refreshView();
  }

  function finishMode() {
    ui.mode = 'idle';
    ui.insertIndex = null;
    workspace.setBanner(null);
    refreshView();
  }

  function updateModeBanner() {
    if (ui.mode === 'idle') return;
    const line = selectedLine();

    let text;
    if (ui.mode === 'append') {
      text = '路線の最後に加える駅をクリックしてください。終わったら［完了］を押します。';
    } else if (ui.mode === 'insert') {
      const stations = line ? line.stations : [];
      const a = stations[ui.insertIndex - 1];
      const b = stations[ui.insertIndex];
      const nameA = a != null ? stationLabel(network, a) : '';
      const nameB = b != null ? stationLabel(network, b) : '';
      text = nameB ? `${nameA}と${nameB}の間に入れる駅をクリックしてください。` : `${nameA}のあとに入れる駅をクリックしてください。`;
    } else {
      text = '終点の次に戻る駅を、図の中でクリックしてください。';
    }

    const content = h('div', { class: 'g-banner__row' }, h('span', {}, text));
    if (ui.mode === 'append') {
      content.appendChild(h('button', { type: 'button', class: 'g-btn g-btn--small', onClick: () => finishMode() }, '完了'));
    }
    workspace.setBanner(content);
  }

  // 右パネル
  function renderRightPanel() {
    clear(workspace.right);
    const line = selectedLine();
    if (!line) {
      workspace.right.appendChild(h('p', {}, '路線を選んでください。'));
      workspace.right.appendChild(h('p', { class: 'g-ws-right__note' }, '左の一覧から選ぶか、図の路線をクリックしてください。'));
      return;
    }

    if (ui.selectedIndex == null) {
      renderLinePanel(line);
    } else {
      renderStationPanel(line, ui.selectedIndex);
    }
  }

  function renderLinePanel(line) {
    workspace.right.appendChild(h('div', { class: 'g-field' },
      h('span', { class: 'g-field__label' }, '路線ID'),
      h('div', {}, line.id)
    ));

    const nameInput = h('input', { type: 'text', class: 'g-input', value: line.name });
    nameInput.addEventListener('change', async () => {
      const value = nameInput.value.trim();
      if (!value) {
        nameInput.value = line.name;
        await alertDialog('路線名を入力してください。');
        return;
      }
      mutateSelectedLine((l) => lineOps.updateLineFields(l, { name: value }));
    });
    workspace.right.appendChild(h('div', { class: 'g-field' },
      h('label', { class: 'g-field__label' }, '路線名'),
      nameInput
    ));

    const companySelect = h('select', { class: 'g-select' },
      network.companies.map((c) => h('option', { value: c.id, selected: line.companyId === c.id }, c.name))
    );
    companySelect.addEventListener('change', () => {
      mutateSelectedLine((l) => lineOps.updateLineFields(l, { companyId: companySelect.value }));
    });
    workspace.right.appendChild(h('div', { class: 'g-field' },
      h('label', { class: 'g-field__label' }, '会社'),
      companySelect
    ));

    const colorInput = h('input', { type: 'color', class: 'g-input', value: line.color || '#3498db' });
    colorInput.addEventListener('change', () => {
      mutateSelectedLine((l) => lineOps.updateLineFields(l, { color: colorInput.value }));
    });
    workspace.right.appendChild(h('div', { class: 'g-field' },
      h('label', { class: 'g-field__label' }, '色'),
      colorInput
    ));

    const vehicleSelect = h('select', { class: 'g-select' },
      network.vehicleTypes.map((v) => h('option', { value: v.id, selected: line.vehicleTypeId === v.id }, v.name))
    );
    vehicleSelect.addEventListener('change', () => {
      mutateSelectedLine((l) => lineOps.updateLineFields(l, { vehicleTypeId: vehicleSelect.value }));
    });
    workspace.right.appendChild(h('div', { class: 'g-field' },
      h('label', { class: 'g-field__label' }, '車両種別'),
      vehicleSelect
    ));

    workspace.right.appendChild(renderShapeSection(line));
    workspace.right.appendChild(renderDirectionsSection(line));
    workspace.right.appendChild(renderCategoriesSection(line));

    workspace.right.appendChild(h('div', { class: 'g-svc-actions' },
      h('button', {
        type: 'button',
        class: 'g-btn g-btn--primary',
        disabled: ui.mode !== 'idle',
        onClick: () => startAppendMode()
      }, icon('plus'), '駅を末尾に追加')
    ));

    const deleteBtn = h('button', {
      type: 'button',
      class: 'g-btn g-btn--danger',
      onClick: async () => {
        const refs = findReferences(network, operations, { type: 'line', id: line.id });
        if (refs.length > 0) {
          await alertDialog('使われているため削除できません。');
          return;
        }
        const ok = await confirmDialog(`路線「${line.name}」を削除します。`, { confirmLabel: '路線を削除', danger: true });
        if (!ok) return;
        store.mutateDoc('network', (doc) => {
          doc.lines = doc.lines.filter((l) => l.id !== line.id);
        });
        ui.selectedId = null;
        ui.selectedIndex = null;
        refreshView();
      }
    }, icon('trash'), '路線を削除');
    workspace.right.appendChild(deleteBtn);
  }

  function renderShapeSection(line) {
    const shape = shapeOf(line);
    const section = h('div', { class: 'g-field' }, h('span', { class: 'g-field__label' }, '路線の形'));

    const normalBtn = h('button', {
      type: 'button', class: 'g-btn g-toggle-btn', 'aria-pressed': String(shape === 'normal'),
      onClick: () => mutateSelectedLine((l) => lineOps.setLineShape(l, 'normal'))
    }, shapeIconSvg('normal'), '端あり');

    const circularBtn = h('button', {
      type: 'button', class: 'g-btn g-toggle-btn', 'aria-pressed': String(shape === 'circular'),
      onClick: async () => {
        const current = selectedLine();
        if (current.directions.forward === '下り線' && current.directions.backward === '上り線') {
          const change = await confirmDialog('向きの名前を「外回り」「内回り」に変えますか。', { confirmLabel: '変える' });
          if (change) {
            mutateSelectedLine((l) => lineOps.updateLineFields(lineOps.setLineShape(l, 'circular'), { directions: { forward: '外回り', backward: '内回り' } }));
            return;
          }
        }
        mutateSelectedLine((l) => lineOps.setLineShape(l, 'circular'));
      }
    }, shapeIconSvg('circular'), '環状線');

    const racketBtn = h('button', {
      type: 'button', class: 'g-btn g-toggle-btn', 'aria-pressed': String(shape === 'racket'),
      onClick: () => startPickLoopMode()
    }, shapeIconSvg('racket'), 'ラケット型');

    section.appendChild(h('div', { class: 'g-shape-toggle' }, normalBtn, circularBtn, racketBtn));

    if (shape === 'racket' && line.loop) {
      const loopName = stationLabel(network, line.stations[line.loop.startIndex]);
      section.appendChild(h('div', { class: 'g-ws-right__note' },
        `戻る駅: ${loopName}`,
        h('button', { type: 'button', class: 'g-btn g-btn--small', onClick: () => startPickLoopMode() }, '戻る駅を変える')
      ));
    }

    return section;
  }

  function renderDirectionsSection(line) {
    const forwardInput = h('input', { type: 'text', class: 'g-input', value: line.directions.forward });
    forwardInput.addEventListener('change', () => {
      mutateSelectedLine((l) => lineOps.updateLineFields(l, { directions: { forward: forwardInput.value.trim() } }));
    });
    const backwardInput = h('input', { type: 'text', class: 'g-input', value: line.directions.backward });
    backwardInput.addEventListener('change', () => {
      mutateSelectedLine((l) => lineOps.updateLineFields(l, { directions: { backward: backwardInput.value.trim() } }));
    });

    return h('div', {},
      h('div', { class: 'g-field' },
        h('label', { class: 'g-field__label' }, '駅順どおりに進む向きの名前'),
        forwardInput,
        h('div', { class: 'g-field__hint' }, '路線の駅順にそって進むときの呼び方です（例：下り線、外回り）。')
      ),
      h('div', { class: 'g-field' },
        h('label', { class: 'g-field__label' }, '逆向きに進む向きの名前'),
        backwardInput,
        h('div', { class: 'g-field__hint' }, '駅順と逆向きに進むときの呼び方です（例：上り線、内回り）。')
      )
    );
  }

  function renderCategoriesSection(line) {
    const section = h('div', { class: 'g-field' }, h('span', { class: 'g-field__label' }, '種別'));
    const list = h('div', { class: 'g-list' });

    line.categories.forEach((category, index) => {
      if (blockedCategoryId === category.id) {
        const refs = findReferences(network, operations, { type: 'category', lineId: line.id, id: category.id });
        list.appendChild(h('div', { class: 'g-list__row' },
          h('div', { class: 'g-field__error' }, '使われているため削除できません。'),
          renderRefList(refs, requestNavigate),
          h('button', { type: 'button', class: 'g-btn g-btn--small', onClick: () => { blockedCategoryId = null; refreshView(); } }, '閉じる')
        ));
        return;
      }

      const nameInput = h('input', { type: 'text', class: 'g-input', value: category.name });
      nameInput.addEventListener('change', () => {
        mutateSelectedLine((l) => lineOps.renameCategory(l, category.id, nameInput.value.trim()));
      });

      const row = h('div', {
        class: 'g-list__row g-platform-row',
        draggable: true,
        ondragstart: (event) => { event.dataTransfer.setData('text/plain', String(index)); },
        ondragover: (event) => event.preventDefault(),
        ondrop: (event) => {
          event.preventDefault();
          const from = Number(event.dataTransfer.getData('text/plain'));
          if (Number.isNaN(from) || from === index) return;
          mutateSelectedLine((l) => lineOps.moveCategory(l, from, index));
        }
      },
        h('span', { class: 'g-rb-item__grabber', 'aria-hidden': 'true' }, icon('grabber', { size: 12 })),
        nameInput,
        h('span', { class: 'g-list__item-id' }, category.id),
        h('button', {
          type: 'button',
          class: 'g-icon-btn',
          'aria-label': '種別を削除',
          title: '種別を削除',
          onClick: () => {
            if (line.categories.length <= 1) {
              alertDialog('種別は1つ以上必要です。');
              return;
            }
            const refs = findReferences(network, operations, { type: 'category', lineId: line.id, id: category.id });
            if (refs.length > 0) {
              blockedCategoryId = category.id;
              refreshView();
              return;
            }
            mutateSelectedLine((l) => lineOps.removeCategory(l, category.id));
          }
        }, icon('trash'))
      );
      list.appendChild(row);
    });

    section.appendChild(list);
    section.appendChild(renderAddCategoryForm(line));
    return section;
  }

  function renderAddCategoryForm(line) {
    let idDirty = false;
    const errorEl = h('div', { class: 'g-field__error' });

    const idInput = h('input', { type: 'text', class: 'g-input', value: suggestCategoryId('', network, line.categories.map((c) => c.id)) });
    idInput.addEventListener('input', () => { idDirty = true; });

    const nameInput = h('input', { type: 'text', class: 'g-input', placeholder: '種別名' });
    nameInput.addEventListener('input', () => {
      if (idDirty) return;
      idInput.value = suggestCategoryId(nameInput.value.trim(), network, line.categories.map((c) => c.id));
    });

    const submit = () => {
      const id = idInput.value.trim();
      const name = nameInput.value.trim();
      if (!isValidId(id)) { errorEl.textContent = '種別IDの書式が不正です。'; return; }
      if (line.categories.some((c) => c.id === id)) { errorEl.textContent = '同じIDの種別が既にあります。'; return; }
      if (!name) { errorEl.textContent = '種別名を入力してください。'; return; }
      mutateSelectedLine((l) => lineOps.addCategory(l, { id, name }));
    };

    return h('div', { class: 'g-add-platform-form' },
      nameInput,
      h('details', {},
        h('summary', {}, '詳細（IDを変更）'),
        idInput
      ),
      errorEl,
      h('button', { type: 'button', class: 'g-btn', onClick: submit }, icon('plus'), '種別を追加')
    );
  }

  function renderStationPanel(line, index) {
    const stationId = line.stations[index];
    workspace.right.appendChild(h('div', { class: 'g-field__label' }, `${stationLabel(network, stationId)}（${index + 1} 番目）`));

    workspace.right.appendChild(h('div', { class: 'g-svc-actions' },
      h('button', {
        type: 'button',
        class: 'g-btn',
        disabled: index === 0,
        onClick: () => moveStationIndex(index, index - 1)
      }, icon('arrow-left'), '前へ'),
      h('button', {
        type: 'button',
        class: 'g-btn',
        disabled: index === line.stations.length - 1,
        onClick: () => moveStationIndex(index, index + 1)
      }, icon('arrow-right'), '後ろへ'),
      h('button', {
        type: 'button',
        class: 'g-btn g-btn--danger',
        onClick: async () => {
          const affected = lineOps.servicesAffectedByLineStationRemoval(network, line.id, stationId);
          if (affected.length > 0) {
            const names = affected.map((sv) => serviceTitle(network, sv)).join('、');
            const ok = await confirmDialog(`この駅に停まる次の運行系統がエラーになります: ${names}`, { confirmLabel: '路線から外す', danger: true });
            if (!ok) return;
          }
          ui.selectedIndex = null;
          mutateSelectedLine((l) => lineOps.removeStationFromLine(l, index));
        }
      }, icon('trash'), '路線から外す')
    ));
  }

  function openAddLinePopover(clientX, clientY) {
    const idInput = h('input', { type: 'text', class: 'g-input', placeholder: '例: KT-L' });
    const nameInput = h('input', { type: 'text', class: 'g-input' });
    const companySelect = h('select', { class: 'g-select' },
      network.companies.map((c) => h('option', { value: c.id }, c.name))
    );
    const colorInput = h('input', { type: 'color', class: 'g-input', value: '#3498db' });
    const vehicleSelect = h('select', { class: 'g-select' },
      network.vehicleTypes.map((v) => h('option', { value: v.id }, v.name))
    );
    const errorEl = h('div', { class: 'g-field__error' });

    const submit = () => {
      const draft = lineOps.createLine(idInput.value.trim(), nameInput.value.trim(), {
        companyId: companySelect.value,
        vehicleTypeId: vehicleSelect.value
      });
      draft.color = colorInput.value;
      const categoryId = suggestCategoryId('普通', network, []);
      const withCategory = lineOps.addCategory(draft, { id: categoryId, name: '普通' });
      const err = lineOps.validateLineDraft(network, withCategory, true);
      if (err) { errorEl.textContent = err; return; }
      store.mutateDoc('network', (doc) => { doc.lines.push(withCategory); });
      ui.selectedId = withCategory.id;
      ui.selectedIndex = null;
      ui.mode = 'append';
      close();
      refreshView();
    };

    const form = h('div', { class: 'g-popover-form' },
      h('div', { class: 'g-field' },
        h('label', { class: 'g-field__label' }, '路線ID'),
        idInput,
        h('div', { class: 'g-field__hint' }, '英数字・_・- のみ、1〜64文字')
      ),
      h('div', { class: 'g-field' }, h('label', { class: 'g-field__label' }, '路線名'), nameInput),
      h('div', { class: 'g-field' }, h('label', { class: 'g-field__label' }, '会社'), companySelect),
      h('div', { class: 'g-field' }, h('label', { class: 'g-field__label' }, '色'), colorInput),
      h('div', { class: 'g-field' }, h('label', { class: 'g-field__label' }, '車両種別'), vehicleSelect),
      errorEl,
      h('div', { class: 'g-popover-actions' },
        h('button', { type: 'button', class: 'g-btn', onClick: () => close() }, 'キャンセル'),
        h('button', { type: 'button', class: 'g-btn g-btn--primary', onClick: submit }, '路線を作成')
      )
    );

    const close = openPopover(clientX, clientY, form);
  }

  function refreshView() {
    drawCanvas();
    renderLeftList();
    renderRibbonPanel();
    renderRightPanel();
    updateModeBanner();
  }

  function onKeyDown(event) {
    const tag = document.activeElement && document.activeElement.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
    if (document.querySelector('.g-dialog-backdrop')) return;

    if (event.key === 'Escape') {
      if (ui.mode !== 'idle') {
        finishMode();
      } else if (ui.selectedIndex != null) {
        selectStationIndex(null);
      } else if (ui.selectedId) {
        selectLine(null);
      }
    }
  }
  window.addEventListener('keydown', onKeyDown);

  refreshView();

  const { fitAll } = attachCanvasToolbar(workspace, canvas, {
    getBounds: () => boundsOf([...positions.values()])
  });
  if (!canvas.hasSavedViewport) fitAll();

  if (focus && focus.id) {
    ui.selectedId = focus.id;
    ui.selectedIndex = null;
    refreshView();
  }

  maybeOpenGuideOnce(GUIDE_STEPS.lines, 'rewis_editor_graph_guide_lines');

  return {
    destroy() {
      window.removeEventListener('keydown', onKeyDown);
      if (bannerTimer) clearTimeout(bannerTimer);
      canvas.destroy();
    }
  };
}

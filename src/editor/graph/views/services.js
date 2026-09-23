import { createWorkspace } from '../canvas/workspace.js';
import { createCanvas } from '../canvas/canvas.js';
import { createNodeDragHandler } from '../canvas/node-drag.js';
import { renderStationNode } from '../canvas/station-node.js';
import { renderRibbon } from '../canvas/ribbon.js';
import { attachCanvasToolbar } from '../canvas/canvas-tab-base.js';
import { graphUi } from '../canvas/ui-state.js';
import { resolvePositions, setLayout } from '../../core/auto-layout.js';
import { boundsOf, portPoint } from '../../core/graph-geometry.js';
import * as serviceOps from '../../core/service-ops.js';
import * as stationOps from '../../core/station-ops.js';
import { matchesServiceFilter } from '../../core/service-filter.js';
import { suggestPlatformId } from '../../core/id-suggest.js';
import { serviceTitle, describeIssueLocation, issueTargetsForService } from '../../core/issue-location.js';
import { summarizeSections, totalRun, reverseService, stationName, categoryName } from '../../core/service-sections.js';
import { h, s, clear, icon } from '../../common/dom.js';
import { alertDialog, confirmDialog } from '../../common/components/dialog.js';
import { openPopover } from '../../common/components/overlay.js';
import { maybeOpenGuideOnce } from '../components/guide.js';
import { GUIDE_STEPS } from '../guide-steps.js';
import { stationOf, lineOf } from '../../core/lookup.js';

const MUTED_COLOR = '#999999';

function firstSectionColor(network, service) {
  const section = (service.sections || [])[0];
  if (!section) return MUTED_COLOR;
  const line = lineOf(network, section.lineId);
  return (line && line.color) || MUTED_COLOR;
}

function formatSeconds(totalSeconds) {
  const m = Math.floor(totalSeconds / 60);
  const sVal = totalSeconds % 60;
  return `${m}分${sVal}秒`;
}

function platformLabelOf(station, platformId) {
  if (!station || platformId == null) return 'のりば指定なし';
  const platform = (station.platforms || []).find((p) => p.id === platformId);
  return platform ? platform.label : platformId;
}

function relevantStationIds(network, service) {
  const ids = new Set((service.stops || []).map((st) => st.stationId));
  const lineIds = new Set((service.sections || []).map((sec) => sec.lineId).filter(Boolean));
  (network.lines || []).forEach((line) => {
    if (lineIds.has(line.id)) (line.stations || []).forEach((id) => ids.add(id));
  });
  return ids;
}

function boundaryStopIndices(service, segments) {
  const result = new Set();
  if (service.circular) return result;
  for (let i = 1; i < (service.stops || []).length - 1; i++) {
    const before = segments[i - 1];
    const after = segments[i];
    if (before && after && before.lineId !== after.lineId) result.add(i);
  }
  return result;
}

function issueSubFromPath(service, path) {
  if (!path) return null;
  const stopMatch = path.match(/^services\[\d+\]\.stops\[(\d+)\]/);
  if (stopMatch) return { type: 'stop', index: Number(stopMatch[1]) };
  const sectionMatch = path.match(/^services\[\d+\]\.sections\[(\d+)\]/);
  if (sectionMatch) {
    const section = (service.sections || [])[Number(sectionMatch[1])];
    if (section) {
      const rangeEnd = section.to - 1 > section.from ? section.to - 1 : undefined;
      return { type: 'edge', index: section.from, rangeEnd };
    }
  }
  return null;
}

export function renderServicesView(container, ctx) {
  const { store, focus } = ctx;
  const network = store.state.docs.network;
  const ui = graphUi.services;

  if (ui.selectedId && !network.services.some((sv) => sv.id === ui.selectedId)) {
    ui.selectedId = null;
    ui.sel = null;
  }

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
    if (duration > 0) bannerTimer = setTimeout(() => workspace.setBanner(null), duration);
  }

  function selectedService() {
    return network.services.find((sv) => sv.id === ui.selectedId) || null;
  }

  // キャンバスに描く対象。新しい系統を作成中（1停車駅だけの draft）のときは draft を描く。
  function canvasService() {
    return ui.draft || selectedService();
  }

  // 選択中の運行系統を1回の mutateDoc で書き換える。fn(doc, service) は新しい service を返す。
  function mutateSelectedService(fn) {
    const id = ui.selectedId;
    if (!id) return;
    store.mutateDoc('network', (doc) => {
      const idx = doc.services.findIndex((sv) => sv.id === id);
      if (idx === -1) return;
      doc.services[idx] = fn(doc, doc.services[idx], idx);
    });
    refreshView();
  }

  function selectService(id) {
    ui.selectedId = id;
    ui.sel = null;
    refreshView();
  }

  function setSel(sel) {
    ui.sel = sel;
    refreshView();
  }

  const canvas = createCanvas(workspace.canvasHost, {
    viewportKey: 'services',
    onBackgroundClick: () => setSel(null)
  });

  const dragHandler = createNodeDragHandler(canvas, positions, {
    onChange: () => drawCanvas(),
    onCommit: (id, pos) => store.mutateDoc('network', (doc) => setLayout(doc, id, pos)),
    onClick: (station, event) => handleNodeBodyClick(station, event)
  });

  function handleNodeBodyClick(station, event) {
    if (ui.mode !== 'idle') {
      openPlatformChoicePopover(station, event.clientX, event.clientY);
      return;
    }
    handleNodeClick(station, null);
  }

  function handlePortClick(station, platformId) {
    if (ui.mode !== 'idle') {
      addStopAtPlatform(station, platformId);
      return;
    }
    handleNodeClick(station, platformId);
  }

  function handleNodeClick(station, platformId) {
    const service = selectedService();
    if (service && ui.sel && ui.sel.type === 'stop') {
      const stop = service.stops[ui.sel.index];
      if (stop && stop.stationId === station.id) {
        const index = ui.sel.index;
        mutateSelectedService((doc, sv) => serviceOps.setStopPlatform(sv, index, platformId));
        return;
      }
    }
    flashBanner('駅を加えるときは［駅を末尾に追加］を押してください。');
  }

  function drawCanvas() {
    canvas.render((world) => {
      const service = canvasService();
      const relevant = service ? relevantStationIds(network, service) : null;

      // 1. 選択していない運行系統の路線
      if (!service) {
        network.services.forEach((sv) => drawRouteLines(world, sv));
      } else {
        network.services.forEach((sv) => {
          if (sv.id !== service.id) drawRouteLines(world, sv);
        });
      }

      // 2. 駅ノード
      network.stations.forEach((station) => {
        const pos = positions.get(station.id);
        if (!pos) return;
        const dimmed = !!relevant && !relevant.has(station.id);
        const highlightPorts = highlightPortsFor(service, station);
        renderStationNode(world, station, pos, {
          selected: false,
          dimmed,
          highlightPorts,
          onBodyPointerDown: dragHandler,
          onPortPointerDown: (event, st, platformId) => handlePortClick(st, platformId)
        });
      });

      // 3〜5. 選択中の系統の駅間・停車番号
      if (service) drawSelectedService(world, service);
    });
  }

  function highlightPortsFor(service, station) {
    if (!service || !ui.sel || ui.sel.type !== 'stop') return null;
    const stop = service.stops[ui.sel.index];
    if (!stop || stop.stationId !== station.id) return null;
    return new Set((station.platforms || []).map((p) => p.id));
  }

  function drawRouteLines(world, service) {
    const segments = serviceOps.segmentsOf(service);
    const stops = service.stops || [];
    for (let i = 0; i < stops.length - 1; i++) {
      drawRouteSegment(world, service, stops[i], stops[i + 1], segments[i]);
    }
    if (service.circular && stops.length > 1) {
      drawRouteSegment(world, service, stops[stops.length - 1], stops[0], segments[0]);
    }
  }

  function drawRouteSegment(world, service, fromStop, toStop, segment) {
    const fromStation = stationOf(network, fromStop.stationId);
    const toStation = stationOf(network, toStop.stationId);
    const fromPos = positions.get(fromStop.stationId);
    const toPos = positions.get(toStop.stationId);
    if (!fromStation || !toStation || !fromPos || !toPos) return;
    const p1 = portPoint(fromStation, fromPos, fromStop.platformId);
    const p2 = portPoint(toStation, toPos, toStop.platformId);
    const color = (segment && lineOf(network, segment.lineId) && lineOf(network, segment.lineId).color) || MUTED_COLOR;

    world.appendChild(s('line', {
      class: 'g-route-line',
      x1: p1.x, y1: p1.y, x2: p2.x, y2: p2.y,
      stroke: color
    }));
    const hit = s('line', {
      class: 'g-route-hit',
      x1: p1.x, y1: p1.y, x2: p2.x, y2: p2.y
    });
    hit.addEventListener('pointerdown', () => { if (ui.mode === 'idle') selectService(service.id); });
    world.appendChild(hit);
  }

  function isEdgeSelected(service, index) {
    if (!ui.sel || ui.sel.type !== 'edge') return false;
    if (service.circular) return true;
    const end = ui.sel.rangeEnd ?? ui.sel.index;
    return index >= ui.sel.index && index <= end;
  }

  function drawSelectedService(world, service) {
    const stops = service.stops || [];
    const segments = serviceOps.segmentsOf(service);
    const boundaries = boundaryStopIndices(service, segments);
    const validation = store.state.validation.network;
    const issueTargets = issueTargetsForService(validation, network.services.indexOf(service), service);

    const edges = [];
    for (let i = 0; i < stops.length - 1; i++) edges.push({ index: i, from: i, to: i + 1, seg: segments[i] });
    if (service.circular && stops.length > 1) edges.push({ index: stops.length - 1, from: stops.length - 1, to: 0, seg: segments[0] || null });

    edges.forEach((edge) => {
      const fromStop = stops[edge.from];
      const toStop = stops[edge.to];
      const fromStation = stationOf(network, fromStop.stationId);
      const toStation = stationOf(network, toStop.stationId);
      const fromPos = positions.get(fromStop.stationId);
      const toPos = positions.get(toStop.stationId);
      if (!fromStation || !toStation || !fromPos || !toPos) return;
      const p1 = portPoint(fromStation, fromPos, fromStop.platformId);
      const p2 = portPoint(toStation, toPos, toStop.platformId);
      const unresolved = !edge.seg || !edge.seg.lineId;
      const color = unresolved ? null : (lineOf(network, edge.seg.lineId) || {}).color;
      const level = issueTargets.edges[edge.index] || null;

      if (isEdgeSelected(service, edge.index)) {
        world.appendChild(s('line', {
          class: 'g-edge-underlay',
          x1: p1.x, y1: p1.y, x2: p2.x, y2: p2.y
        }));
      }

      const edgeLine = s('line', {
        class: 'g-edge' + (unresolved ? ' g-edge--unresolved' : '') + (level ? ` is-${level}` : ''),
        x1: p1.x, y1: p1.y, x2: p2.x, y2: p2.y,
        stroke: unresolved ? null : color
      });
      world.appendChild(edgeLine);
      const selectEdge = (event) => {
        event.stopPropagation();
        if (event.shiftKey && ui.sel && ui.sel.type === 'edge' && !service.circular) {
          setSel({ type: 'edge', index: ui.sel.index, rangeEnd: edge.index });
        } else {
          setSel({ type: 'edge', index: edge.index });
        }
      };
      const hit = s('line', { class: 'g-edge-hit', x1: p1.x, y1: p1.y, x2: p2.x, y2: p2.y });
      hit.addEventListener('pointerdown', selectEdge);
      world.appendChild(hit);

      const mid = { x: (p1.x + p2.x) / 2, y: (p1.y + p2.y) / 2 };
      const run = Number.isFinite(fromStop.run) ? fromStop.run : null;
      const labelGroup = s('g', { class: 'g-edge-label', transform: `translate(${mid.x},${mid.y})` });
      labelGroup.addEventListener('pointerdown', selectEdge);
      labelGroup.appendChild(s('rect', { x: -22, y: -11, width: 44, height: 22, rx: 4 }));
      labelGroup.appendChild(s('text', { 'text-anchor': 'middle', dy: 4 }, run == null ? '?' : `${run}秒`));
      world.appendChild(labelGroup);

      // 進む向きの三角形（60%地点）
      const tx = p1.x + (p2.x - p1.x) * 0.6;
      const ty = p1.y + (p2.y - p1.y) * 0.6;
      const angle = Math.atan2(p2.y - p1.y, p2.x - p1.x) * 180 / Math.PI;
      world.appendChild(s('polygon', {
        class: 'g-edge-arrow' + (unresolved ? ' g-edge-arrow--unresolved' : ''),
        points: '-5,-4 5,0 -5,4',
        transform: `translate(${tx},${ty}) rotate(${angle})`,
        fill: unresolved ? null : color
      }));
    });

    // 直通の境界駅
    boundaries.forEach((i) => {
      const stop = stops[i];
      const station = stationOf(network, stop.stationId);
      const pos = positions.get(stop.stationId);
      if (!station || !pos) return;
      const badge = s('g', { class: 'g-boundary-badge', transform: `translate(${pos.x},${pos.y - 42})` });
      badge.appendChild(s('rect', { x: -20, y: -10, width: 40, height: 20, rx: 10 }));
      badge.appendChild(s('text', { 'text-anchor': 'middle', dy: 4 }, '直通'));
      world.appendChild(badge);
    });

    // 停車の番号
    const seen = new Map();
    stops.forEach((stop, i) => {
      const station = stationOf(network, stop.stationId);
      const pos = positions.get(stop.stationId);
      if (!station || !pos) return;
      const point = portPoint(station, pos, stop.platformId);
      const key = `${stop.stationId}|${stop.platformId}`;
      const occurrence = seen.get(key) || 0;
      seen.set(key, occurrence + 1);
      const cx = point.x + 10 + occurrence * 18;
      const cy = point.y - 14;

      const selectedStop = ui.sel && ui.sel.type === 'stop' && ui.sel.index === i;
      const level = issueTargets.stops[i] || null;
      let cls = 'g-stop-badge';
      if (selectedStop) cls += ' is-selected';
      if (level) cls += ` is-${level}`;

      const group = s('g', { class: cls, transform: `translate(${cx},${cy})` });
      group.appendChild(s('circle', { r: 10 }));
      group.appendChild(s('text', { 'text-anchor': 'middle', dy: 4 }, String(i + 1)));
      group.addEventListener('pointerdown', (event) => {
        event.stopPropagation();
        setSel({ type: 'stop', index: i });
      });
      world.appendChild(group);

      let flagY = cy + 16;
      if (stop.board === false) {
        world.appendChild(s('text', { class: 'g-stop-flag', x: cx, y: flagY, 'text-anchor': 'middle' }, '降車のみ'));
        flagY += 12;
      }
      if (stop.alight === false) {
        world.appendChild(s('text', { class: 'g-stop-flag', x: cx, y: flagY, 'text-anchor': 'middle' }, '乗車のみ'));
      }
    });
  }

  // 左パネル
  const leftTitle = h('div', { class: 'g-ws-left__title' }, '運行系統');

  const lineSelect = h('select', { class: 'g-select' },
    h('option', { value: '' }, '全路線'),
    network.lines.map((line) => h('option', { value: line.id, selected: ui.filterLineId === line.id }, line.name))
  );
  const categorySelect = h('select', { class: 'g-select', disabled: !ui.filterLineId },
    h('option', { value: '' }, '全種別')
  );

  function renderCategoryOptions() {
    clear(categorySelect);
    categorySelect.appendChild(h('option', { value: '' }, '全種別'));
    categorySelect.disabled = !ui.filterLineId;
    if (!ui.filterLineId) return;
    const line = lineOf(network, ui.filterLineId);
    (line ? line.categories || [] : []).forEach((cat) => {
      categorySelect.appendChild(h('option', { value: cat.id, selected: ui.filterCategoryId === cat.id }, cat.name));
    });
  }
  renderCategoryOptions();

  lineSelect.addEventListener('change', () => {
    ui.filterLineId = lineSelect.value;
    ui.filterCategoryId = '';
    renderCategoryOptions();
    renderLeftList();
  });
  categorySelect.addEventListener('change', () => {
    ui.filterCategoryId = categorySelect.value;
    renderLeftList();
  });

  const filterRow = h('div', { class: 'g-svc-filter' },
    h('div', { class: 'g-field' }, h('label', { class: 'g-field__label' }, '路線'), lineSelect),
    h('div', { class: 'g-field' }, h('label', { class: 'g-field__label' }, '種別'), categorySelect)
  );

  const listEl = h('div', { class: 'g-list g-ws-left__list' });
  const addServiceBtn = h('button', {
    type: 'button',
    class: 'g-btn',
    onClick: () => startNewServiceMode()
  }, icon('plus'), '運行系統を追加');

  workspace.left.appendChild(leftTitle);
  workspace.left.appendChild(filterRow);
  workspace.left.appendChild(listEl);
  workspace.left.appendChild(addServiceBtn);

  function renderLeftList() {
    clear(listEl);
    const validation = store.state.validation.network;
    network.services
      .filter((sv) => matchesServiceFilter(sv, { lineId: ui.filterLineId, categoryId: ui.filterCategoryId }))
      .forEach((sv) => {
        const idx = network.services.indexOf(sv);
        const issues = issueTargetsForService(validation, idx, sv);
        const errorCount = Object.values(issues.stops).filter((l) => l === 'error').length
          + Object.values(issues.edges).filter((l) => l === 'error').length
          + (issues.service === 'error' ? 1 : 0);
        const warnCount = Object.values(issues.stops).filter((l) => l === 'warning').length
          + Object.values(issues.edges).filter((l) => l === 'warning').length
          + (issues.service === 'warning' ? 1 : 0);

        const row = h('button', {
          type: 'button',
          class: 'g-list__item' + (ui.selectedId === sv.id ? ' is-selected' : ''),
          onClick: () => selectService(sv.id)
        },
          h('div', { class: 'g-svc-row__line1' },
            h('span', { class: 'g-svc-dot', style: `background:${firstSectionColor(network, sv)};` }),
            h('span', {}, serviceTitle(network, sv))
          ),
          h('div', { class: 'g-svc-row__line2' }, summarizeSections(network, sv.sections || [])),
          h('div', { class: 'g-svc-row__badges' },
            sv.active === false ? h('span', { class: 'g-label' }, icon('eye-closed', { size: 12 }), '運休中') : null,
            errorCount > 0 ? h('span', { class: 'g-label g-label--danger' }, `エラー ${errorCount}`) : null,
            warnCount > 0 ? h('span', { class: 'g-label g-label--attention' }, `注意 ${warnCount}`) : null
          )
        );
        listEl.appendChild(row);
      });
    addServiceBtn.disabled = ui.mode !== 'idle';
  }

  // リボン
  function renderRibbonPanel() {
    const service = selectedService();
    if (!service || !workspace.ribbonHost) {
      if (workspace.ribbonHost) clear(workspace.ribbonHost);
      return;
    }
    const validation = store.state.validation.network;
    const idx = network.services.indexOf(service);
    const issueTargets = issueTargetsForService(validation, idx, service);
    const segments = serviceOps.segmentsOf(service);
    const boundaries = boundaryStopIndices(service, segments);

    const items = service.stops.map((stop, i) => {
      const station = stationOf(network, stop.stationId);
      const badges = [];
      if (boundaries.has(i)) badges.push({ text: '直通', variant: 'accent' });
      if (stop.board === false) badges.push({ text: '降車のみ' });
      if (stop.alight === false) badges.push({ text: '乗車のみ' });
      return {
        label: station ? station.name : stop.stationId,
        sublabel: platformLabelOf(station, stop.platformId),
        badges,
        level: issueTargets.stops[i] || null
      };
    });

    const connectors = [];
    for (let i = 0; i < service.stops.length - 1; i++) {
      const seg = segments[i];
      const line = seg && lineOf(network, seg.lineId);
      connectors.push({
        label: Number.isFinite(service.stops[i].run) ? `${service.stops[i].run}秒` : '?',
        color: line ? line.color : null,
        dashed: !seg || !seg.lineId,
        level: issueTargets.edges[i] || null
      });
    }

    let selected = null;
    if (ui.sel && ui.sel.type === 'stop') selected = { type: 'item', index: ui.sel.index };
    if (ui.sel && ui.sel.type === 'edge') selected = { type: 'connector', index: ui.sel.index, rangeEnd: ui.sel.rangeEnd };

    renderRibbon(workspace.ribbonHost, {
      items,
      connectors,
      closed: !!service.circular,
      selected,
      onSelect: (type, index, { shiftKey }) => {
        if (type === 'item') setSel({ type: 'stop', index });
        else if (shiftKey && ui.sel && ui.sel.type === 'edge' && !service.circular) {
          setSel({ type: 'edge', index: ui.sel.index, rangeEnd: index });
        } else {
          setSel({ type: 'edge', index });
        }
      },
      onMove: (from, to) => moveStop(from, to)
    });
  }

  function moveStop(from, to) {
    if (ui.sel && ui.sel.type === 'stop' && ui.sel.index === from) {
      ui.sel = { type: 'stop', index: to };
    }
    mutateSelectedService((doc, sv) => serviceOps.moveStop(doc, sv, from, to));
  }

  // 12.4 停車駅の追加・新しい系統の作成

  function startAppendMode() {
    ui.mode = 'append';
    ui.sel = null;
    refreshView();
  }

  function startNewServiceMode() {
    ui.mode = 'append';
    ui.draft = serviceOps.createEmptyService();
    ui.selectedId = null;
    ui.sel = null;
    refreshView();
  }

  function startInsertMode(edgeIndex) {
    ui.mode = 'insert';
    ui.insertIndex = edgeIndex + 1;
    ui.sel = null;
    refreshView();
  }

  function finishMode() {
    if (ui.draft && ui.draft.stops.length < 2) {
      ui.draft = null;
    }
    ui.mode = 'idle';
    ui.insertIndex = null;
    workspace.setBanner(null);
    refreshView();
  }

  function updateModeBanner() {
    if (ui.mode === 'idle') return;

    let text;
    if (ui.draft) {
      text = '始発駅ののりばをクリックしてください。';
    } else if (ui.mode === 'insert') {
      const service = selectedService();
      const stops = service ? service.stops : [];
      const a = stops[ui.insertIndex - 1];
      const b = stops[ui.insertIndex];
      const nameA = a ? stationName(network, a.stationId) : '';
      const nameB = b ? stationName(network, b.stationId) : '';
      text = `${nameA}と${nameB}の間に停まる駅ののりばをクリックしてください。`;
    } else {
      text = '次に停まる駅ののりばをクリックしてください。終わったら［完了］を押すか Esc を押します。';
    }

    const content = h('div', { class: 'g-banner__row' }, h('span', {}, text));
    if (ui.mode === 'append') {
      content.appendChild(h('button', { type: 'button', class: 'g-btn g-btn--small', onClick: () => finishMode() }, '完了'));
    }
    workspace.setBanner(content);
  }

  // 停車駅を追加する（駅間のクリック・のりば選択ポップオーバーの共通処理）
  async function addStopAtPlatform(station, platformId) {
    const stop = { stationId: station.id, platformId };
    if (ui.mode === 'insert') {
      const index = ui.insertIndex;
      mutateSelectedService((doc, sv) => serviceOps.insertStop(doc, sv, index, stop));
      ui.mode = 'idle';
      ui.insertIndex = null;
      workspace.setBanner(null);
      setSel({ type: 'stop', index });
      return;
    }
    if (ui.mode !== 'append') return;
    if (ui.draft) {
      addStopToDraft(stop);
      return;
    }
    const service = selectedService();
    if (!service) return;
    await appendStopWithCircularCheck(service, stop);
  }

  async function appendStopWithCircularCheck(service, stop) {
    const stops = service.stops;
    if (!service.circular && stops.length >= 3) {
      const first = stops[0];
      if (first.stationId === stop.stationId && (first.platformId ?? null) === (stop.platformId ?? null)) {
        const ok = await confirmDialog(
          '始発駅に戻る環状運転にしますか。環状運転では、すべての駅間が同じ路線・種別になり、行先は表示されません。',
          { confirmLabel: '環状運転にする' }
        );
        if (ok) {
          mutateSelectedService((doc, sv) => serviceOps.setCircular(doc, sv, true));
          finishMode();
          return;
        }
      }
    }
    mutateSelectedService((doc, sv) => serviceOps.appendStop(doc, sv, stop));
  }

  function addStopToDraft(stop) {
    ui.draft = serviceOps.appendStop(network, ui.draft, stop);
    if (ui.draft.stops.length >= 2) {
      const created = ui.draft;
      store.mutateDoc('network', (doc) => { doc.services.push(created); });
      ui.selectedId = created.id;
      ui.draft = null;
    }
    refreshView();
  }

  function openPlatformChoicePopover(station, clientX, clientY) {
    const content = h('div', { class: 'g-popover-form' });

    if ((station.platforms || []).length > 0) {
      station.platforms.forEach((platform) => {
        content.appendChild(h('button', {
          type: 'button',
          class: 'g-btn',
          onClick: () => { close(); addStopAtPlatform(station, platform.id); }
        }, `${platform.label} 番のりば`));
      });
      content.appendChild(h('button', {
        type: 'button',
        class: 'g-btn',
        onClick: () => { close(); addStopAtPlatform(station, null); }
      }, 'のりば指定なし'));
    } else {
      content.appendChild(h('p', {}, 'この駅にはのりばが登録されていません。'));
      const labelInput = h('input', { type: 'text', class: 'g-input', placeholder: 'のりばの名前' });
      content.appendChild(labelInput);
      content.appendChild(h('div', { class: 'g-popover-actions' },
        h('button', {
          type: 'button',
          class: 'g-btn',
          onClick: () => { close(); addPlatformAndStop(station, labelInput.value.trim()); }
        }, 'のりばを追加して停車'),
        h('button', {
          type: 'button',
          class: 'g-btn',
          onClick: () => { close(); addStopAtPlatform(station, null); }
        }, 'のりば指定なしで停車')
      ));
    }

    const close = openPopover(clientX, clientY, content);
  }

  function addPlatformAndStop(station, label) {
    const existingIds = station.platforms.map((p) => p.id);
    const platformId = suggestPlatformId(label, existingIds);
    const platform = { id: platformId, label: label || platformId };

    if (ui.draft) {
      store.mutateDoc('network', (doc) => {
        const idx = doc.stations.findIndex((st) => st.id === station.id);
        if (idx === -1) return;
        doc.stations[idx] = stationOps.addPlatform(doc.stations[idx], platform);
      });
      addStopToDraft({ stationId: station.id, platformId: platform.id });
      return;
    }

    const isInsert = ui.mode === 'insert';
    const insertIndex = ui.insertIndex;
    const serviceId = ui.selectedId;
    store.mutateDoc('network', (doc) => {
      const stIdx = doc.stations.findIndex((st) => st.id === station.id);
      if (stIdx === -1) return;
      doc.stations[stIdx] = stationOps.addPlatform(doc.stations[stIdx], platform);
      const svIdx = doc.services.findIndex((sv) => sv.id === serviceId);
      if (svIdx === -1) return;
      const stopArg = { stationId: station.id, platformId: platform.id };
      doc.services[svIdx] = isInsert
        ? serviceOps.insertStop(doc, doc.services[svIdx], insertIndex, stopArg)
        : serviceOps.appendStop(doc, doc.services[svIdx], stopArg);
    });

    if (isInsert) {
      ui.mode = 'idle';
      ui.insertIndex = null;
      workspace.setBanner(null);
      setSel({ type: 'stop', index: insertIndex });
    } else {
      refreshView();
    }
  }

  // 右パネル
  function renderRightPanel() {
    clear(workspace.right);
    const service = selectedService();
    if (!service) {
      workspace.right.appendChild(h('p', {}, '運行系統を選んでください。'));
      workspace.right.appendChild(h('p', { class: 'g-ws-right__note' }, '左の一覧から選ぶか、図の路線をクリックしてください。'));
      return;
    }

    if (!ui.sel) {
      renderServicePanel(service);
    } else if (ui.sel.type === 'stop') {
      renderStopPanel(service, ui.sel.index);
    } else if (ui.sel.type === 'edge') {
      renderEdgePanel(service, ui.sel.index, ui.sel.rangeEnd);
    }
  }

  function renderServicePanel(service) {
    const headsignInput = h('input', { type: 'text', class: 'g-input', value: service.headsign || '', disabled: !!service.circular });
    headsignInput.addEventListener('change', () => {
      mutateSelectedService((doc, sv) => serviceOps.updateServiceFields(sv, { headsign: headsignInput.value }));
    });
    const terminusBtn = h('button', {
      type: 'button',
      class: 'g-btn g-btn--small',
      disabled: !!service.circular,
      onClick: () => {
        const terminus = stationName(network, service.stops[service.stops.length - 1].stationId);
        mutateSelectedService((doc, sv) => serviceOps.updateServiceFields(sv, { headsign: terminus }));
      }
    }, '終点の駅名にする');
    workspace.right.appendChild(h('div', { class: 'g-field' },
      h('label', { class: 'g-field__label' }, '行先'),
      h('div', { class: 'g-svc-headsign-row' }, headsignInput, terminusBtn),
      service.circular ? h('div', { class: 'g-field__hint' }, '環状運転では行先を表示しません。') : null
    ));

    const nameInput = h('input', { type: 'text', class: 'g-input', value: service.name || '' });
    nameInput.addEventListener('change', () => {
      mutateSelectedService((doc, sv) => serviceOps.updateServiceFields(sv, { name: nameInput.value }));
    });
    workspace.right.appendChild(h('div', { class: 'g-field' },
      h('label', { class: 'g-field__label' }, 'メモ（任意）'),
      nameInput
    ));

    const activeInput = h('input', { type: 'checkbox', checked: service.active !== false });
    activeInput.addEventListener('change', () => {
      mutateSelectedService((doc, sv) => serviceOps.updateServiceFields(sv, { active: activeInput.checked }));
    });
    workspace.right.appendChild(h('div', { class: 'g-checkbox' }, activeInput, h('span', {}, '運行中')));

    const circularInput = h('input', { type: 'checkbox', checked: !!service.circular });
    circularInput.addEventListener('change', async () => {
      if (circularInput.checked) {
        const ok = await confirmDialog('すべての駅間が、1つ目の駅間と同じ路線・種別になります。', { confirmLabel: '環状運転にする' });
        if (!ok) { circularInput.checked = false; return; }
        mutateSelectedService((doc, sv) => serviceOps.setCircular(doc, sv, true));
      } else {
        mutateSelectedService((doc, sv) => serviceOps.setCircular(doc, sv, false));
      }
    });
    workspace.right.appendChild(h('div', { class: 'g-checkbox' }, circularInput, h('span', {}, '環状運転')));

    workspace.right.appendChild(h('p', {}, `${service.stops.length} 駅・${formatSeconds(totalRun(service))}`));
    workspace.right.appendChild(h('p', { class: 'g-ws-right__note' }, summarizeSections(network, service.sections || [])));

    workspace.right.appendChild(h('div', { class: 'g-svc-actions' },
      h('button', {
        type: 'button',
        class: 'g-btn g-btn--primary',
        disabled: ui.mode !== 'idle',
        onClick: () => startAppendMode()
      }, icon('plus'), '駅を末尾に追加'),
      h('button', {
        type: 'button',
        class: 'g-btn',
        onClick: () => {
          const copy = serviceOps.duplicateService(service);
          store.mutateDoc('network', (doc) => { doc.services.push(copy); });
          ui.selectedId = copy.id;
          ui.sel = null;
          refreshView();
        }
      }, icon('copy'), '複製'),
      h('button', {
        type: 'button',
        class: 'g-btn',
        onClick: () => {
          const reversed = reverseService(network, service);
          store.mutateDoc('network', (doc) => { doc.services.push(reversed); });
          ui.selectedId = reversed.id;
          ui.sel = null;
          refreshView();
          flashBanner('逆方向の運行系統を作りました。のりばを確認してください。', 'attention', 6000);
        }
      }, icon('arrow-both'), '逆方向を作成'),
      h('button', {
        type: 'button',
        class: 'g-btn g-btn--danger',
        onClick: async () => {
          const ok = await confirmDialog(`運行系統「${serviceTitle(network, service)}」を削除します。`, { confirmLabel: '運行系統を削除', danger: true });
          if (!ok) return;
          store.mutateDoc('network', (doc) => {
            doc.services = doc.services.filter((sv) => sv.id !== service.id);
          });
          ui.selectedId = null;
          ui.sel = null;
          refreshView();
        }
      }, icon('trash'), '運行系統を削除')
    ));

    const validation = store.state.validation.network;
    const idx = network.services.indexOf(service);
    const list = [...validation.errors, ...validation.warnings]
      .filter((issueObj) => issueObj.path === `services[${idx}]` || (issueObj.path || '').startsWith(`services[${idx}].`));
    if (list.length > 0) {
      const issueList = h('div', { class: 'g-list' });
      list.forEach((issueObj) => {
        const isError = validation.errors.includes(issueObj);
        issueList.appendChild(h('button', {
          type: 'button',
          class: 'g-list__item',
          onClick: () => {
            const sub = issueSubFromPath(service, issueObj.path);
            if (sub) setSel(sub);
          }
        },
          h('span', {}, icon(isError ? 'x-circle-fill' : 'alert-fill', { size: 12 })),
          h('span', {}, issueObj.message),
          h('div', { class: 'g-ws-right__note' }, describeIssueLocation('network', issueObj, store.state.docs))
        ));
      });
      workspace.right.appendChild(issueList);
    }
  }

  function renderRunField(labelText, currentRun, onApply) {
    const errorEl = h('div', { class: 'g-field__error' });
    const input = h('input', { type: 'number', class: 'g-input', value: Number.isFinite(currentRun) ? currentRun : '' });
    input.addEventListener('change', () => {
      const value = input.value.trim();
      const num = Number(value);
      if (value === '' || !Number.isInteger(num) || num < 0) {
        input.classList.add('is-invalid');
        errorEl.textContent = '0以上の整数を入力してください。';
        return;
      }
      input.classList.remove('is-invalid');
      errorEl.textContent = '';
      onApply(num);
    });
    return h('div', { class: 'g-field' },
      h('label', { class: 'g-field__label' }, labelText),
      input,
      errorEl
    );
  }

  function renderStopPanel(service, index) {
    const stop = service.stops[index];
    const station = stationOf(network, stop.stationId);
    const isLast = index === service.stops.length - 1;
    const needsRun = !isLast || service.circular;

    workspace.right.appendChild(h('div', { class: 'g-field__label' }, `${index + 1} 番目の停車駅`));
    workspace.right.appendChild(h('p', {}, station ? station.name : stop.stationId));

    const platformSelect = h('select', { class: 'g-select' },
      h('option', { value: '', selected: stop.platformId == null }, 'のりば指定なし'),
      (station ? station.platforms || [] : []).map((p) => h('option', { value: p.id, selected: stop.platformId === p.id }, p.label))
    );
    platformSelect.addEventListener('change', () => {
      const platformId = platformSelect.value || null;
      mutateSelectedService((doc, sv) => serviceOps.setStopPlatform(sv, index, platformId));
    });
    workspace.right.appendChild(h('div', { class: 'g-field' },
      h('label', { class: 'g-field__label' }, 'のりば'),
      platformSelect,
      h('div', { class: 'g-field__hint' }, '図の中で、同じ駅の別ののりばをクリックしても変えられます。')
    ));

    const boardInput = h('input', { type: 'checkbox', checked: stop.board !== false });
    boardInput.addEventListener('change', () => {
      mutateSelectedService((doc, sv) => serviceOps.setStopFlags(sv, index, { board: boardInput.checked }));
    });
    workspace.right.appendChild(h('div', { class: 'g-checkbox' }, boardInput, h('span', {}, 'この駅から乗れる')));

    const alightInput = h('input', { type: 'checkbox', checked: stop.alight !== false });
    alightInput.addEventListener('change', () => {
      mutateSelectedService((doc, sv) => serviceOps.setStopFlags(sv, index, { alight: alightInput.checked }));
    });
    workspace.right.appendChild(h('div', { class: 'g-checkbox' }, alightInput, h('span', {}, 'この駅で降りられる')));

    if (needsRun) {
      workspace.right.appendChild(renderRunField('次の駅まで（秒）', stop.run, (num) => {
        mutateSelectedService((doc, sv) => serviceOps.setRun(sv, index, num));
      }));
    }

    workspace.right.appendChild(h('div', { class: 'g-svc-actions' },
      h('button', {
        type: 'button',
        class: 'g-btn',
        disabled: index === 0,
        onClick: () => moveStop(index, index - 1)
      }, icon('arrow-left'), '前へ'),
      h('button', {
        type: 'button',
        class: 'g-btn',
        disabled: index === service.stops.length - 1,
        onClick: () => moveStop(index, index + 1)
      }, icon('arrow-right'), '後ろへ'),
      h('button', {
        type: 'button',
        class: 'g-btn g-btn--danger',
        onClick: async () => {
          if (service.stops.length <= 2) {
            await alertDialog('停車駅は2つ以上必要です。運行系統ごと消すときは［運行系統を削除］を使ってください。');
            return;
          }
          ui.sel = null;
          mutateSelectedService((doc, sv) => serviceOps.removeStop(doc, sv, index));
        }
      }, icon('trash'), '停車駅を削除')
    ));
  }

  function renderEdgePanel(service, index, rangeEnd) {
    const stops = service.stops;
    const fromStop = stops[index];
    const toIndex = rangeEnd != null ? rangeEnd + 1 : index + 1;
    const toStop = stops[toIndex] || stops[(toIndex) % stops.length];
    const fromStation = stationOf(network, fromStop.stationId);
    const toStation = stationOf(network, toStop.stationId);

    const heading = rangeEnd != null
      ? `${fromStation ? fromStation.name : fromStop.stationId} → ${toStation ? toStation.name : toStop.stationId}（${rangeEnd - index + 1} 駅間）`
      : `${fromStation ? fromStation.name : fromStop.stationId} → ${toStation ? toStation.name : toStop.stationId}`;
    workspace.right.appendChild(h('div', { class: 'g-field__label' }, heading));

    if (rangeEnd == null) {
      workspace.right.appendChild(renderRunField('次の駅まで（秒）', fromStop.run, (num) => {
        mutateSelectedService((doc, sv) => serviceOps.setRun(sv, index, num));
      }));
    }

    const segments = serviceOps.segmentsOf(service);
    const seg = segments[index] || { lineId: null, categoryId: null };

    function applySegment(fromEdge, toEdge, patch) {
      mutateSelectedService((doc, sv) => serviceOps.setSegmentRange(doc, sv, fromEdge, toEdge, patch));
    }

    const lineSelectEdge = h('select', { class: 'g-select' + (seg.lineId ? '' : ' is-invalid') },
      seg.lineId ? null : h('option', { value: '', selected: true }, '選んでください'),
      network.lines.map((line) => h('option', { value: line.id, selected: seg.lineId === line.id }, line.name))
    );
    lineSelectEdge.addEventListener('change', () => {
      const lineId = lineSelectEdge.value || null;
      const newLine = lineOf(network, lineId);
      const categories = newLine ? newLine.categories || [] : [];
      const currentCategoryName = seg.lineId != null ? categoryName(network, seg.lineId, seg.categoryId) : null;
      const matched = currentCategoryName ? categories.find((c) => c.name === currentCategoryName) : null;
      const categoryId = matched ? matched.id : (categories[0] ? categories[0].id : null);
      applySegment(index, rangeEnd ?? index, { lineId, categoryId });
    });
    workspace.right.appendChild(h('div', { class: 'g-field' },
      h('label', { class: 'g-field__label' }, '路線'),
      lineSelectEdge,
      service.circular ? h('div', { class: 'g-field__hint' }, '環状運転では、すべての駅間が同じ路線・種別になります。') : null
    ));

    const line = lineOf(network, seg.lineId);
    const categorySelectEdge = h('select', { class: 'g-select' },
      (line ? line.categories || [] : []).map((cat) => h('option', { value: cat.id, selected: seg.categoryId === cat.id }, cat.name))
    );
    categorySelectEdge.addEventListener('change', () => {
      applySegment(index, rangeEnd ?? index, { lineId: seg.lineId, categoryId: categorySelectEdge.value });
    });
    workspace.right.appendChild(h('div', { class: 'g-field' },
      h('label', { class: 'g-field__label' }, '種別'),
      categorySelectEdge
    ));

    if (!service.circular) {
      const lastEdge = stops.length - 2;
      workspace.right.appendChild(h('div', { class: 'g-svc-actions' },
        h('button', {
          type: 'button',
          class: 'g-btn g-btn--small',
          onClick: () => applySegment(index, lastEdge, { lineId: seg.lineId, categoryId: seg.categoryId })
        }, 'ここから終点まで同じにする'),
        h('button', {
          type: 'button',
          class: 'g-btn g-btn--small',
          onClick: () => applySegment(0, rangeEnd ?? index, { lineId: seg.lineId, categoryId: seg.categoryId })
        }, '始発からここまで同じにする')
      ));
    }

    if (rangeEnd == null) {
      workspace.right.appendChild(h('div', { class: 'g-svc-actions' },
        h('button', {
          type: 'button',
          class: 'g-btn g-btn--small',
          disabled: ui.mode !== 'idle',
          onClick: () => startInsertMode(index)
        }, icon('plus'), 'この駅間に駅を追加')
      ));
    }
  }

  function refreshView() {
    drawCanvas();
    renderLeftList();
    renderRibbonPanel();
    renderRightPanel();
    updateModeBanner();
  }

  async function onKeyDown(event) {
    const tag = document.activeElement && document.activeElement.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
    if (document.querySelector('.g-dialog-backdrop')) return;

    if (event.key === 'Escape') {
      if (ui.mode !== 'idle') {
        finishMode();
      } else if (ui.sel) {
        setSel(null);
      } else if (ui.selectedId) {
        selectService(null);
      }
      return;
    }

    if ((event.key === 'Delete' || event.key === 'Backspace') && ui.sel && ui.sel.type === 'stop') {
      const service = selectedService();
      if (!service) return;
      event.preventDefault();
      if (service.stops.length <= 2) {
        await alertDialog('停車駅は2つ以上必要です。運行系統ごと消すときは［運行系統を削除］を使ってください。');
        return;
      }
      const index = ui.sel.index;
      ui.sel = null;
      mutateSelectedService((doc, sv) => serviceOps.removeStop(doc, sv, index));
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
    ui.sel = focus.sub || null;
    refreshView();
  }

  maybeOpenGuideOnce(GUIDE_STEPS.services, 'rewis_editor_graph_guide_services');

  return {
    destroy() {
      window.removeEventListener('keydown', onKeyDown);
      if (bannerTimer) clearTimeout(bannerTimer);
      canvas.destroy();
    }
  };
}

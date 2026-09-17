import { createWorkspace } from '../canvas/workspace.js';
import { createCanvas } from '../canvas/canvas.js';
import { createNodeDragHandler } from '../canvas/node-drag.js';
import { renderStationNode } from '../canvas/station-node.js';
import { renderRibbon } from '../canvas/ribbon.js';
import { attachCanvasToolbar } from '../canvas/canvas-tab-base.js';
import * as layoutStore from '../canvas/layout-store.js';
import { graphUi } from '../canvas/ui-state.js';
import { resolvePositions } from '../../editor-core/auto-layout.js';
import { boundsOf, portPoint } from '../../editor-core/graph-geometry.js';
import * as serviceOps from '../../editor-core/service-ops.js';
import { matchesServiceFilter } from '../../editor-core/service-filter.js';
import { serviceTitle, describeIssueLocation, issueTargetsForService } from '../../editor-core/issue-location.js';
import { summarizeSections, totalRun } from '../../editor2/views/services.js';
import { h, s, clear, icon } from '../dom.js';

const MUTED_COLOR = '#999999';

function lineOf(network, lineId) {
  return (network.lines || []).find((l) => l.id === lineId) || null;
}

function categoryNameOf(network, lineId, categoryId) {
  const line = lineOf(network, lineId);
  const category = line && (line.categories || []).find((c) => c.id === categoryId);
  return category ? category.name : categoryId;
}

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

function stationOf(network, stationId) {
  return (network.stations || []).find((st) => st.id === stationId) || null;
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
    resolvePositions(network, layoutStore.loadSaved()).forEach((pos, id) => positions.set(id, pos));
  }
  resyncPositions();

  let bannerTimer = null;
  function flashBanner(text) {
    workspace.setBanner(text);
    if (bannerTimer) clearTimeout(bannerTimer);
    bannerTimer = setTimeout(() => workspace.setBanner(null), 3000);
  }

  function selectedService() {
    return network.services.find((sv) => sv.id === ui.selectedId) || null;
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
    onCommit: (id, pos) => layoutStore.savePosition(id, pos),
    onClick: (station) => handleNodeClick(station, null)
  });

  function handleNodeClick(station, platformId) {
    const service = selectedService();
    if (service && ui.sel && ui.sel.type === 'stop') {
      const stop = service.stops[ui.sel.index];
      if (stop && stop.stationId === station.id) {
        store.mutateDoc('network', (doc) => {
          const idx = doc.services.findIndex((sv) => sv.id === service.id);
          if (idx === -1) return;
          doc.services[idx] = serviceOps.setStopPlatform(doc.services[idx], ui.sel.index, platformId);
        });
        refreshView();
        return;
      }
    }
    flashBanner('駅を加えるときは［駅を末尾に追加］を押してください。');
  }

  function drawCanvas() {
    canvas.render((world) => {
      const service = selectedService();
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
          onPortPointerDown: (event, st, platformId) => handleNodeClick(st, platformId)
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
    hit.addEventListener('pointerdown', () => selectService(service.id));
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

  workspace.left.appendChild(leftTitle);
  workspace.left.appendChild(filterRow);
  workspace.left.appendChild(listEl);

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
      }
    });
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
    workspace.right.appendChild(h('div', { class: 'g-field' },
      h('label', { class: 'g-field__label' }, '行先'),
      h('input', { type: 'text', class: 'g-input', value: service.headsign || '', disabled: true }),
      service.circular ? h('div', { class: 'g-field__hint' }, '環状運転では行先を表示しません。') : null
    ));
    workspace.right.appendChild(h('div', { class: 'g-field' },
      h('label', { class: 'g-field__label' }, 'メモ（任意）'),
      h('input', { type: 'text', class: 'g-input', value: service.name || '', disabled: true })
    ));
    workspace.right.appendChild(h('div', { class: 'g-checkbox' },
      h('input', { type: 'checkbox', checked: service.active !== false, disabled: true }),
      h('span', {}, '運行中')
    ));
    workspace.right.appendChild(h('div', { class: 'g-checkbox' },
      h('input', { type: 'checkbox', checked: !!service.circular, disabled: true }),
      h('span', {}, '環状運転')
    ));
    workspace.right.appendChild(h('p', {}, `${service.stops.length} 駅・${formatSeconds(totalRun(service))}`));
    workspace.right.appendChild(h('p', { class: 'g-ws-right__note' }, summarizeSections(network, service.sections || [])));

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

  function renderStopPanel(service, index) {
    const stop = service.stops[index];
    const station = stationOf(network, stop.stationId);
    const isLast = index === service.stops.length - 1;
    const needsRun = !isLast || service.circular;

    workspace.right.appendChild(h('div', { class: 'g-field__label' }, `${index + 1} 番目の停車駅`));
    workspace.right.appendChild(h('p', {}, station ? station.name : stop.stationId));

    const platformSelect = h('select', { class: 'g-select', disabled: true },
      h('option', { value: '', selected: stop.platformId == null }, 'のりば指定なし'),
      (station ? station.platforms || [] : []).map((p) => h('option', { value: p.id, selected: stop.platformId === p.id }, p.label))
    );
    workspace.right.appendChild(h('div', { class: 'g-field' },
      h('label', { class: 'g-field__label' }, 'のりば'),
      platformSelect,
      h('div', { class: 'g-field__hint' }, '図の中で、同じ駅の別ののりばをクリックしても変えられます。')
    ));

    workspace.right.appendChild(h('div', { class: 'g-checkbox' },
      h('input', { type: 'checkbox', checked: stop.board !== false, disabled: true }),
      h('span', {}, 'この駅から乗れる')
    ));
    workspace.right.appendChild(h('div', { class: 'g-checkbox' },
      h('input', { type: 'checkbox', checked: stop.alight !== false, disabled: true }),
      h('span', {}, 'この駅で降りられる')
    ));

    if (needsRun) {
      workspace.right.appendChild(h('div', { class: 'g-field' },
        h('label', { class: 'g-field__label' }, '次の駅まで（秒）'),
        h('input', { type: 'number', class: 'g-input', value: Number.isFinite(stop.run) ? stop.run : '', disabled: true })
      ));
    }
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
      workspace.right.appendChild(h('div', { class: 'g-field' },
        h('label', { class: 'g-field__label' }, '次の駅まで（秒）'),
        h('input', { type: 'number', class: 'g-input', value: Number.isFinite(fromStop.run) ? fromStop.run : '', disabled: true })
      ));
    }

    const segments = serviceOps.segmentsOf(service);
    const seg = segments[index] || { lineId: null, categoryId: null };
    const lineSelectEdge = h('select', { class: 'g-select' + (seg.lineId ? '' : ' is-invalid'), disabled: true },
      seg.lineId ? null : h('option', { value: '', selected: true }, '選んでください'),
      network.lines.map((line) => h('option', { value: line.id, selected: seg.lineId === line.id }, line.name))
    );
    workspace.right.appendChild(h('div', { class: 'g-field' },
      h('label', { class: 'g-field__label' }, '路線'),
      lineSelectEdge,
      service.circular ? h('div', { class: 'g-field__hint' }, '環状運転では、すべての駅間が同じ路線・種別になります。') : null
    ));

    const line = lineOf(network, seg.lineId);
    const categorySelectEdge = h('select', { class: 'g-select', disabled: true },
      (line ? line.categories || [] : []).map((cat) => h('option', { value: cat.id, selected: seg.categoryId === cat.id }, cat.name))
    );
    workspace.right.appendChild(h('div', { class: 'g-field' },
      h('label', { class: 'g-field__label' }, '種別'),
      categorySelectEdge
    ));
  }

  function refreshView() {
    drawCanvas();
    renderLeftList();
    renderRibbonPanel();
    renderRightPanel();
  }

  function onKeyDown(event) {
    if (event.key !== 'Escape') return;
    const tag = document.activeElement && document.activeElement.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
    if (document.querySelector('.g-dialog-backdrop')) return;
    if (ui.sel) {
      setSel(null);
    } else if (ui.selectedId) {
      selectService(null);
    }
  }
  window.addEventListener('keydown', onKeyDown);

  refreshView();

  const { fitAll } = attachCanvasToolbar(workspace, canvas, {
    getBounds: () => boundsOf([...positions.values()]),
    onReset: () => { resyncPositions(); refreshView(); }
  });
  if (!canvas.hasSavedViewport) fitAll();

  if (focus && focus.id) {
    ui.selectedId = focus.id;
    ui.sel = focus.sub || null;
    refreshView();
  }

  return {
    destroy() {
      window.removeEventListener('keydown', onKeyDown);
      if (bannerTimer) clearTimeout(bannerTimer);
      canvas.destroy();
    }
  };
}

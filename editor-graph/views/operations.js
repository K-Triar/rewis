import { createWorkspace } from '../canvas/workspace.js';
import { createCanvas } from '../canvas/canvas.js';
import { createNodeDragHandler } from '../canvas/node-drag.js';
import { renderStationNode } from '../canvas/station-node.js';
import { attachCanvasToolbar } from '../canvas/canvas-tab-base.js';
import { graphUi } from '../canvas/ui-state.js';
import { resolvePositions, setLayout } from '../../editor-core/auto-layout.js';
import { boundsOf } from '../../editor-core/graph-geometry.js';
import * as noticeOps from '../../editor-core/notice-ops.js';
import { generateNoticeText } from '../../shared/notice-text.js';
import { computeAffectedIndices, throughTargetsFor } from '../../shared/model.js';
import { h, s, clear, icon } from '../../editor-shared/dom.js';
import { alertDialog, confirmDialog } from '../../editor-shared/components/dialog.js';
import { maybeOpenGuideOnce } from '../components/guide.js';
import { GUIDE_STEPS } from '../guide-steps.js';

const MUTED_COLOR = '#999999';
const STATE_LABEL = { draft: '下書き', published: '公開中', closed: '終了' };
const TARGET_LABEL = { mutual: '相互', affected_to_through: '影響路線→直通先', through_to_affected: '直通先→影響路線' };

function stationOf(network, stationId) {
  return (network.stations || []).find((st) => st.id === stationId) || null;
}

function stationLabel(network, stationId) {
  const station = stationOf(network, stationId);
  return station ? station.name : stationId;
}

function lineOf(network, lineId) {
  return (network.lines || []).find((l) => l.id === lineId) || null;
}

export function renderOperationsView(container, ctx) {
  const { store, focus } = ctx;
  const network = store.state.docs.network;
  const operations = store.state.docs.operations;
  const ui = graphUi.operations;

  if (ui.selectedId && !operations.notices.some((n) => n.id === ui.selectedId)) {
    ui.selectedId = null;
    ui.mode = 'idle';
    ui.pickStage = null;
  }

  const workspace = createWorkspace(container, { ribbon: false });

  const positions = new Map();
  function resyncPositions() {
    positions.clear();
    resolvePositions(network).forEach((pos, id) => positions.set(id, pos));
  }
  resyncPositions();

  function selectedNotice() {
    return operations.notices.find((n) => n.id === ui.selectedId) || null;
  }

  function mutateSelectedNotice(fn) {
    const id = ui.selectedId;
    if (!id) return;
    store.mutateDoc('operations', (doc) => {
      const idx = doc.notices.findIndex((n) => n.id === id);
      if (idx === -1) return;
      doc.notices[idx] = fn(doc.notices[idx]);
    });
    refreshView();
  }

  function selectNotice(id) {
    ui.selectedId = id;
    ui.mode = 'idle';
    ui.pickStage = null;
    workspace.setBanner(null);
    refreshView();
  }

  const canvas = createCanvas(workspace.canvasHost, {
    viewportKey: 'operations',
    onBackgroundClick: () => {}
  });

  function flashBanner(text, duration = 2500) {
    workspace.setBanner(text, 'attention');
    setTimeout(() => { if (ui.mode === 'idle') workspace.setBanner(null); else updateModeBanner(); }, duration);
  }

  function handleNodeClick(station) {
    if (ui.mode !== 'pickRangeStart' && ui.mode !== 'pickRangeEnd') return;
    const notice = selectedNotice();
    const line = notice ? lineOf(network, notice.lineId) : null;
    if (!line || !line.stations.includes(station.id)) {
      flashBanner('影響路線に含まれていない駅です。');
      return;
    }
    if (ui.mode === 'pickRangeStart') {
      ui.pickStage = station.id;
      ui.mode = 'pickRangeEnd';
      refreshView();
      return;
    }
    const fromStationId = ui.pickStage;
    mutateSelectedNotice((n) => noticeOps.setNoticeRange(n, { fromStationId, toStationId: station.id, direction: null }));
    ui.mode = 'idle';
    ui.pickStage = null;
    refreshView();
  }

  const dragHandler = createNodeDragHandler(canvas, positions, {
    onChange: () => drawCanvas(),
    onCommit: (id, pos) => store.mutateDoc('network', (doc) => setLayout(doc, id, pos)),
    onClick: (station) => handleNodeClick(station)
  });

  function drawLinePath(world, line, selected) {
    const stations = line.stations || [];
    for (let i = 0; i < stations.length - 1; i++) {
      const p1 = positions.get(stations[i]);
      const p2 = positions.get(stations[i + 1]);
      if (!p1 || !p2) continue;
      world.appendChild(s('line', {
        class: 'g-line-path' + (selected ? ' is-selected' : ''),
        x1: p1.x, y1: p1.y, x2: p2.x, y2: p2.y,
        stroke: line.color || MUTED_COLOR
      }));
    }
    if (line.loop && stations.length > 1) {
      const p1 = positions.get(stations[stations.length - 1]);
      const p2 = positions.get(stations[line.loop.startIndex]);
      if (p1 && p2) {
        world.appendChild(s('line', {
          class: 'g-line-path' + (selected ? ' is-selected' : ''),
          x1: p1.x, y1: p1.y, x2: p2.x, y2: p2.y,
          stroke: line.color || MUTED_COLOR
        }));
      }
    }
  }

  function drawCanvas() {
    const notice = selectedNotice();
    const line = notice ? lineOf(network, notice.lineId) : null;

    canvas.render((world) => {
      network.lines.forEach((l) => {
        if (!line || l.id !== line.id) drawLinePath(world, l, false);
      });
      if (line) drawLinePath(world, line, true);

      const affectedStations = line ? new Set(computeAffectedIndices(line, notice.range).map((i) => line.stations[i])) : new Set();

      network.stations.forEach((station) => {
        const pos = positions.get(station.id);
        if (!pos) return;
        const onLine = !!(line && line.stations.includes(station.id));
        renderStationNode(world, station, pos, {
          selected: onLine && affectedStations.has(station.id),
          dimmed: !!line && !onLine,
          onBodyPointerDown: dragHandler
        });
      });
    });
  }

  // --- 左パネル ---
  const leftTitle = h('div', { class: 'g-ws-left__title' }, '運行情報');
  const filterRow = h('div', { class: 'g-field' });
  const listEl = h('div', { class: 'g-list g-ws-left__list' });
  const addBtn = h('button', {
    type: 'button',
    class: 'g-btn',
    onClick: () => {
      const draft = noticeOps.createEmptyNotice(network);
      store.mutateDoc('operations', (doc) => doc.notices.push(draft));
      selectNotice(draft.id);
    }
  }, icon('plus'), '運行情報を追加');

  workspace.left.appendChild(leftTitle);
  workspace.left.appendChild(filterRow);
  workspace.left.appendChild(listEl);
  workspace.left.appendChild(addBtn);

  function renderFilterRow() {
    clear(filterRow);
    const stateSelect = h('select', { class: 'g-select' },
      h('option', { value: 'active', selected: ui.stateFilter === 'active' }, '下書き・公開中'),
      h('option', { value: 'all', selected: ui.stateFilter === 'all' }, 'すべて'),
      h('option', { value: 'draft', selected: ui.stateFilter === 'draft' }, '下書きのみ'),
      h('option', { value: 'published', selected: ui.stateFilter === 'published' }, '公開中のみ'),
      h('option', { value: 'closed', selected: ui.stateFilter === 'closed' }, '終了のみ')
    );
    stateSelect.addEventListener('change', () => { ui.stateFilter = stateSelect.value; refreshView(); });

    const lineSelect = h('select', { class: 'g-select' },
      h('option', { value: '', selected: ui.lineFilter === '' }, 'すべての路線'),
      network.lines.map((l) => h('option', { value: l.id, selected: ui.lineFilter === l.id }, l.name))
    );
    lineSelect.addEventListener('change', () => { ui.lineFilter = lineSelect.value; refreshView(); });

    filterRow.appendChild(stateSelect);
    filterRow.appendChild(lineSelect);
  }

  function visibleNotices() {
    return operations.notices.filter((n) => {
      if (ui.lineFilter && n.lineId !== ui.lineFilter) return false;
      if (ui.stateFilter === 'active') return n.state !== 'closed';
      if (ui.stateFilter === 'all') return true;
      return n.state === ui.stateFilter;
    });
  }

  function renderLeftList() {
    clear(listEl);
    visibleNotices().forEach((notice) => {
      const heading = generateNoticeText(notice, network, operations.masters).heading;
      listEl.appendChild(h('button', {
        type: 'button',
        class: 'g-list__item' + (ui.selectedId === notice.id ? ' is-selected' : ''),
        onClick: () => selectNotice(notice.id)
      },
        h('div', { class: 'g-svc-row__line1' },
          h('span', { class: 'g-svc-dot', style: `background:${lineOf(network, notice.lineId)?.color || MUTED_COLOR};` }),
          h('span', {}, heading)
        ),
        h('div', { class: 'g-svc-row__badges' },
          h('span', { class: 'g-label' }, STATE_LABEL[notice.state] || notice.state)
        )
      ));
    });
    addBtn.disabled = ui.mode !== 'idle';
  }

  // --- モード（影響区間の指定） ---
  function startPickRange() {
    ui.mode = 'pickRangeStart';
    ui.pickStage = null;
    refreshView();
  }

  function updateModeBanner() {
    if (ui.mode === 'idle') { workspace.setBanner(null); return; }
    const text = ui.mode === 'pickRangeStart'
      ? '影響区間の始点駅を、図の中でクリックしてください。'
      : '影響区間の終点駅を、図の中でクリックしてください。';
    const content = h('div', { class: 'g-banner__row' },
      h('span', {}, text),
      h('button', {
        type: 'button', class: 'g-btn g-btn--small',
        onClick: () => { ui.mode = 'idle'; ui.pickStage = null; refreshView(); }
      }, 'キャンセル')
    );
    workspace.setBanner(content);
  }

  // --- 右パネル ---
  function renderRightPanel() {
    clear(workspace.right);
    const notice = selectedNotice();
    if (!notice) {
      workspace.right.appendChild(h('p', {}, '運行情報を選んでください。'));
      workspace.right.appendChild(h('p', { class: 'g-ws-right__note' }, '左の一覧から選ぶか、［運行情報を追加］で作ります。'));
      return;
    }

    const line = lineOf(network, notice.lineId);

    // 影響路線・状態
    const lineSelect = h('select', { class: 'g-select' },
      network.lines.map((l) => h('option', { value: l.id, selected: notice.lineId === l.id }, l.name))
    );
    lineSelect.addEventListener('change', () => {
      mutateSelectedNotice((n) => noticeOps.updateNoticeFields(n, { lineId: lineSelect.value }));
    });
    workspace.right.appendChild(h('div', { class: 'g-field' }, h('label', { class: 'g-field__label' }, '影響路線'), lineSelect));

    const stateSelect = h('select', { class: 'g-select' },
      h('option', { value: 'draft', selected: notice.state === 'draft' }, '下書き'),
      h('option', { value: 'published', selected: notice.state === 'published' }, '公開中'),
      h('option', { value: 'closed', selected: notice.state === 'closed' }, '終了')
    );
    stateSelect.addEventListener('change', () => {
      mutateSelectedNotice((n) => noticeOps.updateNoticeFields(n, { state: stateSelect.value }));
    });
    workspace.right.appendChild(h('div', { class: 'g-field' }, h('label', { class: 'g-field__label' }, '状態'), stateSelect));

    // 発生日時
    const occ = notice.occurrence;
    function occField(label, key, max) {
      const input = h('input', { type: 'number', class: 'g-input', min: '1', max: max ? String(max) : undefined, value: occ[key] ?? '' });
      input.addEventListener('change', () => {
        mutateSelectedNotice((n) => noticeOps.updateNoticeFields(n, { occurrence: { [key]: input.value ? Number(input.value) : null } }));
      });
      return h('div', { class: 'g-field' }, h('label', { class: 'g-field__label' }, label), input);
    }
    const occGroup = h('div', {}, occField('年', 'year'), occField('月', 'month', 12), occField('日', 'day', 31), occField('時', 'hour', 23), occField('分', 'minute', 59));
    workspace.right.appendChild(h('div', { class: 'g-field' }, h('span', { class: 'g-field__label' }, '発生日時（時・分は省略可）'), occGroup));

    // 影響区間
    const rangeSection = h('div', { class: 'g-field' }, h('span', { class: 'g-field__label' }, '影響区間'));
    const fullLineCheckbox = h('input', { type: 'checkbox', checked: notice.range == null });
    fullLineCheckbox.addEventListener('change', () => {
      if (fullLineCheckbox.checked) {
        mutateSelectedNotice((n) => noticeOps.setNoticeRange(n, null));
      } else {
        startPickRange();
      }
    });
    rangeSection.appendChild(h('div', { class: 'g-checkbox' }, fullLineCheckbox, h('span', {}, '全線')));
    if (notice.range) {
      const range = noticeOps.normalizeRange(notice.range);
      rangeSection.appendChild(h('div', { class: 'g-ws-right__note' },
        `${stationLabel(network, range.fromStationId)} 〜 ${stationLabel(network, range.toStationId)}`,
        h('button', { type: 'button', class: 'g-btn g-btn--small', disabled: ui.mode !== 'idle', onClick: () => startPickRange() }, '区間を選び直す')
      ));
      if (line && line.loop) {
        rangeSection.appendChild(h('div', { class: 'g-ws-right__note' },
          `始点から終点へ「${line.directions.forward}」方向に進んだ側が対象です。反対側にする場合は入れ替えてください。`,
          h('button', {
            type: 'button',
            class: 'g-btn g-btn--small',
            onClick: () => mutateSelectedNotice((n) => {
              const r = noticeOps.normalizeRange(n.range);
              return noticeOps.setNoticeRange(n, { fromStationId: r.toStationId, toStationId: r.fromStationId, direction: null });
            })
          }, '始点と終点を入れ替える')
        ));
      }
    } else {
      rangeSection.appendChild(h('div', { class: 'g-ws-right__note' },
        h('button', { type: 'button', class: 'g-btn g-btn--small', disabled: ui.mode !== 'idle', onClick: () => startPickRange() }, '区間を指定する')
      ));
    }
    workspace.right.appendChild(rangeSection);

    // 方向（列車の進行方向）
    const dirNames = line ? line.directions : { forward: '下り線', backward: '上り線' };
    const forwardCheckbox = h('input', { type: 'checkbox', checked: notice.directions.forward });
    const backwardCheckbox = h('input', { type: 'checkbox', checked: notice.directions.backward });
    function commitDirections() {
      mutateSelectedNotice((n) => noticeOps.setNoticeDirections(n, { forward: forwardCheckbox.checked, backward: backwardCheckbox.checked }));
    }
    forwardCheckbox.addEventListener('change', commitDirections);
    backwardCheckbox.addEventListener('change', commitDirections);
    workspace.right.appendChild(h('div', { class: 'g-field' },
      h('span', { class: 'g-field__label' }, '方向（列車の進行方向）'),
      h('div', { class: 'g-checkbox' }, forwardCheckbox, h('span', {}, dirNames.forward)),
      h('div', { class: 'g-checkbox' }, backwardCheckbox, h('span', {}, dirNames.backward))
    ));

    // 影響種別
    const categorySection = h('div', { class: 'g-field' }, h('span', { class: 'g-field__label' }, '影響種別'));
    const allCategoriesCheckbox = h('input', { type: 'checkbox', checked: notice.categoryIds == null });
    allCategoriesCheckbox.addEventListener('change', () => {
      mutateSelectedNotice((n) => noticeOps.setNoticeCategories(n, allCategoriesCheckbox.checked ? null : []));
    });
    categorySection.appendChild(h('div', { class: 'g-checkbox' }, allCategoriesCheckbox, h('span', {}, 'すべて')));
    if (notice.categoryIds != null && line) {
      line.categories.forEach((category) => {
        const checkbox = h('input', { type: 'checkbox', checked: notice.categoryIds.includes(category.id) });
        checkbox.addEventListener('change', () => {
          const currentNotice = selectedNotice();
          const next = new Set(currentNotice.categoryIds);
          if (checkbox.checked) next.add(category.id); else next.delete(category.id);
          mutateSelectedNotice((n) => noticeOps.setNoticeCategories(n, Array.from(next)));
        });
        categorySection.appendChild(h('div', { class: 'g-checkbox' }, checkbox, h('span', {}, category.name)));
      });
    }
    workspace.right.appendChild(categorySection);

    // 状態（ステータス）
    const statusSelect = h('select', { class: 'g-select' },
      operations.masters.statusTemplates.map((t) => h('option', { value: t.code, selected: notice.status.code === t.code }, t.label)),
      h('option', { value: 'notice', selected: notice.status.code === 'notice' }, 'お知らせ'),
      h('option', { value: 'other', selected: notice.status.code === 'other' }, 'その他')
    );
    statusSelect.addEventListener('change', () => {
      mutateSelectedNotice((n) => noticeOps.setNoticeStatus(operations.masters, n, statusSelect.value));
    });
    const isCustomStatus = notice.status.code === 'notice' || notice.status.code === 'other';
    const statusHeadingInput = h('input', { type: 'text', class: 'g-input', value: notice.status.heading || '', disabled: !isCustomStatus });
    const statusBodyInput = h('textarea', { class: 'g-textarea', disabled: !isCustomStatus }, notice.status.body || '');
    if (isCustomStatus) {
      statusHeadingInput.addEventListener('change', () => mutateSelectedNotice((n) => noticeOps.updateNoticeStatusText(n, { heading: statusHeadingInput.value })));
      statusBodyInput.addEventListener('change', () => mutateSelectedNotice((n) => noticeOps.updateNoticeStatusText(n, { body: statusBodyInput.value })));
    }
    workspace.right.appendChild(h('div', { class: 'g-field' },
      h('label', { class: 'g-field__label' }, '状態（ステータス）'), statusSelect,
      h('label', { class: 'g-field__label' }, '見出し'), statusHeadingInput,
      h('label', { class: 'g-field__label' }, '本文'), statusBodyInput
    ));

    // 原因
    const causeSelect = h('select', { class: 'g-select' },
      operations.masters.causes.map((c) => h('option', { value: c.code, selected: notice.cause.code === c.code }, c.label))
    );
    causeSelect.addEventListener('change', () => {
      mutateSelectedNotice((n) => noticeOps.setNoticeCause(operations.masters, n, causeSelect.value));
    });
    const isCustomCause = notice.cause.code === 'other';
    const causeHeadingInput = h('input', { type: 'text', class: 'g-input', value: notice.cause.heading || '', disabled: !isCustomCause });
    const causeBodyInput = h('textarea', { class: 'g-textarea', disabled: !isCustomCause }, notice.cause.body || '');
    if (isCustomCause) {
      causeHeadingInput.addEventListener('change', () => mutateSelectedNotice((n) => noticeOps.updateNoticeCauseFields(n, { heading: causeHeadingInput.value })));
      causeBodyInput.addEventListener('change', () => mutateSelectedNotice((n) => noticeOps.updateNoticeCauseFields(n, { body: causeBodyInput.value })));
    }
    const causeLineOptionSelect = h('select', { class: 'g-select' },
      h('option', { value: 'affected', selected: notice.cause.lineOption === 'affected' }, '影響路線と同じ'),
      h('option', { value: 'line', selected: notice.cause.lineOption === 'line' }, '別の路線'),
      h('option', { value: 'hidden', selected: notice.cause.lineOption === 'hidden' }, '表示しない')
    );
    causeLineOptionSelect.addEventListener('change', () => {
      mutateSelectedNotice((n) => noticeOps.updateNoticeCauseFields(n, { lineOption: causeLineOptionSelect.value }));
    });
    const causeField = h('div', { class: 'g-field' },
      h('label', { class: 'g-field__label' }, '原因'), causeSelect,
      h('label', { class: 'g-field__label' }, '見出し'), causeHeadingInput,
      h('label', { class: 'g-field__label' }, '本文'), causeBodyInput,
      h('label', { class: 'g-field__label' }, '原因路線の表示'), causeLineOptionSelect
    );
    if (notice.cause.lineOption === 'line') {
      const causeLineSelect = h('select', { class: 'g-select' },
        network.lines.map((l) => h('option', { value: l.id, selected: notice.cause.lineId === l.id }, l.name))
      );
      causeLineSelect.addEventListener('change', () => {
        mutateSelectedNotice((n) => noticeOps.updateNoticeCauseFields(n, { lineId: causeLineSelect.value }));
      });
      causeField.appendChild(h('label', { class: 'g-field__label' }, '原因路線'));
      causeField.appendChild(causeLineSelect);
    }
    workspace.right.appendChild(causeField);

    // 折り返し
    const turnbackStart = h('input', { type: 'checkbox', checked: notice.turnback.start });
    const turnbackEnd = h('input', { type: 'checkbox', checked: notice.turnback.end });
    turnbackStart.addEventListener('change', () => mutateSelectedNotice((n) => noticeOps.setNoticeTurnback(n, { start: turnbackStart.checked })));
    turnbackEnd.addEventListener('change', () => mutateSelectedNotice((n) => noticeOps.setNoticeTurnback(n, { end: turnbackEnd.checked })));
    workspace.right.appendChild(h('div', { class: 'g-field' },
      h('span', { class: 'g-field__label' }, '折り返し'),
      h('div', { class: 'g-checkbox' }, turnbackStart, h('span', {}, '始点で折り返し')),
      h('div', { class: 'g-checkbox' }, turnbackEnd, h('span', {}, '終点で折り返し'))
    ));

    // 直通
    const throughSection = h('div', { class: 'g-field' }, h('span', { class: 'g-field__label' }, '直通'));
    const throughLinks = notice.lineId ? throughTargetsFor(network, notice.lineId) : [];
    if (throughLinks.length === 0) {
      throughSection.appendChild(h('p', { class: 'g-ws-right__note' }, '直通設定はありません。'));
    } else {
      throughLinks.forEach((link) => {
        const existing = (notice.throughServices || []).find((ts) => ts.lineId === link.lineId) || { lineId: link.lineId, state: 'none', target: link.allowedTargets[0], showOnThroughLine: false };
        const stateSel = h('select', { class: 'g-select' },
          h('option', { value: 'none', selected: existing.state === 'none' }, '影響なし'),
          h('option', { value: 'suspended', selected: existing.state === 'suspended' }, '直通中止'),
          h('option', { value: 'resumed', selected: existing.state === 'resumed' }, '直通再開')
        );
        const targetOptions = link.allowedTargets.includes('mutual') ? ['mutual', 'affected_to_through', 'through_to_affected'] : link.allowedTargets;
        const targetSel = h('select', { class: 'g-select', disabled: existing.state !== 'suspended' },
          targetOptions.map((t) => h('option', { value: t, selected: existing.target === t }, TARGET_LABEL[t]))
        );
        const showCheckbox = h('input', { type: 'checkbox', checked: existing.showOnThroughLine, disabled: existing.state !== 'suspended' });

        function commit() {
          if (stateSel.value === 'none') {
            mutateSelectedNotice((n) => noticeOps.removeThroughService(n, link.lineId));
          } else {
            mutateSelectedNotice((n) => noticeOps.setThroughService(n, link.lineId, { state: stateSel.value, target: targetSel.value, showOnThroughLine: stateSel.value === 'suspended' && showCheckbox.checked }));
          }
        }
        stateSel.addEventListener('change', commit);
        targetSel.addEventListener('change', commit);
        showCheckbox.addEventListener('change', commit);

        throughSection.appendChild(h('div', { class: 'g-list__row' },
          h('strong', {}, lineOf(network, link.lineId)?.name || link.lineId),
          h('label', {}, ' 状態 ', stateSel),
          h('label', {}, ' 対象 ', targetSel),
          h('div', { class: 'g-checkbox' }, showCheckbox, h('span', {}, '直通先路線に表示'))
        ));
      });
    }
    workspace.right.appendChild(throughSection);

    // プレビュー
    const preview = generateNoticeText(notice, network, operations.masters);
    const textModeAuto = h('input', { type: 'radio', name: 'g-notice-text-mode', checked: notice.text.mode === 'auto' });
    const textModeCustom = h('input', { type: 'radio', name: 'g-notice-text-mode', checked: notice.text.mode === 'custom' });
    textModeAuto.addEventListener('change', () => mutateSelectedNotice((n) => noticeOps.setNoticeText(n, 'auto')));
    textModeCustom.addEventListener('change', () => mutateSelectedNotice((n) => noticeOps.setNoticeText(n, 'custom', `${preview.heading}\n${preview.body}`)));
    const previewSection = h('div', { class: 'g-field' },
      h('span', { class: 'g-field__label' }, 'プレビュー'),
      h('div', { class: 'g-checkbox' }, textModeAuto, h('span', {}, '自動生成')),
      h('div', { class: 'g-checkbox' }, textModeCustom, h('span', {}, '手動で書き換える'))
    );
    if (notice.text.mode === 'custom') {
      const customBox = h('textarea', { class: 'g-textarea' }, notice.text.custom || '');
      customBox.addEventListener('change', () => mutateSelectedNotice((n) => noticeOps.setNoticeText(n, 'custom', customBox.value)));
      previewSection.appendChild(customBox);
    } else {
      previewSection.appendChild(h('div', { class: 'g-ws-right__note' }, h('strong', {}, preview.heading), h('p', {}, preview.body)));
    }
    workspace.right.appendChild(previewSection);

    // 操作
    workspace.right.appendChild(h('div', { class: 'g-svc-actions' },
      h('button', {
        type: 'button', class: 'g-btn',
        onClick: () => {
          const dup = noticeOps.duplicateNotice(notice);
          store.mutateDoc('operations', (doc) => doc.notices.push(dup));
          selectNotice(dup.id);
        }
      }, icon('copy'), '複製'),
      h('button', {
        type: 'button', class: 'g-btn g-btn--danger',
        onClick: async () => {
          const ok = await confirmDialog('この運行情報を削除します。', { confirmLabel: '運行情報を削除', danger: true });
          if (!ok) return;
          store.mutateDoc('operations', (doc) => { doc.notices = doc.notices.filter((n) => n.id !== notice.id); });
          ui.selectedId = null;
          refreshView();
        }
      }, icon('trash'), '運行情報を削除')
    ));

    const error = noticeOps.validateNoticeDraft(network, operations.masters, notice);
    if (error) {
      workspace.right.appendChild(h('div', { class: 'g-field__error' }, error));
    }
  }

  function refreshView() {
    drawCanvas();
    renderFilterRow();
    renderLeftList();
    renderRightPanel();
    updateModeBanner();
  }

  function onKeyDown(event) {
    const tag = document.activeElement && document.activeElement.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
    if (document.querySelector('.g-dialog-backdrop')) return;

    if (event.key === 'Escape') {
      if (ui.mode !== 'idle') {
        ui.mode = 'idle';
        ui.pickStage = null;
        refreshView();
      } else if (ui.selectedId) {
        selectNotice(null);
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
    ui.mode = 'idle';
    refreshView();
  }

  maybeOpenGuideOnce(GUIDE_STEPS.operations, 'rewis_editor_graph_guide_operations');

  return {
    destroy() {
      window.removeEventListener('keydown', onKeyDown);
      canvas.destroy();
    }
  };
}

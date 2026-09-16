import { createWorkspace } from '../canvas/workspace.js';
import { createCanvas } from '../canvas/canvas.js';
import { createNodeDragHandler } from '../canvas/node-drag.js';
import { renderStationNode } from '../canvas/station-node.js';
import { attachCanvasToolbar } from '../canvas/canvas-tab-base.js';
import * as layoutStore from '../canvas/layout-store.js';
import { graphUi } from '../canvas/ui-state.js';
import { resolvePositions } from '../../editor-core/auto-layout.js';
import { boundsOf } from '../../editor-core/graph-geometry.js';
import * as stationOps from '../../editor-core/station-ops.js';
import { suggestPlatformId } from '../../editor-core/id-suggest.js';
import { findReferences } from '../../editor2/refs.js';
import { h, clear, icon } from '../dom.js';
import { alertDialog, confirmDialog } from '../components/dialog.js';
import { openPopover } from '../components/overlay.js';

const REF_TAB_BY_KIND = { line: 'lines', service: 'services', transfer: 'transfers', stationGroup: 'transfers' };

function refTarget(ref) {
  const tab = REF_TAB_BY_KIND[ref.kind];
  if (!tab) return null;
  return { tab, id: ref.id, sub: ref.kind === 'stationGroup' ? { type: 'group' } : null };
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

export function renderStationsView(container, ctx) {
  const { store, requestNavigate, focus } = ctx;
  const network = store.state.docs.network;
  const operations = store.state.docs.operations;
  const ui = graphUi.stations;

  if (ui.selectedId && !network.stations.some((s) => s.id === ui.selectedId)) {
    ui.selectedId = null;
  }

  let blockedPlatformId = null;

  const workspace = createWorkspace(container, { ribbon: false });

  const positions = new Map();
  function resyncPositions() {
    positions.clear();
    resolvePositions(network, layoutStore.loadSaved()).forEach((pos, id) => positions.set(id, pos));
  }
  resyncPositions();

  const canvas = createCanvas(workspace.canvasHost, {
    viewportKey: 'stations',
    onBackgroundDoubleClick: (event) => {
      const pos = canvas.screenToWorld(event.clientX, event.clientY);
      openCreatePopover(event.clientX, event.clientY, pos);
    }
  });

  function viewportCenterWorld() {
    const rect = workspace.canvasHost.getBoundingClientRect();
    return canvas.screenToWorld(rect.left + rect.width / 2, rect.top + rect.height / 2);
  }

  const dragHandler = createNodeDragHandler(canvas, positions, {
    onChange: () => drawCanvas(),
    onCommit: (id, pos) => layoutStore.savePosition(id, pos),
    onClick: (station) => selectStation(station.id)
  });

  function drawCanvas() {
    canvas.render((world) => {
      network.stations.forEach((station) => {
        const pos = positions.get(station.id);
        if (!pos) return;
        renderStationNode(world, station, pos, {
          selected: ui.selectedId === station.id,
          onBodyPointerDown: dragHandler,
          onPortPointerDown: (event, st) => selectStation(st.id)
        });
      });
    });
  }

  function selectStation(id) {
    if (ui.selectedId === id) return;
    ui.selectedId = id;
    blockedPlatformId = null;
    refreshView();
  }

  function selectFromList(id) {
    if (!positions.has(id)) {
      layoutStore.savePosition(id, viewportCenterWorld());
      resyncPositions();
    } else {
      const pos = positions.get(id);
      canvas.centerOn(pos.x, pos.y);
    }
    ui.selectedId = id;
    blockedPlatformId = null;
    refreshView();
  }

  // 左パネル
  const leftTitle = h('div', { class: 'g-ws-left__title' }, '駅');
  const searchInput = h('input', { type: 'text', class: 'g-input', placeholder: '駅名・かなで検索', value: ui.search });
  const searchWrap = h('div', { class: 'g-search-field' }, icon('search', { size: 14 }), searchInput);
  const addBtn = h('button', {
    type: 'button',
    class: 'g-btn',
    onClick: () => {
      const pos = viewportCenterWorld();
      const rect = workspace.canvasHost.getBoundingClientRect();
      openCreatePopover(rect.left + rect.width / 2, rect.top + rect.height / 2, pos);
    }
  }, icon('plus'), '駅を追加');
  const listEl = h('div', { class: 'g-list g-ws-left__list' });

  searchInput.addEventListener('input', () => {
    ui.search = searchInput.value;
    renderLeftList();
  });

  workspace.left.appendChild(leftTitle);
  workspace.left.appendChild(searchWrap);
  workspace.left.appendChild(addBtn);
  workspace.left.appendChild(listEl);

  function matchesSearch(station) {
    const needle = ui.search.trim();
    if (!needle) return true;
    return station.name.includes(needle) || (station.kana || '').includes(needle);
  }

  function renderLeftList() {
    clear(listEl);
    network.stations.filter(matchesSearch).forEach((station) => {
      const visible = positions.has(station.id);
      listEl.appendChild(h('button', {
        type: 'button',
        class: 'g-list__item g-list__item--row' + (ui.selectedId === station.id ? ' is-selected' : ''),
        onClick: () => selectFromList(station.id)
      },
        h('span', {}, station.name),
        h('span', { class: 'g-list__item-id' }, station.id),
        visible ? null : h('span', { class: 'g-label' }, '図にない')
      ));
    });
  }

  // 右パネル
  function renderRightPanel() {
    clear(workspace.right);
    const station = network.stations.find((s) => s.id === ui.selectedId);
    if (!station) {
      ui.selectedId = null;
      workspace.right.appendChild(h('p', {}, '駅を選んでください。'));
      workspace.right.appendChild(h('p', { class: 'g-ws-right__note' }, '図の駅をクリックするか、左の一覧から選んでください。背景をダブルクリックすると、新しい駅を作成できます。'));
      return;
    }

    workspace.right.appendChild(h('div', { class: 'g-field' },
      h('span', { class: 'g-field__label' }, '駅ID'),
      h('div', {}, station.id)
    ));

    const nameInput = h('input', { type: 'text', class: 'g-input', value: station.name });
    nameInput.addEventListener('change', async () => {
      const value = nameInput.value.trim();
      if (!value) {
        nameInput.value = station.name;
        await alertDialog('駅名を入力してください。');
        return;
      }
      applyStationPatch(station.id, { name: value });
    });
    workspace.right.appendChild(h('div', { class: 'g-field' },
      h('label', { class: 'g-field__label' }, '駅名'),
      nameInput
    ));

    const kanaInput = h('input', { type: 'text', class: 'g-input', value: station.kana || '' });
    kanaInput.addEventListener('change', () => {
      applyStationPatch(station.id, { kana: kanaInput.value.trim() });
    });
    workspace.right.appendChild(h('div', { class: 'g-field' },
      h('label', { class: 'g-field__label' }, 'かな'),
      kanaInput
    ));

    workspace.right.appendChild(renderPlatformsSection(station));
    workspace.right.appendChild(renderUsageSection(station));

    const deleteBtn = h('button', {
      type: 'button',
      class: 'g-btn g-btn--danger',
      onClick: async () => {
        const refs = findReferences(network, operations, { type: 'station', id: station.id });
        if (refs.length > 0) {
          await alertDialog('使われているため削除できません。');
          return;
        }
        const ok = await confirmDialog(`駅「${station.name}」を削除します。`, { confirmLabel: '駅を削除', danger: true });
        if (!ok) return;
        store.mutateDoc('network', (doc) => {
          doc.stations = doc.stations.filter((s) => s.id !== station.id);
        });
        layoutStore.removePosition(station.id);
        ui.selectedId = null;
        resyncPositions();
        refreshView();
      }
    }, icon('trash'), '駅を削除');
    workspace.right.appendChild(deleteBtn);
  }

  function applyStationPatch(stationId, patch) {
    store.mutateDoc('network', (doc) => {
      const idx = doc.stations.findIndex((s) => s.id === stationId);
      if (idx === -1) return;
      doc.stations[idx] = stationOps.updateStation(doc.stations[idx], patch);
    });
    refreshView();
  }

  function renderPlatformsSection(station) {
    const section = h('div', { class: 'g-field' }, h('span', { class: 'g-field__label' }, 'のりば'));
    const list = h('div', { class: 'g-list' });

    station.platforms.forEach((platform, index) => {
      if (blockedPlatformId === platform.id) {
        const refs = findReferences(network, operations, { type: 'platform', stationId: station.id, id: platform.id });
        list.appendChild(h('div', { class: 'g-list__row' },
          h('div', { class: 'g-field__error' }, '使われているため削除できません。'),
          renderRefList(refs, requestNavigate),
          h('button', { type: 'button', class: 'g-btn g-btn--small', onClick: () => { blockedPlatformId = null; refreshView(); } }, '閉じる')
        ));
        return;
      }

      const labelInput = h('input', { type: 'text', class: 'g-input', value: platform.label });
      labelInput.addEventListener('change', () => {
        store.mutateDoc('network', (doc) => {
          const idx = doc.stations.findIndex((s) => s.id === station.id);
          if (idx === -1) return;
          doc.stations[idx] = stationOps.renamePlatform(doc.stations[idx], platform.id, labelInput.value.trim());
        });
        refreshView();
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
          store.mutateDoc('network', (doc) => {
            const idx = doc.stations.findIndex((s) => s.id === station.id);
            if (idx === -1) return;
            doc.stations[idx] = stationOps.movePlatform(doc.stations[idx], from, index);
          });
          refreshView();
        }
      },
        h('span', { class: 'g-rb-item__grabber', 'aria-hidden': 'true' }, icon('grabber', { size: 12 })),
        labelInput,
        h('span', { class: 'g-list__item-id' }, platform.id),
        h('button', {
          type: 'button',
          class: 'g-icon-btn',
          'aria-label': 'のりばを削除',
          title: 'のりばを削除',
          onClick: () => {
            const refs = findReferences(network, operations, { type: 'platform', stationId: station.id, id: platform.id });
            if (refs.length > 0) {
              blockedPlatformId = platform.id;
              refreshView();
              return;
            }
            store.mutateDoc('network', (doc) => {
              const idx = doc.stations.findIndex((s) => s.id === station.id);
              if (idx === -1) return;
              doc.stations[idx] = stationOps.removePlatform(doc.stations[idx], platform.id);
            });
            refreshView();
          }
        }, icon('trash'))
      );
      list.appendChild(row);
    });

    section.appendChild(list);
    section.appendChild(renderAddPlatformForm(station));
    return section;
  }

  function renderAddPlatformForm(station) {
    let idDirty = false;
    const errorEl = h('div', { class: 'g-field__error' });

    const idInput = h('input', { type: 'text', class: 'g-input', value: suggestPlatformId('', station.platforms.map((p) => p.id)) });
    idInput.addEventListener('input', () => { idDirty = true; });

    const labelInput = h('input', { type: 'text', class: 'g-input', placeholder: '表示名' });
    labelInput.addEventListener('input', () => {
      if (idDirty) return;
      idInput.value = suggestPlatformId(labelInput.value.trim(), station.platforms.map((p) => p.id));
    });

    const submit = () => {
      const platform = { id: idInput.value.trim(), label: labelInput.value.trim() };
      const err = stationOps.validatePlatformDraft(station.platforms, platform);
      if (err) { errorEl.textContent = err; return; }
      store.mutateDoc('network', (doc) => {
        const idx = doc.stations.findIndex((s) => s.id === station.id);
        if (idx === -1) return;
        doc.stations[idx] = stationOps.addPlatform(doc.stations[idx], platform);
      });
      refreshView();
    };

    return h('div', { class: 'g-add-platform-form' },
      labelInput,
      h('details', {},
        h('summary', {}, '詳細（IDを変更）'),
        idInput
      ),
      errorEl,
      h('button', { type: 'button', class: 'g-btn', onClick: submit }, icon('plus'), 'のりばを追加')
    );
  }

  function renderUsageSection(station) {
    const refs = findReferences(network, operations, { type: 'station', id: station.id });
    const section = h('div', { class: 'g-field' }, h('span', { class: 'g-field__label' }, 'この駅を使っているもの'));
    if (refs.length > 0) section.appendChild(renderRefList(refs, requestNavigate));
    return section;
  }

  function refreshView() {
    drawCanvas();
    renderLeftList();
    renderRightPanel();
  }

  function openCreatePopover(clientX, clientY, worldPos) {
    const idInput = h('input', { type: 'text', class: 'g-input', placeholder: '例: KL01' });
    const nameInput = h('input', { type: 'text', class: 'g-input' });
    const kanaInput = h('input', { type: 'text', class: 'g-input' });
    const errorEl = h('div', { class: 'g-field__error' });

    const submit = () => {
      const draft = stationOps.createStation(idInput.value.trim(), nameInput.value.trim(), kanaInput.value.trim());
      const err = stationOps.validateStationDraft(network, draft, true);
      if (err) { errorEl.textContent = err; return; }
      store.mutateDoc('network', (doc) => { doc.stations.push(draft); });
      layoutStore.savePosition(draft.id, worldPos);
      resyncPositions();
      ui.selectedId = draft.id;
      close();
      refreshView();
    };

    const form = h('div', { class: 'g-popover-form' },
      h('div', { class: 'g-field' },
        h('label', { class: 'g-field__label' }, '駅ID'),
        idInput,
        h('div', { class: 'g-field__hint' }, '英数字・_・- のみ、1〜64文字')
      ),
      h('div', { class: 'g-field' }, h('label', { class: 'g-field__label' }, '駅名'), nameInput),
      h('div', { class: 'g-field' }, h('label', { class: 'g-field__label' }, 'かな'), kanaInput),
      errorEl,
      h('div', { class: 'g-popover-actions' },
        h('button', { type: 'button', class: 'g-btn', onClick: () => close() }, 'キャンセル'),
        h('button', { type: 'button', class: 'g-btn g-btn--primary', onClick: submit }, '駅を作成')
      )
    );

    const close = openPopover(clientX, clientY, form);
  }

  function onKeyDown(event) {
    if (event.key !== 'Delete') return;
    const tag = document.activeElement && document.activeElement.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
    if (document.querySelector('.g-dialog-backdrop')) return;
    if (!ui.selectedId) return;
    event.preventDefault();
    const deleteBtn = workspace.right.querySelector('.g-btn--danger');
    if (deleteBtn) deleteBtn.click();
  }
  window.addEventListener('keydown', onKeyDown);

  drawCanvas();
  renderLeftList();
  renderRightPanel();

  const { fitAll } = attachCanvasToolbar(workspace, canvas, {
    getBounds: () => boundsOf([...positions.values()]),
    onReset: () => { resyncPositions(); refreshView(); }
  });
  if (!canvas.hasSavedViewport) fitAll();

  if (focus && focus.id) {
    selectFromList(focus.id);
  }

  return {
    destroy() {
      window.removeEventListener('keydown', onKeyDown);
      canvas.destroy();
    }
  };
}

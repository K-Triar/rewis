import { h, clear } from '../dom.js';
import { alertDialog } from '../components/dialog.js';
import { createStationPicker } from '../components/station-picker.js';
import { isValidId } from '../../shared/ids.js';
import { findReferences } from '../refs.js';

function stationLabel(network, stationId) {
  const station = network.stations.find((s) => s.id === stationId);
  return station ? `${station.name}（${stationId}）` : stationId;
}

function shapeOf(line) {
  if (!line.loop) return 'normal';
  return line.loop.startIndex === 0 ? 'circular' : 'racket';
}

function attachDragReorder(row, index, array, onReordered) {
  row.draggable = true;
  row.classList.add('ed2-drag-row');
  row.addEventListener('dragstart', (e) => {
    e.dataTransfer.setData('text/plain', String(index));
  });
  row.addEventListener('dragover', (e) => {
    e.preventDefault();
    row.classList.add('ed2-drag-over');
  });
  row.addEventListener('dragleave', () => {
    row.classList.remove('ed2-drag-over');
  });
  row.addEventListener('drop', (e) => {
    e.preventDefault();
    row.classList.remove('ed2-drag-over');
    const fromIndex = Number(e.dataTransfer.getData('text/plain'));
    if (Number.isNaN(fromIndex) || fromIndex === index) return;
    const [moved] = array.splice(fromIndex, 1);
    array.splice(index, 0, moved);
    onReordered();
  });
}

export function renderLinesView(container, ctx) {
  clear(container);
  const { store, refreshAll } = ctx;
  const network = store.state.docs.network;

  if (!network) {
    container.appendChild(emptyNotice());
    return;
  }

  let expandedId = null; // null | '__new__' | 路線ID
  let deletingId = null;

  function render() {
    clear(container);

    container.appendChild(h('div', { class: 'section-header' },
      h('h2', {}, '路線'),
      h('button', { class: 'add-btn', type: 'button', onClick: () => { expandedId = '__new__'; render(); } }, '+ 追加')
    ));

    const tbody = h('tbody', {});
    network.lines.forEach((line) => tbody.appendChild(renderLineRow(line)));
    container.appendChild(h('div', { class: 'table-container' },
      h('table', { class: 'data-table' },
        h('thead', {}, h('tr', {},
          h('th', {}, '路線ID'), h('th', {}, '路線名'), h('th', {}, '会社'),
          h('th', {}, '色'), h('th', {}, '車両種別'), h('th', {}, '駅数'),
          h('th', {}, '種別数'), h('th', {}, '形状'), h('th', { style: 'width:180px' }, '操作')
        )),
        tbody
      )
    ));

    const detailContainer = h('div', {});
    container.appendChild(detailContainer);
    if (expandedId === '__new__') {
      detailContainer.appendChild(renderLineForm(null));
    } else if (expandedId) {
      const line = network.lines.find((l) => l.id === expandedId);
      if (line) detailContainer.appendChild(renderLineForm(line));
    }
  }

  function shapeLabel(line) {
    const shape = shapeOf(line);
    if (shape === 'circular') return '環状線';
    if (shape === 'racket') return 'ラケット型';
    return '普通';
  }

  function renderLineRow(line) {
    if (deletingId === line.id) {
      const refs = findReferences(network, store.state.docs.operations, { type: 'line', id: line.id });
      if (refs.length > 0) {
        return h('tr', {},
          h('td', {}, line.id),
          h('td', { colspan: '8' },
            h('span', { class: 'ed2-issue-error' }, `削除できません。参照箇所: ${refs.map((r) => r.label).join(' / ')}`),
            ' ',
            h('button', { class: 'preview-btn', type: 'button', onClick: () => { deletingId = null; render(); } }, '閉じる')
          )
        );
      }
      return h('tr', {},
        h('td', {}, line.id),
        h('td', { colspan: '7' }, line.name),
        h('td', {},
          h('button', {
            class: 'export-btn',
            type: 'button',
            onClick: () => {
              store.mutateDoc('network', (doc) => {
                doc.lines = doc.lines.filter((l) => l.id !== line.id);
              });
              deletingId = null;
              if (expandedId === line.id) expandedId = null;
              render();
              refreshAll();
            }
          }, '削除する'),
          h('button', { class: 'preview-btn', type: 'button', onClick: () => { deletingId = null; render(); } }, 'キャンセル')
        )
      );
    }

    const company = network.companies.find((c) => c.id === line.companyId);
    const vehicleType = network.vehicleTypes.find((v) => v.id === line.vehicleTypeId);

    return h('tr', {},
      h('td', {}, line.id),
      h('td', {}, line.name),
      h('td', {}, company ? company.name : line.companyId),
      h('td', {}, h('span', { style: `display:inline-block;width:14px;height:14px;border:1px solid #999;background:${line.color || '#ccc'};` })),
      h('td', {}, vehicleType ? vehicleType.shortName : line.vehicleTypeId),
      h('td', {}, String((line.stations || []).length)),
      h('td', {}, String((line.categories || []).length)),
      h('td', {}, shapeLabel(line)),
      h('td', {},
        h('button', {
          class: 'preview-btn',
          type: 'button',
          onClick: () => { expandedId = expandedId === line.id ? null : line.id; render(); }
        }, expandedId === line.id ? '閉じる' : '詳細'),
        h('button', { class: 'preview-btn', type: 'button', onClick: () => { deletingId = line.id; render(); } }, '削除')
      )
    );
  }

  function renderLineForm(line) {
    const isNew = !line;

    const idInput = h('input', { type: 'text', value: isNew ? '' : line.id, disabled: !isNew, placeholder: '例: KT-L' });
    const nameInput = h('input', { type: 'text', value: isNew ? '' : line.name, placeholder: '路線名' });
    const colorInput = h('input', { type: 'color', value: isNew ? '#3498db' : (line.color || '#3498db') });

    const companySelect = h('select', {},
      ...network.companies.map((c) => h('option', { value: c.id }, c.name))
    );
    companySelect.value = isNew ? (network.companies[0] ? network.companies[0].id : '') : line.companyId;

    const vehicleTypeSelect = h('select', {},
      ...network.vehicleTypes.map((v) => h('option', { value: v.id }, v.name))
    );
    vehicleTypeSelect.value = isNew ? (network.vehicleTypes[0] ? network.vehicleTypes[0].id : '') : line.vehicleTypeId;

    let categories = isNew ? [] : line.categories.map((c) => ({ ...c }));
    let stations = isNew ? [] : line.stations.slice();
    let loop = isNew ? null : (line.loop ? { ...line.loop } : null);
    const directions = isNew
      ? { forward: '下り線', backward: '上り線' }
      : { forward: line.directions.forward, backward: line.directions.backward };

    // --- 種別 ---
    const categoriesTbody = h('tbody', {});
    function renderCategories() {
      clear(categoriesTbody);
      categories.forEach((category, index) => {
        const idInputC = h('input', { type: 'text', value: category.id, style: 'width:80px', disabled: !isNew && !category.__new });
        const nameInputC = h('input', { type: 'text', value: category.name, style: 'width:120px' });
        idInputC.addEventListener('change', () => { category.id = idInputC.value.trim(); });
        nameInputC.addEventListener('change', () => { category.name = nameInputC.value.trim(); });

        const upBtn = h('button', {
          class: 'preview-btn', type: 'button', disabled: index === 0,
          onClick: () => { [categories[index - 1], categories[index]] = [categories[index], categories[index - 1]]; renderCategories(); }
        }, '▲');
        const downBtn = h('button', {
          class: 'preview-btn', type: 'button', disabled: index === categories.length - 1,
          onClick: () => { [categories[index + 1], categories[index]] = [categories[index], categories[index + 1]]; renderCategories(); }
        }, '▼');
        const deleteBtn = h('button', {
          class: 'preview-btn', type: 'button',
          onClick: async () => {
            if (!isNew) {
              const refs = findReferences(network, store.state.docs.operations, { type: 'category', lineId: line.id, id: category.id });
              if (refs.length > 0) {
                await alertDialog(`この種別は削除できません。参照箇所: ${refs.map((r) => r.label).join(' / ')}`);
                return;
              }
            }
            categories = categories.filter((c) => c !== category);
            renderCategories();
          }
        }, '削除');

        const row = h('tr', {}, h('td', {}, idInputC), h('td', {}, nameInputC), h('td', {}, upBtn, downBtn, deleteBtn));
        attachDragReorder(row, index, categories, renderCategories);
        categoriesTbody.appendChild(row);
      });
    }
    renderCategories();

    const newCategoryId = h('input', { type: 'text', placeholder: '種別ID', style: 'width:80px' });
    const newCategoryName = h('input', { type: 'text', placeholder: '種別名', style: 'width:120px' });
    const addCategoryBtn = h('button', {
      class: 'preview-btn', type: 'button',
      onClick: async () => {
        const id = newCategoryId.value.trim();
        const name = newCategoryName.value.trim();
        if (!isValidId(id)) { await alertDialog('種別IDの書式が不正です。'); return; }
        if (categories.some((c) => c.id === id)) { await alertDialog('同じIDの種別が既にあります。'); return; }
        if (!name) { await alertDialog('種別名を入力してください。'); return; }
        categories.push({ id, name, __new: true });
        newCategoryId.value = '';
        newCategoryName.value = '';
        renderCategories();
      }
    }, '+ 種別追加');

    // --- 駅順 ---
    const stationsTbody = h('tbody', {});
    function renderStations() {
      clear(stationsTbody);
      stations.forEach((stationId, index) => {
        const upBtn = h('button', {
          class: 'preview-btn', type: 'button', disabled: index === 0,
          onClick: () => { [stations[index - 1], stations[index]] = [stations[index], stations[index - 1]]; renderStations(); renderLoopSelect(); }
        }, '▲');
        const downBtn = h('button', {
          class: 'preview-btn', type: 'button', disabled: index === stations.length - 1,
          onClick: () => { [stations[index + 1], stations[index]] = [stations[index], stations[index + 1]]; renderStations(); renderLoopSelect(); }
        }, '▼');
        const deleteBtn = h('button', {
          class: 'preview-btn', type: 'button',
          onClick: () => { stations = stations.filter((s, i) => i !== index); renderStations(); renderLoopSelect(); }
        }, '削除');
        const row = h('tr', {}, h('td', {}, String(index)), h('td', {}, stationLabel(network, stationId)), h('td', {}, upBtn, downBtn, deleteBtn));
        attachDragReorder(row, index, stations, () => { renderStations(); renderLoopSelect(); });
        stationsTbody.appendChild(row);
      });
    }
    renderStations();

    const picker = createStationPicker(network.stations, (stationId) => {
      if (stations.includes(stationId)) {
        alertDialog('同じ駅が既に駅順に含まれています（ラケット型で同じ駅を2回通る場合を除き、通常は重複させません）。');
      }
      stations.push(stationId);
      renderStations();
      renderLoopSelect();
    });

    // --- 形状 ---
    let shape = shapeOf(line || { loop });
    const shapeRadios = {};
    ['normal', 'circular', 'racket'].forEach((value) => {
      const radio = h('input', { type: 'radio', name: 'ed2-line-shape', value });
      radio.checked = shape === value;
      radio.addEventListener('change', () => {
        shape = value;
        if (value === 'normal') loop = null;
        else if (value === 'circular') loop = { startIndex: 0 };
        else loop = { startIndex: stations.length > 0 ? Math.min(loop?.startIndex || 1, stations.length - 1) : 0 };
        renderLoopSelect();
        renderDirectionHints();
      });
      shapeRadios[value] = radio;
    });

    const loopSelectContainer = h('div', {});
    function renderLoopSelect() {
      clear(loopSelectContainer);
      if (shape !== 'racket') return;
      const select = h('select', {}, ...stations.map((stationId, index) => h('option', { value: String(index) }, `${index}: ${stationLabel(network, stationId)}`)));
      select.value = String(loop ? Math.min(loop.startIndex, Math.max(stations.length - 1, 0)) : 0);
      select.addEventListener('change', () => { loop = { startIndex: Number(select.value) }; });
      loopSelectContainer.appendChild(h('label', {}, '戻る駅: ', select));
    }
    renderLoopSelect();

    // --- 方向名 ---
    const forwardInput = h('input', { type: 'text', value: directions.forward });
    const backwardInput = h('input', { type: 'text', value: directions.backward });
    const directionHints = h('div', {});
    function renderDirectionHints() {
      clear(directionHints);
      if (shape === 'circular') {
        directionHints.appendChild(h('button', { class: 'preview-btn', type: 'button', onClick: () => { forwardInput.value = '外回り'; } }, '外回りにする'));
        directionHints.appendChild(h('button', { class: 'preview-btn', type: 'button', onClick: () => { backwardInput.value = '内回り'; } }, '内回りにする'));
      }
    }
    renderDirectionHints();

    async function save() {
      const id = isNew ? idInput.value.trim() : line.id;
      const name = nameInput.value.trim();
      if (isNew) {
        if (!isValidId(id)) { await alertDialog('路線IDの書式が不正です。'); return; }
        if (network.lines.some((l) => l.id === id)) { await alertDialog('同じIDの路線が既にあります。'); return; }
      }
      if (!name) { await alertDialog('路線名を入力してください。'); return; }
      if (categories.length === 0) { await alertDialog('種別を1つ以上追加してください。'); return; }

      const categoryIds = new Set();
      for (const c of categories) {
        if (!isValidId(c.id)) { await alertDialog(`種別ID「${c.id}」の書式が不正です。`); return; }
        if (categoryIds.has(c.id)) { await alertDialog(`種別ID「${c.id}」が重複しています。`); return; }
        categoryIds.add(c.id);
      }

      const cleanedCategories = categories.map(({ id: cid, name: cname }) => ({ id: cid, name: cname }));
      const record = {
        id,
        name,
        companyId: companySelect.value,
        color: colorInput.value,
        vehicleTypeId: vehicleTypeSelect.value,
        stations: stations.slice(),
        loop: loop ? { startIndex: loop.startIndex } : null,
        directions: { forward: forwardInput.value.trim(), backward: backwardInput.value.trim() },
        categories: cleanedCategories
      };

      if (isNew) {
        store.mutateDoc('network', (doc) => doc.lines.push(record));
        expandedId = null;
      } else {
        store.mutateDoc('network', (doc) => {
          const idx = doc.lines.findIndex((l) => l.id === line.id);
          if (idx !== -1) doc.lines[idx] = record;
        });
      }
      render();
      refreshAll();
    }

    return h('div', { class: 'export-card' },
      h('h3', {}, isNew ? '路線を追加' : `路線を編集: ${line.id}`),
      h('div', { class: 'worker-config-grid' },
        h('label', {}, '路線ID'), idInput,
        h('label', {}, '路線名'), nameInput,
        h('label', {}, '会社'), companySelect,
        h('label', {}, '色'), colorInput,
        h('label', {}, '車両種別'), vehicleTypeSelect
      ),

      h('h4', {}, '種別'),
      h('div', { class: 'table-container' },
        h('table', { class: 'data-table' },
          h('thead', {}, h('tr', {}, h('th', {}, 'ID'), h('th', {}, '名前'), h('th', {}, '操作'))),
          categoriesTbody
        )
      ),
      h('div', { class: 'worker-config-actions' }, newCategoryId, newCategoryName, addCategoryBtn),

      h('h4', {}, '駅順'),
      h('div', { class: 'table-container' },
        h('table', { class: 'data-table' },
          h('thead', {}, h('tr', {}, h('th', {}, '#'), h('th', {}, '駅'), h('th', {}, '操作'))),
          stationsTbody
        )
      ),
      h('div', { class: 'worker-config-actions' }, picker),

      h('h4', {}, '形状'),
      h('div', { class: 'worker-config-actions' },
        h('label', {}, shapeRadios.normal, ' 普通の路線'),
        h('label', {}, shapeRadios.circular, ' 環状線'),
        h('label', {}, shapeRadios.racket, ' ラケット型')
      ),
      loopSelectContainer,

      h('h4', {}, '方向名'),
      h('div', { class: 'worker-config-grid' },
        h('label', {}, 'forward（駅順どおり）'), forwardInput,
        h('label', {}, 'backward（逆向き）'), backwardInput
      ),
      directionHints,

      h('div', { class: 'worker-config-actions' },
        h('button', { class: 'export-btn', type: 'button', onClick: save }, isNew ? '追加する' : '保存'),
        h('button', { class: 'preview-btn', type: 'button', onClick: () => { expandedId = null; render(); } }, 'キャンセル')
      )
    );
  }

  render();
}

function emptyNotice() {
  const p = document.createElement('p');
  p.className = 'ed2-placeholder';
  p.textContent = '先に「保存/読込」タブで路線網 (network) を読み込んでください。';
  return p;
}

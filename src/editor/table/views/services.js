import { h, clear } from '../../common/dom.js';
import { alertDialog } from '../../common/components/dialog.js';
import { createStationPicker } from '../components/station-picker.js';
import { attachDragReorder } from '../components/drag-reorder.js';
import { newId } from '../../../shared/ids.js';

export function stationName(network, stationId) {
  const station = network.stations.find((s) => s.id === stationId);
  return station ? station.name : stationId;
}

function lineName(network, lineId) {
  const line = network.lines.find((l) => l.id === lineId);
  return line ? line.name : lineId;
}

function categoryName(network, lineId, categoryId) {
  const line = network.lines.find((l) => l.id === lineId);
  const category = line && (line.categories || []).find((c) => c.id === categoryId);
  return category ? category.name : categoryId;
}

function lineColor(network, lineId) {
  const line = network.lines.find((l) => l.id === lineId);
  return (line && line.color) || 'var(--fgColor-muted)';
}

// sections（保存済みの形）を、停車駅の間ごとの「路線・種別」の配列に展開する
export function expandSectionsToSegments(sections, stopsLength) {
  const segments = new Array(Math.max(stopsLength - 1, 0));
  (sections || []).forEach((sec) => {
    for (let i = sec.from; i < sec.to; i++) {
      segments[i] = { lineId: sec.lineId, categoryId: sec.categoryId };
    }
  });
  return segments;
}

// 停車駅の間ごとの「路線・種別」の配列から、連続する組み合わせをまとめてsectionsを作る
export function buildSectionsFromSegments(segments) {
  if (segments.length === 0) return [];
  const sections = [];
  let start = 0;
  for (let i = 1; i <= segments.length; i++) {
    const cur = segments[start];
    const next = i < segments.length ? segments[i] : null;
    if (!next || !cur || next.lineId !== cur.lineId || next.categoryId !== cur.categoryId) {
      sections.push({ lineId: cur.lineId, categoryId: cur.categoryId, from: start, to: i });
      start = i;
    }
  }
  return sections;
}

export function summarizeSections(network, sections) {
  return sections.map((s) => `${lineName(network, s.lineId)} ${categoryName(network, s.lineId, s.categoryId)}`).join(' → ');
}

export function totalRun(service) {
  return (service.stops || []).reduce((sum, stop) => sum + (Number.isFinite(stop.run) ? stop.run : 0), 0);
}

function defaultLineCategory(network) {
  const line = network.lines[0];
  const category = line && line.categories[0];
  return { lineId: line ? line.id : '', categoryId: category ? category.id : '' };
}

export function reverseService(network, service) {
  const stops = service.stops;
  const n = stops.length;
  const newStops = stops.slice().reverse().map((s) => ({ ...s }));

  if (service.circular) {
    // runは折り返しを含めた全区間（stops[i]→stops[(i+1)%n]）で、wrap分（最後→最初）は向きを変えても同じ
    const runs = stops.map((s) => s.run);
    const newRuns = new Array(n);
    for (let j = 0; j <= n - 2; j++) newRuns[j] = runs[n - 2 - j];
    newRuns[n - 1] = runs[n - 1];
    newStops.forEach((s, j) => { s.run = newRuns[j]; });
  } else {
    const runs = stops.slice(0, n - 1).map((s) => s.run);
    const newRuns = runs.slice().reverse();
    newStops.forEach((s, j) => {
      if (j < n - 1) s.run = newRuns[j];
      else delete s.run;
    });
  }

  let sections;
  if (service.circular) {
    // circularはsectionが1つだけなので、路線・種別はそのまま
    sections = [{ ...service.sections[0], from: 0, to: n - 1 }];
  } else {
    const segments = expandSectionsToSegments(service.sections, n);
    const newSegments = segments.slice().reverse();
    sections = buildSectionsFromSegments(newSegments);
  }

  return {
    id: newId('sv'),
    name: service.name || '',
    headsign: service.circular ? null : stationName(network, stops[0].stationId),
    active: service.active,
    circular: service.circular,
    stops: newStops,
    sections
  };
}

export function renderServicesView(container, ctx) {
  clear(container);
  const { store, refreshAll, focus } = ctx;
  const network = store.state.docs.network;

  if (!network) {
    container.appendChild(emptyNotice());
    return;
  }

  const focusServiceId = focus && focus.tab === 'services' ? focus.id : null;
  let filterLineId = '';
  let filterCategoryId = '';
  let expandedId = focusServiceId; // null | '__new__' | 運行系統ID
  let deletingId = null;
  let scrolledToFocus = false;
  let pendingScroll = null; // { type: 'top' } | { type: 'row', id }

  function serviceWarningCount(index) {
    const warnings = store.state.validation.network.warnings || [];
    const prefix = `services[${index}]`;
    return warnings.filter((w) => w.path && w.path.startsWith(prefix)).length;
  }

  function matchesFilter(service) {
    if (!filterLineId) return true;
    const sections = service.sections || [];
    if (!sections.some((s) => s.lineId === filterLineId)) return false;
    if (!filterCategoryId) return true;
    return sections.some((s) => s.lineId === filterLineId && s.categoryId === filterCategoryId);
  }

  function render() {
    clear(container);

    container.appendChild(h('div', { class: 'g-section-header' },
      h('h2', {}, '運行系統'),
      h('button', { class: 'g-btn g-btn--primary', type: 'button', onClick: () => { expandedId = '__new__'; pendingScroll = { type: 'top' }; render(); } }, '+ 追加')
    ));

    const lineFilterSelect = h('select', { class: 'g-select' }, h('option', { value: '' }, '全路線'), ...network.lines.map((l) => h('option', { value: l.id }, l.name)));
    lineFilterSelect.value = filterLineId;
    lineFilterSelect.addEventListener('change', () => {
      filterLineId = lineFilterSelect.value;
      filterCategoryId = '';
      render();
    });

    const selectedLine = network.lines.find((l) => l.id === filterLineId);
    const categoryFilterSelect = h('select', { class: 'g-select', disabled: !selectedLine },
      h('option', { value: '' }, '全種別'),
      ...(selectedLine ? selectedLine.categories.map((c) => h('option', { value: c.id }, c.name)) : [])
    );
    categoryFilterSelect.value = filterCategoryId;
    categoryFilterSelect.addEventListener('change', () => {
      filterCategoryId = categoryFilterSelect.value;
      render();
    });

    container.appendChild(h('div', { class: 'g-actions-row' },
      h('label', { class: 'g-field__label' }, '路線で絞込: ', lineFilterSelect),
      h('label', { class: 'g-field__label' }, '種別で絞込: ', categoryFilterSelect)
    ));

    const detailContainer = h('div', {});
    container.appendChild(detailContainer);

    const tbody = h('tbody', {});
    network.services.forEach((service) => {
      if (!matchesFilter(service)) return;
      tbody.appendChild(renderServiceRow(service));
    });

    container.appendChild(h('div', { class: 'ed2-list-scroll g-table-wrap' },
      h('table', { class: 'g-table' },
        h('thead', {}, h('tr', {},
          h('th', {}, '行先'), h('th', {}, '区間'), h('th', {}, '停車数'),
          h('th', {}, '所要時間'), h('th', {}, '有効'), h('th', {}, '警告'), h('th', { style: 'width:220px' }, '操作')
        )),
        tbody
      )
    ));

    if (expandedId === '__new__') {
      detailContainer.appendChild(renderServiceForm(null));
    } else if (expandedId) {
      const service = network.services.find((sv) => sv.id === expandedId);
      if (service) detailContainer.appendChild(renderServiceForm(service));
    }
    if (focusServiceId && !scrolledToFocus && expandedId === focusServiceId && detailContainer.firstChild) {
      detailContainer.scrollIntoView({ block: 'center' });
      scrolledToFocus = true;
    }
    if (pendingScroll) {
      const action = pendingScroll;
      pendingScroll = null;
      if (action.type === 'top') {
        detailContainer.scrollIntoView({ block: 'start' });
      } else if (action.type === 'row') {
        const row = tbody.querySelector(`[data-row-id="${action.id}"]`);
        if (row) row.scrollIntoView({ block: 'center' });
      }
    }
  }

  function renderServiceRow(service) {
    const index = network.services.indexOf(service);

    if (deletingId === service.id) {
      return h('tr', {},
        h('td', { colspan: '6' }, `「${service.headsign || service.id}」を削除しますか？`),
        h('td', {},
          h('button', {
            class: 'g-btn g-btn--danger g-btn--small', type: 'button',
            onClick: () => {
              store.mutateDoc('network', (doc) => { doc.services = doc.services.filter((sv) => sv.id !== service.id); });
              deletingId = null;
              if (expandedId === service.id) expandedId = null;
              render();
              refreshAll();
            }
          }, '削除する'),
          h('button', { class: 'g-btn g-btn--small', type: 'button', onClick: () => { deletingId = null; render(); } }, 'キャンセル')
        )
      );
    }

    return h('tr', { class: expandedId === service.id ? 'is-editing' : null, 'data-row-id': service.id },
      h('td', {}, service.circular ? '（環状）' : (service.headsign || '')),
      h('td', {}, summarizeSections(network, service.sections || [])),
      h('td', {}, String((service.stops || []).length)),
      h('td', {}, `${totalRun(service)}秒`),
      h('td', {}, service.active === false ? '無効' : '有効'),
      h('td', {}, String(serviceWarningCount(index))),
      h('td', {},
        h('button', {
          class: 'g-btn g-btn--small', type: 'button',
          onClick: () => {
            const opening = expandedId !== service.id;
            pendingScroll = opening ? { type: 'top' } : { type: 'row', id: service.id };
            expandedId = opening ? service.id : null;
            render();
          }
        }, expandedId === service.id ? '閉じる' : '詳細'),
        h('button', {
          class: 'g-btn g-btn--small', type: 'button',
          onClick: () => {
            const clone = JSON.parse(JSON.stringify(service));
            clone.id = newId('sv');
            clone.name = (clone.name || '') + '（複製）';
            store.mutateDoc('network', (doc) => doc.services.push(clone));
            expandedId = clone.id;
            pendingScroll = { type: 'top' };
            render();
            refreshAll();
          }
        }, '複製'),
        h('button', {
          class: 'g-btn g-btn--small', type: 'button',
          onClick: async () => {
            const reversed = reverseService(network, service);
            store.mutateDoc('network', (doc) => doc.services.push(reversed));
            expandedId = reversed.id;
            pendingScroll = { type: 'top' };
            render();
            refreshAll();
            await alertDialog('逆方向の運行系統を作成しました。のりばを確認してください。');
          }
        }, '逆方向を作成'),
        h('button', { class: 'g-btn g-btn--small', type: 'button', onClick: () => { deletingId = service.id; render(); } }, '削除')
      )
    );
  }

  function renderServiceForm(service) {
    const isNew = !service;
    const nameInput = h('input', { type: 'text', class: 'g-input', value: isNew ? '' : (service.name || ''), placeholder: 'メモ（任意）' });
    const headsignInput = h('input', { type: 'text', class: 'g-input', value: isNew ? '' : (service.headsign || ''), placeholder: '行先' });
    const activeInput = h('input', { type: 'checkbox' });
    activeInput.checked = isNew ? true : service.active !== false;
    const circularInput = h('input', { type: 'checkbox' });
    circularInput.checked = isNew ? false : !!service.circular;

    let stops = isNew ? [] : service.stops.map((s) => ({ ...s }));
    let segments = isNew ? [] : expandSectionsToSegments(service.sections, stops.length);
    let circularCategory = isNew
      ? defaultLineCategory(network)
      : (service.circular && service.sections[0] ? { lineId: service.sections[0].lineId, categoryId: service.sections[0].categoryId } : defaultLineCategory(network));

    const stopsTbody = h('tbody', {});
    const previewContainer = h('div', { class: 'g-table-wrap ed2-subtable' });

    function isCircular() {
      return circularInput.checked;
    }

    function renderPreview() {
      clear(previewContainer);
      if (stops.length === 0) return;
      const items = stops.map((stop, i) => {
        const seg = isCircular() ? circularCategory : segments[i];
        const nextSeg = isCircular() ? circularCategory : segments[i - 1];
        const color = seg ? lineColor(network, seg.lineId) : (nextSeg ? lineColor(network, nextSeg.lineId) : 'var(--fgColor-muted)');
        const isBoundary = i > 0 && !isCircular() && segments[i - 1] && segments[i] &&
          (segments[i - 1].lineId !== segments[i].lineId || segments[i - 1].categoryId !== segments[i].categoryId);
        return h('span', { style: `display:inline-block;padding:2px 6px;margin:2px;border-left:4px solid ${color};background:var(--bgColor-muted);border-radius:var(--borderRadius-small);` },
          stationName(network, stop.stationId),
          isBoundary ? h('span', { class: 'g-text-attention' }, ' [直通]') : ''
        );
      });
      previewContainer.appendChild(h('div', { style: 'padding:var(--space-sm);' }, ...items));
    }

    function renderStops() {
      clear(stopsTbody);
      stops.forEach((stop, index) => {
        stopsTbody.appendChild(renderStopRow(stop, index));
      });
      renderPreview();
    }

    function renderStopRow(stop, index) {
      const station = network.stations.find((s) => s.id === stop.stationId);
      const platforms = station ? station.platforms : [];

      const platformSelect = h('select', { class: 'g-select' },
        h('option', { value: '' }, '（指定なし）'),
        ...platforms.map((p) => h('option', { value: p.id }, p.label))
      );
      platformSelect.value = stop.platformId || '';
      platformSelect.addEventListener('change', () => { stop.platformId = platformSelect.value || null; });

      const boardInput = h('input', { type: 'checkbox' });
      boardInput.checked = stop.board !== false;
      boardInput.addEventListener('change', () => { stop.board = boardInput.checked; });

      const alightInput = h('input', { type: 'checkbox' });
      alightInput.checked = stop.alight !== false;
      alightInput.addEventListener('change', () => { stop.alight = alightInput.checked; });

      const isLast = index === stops.length - 1;
      const needsRun = !isLast || isCircular();

      const runInput = h('input', { type: 'number', class: 'g-input', min: '0', step: '1', style: 'width:70px', disabled: !needsRun });
      runInput.value = Number.isFinite(stop.run) ? String(stop.run) : '';
      runInput.addEventListener('change', () => { stop.run = Number(runInput.value) || 0; });

      const needsSegment = needsRun && !isCircular();
      let segmentCells = [h('td', {}), h('td', {})];
      if (needsSegment) {
        if (!segments[index]) {
          segments[index] = segments[index - 1] ? { ...segments[index - 1] } : defaultLineCategory(network);
        }
        const seg = segments[index];
        const availableLines = network.lines.filter((l) => (l.stations || []).includes(stop.stationId));
        const lineChoices = availableLines.length > 0 ? availableLines : network.lines;
        if (!lineChoices.some((l) => l.id === seg.lineId)) {
          const fallback = lineChoices[0];
          seg.lineId = fallback ? fallback.id : '';
          seg.categoryId = fallback && fallback.categories[0] ? fallback.categories[0].id : '';
        }
        const lineSelect = h('select', { class: 'g-select' }, ...lineChoices.map((l) => h('option', { value: l.id }, l.name)));
        lineSelect.value = seg.lineId;
        const categorySelect = h('select', { class: 'g-select' });
        function fillCategories() {
          clear(categorySelect);
          const line = lineChoices.find((l) => l.id === lineSelect.value);
          (line ? line.categories : []).forEach((c) => categorySelect.appendChild(h('option', { value: c.id }, c.name)));
          categorySelect.value = seg.categoryId;
          if (!categorySelect.value && line && line.categories[0]) categorySelect.value = line.categories[0].id;
        }
        fillCategories();
        lineSelect.addEventListener('change', () => {
          const line = lineChoices.find((l) => l.id === lineSelect.value);
          seg.lineId = lineSelect.value;
          seg.categoryId = line && line.categories[0] ? line.categories[0].id : '';
          fillCategories();
          renderPreview();
        });
        categorySelect.addEventListener('change', () => { seg.categoryId = categorySelect.value; renderPreview(); });
        segmentCells = [h('td', {}, lineSelect), h('td', {}, categorySelect)];
      }

      const upBtn = h('button', {
        class: 'g-btn g-btn--small', type: 'button', disabled: index === 0,
        onClick: () => {
          [stops[index - 1], stops[index]] = [stops[index], stops[index - 1]];
          if (segments[index - 1] || segments[index]) {
            [segments[index - 1], segments[index]] = [segments[index], segments[index - 1]];
          }
          renderStops();
        }
      }, '▲');
      const downBtn = h('button', {
        class: 'g-btn g-btn--small', type: 'button', disabled: index === stops.length - 1,
        onClick: () => {
          [stops[index + 1], stops[index]] = [stops[index], stops[index + 1]];
          if (segments[index] || segments[index + 1]) {
            [segments[index], segments[index + 1]] = [segments[index + 1], segments[index]];
          }
          renderStops();
        }
      }, '▼');
      const deleteBtn = h('button', {
        class: 'g-btn g-btn--small', type: 'button',
        onClick: () => {
          segments = rebuildSegmentsAfterRemoval(segments, index);
          stops = stops.filter((s, i) => i !== index);
          renderStops();
        }
      }, '削除');

      const row = h('tr', {},
        h('td', {}, String(index)),
        h('td', {}, stationName(network, stop.stationId)),
        h('td', {}, platformSelect),
        h('td', {}, boardInput),
        h('td', {}, alightInput),
        h('td', {}, runInput),
        ...segmentCells,
        h('td', {}, upBtn, downBtn, deleteBtn)
      );
      attachDragReorder(row, index, stops, (fromIndex, toIndex) => {
        if (segments.length > 0) {
          const [movedSeg] = segments.splice(fromIndex, 1);
          segments.splice(toIndex, 0, movedSeg);
        }
        renderStops();
      });
      return row;
    }

    // removedIndex番目の停車駅を消す前提で、区間配列（長さ = 停車駅数-1）を詰め直す。
    // 削除した駅の前後をつないだ区間は、削除した駅の直前までの区間の路線・種別を引き継ぐ
    function rebuildSegmentsAfterRemoval(oldSegments, removedIndex) {
      const newLength = Math.max(oldSegments.length - 1, 0);
      const rebuilt = [];
      for (let j = 0; j < newLength; j++) {
        if (j < removedIndex - 1) {
          rebuilt.push(oldSegments[j]);
        } else if (j === removedIndex - 1) {
          rebuilt.push(oldSegments[removedIndex - 1] || oldSegments[removedIndex] || defaultLineCategory(network));
        } else {
          rebuilt.push(oldSegments[j + 1]);
        }
      }
      return rebuilt;
    }

    renderStops();

    const picker = createStationPicker(network.stations, (stationId) => {
      const prevLen = stops.length;
      stops.push({ stationId, platformId: null, run: 60, board: true, alight: true });
      if (prevLen > 0) {
        segments[prevLen - 1] = segments[prevLen - 2] ? { ...segments[prevLen - 2] } : defaultLineCategory(network);
      }
      renderStops();
    });

    const circularCategoryContainer = h('div', {});
    function renderCircularCategory() {
      clear(circularCategoryContainer);
      if (!isCircular()) return;
      const lineSelect = h('select', { class: 'g-select' }, ...network.lines.map((l) => h('option', { value: l.id }, l.name)));
      lineSelect.value = circularCategory.lineId;
      const categorySelect = h('select', { class: 'g-select' });
      function fillCategories() {
        clear(categorySelect);
        const line = network.lines.find((l) => l.id === lineSelect.value);
        (line ? line.categories : []).forEach((c) => categorySelect.appendChild(h('option', { value: c.id }, c.name)));
        categorySelect.value = circularCategory.categoryId;
      }
      fillCategories();
      lineSelect.addEventListener('change', () => {
        const line = network.lines.find((l) => l.id === lineSelect.value);
        circularCategory.lineId = lineSelect.value;
        circularCategory.categoryId = line && line.categories[0] ? line.categories[0].id : '';
        fillCategories();
        renderPreview();
      });
      categorySelect.addEventListener('change', () => { circularCategory.categoryId = categorySelect.value; renderPreview(); });
      circularCategoryContainer.appendChild(h('div', { class: 'g-actions-row' },
        h('label', { class: 'g-field__label' }, '環状区間の路線: ', lineSelect),
        h('label', { class: 'g-field__label' }, '種別: ', categorySelect)
      ));
    }

    circularInput.addEventListener('change', () => {
      if (isCircular()) {
        headsignInput.value = '';
        headsignInput.disabled = true;
      } else {
        headsignInput.disabled = false;
      }
      renderCircularCategory();
      renderStops();
    });
    headsignInput.disabled = circularInput.checked;
    renderCircularCategory();

    async function save() {
      if (stops.length < 2) { await alertDialog('停車駅を2件以上追加してください。'); return; }
      if (!isCircular() && !headsignInput.value.trim()) { await alertDialog('行先を入力してください（環状の場合は「環状」にチェックを入れてください）。'); return; }

      const finalStops = stops.map((s, i) => {
        const clean = { stationId: s.stationId, platformId: s.platformId ?? null };
        const isLast = i === stops.length - 1;
        if (!isLast || isCircular()) clean.run = Number.isFinite(s.run) ? s.run : 0;
        clean.board = s.board !== false;
        clean.alight = s.alight !== false;
        return clean;
      });

      const sections = isCircular()
        ? [{ lineId: circularCategory.lineId, categoryId: circularCategory.categoryId, from: 0, to: finalStops.length - 1 }]
        : buildSectionsFromSegments(segments);

      const record = {
        id: isNew ? newId('sv') : service.id,
        name: nameInput.value.trim(),
        headsign: isCircular() ? null : headsignInput.value.trim(),
        active: activeInput.checked,
        circular: isCircular(),
        stops: finalStops,
        sections
      };

      if (isNew) {
        store.mutateDoc('network', (doc) => doc.services.push(record));
        expandedId = null;
      } else {
        store.mutateDoc('network', (doc) => {
          const idx = doc.services.findIndex((sv) => sv.id === service.id);
          if (idx !== -1) doc.services[idx] = record;
        });
      }
      render();
      refreshAll();
    }

    return h('div', { class: 'g-card' },
      h('div', { class: 'g-card__header' }, isNew ? '運行系統を追加' : `運行系統を編集: ${service.id}`),
      h('div', { class: 'g-card__body' },
        h('div', { class: 'g-field' }, h('label', { class: 'g-field__label' }, '行先'), headsignInput),
        h('div', { class: 'g-field' }, h('label', { class: 'g-field__label' }, 'メモ'), nameInput),
        h('label', { class: 'g-field__label' }, activeInput, ' 有効'),
        h('label', { class: 'g-field__label' }, circularInput, ' 環状'),
        circularCategoryContainer,

        h('h4', { style: 'margin-block:var(--stack-gap-normal) var(--stack-gap-condensed);' }, '停車駅'),
        h('div', { class: 'g-table-wrap ed2-subtable' },
          h('table', { class: 'g-table' },
            h('thead', {}, h('tr', {},
              h('th', {}, '#'), h('th', {}, '駅'), h('th', {}, 'のりば'), h('th', {}, '乗車可'), h('th', {}, '降車可'),
              h('th', {}, '秒数'), h('th', {}, '路線'), h('th', {}, '種別'), h('th', {}, '操作')
            )),
            stopsTbody
          )
        ),
        h('div', { class: 'g-actions-row' }, picker),

        h('h4', { style: 'margin-block:var(--stack-gap-normal) var(--stack-gap-condensed);' }, 'プレビュー'),
        previewContainer,

        h('div', { class: 'g-actions-row' },
          h('button', { class: 'g-btn g-btn--primary', type: 'button', onClick: save }, isNew ? '追加する' : '保存'),
          h('button', {
            class: 'g-btn',
            type: 'button',
            onClick: () => {
              pendingScroll = isNew ? null : { type: 'row', id: service.id };
              expandedId = null;
              render();
            }
          }, 'キャンセル')
        )
      )
    );
  }

  render();
}

function emptyNotice() {
  const p = document.createElement('p');
  p.className = 'g-empty';
  p.textContent = '先に「保存/読込」タブで路線網 (network) を読み込んでください。';
  return p;
}

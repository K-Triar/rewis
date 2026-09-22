import { h, clear } from '../../editor-shared/dom.js';
import { alertDialog } from '../../editor-shared/components/dialog.js';
import { createStationPicker } from '../components/station-picker.js';
import { newId } from '../../shared/ids.js';

function stationLabel(network, stationId) {
  const station = network.stations.find((s) => s.id === stationId);
  return station ? `${station.name}（${stationId}）` : stationId;
}

function platformLabel(network, stationId, platformId) {
  if (platformId == null) return '（指定なし）';
  const station = network.stations.find((s) => s.id === stationId);
  const platform = station ? (station.platforms || []).find((p) => p.id === platformId) : null;
  return platform ? platform.label : platformId;
}

function endpointLabel(network, endpoint) {
  return `${stationLabel(network, endpoint.stationId)} ${platformLabel(network, endpoint.stationId, endpoint.platformId)}`;
}

export function renderTransfersView(container, ctx) {
  clear(container);
  const { store, refreshAll, focus } = ctx;
  const network = store.state.docs.network;

  if (!network) {
    container.appendChild(emptyNotice());
    return;
  }

  const focusTransferId = focus && focus.tab === 'transfers' && focus.type === 'transfer' ? focus.id : null;
  const focusGroupId = focus && focus.tab === 'transfers' && focus.type === 'stationGroup' ? focus.id : null;
  let searchText = '';
  let expandedTransferId = focusTransferId; // null | '__new__' | 乗換ID
  let deletingTransferId = null;
  let pendingTransferScroll = null; // { type: 'top' } | { type: 'row', id }
  let expandedGroupId = focusGroupId; // null | '__new__' | グループID
  let deletingGroupId = null;
  let pendingGroupScroll = null; // { type: 'top' } | { type: 'row', id }

  const transfersSection = h('div', { class: 'ed2-flex-pane' });
  const defaultsSection = h('div', {});
  const groupsSection = h('div', { class: 'ed2-flex-pane' });
  container.appendChild(transfersSection);
  container.appendChild(defaultsSection);
  container.appendChild(groupsSection);

  function matchesSearch(transfer) {
    if (!searchText.trim()) return true;
    const needle = searchText.trim();
    const fromStation = network.stations.find((s) => s.id === transfer.from.stationId);
    const toStation = network.stations.find((s) => s.id === transfer.to.stationId);
    return [fromStation, toStation].some(
      (s) => s && (s.name.includes(needle) || (s.kana || '').includes(needle))
    );
  }

  function renderTransfers() {
    clear(transfersSection);

    transfersSection.appendChild(h('div', { class: 'g-section-header' },
      h('h2', {}, '乗換'),
      h('button', {
        class: 'g-btn g-btn--primary', type: 'button',
        onClick: () => { expandedTransferId = '__new__'; pendingTransferScroll = { type: 'top' }; renderTransfers(); }
      }, '+ 追加')
    ));

    const searchInput = h('input', { type: 'text', class: 'g-input', placeholder: '駅名・かなで絞り込み', value: searchText });
    searchInput.addEventListener('input', () => {
      searchText = searchInput.value;
      renderTransferList();
    });
    transfersSection.appendChild(h('div', { class: 'g-actions-row' }, searchInput));

    const detailContainer = h('div', { class: 'ed2-split__form' });
    const listContainer = h('div', { class: 'ed2-list-scroll ed2-split__list' });
    transfersSection.appendChild(h('div', { class: 'ed2-split' }, listContainer, detailContainer));

    function applyPendingTransferScroll() {
      if (!pendingTransferScroll) return;
      const action = pendingTransferScroll;
      pendingTransferScroll = null;
      if (action.type === 'top') {
        detailContainer.scrollIntoView({ block: 'start' });
      } else if (action.type === 'row') {
        const row = listContainer.querySelector(`[data-row-id="${action.id}"]`);
        if (row) row.scrollIntoView({ block: 'center' });
      }
    }

    function renderTransferList() {
      clear(listContainer);
      const tbody = h('tbody', {});
      network.transfers.filter(matchesSearch).forEach((transfer) => {
        tbody.appendChild(renderTransferRow(transfer));
      });
      listContainer.appendChild(h('div', { class: 'g-table-wrap' },
        h('table', { class: 'g-table' },
          h('thead', {}, h('tr', {},
            h('th', {}, 'から'), h('th', {}, 'へ'), h('th', { style: 'width:80px' }, '秒数'),
            h('th', { style: 'width:60px' }, '双方向'), h('th', {}, 'メモ'), h('th', { style: 'width:180px' }, '操作')
          )),
          tbody
        )
      ));
    }

    function renderTransferRow(transfer) {
      if (deletingTransferId === transfer.id) {
        return h('tr', {},
          h('td', { colspan: '5' }, `乗換「${endpointLabel(network, transfer.from)} → ${endpointLabel(network, transfer.to)}」を削除しますか？`),
          h('td', {},
            h('button', {
              class: 'g-btn g-btn--danger g-btn--small', type: 'button',
              onClick: () => {
                store.mutateDoc('network', (doc) => {
                  doc.transfers = doc.transfers.filter((t) => t.id !== transfer.id);
                });
                deletingTransferId = null;
                if (expandedTransferId === transfer.id) expandedTransferId = null;
                renderTransferList();
                renderTransferDetail();
                refreshAll();
              }
            }, '削除する'),
            h('button', { class: 'g-btn g-btn--small', type: 'button', onClick: () => { deletingTransferId = null; renderTransferList(); } }, 'キャンセル')
          )
        );
      }

      return h('tr', { class: expandedTransferId === transfer.id ? 'is-editing' : null, 'data-row-id': transfer.id },
        h('td', {}, endpointLabel(network, transfer.from)),
        h('td', {}, endpointLabel(network, transfer.to)),
        h('td', {}, String(transfer.seconds)),
        h('td', {}, transfer.bidirectional ? '○' : ''),
        h('td', {}, transfer.note || ''),
        h('td', {},
          h('button', {
            class: 'g-btn g-btn--small', type: 'button',
            onClick: () => {
              const opening = expandedTransferId !== transfer.id;
              pendingTransferScroll = opening ? { type: 'top' } : { type: 'row', id: transfer.id };
              expandedTransferId = opening ? transfer.id : null;
              renderTransferList();
              renderTransferDetail();
              applyPendingTransferScroll();
            }
          }, expandedTransferId === transfer.id ? '閉じる' : '詳細'),
          h('button', { class: 'g-btn g-btn--small', type: 'button', onClick: () => { deletingTransferId = transfer.id; renderTransferList(); } }, '削除')
        )
      );
    }

    function renderTransferDetail() {
      clear(detailContainer);
      if (expandedTransferId === '__new__') {
        detailContainer.appendChild(renderTransferForm(null));
      } else if (expandedTransferId) {
        const transfer = network.transfers.find((t) => t.id === expandedTransferId);
        if (transfer) detailContainer.appendChild(renderTransferForm(transfer));
      }
    }

    function renderTransferForm(transfer) {
      const isNew = !transfer;
      let mode = isNew ? 'same' : (transfer.from.stationId === transfer.to.stationId ? 'same' : 'walk');
      let fromStationId = isNew ? (network.stations[0] ? network.stations[0].id : null) : transfer.from.stationId;
      let fromPlatformId = isNew ? null : transfer.from.platformId;
      let toStationId = isNew ? fromStationId : transfer.to.stationId;
      let toPlatformId = isNew ? null : transfer.to.platformId;

      const secondsInput = h('input', { type: 'number', class: 'g-input', min: '0', step: '1', value: String(isNew ? 60 : transfer.seconds) });
      const bidirectionalInput = h('input', { type: 'checkbox' });
      bidirectionalInput.checked = isNew ? false : !!transfer.bidirectional;
      const noteInput = h('input', { type: 'text', class: 'g-input', value: isNew ? '' : (transfer.note || '') });

      const fromLabel = h('span', {}, stationLabel(network, fromStationId));
      const toLabel = h('span', {}, mode === 'same' ? '（同じ駅）' : stationLabel(network, toStationId));
      const fromPlatformSelectContainer = h('div', {});
      const toPlatformSelectContainer = h('div', {});
      const toPickerContainer = h('div', {});

      function renderFromPlatformSelect() {
        clear(fromPlatformSelectContainer);
        const station = network.stations.find((s) => s.id === fromStationId);
        const platforms = station ? station.platforms : [];
        const options = mode === 'same'
          ? platforms.map((p) => h('option', { value: p.id }, p.label))
          : [h('option', { value: '' }, '（指定なし）'), ...platforms.map((p) => h('option', { value: p.id }, p.label))];
        const select = h('select', { class: 'g-select' }, ...options);
        select.value = fromPlatformId || (mode === 'same' && platforms[0] ? platforms[0].id : '');
        select.addEventListener('change', () => { fromPlatformId = select.value || null; });
        if (mode === 'same' && !fromPlatformId && platforms[0]) fromPlatformId = platforms[0].id;
        fromPlatformSelectContainer.appendChild(select);
      }

      function renderToPlatformSelect() {
        clear(toPlatformSelectContainer);
        const station = network.stations.find((s) => s.id === toStationId);
        const platforms = station ? station.platforms : [];
        const options = mode === 'same'
          ? platforms.map((p) => h('option', { value: p.id }, p.label))
          : [h('option', { value: '' }, '（指定なし）'), ...platforms.map((p) => h('option', { value: p.id }, p.label))];
        const select = h('select', { class: 'g-select' }, ...options);
        select.value = toPlatformId || (mode === 'same' && platforms[0] ? platforms[0].id : '');
        select.addEventListener('change', () => { toPlatformId = select.value || null; });
        if (mode === 'same' && !toPlatformId && platforms[0]) toPlatformId = platforms[0].id;
        toPlatformSelectContainer.appendChild(select);
      }

      function renderToPicker() {
        clear(toPickerContainer);
        if (mode !== 'walk') return;
        toPickerContainer.appendChild(createStationPicker(network.stations, (stationId) => {
          toStationId = stationId;
          toPlatformId = null;
          toLabel.textContent = stationLabel(network, toStationId);
          renderToPlatformSelect();
        }));
      }

      const fromPickerContainer = h('div', {}, createStationPicker(network.stations, (stationId) => {
        fromStationId = stationId;
        fromPlatformId = null;
        fromLabel.textContent = stationLabel(network, fromStationId);
        renderFromPlatformSelect();
        if (mode === 'same') {
          toStationId = fromStationId;
          toPlatformId = null;
          toLabel.textContent = '（同じ駅）';
          renderToPlatformSelect();
        }
      }));

      const modeRadios = {};
      ['same', 'walk'].forEach((value) => {
        const radio = h('input', { type: 'radio', name: 'g-transfer-mode', value });
        radio.checked = mode === value;
        radio.addEventListener('change', () => {
          mode = value;
          if (mode === 'same') {
            toStationId = fromStationId;
            toPlatformId = null;
            toLabel.textContent = '（同じ駅）';
          } else {
            toLabel.textContent = stationLabel(network, toStationId);
          }
          renderFromPlatformSelect();
          renderToPlatformSelect();
          renderToPicker();
        });
        modeRadios[value] = radio;
      });

      renderFromPlatformSelect();
      renderToPlatformSelect();
      renderToPicker();

      async function save() {
        const seconds = Number(secondsInput.value);
        if (!Number.isInteger(seconds) || seconds < 0) {
          await alertDialog('秒数は0以上の整数で入力してください。');
          return;
        }
        const sameStation = fromStationId === toStationId;
        if (sameStation && (fromPlatformId == null || toPlatformId == null)) {
          await alertDialog('同じ駅の中の乗換では、両方ののりばを指定してください。');
          return;
        }
        if (sameStation && fromPlatformId === toPlatformId) {
          await alertDialog('同じのりば同士の乗換は登録できません。');
          return;
        }
        const record = {
          id: isNew ? newId('tr') : transfer.id,
          from: { stationId: fromStationId, platformId: fromPlatformId },
          to: { stationId: toStationId, platformId: toPlatformId },
          seconds,
          bidirectional: bidirectionalInput.checked,
          note: noteInput.value.trim()
        };

        if (isNew) {
          store.mutateDoc('network', (doc) => doc.transfers.push(record));
          expandedTransferId = null;
        } else {
          store.mutateDoc('network', (doc) => {
            const idx = doc.transfers.findIndex((t) => t.id === transfer.id);
            if (idx !== -1) doc.transfers[idx] = record;
          });
        }
        renderTransferList();
        renderTransferDetail();
        refreshAll();
      }

      return h('div', { class: 'g-card' },
        h('div', { class: 'g-card__header' }, isNew ? '乗換を追加' : `乗換を編集: ${transfer.id}`),
        h('div', { class: 'g-card__body' },
          h('div', { class: 'g-actions-row' },
            h('label', { class: 'g-field__label' }, modeRadios.same, ' 同じ駅の中'),
            h('label', { class: 'g-field__label' }, modeRadios.walk, ' 徒歩連絡（別の駅へ）')
          ),
          h('h4', { style: 'margin-block:var(--stack-gap-normal) var(--stack-gap-condensed);' }, '乗換元'),
          h('div', { class: 'g-actions-row' }, fromPickerContainer, '現在: ', fromLabel),
          h('div', { class: 'g-actions-row' }, 'のりば: ', fromPlatformSelectContainer),
          h('h4', { style: 'margin-block:var(--stack-gap-normal) var(--stack-gap-condensed);' }, '乗換先'),
          h('div', { class: 'g-actions-row' }, toPickerContainer, '現在: ', toLabel),
          h('div', { class: 'g-actions-row' }, 'のりば: ', toPlatformSelectContainer),
          h('div', { class: 'g-field' }, h('label', { class: 'g-field__label' }, '秒数'), secondsInput),
          h('label', { class: 'g-field__label' }, bidirectionalInput, ' 双方向'),
          h('div', { class: 'g-field' }, h('label', { class: 'g-field__label' }, 'メモ'), noteInput),
          h('div', { class: 'g-actions-row' },
            h('button', { class: 'g-btn g-btn--primary', type: 'button', onClick: save }, isNew ? '追加する' : '保存'),
            h('button', {
              class: 'g-btn',
              type: 'button',
              onClick: () => {
                const cancelledId = transfer ? transfer.id : null;
                expandedTransferId = null;
                pendingTransferScroll = cancelledId ? { type: 'row', id: cancelledId } : null;
                renderTransferList();
                renderTransferDetail();
                applyPendingTransferScroll();
              }
            }, 'キャンセル')
          )
        )
      );
    }

    renderTransferList();
    renderTransferDetail();
    if (focusTransferId && detailContainer.firstChild) {
      detailContainer.scrollIntoView({ block: 'center' });
    }
    applyPendingTransferScroll();
  }

  function renderDefaults() {
    clear(defaultsSection);
    const defaults = network.transferDefaults || { samePlatform: 5, unknown: 10 };

    const samePlatformInput = h('input', { type: 'number', class: 'g-input', min: '0', step: '1', value: String(defaults.samePlatform) });
    const unknownInput = h('input', { type: 'number', class: 'g-input', min: '0', step: '1', value: String(defaults.unknown) });

    async function applyChange(key, input) {
      const value = Number(input.value);
      if (!Number.isInteger(value) || value < 0) {
        await alertDialog('乗換秒数は0以上の整数で入力してください。');
        input.value = String(network.transferDefaults[key]);
        return;
      }
      store.mutateDoc('network', (doc) => { doc.transferDefaults[key] = value; });
      refreshAll();
    }

    samePlatformInput.addEventListener('change', () => applyChange('samePlatform', samePlatformInput));
    unknownInput.addEventListener('change', () => applyChange('unknown', unknownInput));

    defaultsSection.appendChild(h('div', { class: 'g-card' },
      h('div', { class: 'g-card__header' }, '乗換の既定値'),
      h('div', { class: 'g-card__body' },
        h('div', { class: 'g-field' }, h('label', { class: 'g-field__label' }, '同じのりばでの乗換秒数'), samePlatformInput),
        h('div', { class: 'g-field' }, h('label', { class: 'g-field__label' }, '不明な場合の乗換秒数'), unknownInput)
      )
    ));
  }

  function renderGroups() {
    clear(groupsSection);

    groupsSection.appendChild(h('div', { class: 'g-section-header' },
      h('h2', {}, '駅グループ'),
      h('button', {
        class: 'g-btn g-btn--primary', type: 'button',
        onClick: () => { expandedGroupId = '__new__'; pendingGroupScroll = { type: 'top' }; renderGroups(); }
      }, '+ 追加')
    ));

    const detailContainer = h('div', { class: 'ed2-split__form' });
    const listContainer = h('div', { class: 'ed2-list-scroll ed2-split__list' });
    groupsSection.appendChild(h('div', { class: 'ed2-split' }, listContainer, detailContainer));

    function applyPendingGroupScroll() {
      if (!pendingGroupScroll) return;
      const action = pendingGroupScroll;
      pendingGroupScroll = null;
      if (action.type === 'top') {
        detailContainer.scrollIntoView({ block: 'start' });
      } else if (action.type === 'row') {
        const row = listContainer.querySelector(`[data-row-id="${action.id}"]`);
        if (row) row.scrollIntoView({ block: 'center' });
      }
    }

    function renderGroupList() {
      clear(listContainer);
      const tbody = h('tbody', {});
      (network.stationGroups || []).forEach((group) => tbody.appendChild(renderGroupRow(group)));
      listContainer.appendChild(h('div', { class: 'g-table-wrap' },
        h('table', { class: 'g-table' },
          h('thead', {}, h('tr', {}, h('th', {}, 'グループ名'), h('th', {}, '駅'), h('th', { style: 'width:180px' }, '操作'))),
          tbody
        )
      ));
    }

    function renderGroupRow(group) {
      if (deletingGroupId === group.id) {
        return h('tr', {},
          h('td', { colspan: '2' }, `駅グループ「${group.name}」を削除しますか？`),
          h('td', {},
            h('button', {
              class: 'g-btn g-btn--danger g-btn--small', type: 'button',
              onClick: () => {
                store.mutateDoc('network', (doc) => {
                  doc.stationGroups = doc.stationGroups.filter((g) => g.id !== group.id);
                });
                deletingGroupId = null;
                if (expandedGroupId === group.id) expandedGroupId = null;
                renderGroupList();
                renderGroupDetail();
                refreshAll();
              }
            }, '削除する'),
            h('button', { class: 'g-btn g-btn--small', type: 'button', onClick: () => { deletingGroupId = null; renderGroupList(); } }, 'キャンセル')
          )
        );
      }

      return h('tr', { class: expandedGroupId === group.id ? 'is-editing' : null, 'data-row-id': group.id },
        h('td', {}, group.name),
        h('td', {}, group.stationIds.map((id) => stationLabel(network, id)).join('、')),
        h('td', {},
          h('button', {
            class: 'g-btn g-btn--small', type: 'button',
            onClick: () => {
              const opening = expandedGroupId !== group.id;
              pendingGroupScroll = opening ? { type: 'top' } : { type: 'row', id: group.id };
              expandedGroupId = opening ? group.id : null;
              renderGroupList();
              renderGroupDetail();
              applyPendingGroupScroll();
            }
          }, expandedGroupId === group.id ? '閉じる' : '詳細'),
          h('button', { class: 'g-btn g-btn--small', type: 'button', onClick: () => { deletingGroupId = group.id; renderGroupList(); } }, '削除')
        )
      );
    }

    function renderGroupDetail() {
      clear(detailContainer);
      if (expandedGroupId === '__new__') {
        detailContainer.appendChild(renderGroupForm(null));
      } else if (expandedGroupId) {
        const group = (network.stationGroups || []).find((g) => g.id === expandedGroupId);
        if (group) detailContainer.appendChild(renderGroupForm(group));
      }
    }

    function renderGroupForm(group) {
      const isNew = !group;
      const nameInput = h('input', { type: 'text', class: 'g-input', value: isNew ? '' : group.name, placeholder: '例: 大阪・梅田' });
      let stationIds = isNew ? [] : group.stationIds.slice();

      const stationsTbody = h('tbody', {});
      function renderStations() {
        clear(stationsTbody);
        stationIds.forEach((stationId, index) => {
          const deleteBtn = h('button', {
            class: 'g-btn g-btn--small', type: 'button',
            onClick: () => { stationIds = stationIds.filter((_, i) => i !== index); renderStations(); }
          }, '削除');
          stationsTbody.appendChild(h('tr', {}, h('td', {}, stationLabel(network, stationId)), h('td', {}, deleteBtn)));
        });
      }
      renderStations();

      const picker = createStationPicker(network.stations, (stationId) => {
        if (stationIds.includes(stationId)) {
          alertDialog('同じ駅が既にこのグループに含まれています。');
          return;
        }
        stationIds.push(stationId);
        renderStations();
      });

      async function save() {
        const name = nameInput.value.trim();
        if (!name) {
          await alertDialog('グループ名を入力してください。');
          return;
        }
        if (stationIds.length < 2) {
          await alertDialog('駅を2つ以上選んでください。');
          return;
        }
        for (const otherGroup of network.stationGroups || []) {
          if (!isNew && otherGroup.id === group.id) continue;
          if (otherGroup.stationIds.some((id) => stationIds.includes(id))) {
            await alertDialog(`駅「${stationLabel(network, otherGroup.stationIds.find((id) => stationIds.includes(id)))}」は既に別のグループ「${otherGroup.name}」に入っています。`);
            return;
          }
        }

        const record = { id: isNew ? newId('grp') : group.id, name, stationIds: stationIds.slice() };
        if (isNew) {
          store.mutateDoc('network', (doc) => doc.stationGroups.push(record));
          expandedGroupId = null;
        } else {
          store.mutateDoc('network', (doc) => {
            const idx = doc.stationGroups.findIndex((g) => g.id === group.id);
            if (idx !== -1) doc.stationGroups[idx] = record;
          });
        }
        renderGroupList();
        renderGroupDetail();
        refreshAll();
      }

      return h('div', { class: 'g-card' },
        h('div', { class: 'g-card__header' }, isNew ? '駅グループを追加' : `駅グループを編集: ${group.id}`),
        h('div', { class: 'g-card__body' },
          h('div', { class: 'g-field' }, h('label', { class: 'g-field__label' }, 'グループ名'), nameInput),
          h('h4', { style: 'margin-block:var(--stack-gap-normal) var(--stack-gap-condensed);' }, '駅'),
          h('div', { class: 'g-table-wrap' },
            h('table', { class: 'g-table' },
              h('thead', {}, h('tr', {}, h('th', {}, '駅'), h('th', {}, '操作'))),
              stationsTbody
            )
          ),
          h('div', { class: 'g-actions-row' }, picker),
          h('div', { class: 'g-actions-row' },
            h('button', { class: 'g-btn g-btn--primary', type: 'button', onClick: save }, isNew ? '追加する' : '保存'),
            h('button', {
              class: 'g-btn',
              type: 'button',
              onClick: () => {
                const cancelledId = group ? group.id : null;
                expandedGroupId = null;
                pendingGroupScroll = cancelledId ? { type: 'row', id: cancelledId } : null;
                renderGroupList();
                renderGroupDetail();
                applyPendingGroupScroll();
              }
            }, 'キャンセル')
          )
        )
      );
    }

    renderGroupList();
    renderGroupDetail();
    if (focusGroupId && detailContainer.firstChild) {
      detailContainer.scrollIntoView({ block: 'center' });
    }
    applyPendingGroupScroll();
  }

  renderTransfers();
  renderDefaults();
  renderGroups();
}

function emptyNotice() {
  const p = document.createElement('p');
  p.className = 'g-empty';
  p.textContent = '先に「保存/読込」タブで路線網 (network) を読み込んでください。';
  return p;
}

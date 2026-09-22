import { h, clear } from '../../editor-shared/dom.js';
import { alertDialog } from '../../editor-shared/components/dialog.js';
import { isValidId } from '../../shared/ids.js';
import { findReferences } from '../refs.js';
import { renderRefList } from '../components/ref-list.js';

export function renderStationsView(container, ctx) {
  clear(container);
  const { store, refreshAll, requestNavigate, focus } = ctx;
  const network = store.state.docs.network;

  if (!network) {
    container.appendChild(emptyNotice());
    return;
  }

  const focusStationId = focus && focus.tab === 'stations' ? focus.id : null;
  let searchText = '';
  let expandedId = focusStationId; // null | '__new__' | 駅ID
  let deletingId = null;

  function matchesSearch(station) {
    if (!searchText) return true;
    const needle = searchText.trim();
    if (!needle) return true;
    return station.name.includes(needle) || (station.kana || '').includes(needle);
  }

  function render() {
    clear(container);

    container.appendChild(h('div', { class: 'g-section-header' },
      h('h2', {}, '駅'),
      h('button', { class: 'g-btn g-btn--primary', type: 'button', onClick: () => { expandedId = '__new__'; render(); } }, '+ 追加')
    ));

    const searchInput = h('input', { type: 'text', class: 'g-input', placeholder: '駅名・かなで検索', value: searchText });
    searchInput.addEventListener('input', () => {
      searchText = searchInput.value;
      renderList();
    });
    container.appendChild(h('div', { class: 'g-actions-row' }, searchInput));

    const detailContainer = h('div', {});
    container.appendChild(detailContainer);

    const listContainer = h('div', { class: 'ed2-list-scroll' });
    container.appendChild(listContainer);

    function renderList() {
      clear(listContainer);
      const tbody = h('tbody', {});
      network.stations.filter(matchesSearch).forEach((station) => {
        tbody.appendChild(renderStationRow(station));
      });
      listContainer.appendChild(h('div', { class: 'g-table-wrap' },
        h('table', { class: 'g-table' },
          h('thead', {}, h('tr', {},
            h('th', { style: 'width:120px' }, '駅ID'),
            h('th', {}, '駅名'),
            h('th', {}, 'かな'),
            h('th', { style: 'width:80px' }, 'のりば数'),
            h('th', { style: 'width:180px' }, '操作')
          )),
          tbody
        )
      ));
    }

    function renderStationRow(station) {
      if (deletingId === station.id) {
        const refs = findReferences(network, store.state.docs.operations, { type: 'station', id: station.id });
        if (refs.length > 0) {
          return h('tr', {},
            h('td', {}, station.id),
            h('td', { colspan: '4' },
              h('span', { class: 'g-text-danger' }, '削除できません。参照箇所: '),
              renderRefList(refs, requestNavigate),
              ' ',
              h('button', { class: 'g-btn g-btn--small', type: 'button', onClick: () => { deletingId = null; renderList(); } }, '閉じる')
            )
          );
        }
        return h('tr', {},
          h('td', {}, station.id),
          h('td', { colspan: '3' }, station.name),
          h('td', {},
            h('button', {
              class: 'g-btn g-btn--danger g-btn--small',
              type: 'button',
              onClick: () => {
                store.mutateDoc('network', (doc) => {
                  doc.stations = doc.stations.filter((s) => s.id !== station.id);
                });
                deletingId = null;
                if (expandedId === station.id) expandedId = null;
                renderList();
                renderDetail();
                refreshAll();
              }
            }, '削除する'),
            h('button', { class: 'g-btn g-btn--small', type: 'button', onClick: () => { deletingId = null; renderList(); } }, 'キャンセル')
          )
        );
      }

      return h('tr', { class: expandedId === station.id ? 'is-editing' : null },
        h('td', {}, station.id),
        h('td', {}, station.name),
        h('td', {}, station.kana || ''),
        h('td', {}, String((station.platforms || []).length)),
        h('td', {},
          h('button', {
            class: 'g-btn g-btn--small',
            type: 'button',
            onClick: () => { expandedId = expandedId === station.id ? null : station.id; renderList(); renderDetail(); }
          }, expandedId === station.id ? '閉じる' : '詳細'),
          h('button', { class: 'g-btn g-btn--small', type: 'button', onClick: () => { deletingId = station.id; renderList(); } }, '削除')
        )
      );
    }

    function renderDetail() {
      clear(detailContainer);
      if (expandedId === '__new__') {
        detailContainer.appendChild(renderStationForm(null));
      } else if (expandedId) {
        const station = network.stations.find((s) => s.id === expandedId);
        if (station) detailContainer.appendChild(renderStationForm(station));
      }
    }

    function renderStationForm(station) {
      const isNew = !station;
      const idInput = h('input', { type: 'text', class: 'g-input', value: isNew ? '' : station.id, disabled: !isNew, placeholder: '例: KL01' });
      const nameInput = h('input', { type: 'text', class: 'g-input', value: isNew ? '' : station.name, placeholder: '駅名' });
      const kanaInput = h('input', { type: 'text', class: 'g-input', value: isNew ? '' : (station.kana || ''), placeholder: 'かな' });

      let platforms = isNew ? [] : station.platforms.map((p) => ({ ...p }));

      const platformsTbody = h('tbody', {});
      let blockedPlatformId = null; // 参照があって削除できなかったのりばのID
      function renderPlatforms() {
        clear(platformsTbody);
        platforms.forEach((platform, index) => {
          platformsTbody.appendChild(renderPlatformRow(platform, index));
        });
      }

      function renderPlatformRow(platform, index) {
        if (blockedPlatformId === platform.id) {
          const refs = findReferences(network, store.state.docs.operations, { type: 'platform', stationId: station.id, id: platform.id });
          return h('tr', {},
            h('td', {}, platform.id),
            h('td', { colspan: '2' },
              h('span', { class: 'g-text-danger' }, '削除できません。参照箇所: '),
              renderRefList(refs, requestNavigate),
              ' ',
              h('button', { class: 'g-btn g-btn--small', type: 'button', onClick: () => { blockedPlatformId = null; renderPlatforms(); } }, '閉じる')
            )
          );
        }

        const idInputP = h('input', { type: 'text', class: 'g-input', value: platform.id, style: 'width:80px' });
        const labelInputP = h('input', { type: 'text', class: 'g-input', value: platform.label, style: 'width:80px' });
        idInputP.addEventListener('change', () => { platform.id = idInputP.value.trim(); });
        labelInputP.addEventListener('change', () => { platform.label = labelInputP.value.trim(); });

        const upBtn = h('button', {
          class: 'g-btn g-btn--small',
          type: 'button',
          disabled: index === 0,
          onClick: () => {
            [platforms[index - 1], platforms[index]] = [platforms[index], platforms[index - 1]];
            renderPlatforms();
          }
        }, '▲');
        const downBtn = h('button', {
          class: 'g-btn g-btn--small',
          type: 'button',
          disabled: index === platforms.length - 1,
          onClick: () => {
            [platforms[index + 1], platforms[index]] = [platforms[index], platforms[index + 1]];
            renderPlatforms();
          }
        }, '▼');
        const deleteBtn = h('button', {
          class: 'g-btn g-btn--small',
          type: 'button',
          onClick: () => {
            if (!isNew) {
              const refs = findReferences(network, store.state.docs.operations, { type: 'platform', stationId: station.id, id: platform.id });
              if (refs.length > 0) {
                blockedPlatformId = platform.id;
                renderPlatforms();
                return;
              }
            }
            platforms = platforms.filter((p) => p !== platform);
            renderPlatforms();
          }
        }, '削除');

        return h('tr', {},
          h('td', {}, idInputP),
          h('td', {}, labelInputP),
          h('td', {}, upBtn, downBtn, deleteBtn)
        );
      }

      renderPlatforms();

      const newPlatformIdInput = h('input', { type: 'text', class: 'g-input', placeholder: 'のりばID', style: 'width:80px' });
      const newPlatformLabelInput = h('input', { type: 'text', class: 'g-input', placeholder: '表示名', style: 'width:80px' });
      const addPlatformBtn = h('button', {
        class: 'g-btn g-btn--small',
        type: 'button',
        onClick: async () => {
          const id = newPlatformIdInput.value.trim();
          const label = newPlatformLabelInput.value.trim();
          if (!isValidId(id)) {
            await alertDialog('のりばIDの書式が不正です（英数字・_・- のみ、1〜64文字）。');
            return;
          }
          if (platforms.some((p) => p.id === id)) {
            await alertDialog('同じIDののりばが既にあります。');
            return;
          }
          if (!label) {
            await alertDialog('表示名を入力してください。');
            return;
          }
          platforms.push({ id, label });
          newPlatformIdInput.value = '';
          newPlatformLabelInput.value = '';
          renderPlatforms();
        }
      }, '+ のりば追加');

      async function saveStation() {
        const id = isNew ? idInput.value.trim() : station.id;
        const name = nameInput.value.trim();
        const kana = kanaInput.value.trim();
        if (isNew) {
          if (!isValidId(id)) {
            await alertDialog('駅IDの書式が不正です（英数字・_・- のみ、1〜64文字）。');
            return;
          }
          if (network.stations.some((s) => s.id === id)) {
            await alertDialog('同じIDの駅が既にあります。');
            return;
          }
        }
        if (!name) {
          await alertDialog('駅名を入力してください。');
          return;
        }
        const platformIds = new Set();
        for (const p of platforms) {
          if (!isValidId(p.id)) {
            await alertDialog(`のりばID「${p.id}」の書式が不正です。`);
            return;
          }
          if (platformIds.has(p.id)) {
            await alertDialog(`のりばID「${p.id}」が重複しています。`);
            return;
          }
          platformIds.add(p.id);
        }

        if (isNew) {
          store.mutateDoc('network', (doc) => {
            doc.stations.push({ id, name, kana, platforms, location: null });
          });
          expandedId = null;
        } else {
          store.mutateDoc('network', (doc) => {
            const target = doc.stations.find((s) => s.id === station.id);
            if (target) {
              target.name = name;
              target.kana = kana;
              target.platforms = platforms;
            }
          });
        }
        renderList();
        renderDetail();
        refreshAll();
      }

      return h('div', { class: 'g-card' },
        h('div', { class: 'g-card__header' }, isNew ? '駅を追加' : `駅を編集: ${station.id}`),
        h('div', { class: 'g-card__body' },
          h('div', { class: 'g-field' }, h('label', { class: 'g-field__label' }, '駅ID'), idInput),
          h('div', { class: 'g-field' }, h('label', { class: 'g-field__label' }, '駅名'), nameInput),
          h('div', { class: 'g-field' }, h('label', { class: 'g-field__label' }, 'かな'), kanaInput),
          h('h4', { style: 'margin-block:var(--stack-gap-normal) var(--stack-gap-condensed);' }, 'のりば'),
          h('div', { class: 'g-table-wrap ed2-subtable' },
            h('table', { class: 'g-table' },
              h('thead', {}, h('tr', {}, h('th', {}, 'のりばID'), h('th', {}, '表示名'), h('th', {}, '操作'))),
              platformsTbody
            )
          ),
          h('div', { class: 'g-actions-row' }, newPlatformIdInput, newPlatformLabelInput, addPlatformBtn),
          h('div', { class: 'g-actions-row' },
            h('button', { class: 'g-btn g-btn--primary', type: 'button', onClick: saveStation }, isNew ? '追加する' : '保存'),
            h('button', { class: 'g-btn', type: 'button', onClick: () => { expandedId = null; renderList(); renderDetail(); } }, 'キャンセル')
          )
        )
      );
    }

    renderList();
    renderDetail();
    if (focusStationId && detailContainer.firstChild) {
      detailContainer.scrollIntoView({ block: 'center' });
    }
  }

  render();
}

function emptyNotice() {
  const p = document.createElement('p');
  p.className = 'g-empty';
  p.textContent = '先に「保存/読込」タブで路線網 (network) を読み込んでください。';
  return p;
}

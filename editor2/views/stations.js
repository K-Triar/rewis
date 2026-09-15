import { h, clear } from '../dom.js';
import { alertDialog } from '../components/dialog.js';
import { isValidId } from '../../shared/ids.js';
import { findReferences } from '../refs.js';

export function renderStationsView(container, ctx) {
  clear(container);
  const { store, refreshAll } = ctx;
  const network = store.state.docs.network;

  if (!network) {
    container.appendChild(emptyNotice());
    return;
  }

  let searchText = '';
  let expandedId = null; // null | '__new__' | 駅ID
  let deletingId = null;

  function matchesSearch(station) {
    if (!searchText) return true;
    const needle = searchText.trim();
    if (!needle) return true;
    return station.name.includes(needle) || (station.kana || '').includes(needle);
  }

  function render() {
    clear(container);

    container.appendChild(h('div', { class: 'section-header' },
      h('h2', {}, '駅'),
      h('button', { class: 'add-btn', type: 'button', onClick: () => { expandedId = '__new__'; render(); } }, '+ 追加')
    ));

    const searchInput = h('input', { type: 'text', placeholder: '駅名・かなで検索', value: searchText });
    searchInput.addEventListener('input', () => {
      searchText = searchInput.value;
      renderList();
    });
    container.appendChild(h('div', { class: 'search-box' }, searchInput));

    const listContainer = h('div', {});
    container.appendChild(listContainer);

    const detailContainer = h('div', {});
    container.appendChild(detailContainer);

    function renderList() {
      clear(listContainer);
      const tbody = h('tbody', {});
      network.stations.filter(matchesSearch).forEach((station) => {
        tbody.appendChild(renderStationRow(station));
      });
      listContainer.appendChild(h('div', { class: 'table-container' },
        h('table', { class: 'data-table' },
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
              h('span', { class: 'ed2-issue-error' }, `削除できません。参照箇所: ${refs.map((r) => r.label).join(' / ')}`),
              ' ',
              h('button', { class: 'preview-btn', type: 'button', onClick: () => { deletingId = null; renderList(); } }, '閉じる')
            )
          );
        }
        return h('tr', {},
          h('td', {}, station.id),
          h('td', { colspan: '3' }, station.name),
          h('td', {},
            h('button', {
              class: 'export-btn',
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
            h('button', { class: 'preview-btn', type: 'button', onClick: () => { deletingId = null; renderList(); } }, 'キャンセル')
          )
        );
      }

      return h('tr', {},
        h('td', {}, station.id),
        h('td', {}, station.name),
        h('td', {}, station.kana || ''),
        h('td', {}, String((station.platforms || []).length)),
        h('td', {},
          h('button', {
            class: 'preview-btn',
            type: 'button',
            onClick: () => { expandedId = expandedId === station.id ? null : station.id; renderList(); renderDetail(); }
          }, expandedId === station.id ? '閉じる' : '詳細'),
          h('button', { class: 'preview-btn', type: 'button', onClick: () => { deletingId = station.id; renderList(); } }, '削除')
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
      const idInput = h('input', { type: 'text', value: isNew ? '' : station.id, disabled: !isNew, placeholder: '例: KL01' });
      const nameInput = h('input', { type: 'text', value: isNew ? '' : station.name, placeholder: '駅名' });
      const kanaInput = h('input', { type: 'text', value: isNew ? '' : (station.kana || ''), placeholder: 'かな' });

      let platforms = isNew ? [] : station.platforms.map((p) => ({ ...p }));

      const platformsTbody = h('tbody', {});
      function renderPlatforms() {
        clear(platformsTbody);
        platforms.forEach((platform, index) => {
          platformsTbody.appendChild(renderPlatformRow(platform, index));
        });
      }

      function renderPlatformRow(platform, index) {
        const idInputP = h('input', { type: 'text', value: platform.id, style: 'width:80px' });
        const labelInputP = h('input', { type: 'text', value: platform.label, style: 'width:80px' });
        idInputP.addEventListener('change', () => { platform.id = idInputP.value.trim(); });
        labelInputP.addEventListener('change', () => { platform.label = labelInputP.value.trim(); });

        const upBtn = h('button', {
          class: 'preview-btn',
          type: 'button',
          disabled: index === 0,
          onClick: () => {
            [platforms[index - 1], platforms[index]] = [platforms[index], platforms[index - 1]];
            renderPlatforms();
          }
        }, '▲');
        const downBtn = h('button', {
          class: 'preview-btn',
          type: 'button',
          disabled: index === platforms.length - 1,
          onClick: () => {
            [platforms[index + 1], platforms[index]] = [platforms[index], platforms[index + 1]];
            renderPlatforms();
          }
        }, '▼');
        const deleteBtn = h('button', {
          class: 'preview-btn',
          type: 'button',
          onClick: async () => {
            if (!isNew) {
              const refs = findReferences(network, store.state.docs.operations, { type: 'platform', stationId: station.id, id: platform.id });
              if (refs.length > 0) {
                await alertDialog(`このりばは削除できません。参照箇所: ${refs.map((r) => r.label).join(' / ')}`);
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

      const newPlatformIdInput = h('input', { type: 'text', placeholder: 'のりばID', style: 'width:80px' });
      const newPlatformLabelInput = h('input', { type: 'text', placeholder: '表示名', style: 'width:80px' });
      const addPlatformBtn = h('button', {
        class: 'preview-btn',
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

      return h('div', { class: 'export-card' },
        h('h3', {}, isNew ? '駅を追加' : `駅を編集: ${station.id}`),
        h('div', { class: 'worker-config-grid' },
          h('label', {}, '駅ID'), idInput,
          h('label', {}, '駅名'), nameInput,
          h('label', {}, 'かな'), kanaInput
        ),
        h('h4', {}, 'のりば'),
        h('div', { class: 'table-container' },
          h('table', { class: 'data-table' },
            h('thead', {}, h('tr', {}, h('th', {}, 'のりばID'), h('th', {}, '表示名'), h('th', {}, '操作'))),
            platformsTbody
          )
        ),
        h('div', { class: 'worker-config-actions' }, newPlatformIdInput, newPlatformLabelInput, addPlatformBtn),
        h('div', { class: 'worker-config-actions' },
          h('button', { class: 'export-btn', type: 'button', onClick: saveStation }, isNew ? '追加する' : '保存'),
          h('button', { class: 'preview-btn', type: 'button', onClick: () => { expandedId = null; renderDetail(); } }, 'キャンセル')
        )
      );
    }

    renderList();
    renderDetail();
  }

  render();
}

function emptyNotice() {
  const p = document.createElement('p');
  p.className = 'ed2-placeholder';
  p.textContent = '先に「保存/読込」タブで路線網 (network) を読み込んでください。';
  return p;
}

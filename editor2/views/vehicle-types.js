import { h, clear } from '../../editor-shared/dom.js';

export function renderVehicleTypesView(container, ctx) {
  clear(container);
  const { store } = ctx;
  const network = store.state.docs.network;

  if (!network) {
    container.appendChild(emptyNotice());
    return;
  }

  container.appendChild(h('div', { class: 'g-section-header' },
    h('h2', {}, '車両種別（閲覧のみ）')
  ));

  const tbody = h('tbody', {});
  network.vehicleTypes
    .slice()
    .sort((a, b) => (a.order ?? 0) - (b.order ?? 0))
    .forEach((vt) => {
      tbody.appendChild(h('tr', {},
        h('td', {}, vt.id),
        h('td', {}, vt.name),
        h('td', {}, vt.shortName || ''),
        h('td', {}, String(vt.order ?? '')),
        h('td', {}, h('span', {
          style: `display:inline-block;width:16px;height:16px;border:1px solid var(--borderColor-default);background:${vt.color || 'var(--bgColor-muted)'};vertical-align:middle;`
        }), ' ' + (vt.color || ''))
      ));
    });

  container.appendChild(h('div', { class: 'g-table-wrap' },
    h('table', { class: 'g-table' },
      h('thead', {}, h('tr', {},
        h('th', {}, 'ID'), h('th', {}, '名前'), h('th', {}, '略称'), h('th', {}, '順序'), h('th', {}, '色')
      )),
      tbody
    )
  ));
}

function emptyNotice() {
  const p = document.createElement('p');
  p.className = 'g-empty';
  p.textContent = '先に「保存/読込」タブで路線網 (network) を読み込んでください。';
  return p;
}

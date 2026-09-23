import { h, clear } from '../dom.js';

export function renderVehicleTypesView(container, ctx) {
  const { store } = ctx;
  const network = store.state.docs.network;

  const view = h('div', { class: 'g-view' });
  container.appendChild(view);

  const list = h('div', { class: 'g-list' });
  network.vehicleTypes
    .slice()
    .sort((a, b) => (a.order ?? 0) - (b.order ?? 0))
    .forEach((vt) => {
      list.appendChild(h('div', { class: 'g-list__row' },
        h('span', { class: 'g-svc-dot', style: `background:${vt.color || '#999999'};` }),
        h('span', {}, vt.name),
        vt.shortName ? h('span', { class: 'g-ws-right__note' }, vt.shortName) : null,
        h('span', { class: 'g-list__item-id' }, vt.id)
      ));
    });

  view.appendChild(h('div', { class: 'g-single-col' },
    h('div', { class: 'g-card' },
      h('div', { class: 'g-card__header' }, '車両種別'),
      h('div', { class: 'g-card__body' },
        h('p', { class: 'g-ws-right__note' }, '車両種別は管理者が設定します。'),
        list
      )
    )
  ));

  return { destroy() {} };
}

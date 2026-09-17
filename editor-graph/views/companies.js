import { h, clear, icon } from '../dom.js';
import { alertDialog, confirmDialog } from '../components/dialog.js';
import { openPopover } from '../components/overlay.js';
import * as companyOps from '../../editor-core/company-ops.js';
import { findReferences } from '../../editor2/refs.js';

const REF_TAB_BY_KIND = { line: 'lines' };

function refTarget(ref) {
  const tab = REF_TAB_BY_KIND[ref.kind];
  if (!tab) return null;
  return { tab, id: ref.id, sub: null };
}

function renderRefList(refs, requestNavigate) {
  const list = h('div', { class: 'g-list' });
  refs.forEach((ref) => {
    const target = refTarget(ref);
    if (target) {
      list.appendChild(h('button', {
        type: 'button', class: 'g-list__item', onClick: () => requestNavigate(target)
      }, ref.label));
    } else {
      list.appendChild(h('div', { class: 'g-list__row' }, ref.label));
    }
  });
  return list;
}

export function renderCompaniesView(container, ctx) {
  const { store, requestNavigate } = ctx;
  const network = store.state.docs.network;
  const operations = store.state.docs.operations;

  let selectedId = null;
  let blockedRefs = null;

  const view = h('div', { class: 'g-view' });
  container.appendChild(view);

  function refresh() {
    clear(view);
    view.appendChild(h('div', { class: 'g-single-col' }, renderCard()));
  }

  function renderCard() {
    const list = h('div', { class: 'g-list' });
    network.companies.forEach((company) => {
      list.appendChild(renderRow(company));
      if (selectedId === company.id) list.appendChild(renderDetail(company));
    });

    const addBtn = h('button', {
      type: 'button', class: 'g-btn',
      onClick: (event) => openAddPopover(event.clientX, event.clientY)
    }, icon('plus'), '鉄道会社を追加');

    return h('div', { class: 'g-card' },
      h('div', { class: 'g-card__header' }, '鉄道会社'),
      h('div', { class: 'g-card__body' }, list, addBtn)
    );
  }

  function renderRow(company) {
    const isOwn = network.meta && network.meta.ownCompanyId === company.id;
    return h('button', {
      type: 'button',
      class: 'g-list__item' + (selectedId === company.id ? ' is-selected' : ''),
      onClick: () => {
        selectedId = selectedId === company.id ? null : company.id;
        blockedRefs = null;
        refresh();
      }
    },
      h('span', {}, company.name),
      h('span', { class: 'g-list__item-id' }, company.id),
      isOwn ? h('span', { class: 'g-label' }, '自社') : null
    );
  }

  function renderDetail(company) {
    const nameInput = h('input', { type: 'text', class: 'g-input', value: company.name });
    nameInput.addEventListener('change', () => {
      const name = nameInput.value.trim();
      if (!name) { nameInput.value = company.name; return; }
      store.mutateDoc('network', (doc) => {
        const target = doc.companies.find((c) => c.id === company.id);
        if (target) target.name = name;
      });
    });

    const body = [
      h('div', { class: 'g-field' }, h('label', { class: 'g-field__label' }, '会社名'), nameInput)
    ];

    if (blockedRefs) {
      body.push(h('div', { class: 'g-field' },
        h('span', { class: 'g-field__error' }, '使われているため削除できません。'),
        renderRefList(blockedRefs, requestNavigate)
      ));
    } else {
      body.push(h('button', {
        type: 'button', class: 'g-btn g-btn--danger',
        onClick: async () => {
          const ownMsg = companyOps.canDeleteCompany(network, company.id);
          if (ownMsg) { await alertDialog(ownMsg); return; }
          const refs = findReferences(network, operations, { type: 'company', id: company.id });
          if (refs.length > 0) {
            blockedRefs = refs;
            refresh();
            return;
          }
          const ok = await confirmDialog(`鉄道会社「${company.name}」を削除します。`, { confirmLabel: '鉄道会社を削除', danger: true });
          if (!ok) return;
          store.mutateDoc('network', (doc) => {
            doc.companies = doc.companies.filter((c) => c.id !== company.id);
          });
          selectedId = null;
          blockedRefs = null;
          refresh();
        }
      }, icon('trash'), '鉄道会社を削除'));
    }

    return h('div', { class: 'g-company-detail' }, body);
  }

  function openAddPopover(clientX, clientY) {
    const idInput = h('input', { type: 'text', class: 'g-input', placeholder: '例: KT' });
    const nameInput = h('input', { type: 'text', class: 'g-input' });
    const errorEl = h('div', { class: 'g-field__error' });

    const submit = () => {
      const draft = { id: idInput.value.trim(), name: nameInput.value.trim() };
      const err = companyOps.validateCompanyDraft(network, draft, true);
      if (err) { errorEl.textContent = err; return; }
      store.mutateDoc('network', (doc) => { doc.companies.push(draft); });
      selectedId = draft.id;
      blockedRefs = null;
      close();
      refresh();
    };

    const form = h('div', { class: 'g-popover-form' },
      h('div', { class: 'g-field' },
        h('label', { class: 'g-field__label' }, '会社ID'),
        idInput,
        h('div', { class: 'g-field__hint' }, '英数字・_・- のみ、1〜64文字')
      ),
      h('div', { class: 'g-field' }, h('label', { class: 'g-field__label' }, '会社名'), nameInput),
      errorEl,
      h('div', { class: 'g-popover-actions' },
        h('button', { type: 'button', class: 'g-btn', onClick: () => close() }, 'キャンセル'),
        h('button', { type: 'button', class: 'g-btn g-btn--primary', onClick: submit }, '作成')
      )
    );

    const close = openPopover(clientX, clientY, form);
  }

  refresh();
  return { destroy() {} };
}

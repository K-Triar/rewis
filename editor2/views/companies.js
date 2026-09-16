import { h, clear } from '../dom.js';
import { alertDialog } from '../components/dialog.js';
import { isValidId } from '../../shared/ids.js';
import { findReferences } from '../refs.js';

export function renderCompaniesView(container, ctx) {
  clear(container);
  const { store, refreshAll } = ctx;
  const network = store.state.docs.network;

  if (!network) {
    container.appendChild(emptyNotice());
    return;
  }

  let mode = null; // null | '__new__' | 会社ID（編集中） | { delete: 会社ID }

  function render() {
    clear(container);

    container.appendChild(h('div', { class: 'section-header' },
      h('h2', {}, '鉄道会社'),
      h('button', { class: 'add-btn', type: 'button', onClick: () => { mode = '__new__'; render(); } }, '+ 追加')
    ));

    const tbody = h('tbody', {});
    network.companies.forEach((company) => tbody.appendChild(renderRow(company)));
    if (mode === '__new__') tbody.appendChild(renderNewRow());

    container.appendChild(h('div', { class: 'table-container' },
      h('table', { class: 'data-table' },
        h('thead', {}, h('tr', {},
          h('th', { style: 'width:160px' }, '会社ID'),
          h('th', {}, '会社名'),
          h('th', { style: 'width:180px' }, '操作')
        )),
        tbody
      )
    ));
  }

  function renderNewRow() {
    const idInput = h('input', { type: 'text', placeholder: '例: KT' });
    const nameInput = h('input', { type: 'text', placeholder: '会社名' });

    async function save() {
      const id = idInput.value.trim();
      const name = nameInput.value.trim();
      if (!isValidId(id)) {
        await alertDialog('会社IDの書式が不正です（英数字・_・- のみ、1〜64文字）。');
        return;
      }
      if (network.companies.some((c) => c.id === id)) {
        await alertDialog('同じIDの会社が既にあります。');
        return;
      }
      if (!name) {
        await alertDialog('会社名を入力してください。');
        return;
      }
      store.mutateDoc('network', (doc) => doc.companies.push({ id, name }));
      mode = null;
      render();
      refreshAll();
    }

    return h('tr', {},
      h('td', {}, idInput),
      h('td', {}, nameInput),
      h('td', {},
        h('button', { class: 'export-btn', type: 'button', onClick: save }, '保存'),
        h('button', { class: 'preview-btn', type: 'button', onClick: () => { mode = null; render(); } }, 'キャンセル')
      )
    );
  }

  function renderRow(company) {
    if (mode === company.id) {
      const nameInput = h('input', { type: 'text', value: company.name });

      async function save() {
        const name = nameInput.value.trim();
        if (!name) {
          await alertDialog('会社名を入力してください。');
          return;
        }
        store.mutateDoc('network', (doc) => {
          const target = doc.companies.find((c) => c.id === company.id);
          if (target) target.name = name;
        });
        mode = null;
        render();
        refreshAll();
      }

      return h('tr', {},
        h('td', {}, company.id),
        h('td', {}, nameInput),
        h('td', {},
          h('button', { class: 'export-btn', type: 'button', onClick: save }, '保存'),
          h('button', { class: 'preview-btn', type: 'button', onClick: () => { mode = null; render(); } }, 'キャンセル')
        )
      );
    }

    if (mode && typeof mode === 'object' && mode.delete === company.id) {
      const refs = findReferences(network, store.state.docs.operations, { type: 'company', id: company.id });
      if (refs.length > 0) {
        return h('tr', {},
          h('td', {}, company.id),
          h('td', { colspan: '2' },
            h('span', { class: 'ed2-issue-error' }, `削除できません。参照箇所: ${refs.map((r) => r.label).join(' / ')}`),
            ' ',
            h('button', { class: 'preview-btn', type: 'button', onClick: () => { mode = null; render(); } }, '閉じる')
          )
        );
      }
      return h('tr', {},
        h('td', {}, company.id),
        h('td', {}, company.name),
        h('td', {},
          '本当に削除しますか？ ',
          h('button', {
            class: 'export-btn',
            type: 'button',
            onClick: () => {
              store.mutateDoc('network', (doc) => {
                doc.companies = doc.companies.filter((c) => c.id !== company.id);
              });
              mode = null;
              render();
              refreshAll();
            }
          }, '削除する'),
          h('button', { class: 'preview-btn', type: 'button', onClick: () => { mode = null; render(); } }, 'キャンセル')
        )
      );
    }

    return h('tr', {},
      h('td', {}, company.id),
      h('td', {}, company.name),
      h('td', {},
        h('button', { class: 'preview-btn', type: 'button', onClick: () => { mode = company.id; render(); } }, '編集'),
        h('button', { class: 'preview-btn', type: 'button', onClick: () => { mode = { delete: company.id }; render(); } }, '削除')
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

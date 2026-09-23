import { h, clear } from '../../common/dom.js';
import { alertDialog, confirmDialog } from '../../common/components/dialog.js';
import { getSavedSession } from '../../common/api.js';
import {
  createEmptyNotice,
  updateNoticeFields,
  setNoticeRange,
  normalizeRange,
  setNoticeDirections,
  setNoticeCategories,
  setNoticeStatus,
  updateNoticeStatusText,
  setNoticeCause,
  updateNoticeCauseFields,
  setNoticeTurnback,
  setThroughService,
  removeThroughService,
  setNoticeText,
  duplicateNotice,
  validateNoticeDraft,
  NOTICE_STATE_LABEL,
  THROUGH_TARGET_LABEL
} from '../../core/notice-ops.js';
import { lineName } from '../../core/lookup.js';
import { formatDateTime } from '../../common/format.js';
import { generateNoticeText } from '../../../shared/notice-text.js';
import { throughTargetsFor } from '../../../shared/model.js';

function stationsOfLine(network, lineId) {
  const line = (network.lines || []).find((l) => l.id === lineId);
  return line ? line.stations.map((id) => (network.stations || []).find((s) => s.id === id)).filter(Boolean) : [];
}

export function renderOperationsView(container, ctx) {
  clear(container);
  const { store, refreshAll, requestNavigate, focus } = ctx;
  const network = store.state.docs.network;
  const operations = store.state.docs.operations;

  if (!network || !operations) {
    container.appendChild(emptyNotice());
    return;
  }

  const focusId = focus && focus.tab === 'operations' ? focus.id : null;
  let expandedId = focusId; // null | '__new__' | notice.id
  let deletingId = null;
  let stateFilter = 'active'; // active（下書き・公開中） | all | draft | published | closed
  let lineFilter = '';
  let scrolledToFocus = false;
  let pendingScroll = null; // { type: 'top' } | { type: 'row', id }

  function visibleNotices() {
    return operations.notices.filter((n) => {
      if (lineFilter && n.lineId !== lineFilter) return false;
      if (stateFilter === 'active') return n.state !== 'closed';
      if (stateFilter === 'all') return true;
      return n.state === stateFilter;
    });
  }

  function render() {
    clear(container);

    const stateSelect = h('select', { class: 'g-select' },
      h('option', { value: 'active' }, '下書き・公開中'),
      h('option', { value: 'all' }, 'すべて'),
      h('option', { value: 'draft' }, '下書きのみ'),
      h('option', { value: 'published' }, '公開中のみ'),
      h('option', { value: 'closed' }, '終了のみ')
    );
    stateSelect.value = stateFilter;
    stateSelect.addEventListener('change', () => { stateFilter = stateSelect.value; render(); });

    const lineSelect = h('select', { class: 'g-select' },
      h('option', { value: '' }, 'すべての路線'),
      ...network.lines.map((l) => h('option', { value: l.id }, l.name))
    );
    lineSelect.value = lineFilter;
    lineSelect.addEventListener('change', () => { lineFilter = lineSelect.value; render(); });

    container.appendChild(h('div', { class: 'g-section-header' },
      h('h2', {}, '運行情報'),
      h('button', { class: 'g-btn g-btn--primary', type: 'button', onClick: () => { expandedId = '__new__'; pendingScroll = { type: 'top' }; render(); } }, '+ 追加')
    ));
    container.appendChild(h('div', { class: 'g-actions-row' }, stateSelect, lineSelect));

    const detailContainer = h('div', { class: 'ed2-split__form' });

    const tbody = h('tbody', {});
    visibleNotices().forEach((notice) => tbody.appendChild(renderRow(notice)));
    const listWrap = h('div', { class: 'ed2-list-scroll ed2-split__list g-table-wrap' },
      h('table', { class: 'g-table' },
        h('thead', {}, h('tr', {},
          h('th', {}, '状態'), h('th', {}, '路線'), h('th', {}, '見出し'),
          h('th', {}, '原因'), h('th', {}, '更新日時'), h('th', { style: 'width:220px' }, '操作')
        )),
        tbody
      )
    );
    container.appendChild(h('div', { class: 'ed2-split' }, listWrap, detailContainer));

    if (expandedId === '__new__') {
      detailContainer.appendChild(renderForm(null));
    } else if (expandedId) {
      const notice = operations.notices.find((n) => n.id === expandedId);
      if (notice) detailContainer.appendChild(renderForm(notice));
    }
    if (focusId && !scrolledToFocus && expandedId === focusId && detailContainer.firstChild) {
      detailContainer.scrollIntoView({ block: 'center' });
      scrolledToFocus = true;
    }
    if (pendingScroll) {
      const action = pendingScroll;
      pendingScroll = null;
      if (action.type === 'top') {
        detailContainer.scrollIntoView({ block: 'start' });
      } else if (action.type === 'row') {
        const row = listWrap.querySelector(`[data-row-id="${action.id}"]`);
        if (row) row.scrollIntoView({ block: 'center' });
      }
    }
  }

  function causeLabel(notice) {
    const tpl = (operations.masters.causes || []).find((c) => c.code === notice.cause.code);
    if (tpl) return tpl.label;
    if (notice.cause.code === 'other') return notice.cause.heading || 'その他';
    return notice.cause.code || '';
  }

  function renderRow(notice) {
    if (deletingId === notice.id) {
      return h('tr', {},
        h('td', { colspan: '5' }, '本当に削除しますか？'),
        h('td', {},
          h('button', {
            class: 'g-btn g-btn--danger g-btn--small', type: 'button',
            onClick: () => {
              store.mutateDoc('operations', (doc) => { doc.notices = doc.notices.filter((n) => n.id !== notice.id); });
              deletingId = null;
              if (expandedId === notice.id) expandedId = null;
              render();
              refreshAll();
            }
          }, '削除する'),
          h('button', { class: 'g-btn g-btn--small', type: 'button', onClick: () => { deletingId = null; render(); } }, 'キャンセル')
        )
      );
    }

    const heading = generateNoticeText(notice, network, operations.masters).heading;
    return h('tr', { class: expandedId === notice.id ? 'is-editing' : null, 'data-row-id': notice.id },
      h('td', {}, NOTICE_STATE_LABEL[notice.state] || notice.state),
      h('td', {}, lineName(network, notice.lineId)),
      h('td', {}, heading),
      h('td', {}, causeLabel(notice)),
      h('td', {}, formatDateTime(notice.updatedAt)),
      h('td', {},
        h('button', {
          class: 'g-btn g-btn--small', type: 'button',
          onClick: () => {
            const opening = expandedId !== notice.id;
            pendingScroll = opening ? { type: 'top' } : { type: 'row', id: notice.id };
            expandedId = opening ? notice.id : null;
            render();
          }
        }, expandedId === notice.id ? '閉じる' : '詳細'),
        h('button', {
          class: 'g-btn g-btn--small', type: 'button',
          onClick: () => {
            const dup = duplicateNotice(notice);
            store.mutateDoc('operations', (doc) => doc.notices.push(dup));
            expandedId = dup.id;
            render();
            refreshAll();
          }
        }, '複製'),
        h('button', { class: 'g-btn g-btn--small', type: 'button', onClick: () => { deletingId = notice.id; render(); } }, '削除')
      )
    );
  }

  function renderForm(notice) {
    const isNew = !notice;
    let draft = isNew ? createEmptyNotice(network) : structuredClone(notice);

    const form = h('div', { class: 'g-card' });

    function refreshForm() {
      clear(form);
      form.appendChild(h('div', { class: 'g-card__header' }, isNew ? '運行情報を追加' : `運行情報を編集: ${draft.id}`));
      form.appendChild(buildFormBody());
    }

    function buildFormBody() {
      const line = network.lines.find((l) => l.id === draft.lineId);
      const stations = draft.lineId ? stationsOfLine(network, draft.lineId) : [];

      // --- 路線・状態 ---
      const lineSelect = h('select', { class: 'g-select' }, ...network.lines.map((l) => h('option', { value: l.id }, l.name)));
      lineSelect.value = draft.lineId || '';
      lineSelect.addEventListener('change', () => { draft = updateNoticeFields(draft, { lineId: lineSelect.value }); refreshForm(); });

      const stateSelect = h('select', { class: 'g-select' },
        h('option', { value: 'draft' }, '下書き'),
        h('option', { value: 'published' }, '公開中'),
        h('option', { value: 'closed' }, '終了')
      );
      stateSelect.value = draft.state;
      stateSelect.addEventListener('change', () => { draft = updateNoticeFields(draft, { state: stateSelect.value }); refreshForm(); });

      // --- 発生日時 ---
      const occ = draft.occurrence;
      const yearInput = h('input', { type: 'number', class: 'g-input', value: occ.year ?? '', style: 'width:80px' });
      const monthInput = h('input', { type: 'number', class: 'g-input', min: '1', max: '12', value: occ.month ?? '', style: 'width:60px' });
      const dayInput = h('input', { type: 'number', class: 'g-input', min: '1', max: '31', value: occ.day ?? '', style: 'width:60px' });
      const hourInput = h('input', { type: 'number', class: 'g-input', min: '0', max: '23', value: occ.hour ?? '', style: 'width:60px', placeholder: '時' });
      const minuteInput = h('input', { type: 'number', class: 'g-input', min: '0', max: '59', value: occ.minute ?? '', style: 'width:60px', placeholder: '分' });
      function commitOccurrence() {
        draft = updateNoticeFields(draft, {
          occurrence: {
            year: yearInput.value ? Number(yearInput.value) : null,
            month: monthInput.value ? Number(monthInput.value) : null,
            day: dayInput.value ? Number(dayInput.value) : null,
            hour: hourInput.value ? Number(hourInput.value) : null,
            minute: minuteInput.value ? Number(minuteInput.value) : null
          }
        });
      }
      [yearInput, monthInput, dayInput, hourInput, minuteInput].forEach((el) => el.addEventListener('change', commitOccurrence));

      // --- 影響区間 ---
      if (draft.range && draft.range.direction === 'backward') draft = setNoticeRange(draft, normalizeRange(draft.range));
      const isFullLine = draft.range == null;
      const fullLineCheckbox = h('input', { type: 'checkbox' });
      fullLineCheckbox.checked = isFullLine;
      fullLineCheckbox.addEventListener('change', () => {
        draft = setNoticeRange(draft, fullLineCheckbox.checked ? null : { fromStationId: stations[0] ? stations[0].id : null, toStationId: stations[stations.length - 1] ? stations[stations.length - 1].id : null, direction: null });
        refreshForm();
      });

      const rangeControls = h('div', {});
      if (!isFullLine) {
        const startSelect = h('select', { class: 'g-select' }, ...stations.map((s) => h('option', { value: s.id }, s.name)));
        startSelect.value = draft.range.fromStationId || '';
        const endSelect = h('select', { class: 'g-select' }, ...stations.map((s) => h('option', { value: s.id }, s.name)));
        endSelect.value = draft.range.toStationId || '';
        function commitRange() {
          draft = setNoticeRange(draft, { fromStationId: startSelect.value, toStationId: endSelect.value, direction: null });
        }
        startSelect.addEventListener('change', commitRange);
        endSelect.addEventListener('change', commitRange);
        rangeControls.appendChild(h('div', { class: 'g-actions-row' },
          h('label', { class: 'g-field__label' }, '始点 ', startSelect),
          h('label', { class: 'g-field__label' }, '終点 ', endSelect)
        ));

        if (line && line.loop) {
          rangeControls.appendChild(h('p', { class: 'g-field__hint' }, `環状線・ラケット型の路線では、始点から終点へ「${line.directions.forward}」方向に進んだ側の区間が対象です。反対側にしたい場合は始点と終点を入れ替えてください。`));
        }
      }

      // --- 方向（列車の進行方向） ---
      const dirNames = line ? line.directions : { forward: '下り線', backward: '上り線' };
      const forwardCheckbox = h('input', { type: 'checkbox' });
      forwardCheckbox.checked = draft.directions.forward;
      const backwardCheckbox = h('input', { type: 'checkbox' });
      backwardCheckbox.checked = draft.directions.backward;
      function commitDirections() {
        draft = setNoticeDirections(draft, { forward: forwardCheckbox.checked, backward: backwardCheckbox.checked });
      }
      forwardCheckbox.addEventListener('change', commitDirections);
      backwardCheckbox.addEventListener('change', commitDirections);

      // --- 影響種別 ---
      const allCategoriesCheckbox = h('input', { type: 'checkbox' });
      allCategoriesCheckbox.checked = draft.categoryIds == null;
      allCategoriesCheckbox.addEventListener('change', () => {
        draft = setNoticeCategories(draft, allCategoriesCheckbox.checked ? null : []);
        refreshForm();
      });
      const categoryChecks = h('div', { class: 'g-actions-row' });
      if (draft.categoryIds != null && line) {
        line.categories.forEach((category) => {
          const checkbox = h('input', { type: 'checkbox' });
          checkbox.checked = draft.categoryIds.includes(category.id);
          checkbox.addEventListener('change', () => {
            const next = new Set(draft.categoryIds);
            if (checkbox.checked) next.add(category.id); else next.delete(category.id);
            draft = setNoticeCategories(draft, Array.from(next));
          });
          categoryChecks.appendChild(h('label', { class: 'g-field__label' }, checkbox, ` ${category.name} `));
        });
      }

      // --- 状態（ステータス） ---
      const statusSelect = h('select', { class: 'g-select' },
        ...operations.masters.statusTemplates.map((t) => h('option', { value: t.code }, t.label)),
        h('option', { value: 'notice' }, 'お知らせ'),
        h('option', { value: 'other' }, 'その他')
      );
      statusSelect.value = draft.status.code;
      statusSelect.addEventListener('change', () => { draft = setNoticeStatus(operations.masters, draft, statusSelect.value); refreshForm(); });

      const isCustomStatus = draft.status.code === 'notice' || draft.status.code === 'other';
      const statusHeadingInput = h('input', { type: 'text', class: 'g-input', value: draft.status.heading || '', disabled: !isCustomStatus });
      const statusBodyInput = h('textarea', { class: 'g-textarea', rows: '2', disabled: !isCustomStatus }, draft.status.body || '');
      if (isCustomStatus) {
        statusHeadingInput.addEventListener('change', () => { draft = updateNoticeStatusText(draft, { heading: statusHeadingInput.value }); });
        statusBodyInput.addEventListener('change', () => { draft = updateNoticeStatusText(draft, { body: statusBodyInput.value }); });
      }

      // --- 原因 ---
      const causeSelect = h('select', { class: 'g-select' }, ...operations.masters.causes.map((c) => h('option', { value: c.code }, c.label)));
      causeSelect.value = draft.cause.code;
      causeSelect.addEventListener('change', () => { draft = setNoticeCause(operations.masters, draft, causeSelect.value); refreshForm(); });

      const isCustomCause = draft.cause.code === 'other';
      const causeHeadingInput = h('input', { type: 'text', class: 'g-input', value: draft.cause.heading || '', disabled: !isCustomCause });
      const causeBodyInput = h('textarea', { class: 'g-textarea', rows: '2', disabled: !isCustomCause }, draft.cause.body || '');
      if (isCustomCause) {
        causeHeadingInput.addEventListener('change', () => { draft = updateNoticeCauseFields(draft, { heading: causeHeadingInput.value }); });
        causeBodyInput.addEventListener('change', () => { draft = updateNoticeCauseFields(draft, { body: causeBodyInput.value }); });
      }

      const causeLineOptionSelect = h('select', { class: 'g-select' },
        h('option', { value: 'affected' }, '影響路線と同じ'),
        h('option', { value: 'line' }, '別の路線'),
        h('option', { value: 'hidden' }, '表示しない')
      );
      causeLineOptionSelect.value = draft.cause.lineOption;
      causeLineOptionSelect.addEventListener('change', () => { draft = updateNoticeCauseFields(draft, { lineOption: causeLineOptionSelect.value }); refreshForm(); });

      const causeLineSelectWrap = h('div', {});
      if (draft.cause.lineOption === 'line') {
        const causeLineSelect = h('select', { class: 'g-select' }, ...network.lines.map((l) => h('option', { value: l.id }, l.name)));
        causeLineSelect.value = draft.cause.lineId || '';
        causeLineSelect.addEventListener('change', () => { draft = updateNoticeCauseFields(draft, { lineId: causeLineSelect.value }); });
        causeLineSelectWrap.appendChild(h('div', { class: 'g-field' }, h('label', { class: 'g-field__label' }, '原因路線'), causeLineSelect));
      }

      // --- 折り返し ---
      const turnbackStart = h('input', { type: 'checkbox' });
      turnbackStart.checked = draft.turnback.start;
      const turnbackEnd = h('input', { type: 'checkbox' });
      turnbackEnd.checked = draft.turnback.end;
      turnbackStart.addEventListener('change', () => { draft = setNoticeTurnback(draft, { start: turnbackStart.checked }); });
      turnbackEnd.addEventListener('change', () => { draft = setNoticeTurnback(draft, { end: turnbackEnd.checked }); });

      // --- 直通 ---
      const throughContainer = h('div', {});
      const throughLinks = draft.lineId ? throughTargetsFor(network, draft.lineId) : [];
      if (throughLinks.length === 0) {
        throughContainer.appendChild(h('p', { class: 'g-field__hint' }, '直通設定はありません。'));
      } else {
        throughLinks.forEach((link) => {
          const existing = (draft.throughServices || []).find((ts) => ts.lineId === link.lineId) || { lineId: link.lineId, state: 'none', target: link.allowedTargets[0], showOnThroughLine: false };
          const stateSel = h('select', { class: 'g-select' },
            h('option', { value: 'none' }, '影響なし'),
            h('option', { value: 'suspended' }, '直通中止'),
            h('option', { value: 'resumed' }, '直通再開')
          );
          stateSel.value = existing.state;
          const targetOptions = link.allowedTargets.includes('mutual') ? ['mutual', 'affected_to_through', 'through_to_affected'] : link.allowedTargets;
          const targetSel = h('select', { class: 'g-select' }, ...targetOptions.map((t) => h('option', { value: t }, THROUGH_TARGET_LABEL[t])));
          targetSel.value = existing.target;
          const showCheckbox = h('input', { type: 'checkbox' });
          showCheckbox.checked = existing.showOnThroughLine;
          const enabled = existing.state === 'suspended';
          targetSel.disabled = !enabled;
          showCheckbox.disabled = !enabled;

          function commit() {
            if (stateSel.value === 'none') {
              draft = removeThroughService(draft, link.lineId);
            } else {
              draft = setThroughService(draft, link.lineId, { state: stateSel.value, target: targetSel.value, showOnThroughLine: stateSel.value === 'suspended' && showCheckbox.checked });
            }
          }
          stateSel.addEventListener('change', () => { commit(); refreshForm(); });
          targetSel.addEventListener('change', commit);
          showCheckbox.addEventListener('change', commit);

          throughContainer.appendChild(h('div', { class: 'g-actions-row' },
            h('strong', {}, lineName(network, link.lineId)),
            h('label', { class: 'g-field__label' }, ' 直通状態 ', stateSel),
            h('label', { class: 'g-field__label' }, ' 対象 ', targetSel),
            h('label', { class: 'g-field__label' }, showCheckbox, ' 直通先路線に表示')
          ));
        });
      }

      // --- プレビュー ---
      const preview = generateNoticeText(draft, network, operations.masters);
      const textModeAuto = h('input', { type: 'radio', name: 'g-notice-text-mode' });
      textModeAuto.checked = draft.text.mode === 'auto';
      const textModeCustom = h('input', { type: 'radio', name: 'g-notice-text-mode' });
      textModeCustom.checked = draft.text.mode === 'custom';
      textModeAuto.addEventListener('change', () => { draft = setNoticeText(draft, 'auto'); refreshForm(); });
      textModeCustom.addEventListener('change', () => {
        draft = setNoticeText(draft, 'custom', `${preview.heading}\n${preview.body}`);
        refreshForm();
      });

      const previewBox = draft.text.mode === 'custom'
        ? h('textarea', { class: 'g-textarea', rows: '4' }, draft.text.custom || '')
        : h('div', { class: 'g-banner' }, h('div', {}, h('strong', {}, preview.heading), h('p', { style: 'margin:var(--space-xs) 0 0;' }, preview.body)));
      if (draft.text.mode === 'custom') {
        previewBox.addEventListener('change', () => { draft = setNoticeText(draft, 'custom', previewBox.value); });
      }

      async function save() {
        const error = validateNoticeDraft(network, operations.masters, draft);
        if (error) { await alertDialog(error); return; }
        const now = new Date().toISOString();
        const session = getSavedSession();
        const record = { ...draft, updatedAt: now, updatedBy: session ? session.userId : null };
        if (isNew) record.createdAt = now;

        store.mutateDoc('operations', (doc) => {
          const idx = doc.notices.findIndex((n) => n.id === record.id);
          if (idx === -1) doc.notices.push(record); else doc.notices[idx] = record;
        });
        expandedId = record.id;
        render();
        refreshAll();
      }

      async function cancel() {
        if (JSON.stringify(draft) !== JSON.stringify(notice) || isNew) {
          const ok = await confirmDialog('変更を破棄しますか？');
          if (!ok) return;
        }
        pendingScroll = isNew ? null : { type: 'row', id: notice.id };
        expandedId = null;
        render();
      }

      return h('div', { class: 'g-card__body' },
        h('div', { class: 'g-field' }, h('label', { class: 'g-field__label' }, '影響路線'), lineSelect),
        h('div', { class: 'g-field' }, h('label', { class: 'g-field__label' }, '状態'), stateSelect),

        h('h4', { style: 'margin-block:var(--stack-gap-normal) var(--stack-gap-condensed);' }, '発生日時'),
        h('div', { class: 'g-actions-row' }, yearInput, '年', monthInput, '月', dayInput, '日', hourInput, minuteInput, '（時刻は空欄可）'),

        h('h4', { style: 'margin-block:var(--stack-gap-normal) var(--stack-gap-condensed);' }, '影響区間'),
        h('label', { class: 'g-field__label' }, fullLineCheckbox, ' 全線'),
        rangeControls,

        h('h4', { style: 'margin-block:var(--stack-gap-normal) var(--stack-gap-condensed);' }, '方向（列車の進行方向）'),
        h('div', { class: 'g-actions-row' },
          h('label', { class: 'g-field__label' }, forwardCheckbox, ` ${dirNames.forward}`),
          h('label', { class: 'g-field__label' }, backwardCheckbox, ` ${dirNames.backward}`)
        ),

        h('h4', { style: 'margin-block:var(--stack-gap-normal) var(--stack-gap-condensed);' }, '影響種別'),
        h('label', { class: 'g-field__label' }, allCategoriesCheckbox, ' すべて'),
        categoryChecks,

        h('h4', { style: 'margin-block:var(--stack-gap-normal) var(--stack-gap-condensed);' }, '状態（ステータス）'),
        h('div', { class: 'g-field' }, h('label', { class: 'g-field__label' }, '種類'), statusSelect),
        h('div', { class: 'g-field' }, h('label', { class: 'g-field__label' }, '見出し'), statusHeadingInput),
        h('div', { class: 'g-field' }, h('label', { class: 'g-field__label' }, '本文'), statusBodyInput),

        h('h4', { style: 'margin-block:var(--stack-gap-normal) var(--stack-gap-condensed);' }, '原因'),
        h('div', { class: 'g-field' }, h('label', { class: 'g-field__label' }, '種類'), causeSelect),
        h('div', { class: 'g-field' }, h('label', { class: 'g-field__label' }, '見出し'), causeHeadingInput),
        h('div', { class: 'g-field' }, h('label', { class: 'g-field__label' }, '本文'), causeBodyInput),
        h('div', { class: 'g-field' }, h('label', { class: 'g-field__label' }, '原因路線の表示'), causeLineOptionSelect),
        causeLineSelectWrap,

        h('h4', { style: 'margin-block:var(--stack-gap-normal) var(--stack-gap-condensed);' }, '折り返し'),
        h('div', { class: 'g-actions-row' },
          h('label', { class: 'g-field__label' }, turnbackStart, ' 始点で折り返し'),
          h('label', { class: 'g-field__label' }, turnbackEnd, ' 終点で折り返し')
        ),

        h('h4', { style: 'margin-block:var(--stack-gap-normal) var(--stack-gap-condensed);' }, '直通'),
        throughContainer,

        h('h4', { style: 'margin-block:var(--stack-gap-normal) var(--stack-gap-condensed);' }, 'プレビュー'),
        h('div', { class: 'g-actions-row' },
          h('label', { class: 'g-field__label' }, textModeAuto, ' 自動生成'),
          h('label', { class: 'g-field__label' }, textModeCustom, ' 手動で書き換える')
        ),
        previewBox,

        h('div', { class: 'g-actions-row' },
          h('button', { class: 'g-btn g-btn--primary', type: 'button', onClick: save }, isNew ? '追加する' : '保存'),
          h('button', { class: 'g-btn', type: 'button', onClick: cancel }, 'キャンセル')
        )
      );
    }

    refreshForm();
    return form;
  }

  render();
}

function emptyNotice() {
  const p = document.createElement('p');
  p.className = 'g-empty';
  p.textContent = '先に「保存/読込」タブで路線網 (network) と運行情報 (operations) を読み込んでください。';
  return p;
}

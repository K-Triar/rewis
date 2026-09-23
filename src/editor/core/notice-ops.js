// 運行情報（notice）の編集ロジック。DOM を使わない。01-schema-v2.md 3章。
// v1 の editor.js（createEmptyServiceStatus・saveServiceStatus の入力チェック）を v2 の形に移植したもの。

import { newId } from '../../shared/ids.js';

export function createEmptyNotice(network) {
  const firstLine = (network && network.lines || [])[0];
  return {
    id: newId('nt'),
    state: 'draft',
    createdAt: null,
    updatedAt: null,
    updatedBy: null,
    occurrence: { year: new Date().getFullYear(), month: null, day: null, hour: null, minute: null, timezone: 'Asia/Tokyo' },
    lineId: firstLine ? firstLine.id : null,
    range: null,
    directions: { forward: true, backward: true },
    categoryIds: null,
    status: { code: '', heading: '', body: '' },
    cause: { code: '', heading: null, body: null, lineOption: 'affected', lineId: null, range: null },
    turnback: { start: false, end: false },
    throughServices: [],
    text: { mode: 'auto', custom: null }
  };
}

export function updateNoticeFields(notice, patch) {
  const draft = structuredClone(notice);
  if ('lineId' in patch && patch.lineId !== draft.lineId) {
    draft.lineId = patch.lineId;
    draft.range = null;
    draft.categoryIds = null;
    draft.throughServices = [];
  }
  if ('state' in patch) draft.state = patch.state;
  if ('occurrence' in patch) draft.occurrence = { ...draft.occurrence, ...patch.occurrence };
  return draft;
}

export function setNoticeRange(notice, range) {
  const draft = structuredClone(notice);
  draft.range = range ? { fromStationId: range.fromStationId, toStationId: range.toStationId, direction: range.direction ?? null } : null;
  return draft;
}

// 環状線・ラケット型の区間は「始点から終点へ下り方向に進んだ側」に一本化した。
// 旧データの direction:'backward' は始点と終点を入れ替えた同じ駅集合なので、その形に直す。
export function normalizeRange(range) {
  if (!range || range.direction !== 'backward') return range;
  return { fromStationId: range.toStationId, toStationId: range.fromStationId, direction: null };
}

export function setNoticeDirections(notice, directions) {
  const draft = structuredClone(notice);
  draft.directions = { forward: !!directions.forward, backward: !!directions.backward };
  return draft;
}

export function setNoticeCategories(notice, categoryIds) {
  const draft = structuredClone(notice);
  draft.categoryIds = categoryIds == null ? null : [...categoryIds];
  return draft;
}

export function setNoticeStatus(masters, notice, code) {
  const draft = structuredClone(notice);
  const tpl = (masters.statusTemplates || []).find((t) => t.code === code);
  if (tpl) {
    draft.status = { code, heading: tpl.heading || '', body: tpl.body || '' };
  } else {
    const keepText = draft.status && draft.status.code === code;
    draft.status = { code, heading: keepText ? draft.status.heading : '', body: keepText ? draft.status.body : '' };
  }
  return draft;
}

export function updateNoticeStatusText(notice, patch) {
  const draft = structuredClone(notice);
  draft.status = { ...draft.status, ...patch };
  return draft;
}

export function setNoticeCause(masters, notice, code) {
  const draft = structuredClone(notice);
  const tpl = (masters.causes || []).find((c) => c.code === code);
  draft.cause = {
    ...draft.cause,
    code,
    heading: tpl ? null : draft.cause.heading,
    body: tpl ? null : draft.cause.body,
    lineOption: tpl ? (tpl.defaultLineOption || 'affected') : draft.cause.lineOption
  };
  return draft;
}

export function updateNoticeCauseFields(notice, patch) {
  const draft = structuredClone(notice);
  draft.cause = { ...draft.cause, ...patch };
  if ('lineOption' in patch && patch.lineOption !== 'line') {
    draft.cause.lineId = null;
  }
  if ('lineOption' in patch && patch.lineOption === 'hidden') {
    draft.cause.range = null;
  }
  return draft;
}

export function setNoticeTurnback(notice, patch) {
  const draft = structuredClone(notice);
  draft.turnback = { ...draft.turnback, ...patch };
  return draft;
}

export function setThroughService(notice, lineId, patch) {
  const draft = structuredClone(notice);
  const list = draft.throughServices || [];
  const idx = list.findIndex((ts) => ts.lineId === lineId);
  if (idx === -1) {
    list.push({ lineId, state: 'none', target: 'mutual', showOnThroughLine: false, ...patch });
  } else {
    list[idx] = { ...list[idx], ...patch };
  }
  draft.throughServices = list;
  return draft;
}

export function removeThroughService(notice, lineId) {
  const draft = structuredClone(notice);
  draft.throughServices = (draft.throughServices || []).filter((ts) => ts.lineId !== lineId);
  return draft;
}

export function setNoticeText(notice, mode, custom) {
  const draft = structuredClone(notice);
  draft.text = { mode, custom: mode === 'custom' ? (custom || '') : null };
  return draft;
}

export function duplicateNotice(notice) {
  const draft = structuredClone(notice);
  draft.id = newId('nt');
  draft.state = 'draft';
  draft.createdAt = null;
  draft.updatedAt = null;
  return draft;
}

// v1 の saveServiceStatus の入力チェックを引き継ぐ。あわせて validateOperations も呼ぶ想定（呼び出し側の責務）。
export function validateNoticeDraft(network, masters, notice) {
  const line = notice.lineId ? (network.lines || []).find((l) => l.id === notice.lineId) : null;
  if (!notice.lineId || !line) {
    return '影響路線を選択してください。';
  }

  if (notice.state !== 'draft' && (!notice.occurrence || !notice.occurrence.month || !notice.occurrence.day)) {
    return '発生日時の月・日を入力してください。';
  }

  if (notice.range != null) {
    if (!notice.range.fromStationId || !notice.range.toStationId) {
      return '影響区間の始点・終点を選択してください。';
    }
  }

  if (!notice.directions || (!notice.directions.forward && !notice.directions.backward)) {
    return '方向（進行方向）のいずれかを選択してください。';
  }

  if (!notice.status || !notice.status.code) {
    return '状態を選択してください。';
  }

  if (Array.isArray(notice.categoryIds) && notice.categoryIds.length === 0) {
    return '影響種別を少なくとも1つ選択するか「すべて」を選択してください。';
  }

  if (!notice.cause || !notice.cause.code) {
    return '原因を選択してください。';
  }
  if (notice.cause.code === 'other' && (!notice.cause.heading || !notice.cause.body)) {
    return '原因見出しと原因本文を入力してください。';
  }
  if (notice.cause.lineOption === 'line' && !notice.cause.lineId) {
    return '原因路線を選択してください。';
  }

  for (const ts of notice.throughServices || []) {
    if (!ts.lineId || ts.lineId === notice.lineId) {
      return '直通設定の対象路線が正しくありません。';
    }
  }

  return null;
}

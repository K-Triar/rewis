import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import {
  createEmptyNotice,
  updateNoticeFields,
  setNoticeRange,
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
  validateNoticeDraft
} from '../editor-core/notice-ops.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

function loadFixture(name) {
  return JSON.parse(readFileSync(join(__dirname, 'fixtures', name), 'utf-8'));
}

const network = loadFixture('v2-minimal-network.json'); // lines: LA(普通), LB(環状, 普通)
const masters = loadFixture('v2-minimal-operations.json').masters; // statusTemplates: OfS_SUSPEND, causes: signal_check

function validNotice() {
  return {
    id: 'nt_1',
    state: 'published',
    createdAt: 't', updatedAt: 't', updatedBy: null,
    occurrence: { year: 2026, month: 4, day: 6, hour: null, minute: null, timezone: 'Asia/Tokyo' },
    lineId: 'LA',
    range: null,
    directions: { forward: true, backward: true },
    categoryIds: null,
    status: { code: 'OfS_SUSPEND', heading: '運転見合わせ', body: '運転を見合わせています' },
    cause: { code: 'signal_check', heading: null, body: null, lineOption: 'affected', lineId: null, range: null },
    turnback: { start: false, end: false },
    throughServices: [],
    text: { mode: 'auto', custom: null }
  };
}

test('createEmptyNotice: 既定値と先頭の路線', () => {
  const notice = createEmptyNotice(network);
  assert.equal(notice.state, 'draft');
  assert.equal(notice.lineId, 'LA');
  assert.equal(notice.range, null);
  assert.deepEqual(notice.directions, { forward: true, backward: true });
  assert.equal(notice.categoryIds, null);
  assert.deepEqual(notice.throughServices, []);
  assert.match(notice.id, /^nt_/);
});

test('updateNoticeFields: lineId を変えると range/categoryIds/throughServices がリセットされる', () => {
  const base = { ...validNotice(), range: { fromStationId: 'S1', toStationId: 'S2', direction: null }, categoryIds: ['Lo'], throughServices: [{ lineId: 'LB', state: 'suspended', target: 'mutual', showOnThroughLine: false }] };
  const updated = updateNoticeFields(base, { lineId: 'LB' });
  assert.equal(updated.lineId, 'LB');
  assert.equal(updated.range, null);
  assert.equal(updated.categoryIds, null);
  assert.deepEqual(updated.throughServices, []);
  assert.equal(base.lineId, 'LA'); // 入力は変更されない
});

test('updateNoticeFields: lineId を変えなければ他のフィールドは保たれる', () => {
  const base = validNotice();
  const updated = updateNoticeFields(base, { lineId: 'LA', state: 'draft' });
  assert.equal(updated.state, 'draft');
  assert.equal(updated.range, base.range);
});

test('setNoticeRange / setNoticeDirections / setNoticeCategories', () => {
  const base = validNotice();
  const withRange = setNoticeRange(base, { fromStationId: 'S1', toStationId: 'S2' });
  assert.deepEqual(withRange.range, { fromStationId: 'S1', toStationId: 'S2', direction: null });
  const cleared = setNoticeRange(withRange, null);
  assert.equal(cleared.range, null);

  const dirs = setNoticeDirections(base, { forward: true, backward: false });
  assert.deepEqual(dirs.directions, { forward: true, backward: false });

  const cats = setNoticeCategories(base, ['Lo']);
  assert.deepEqual(cats.categoryIds, ['Lo']);
  assert.equal(setNoticeCategories(cats, null).categoryIds, null);
});

test('setNoticeStatus: masters にあるコードなら文言を自動で入れる', () => {
  const base = validNotice();
  const updated = setNoticeStatus(masters, base, 'OfS_SUSPEND');
  assert.deepEqual(updated.status, { code: 'OfS_SUSPEND', heading: '運転見合わせ', body: '運転を見合わせています' });
});

test('setNoticeStatus: masters にないコード（notice/other）は文言を空にする', () => {
  const base = validNotice();
  const updated = setNoticeStatus(masters, base, 'other');
  assert.deepEqual(updated.status, { code: 'other', heading: '', body: '' });
  const withText = updateNoticeStatusText(updated, { heading: '見出し', body: '本文' });
  assert.deepEqual(withText.status, { code: 'other', heading: '見出し', body: '本文' });
});

test('setNoticeCause: masters にあるコードなら手入力欄をクリアし既定のlineOptionを入れる', () => {
  const base = validNotice();
  const updated = setNoticeCause(masters, base, 'signal_check');
  assert.equal(updated.cause.code, 'signal_check');
  assert.equal(updated.cause.heading, null);
  assert.equal(updated.cause.lineOption, 'affected');
});

test('updateNoticeCauseFields: lineOptionをlineから変えるとlineIdをクリアする', () => {
  const base = updateNoticeCauseFields(validNotice(), { lineOption: 'line', lineId: 'LB' });
  assert.equal(base.cause.lineId, 'LB');
  const back = updateNoticeCauseFields(base, { lineOption: 'affected' });
  assert.equal(back.cause.lineId, null);
});

test('setNoticeTurnback', () => {
  const updated = setNoticeTurnback(validNotice(), { start: true });
  assert.deepEqual(updated.turnback, { start: true, end: false });
});

test('setThroughService / removeThroughService', () => {
  const base = validNotice();
  const added = setThroughService(base, 'LB', { state: 'suspended', target: 'affected_to_through', showOnThroughLine: true });
  assert.deepEqual(added.throughServices, [{ lineId: 'LB', state: 'suspended', target: 'affected_to_through', showOnThroughLine: true }]);
  const updated = setThroughService(added, 'LB', { state: 'resumed' });
  assert.equal(updated.throughServices[0].state, 'resumed');
  assert.equal(updated.throughServices[0].target, 'affected_to_through');
  const removed = removeThroughService(updated, 'LB');
  assert.deepEqual(removed.throughServices, []);
});

test('setNoticeText', () => {
  const auto = setNoticeText(validNotice(), 'auto');
  assert.deepEqual(auto.text, { mode: 'auto', custom: null });
  const custom = setNoticeText(validNotice(), 'custom', '見出し\n本文');
  assert.deepEqual(custom.text, { mode: 'custom', custom: '見出し\n本文' });
});

test('duplicateNotice: 新しいIDで下書きになる', () => {
  const base = validNotice();
  const dup = duplicateNotice(base);
  assert.notEqual(dup.id, base.id);
  assert.equal(dup.state, 'draft');
  assert.equal(dup.createdAt, null);
  assert.equal(dup.lineId, base.lineId);
});

test('validateNoticeDraft: 正しい入力はnull', () => {
  assert.equal(validateNoticeDraft(network, masters, validNotice()), null);
});

test('validateNoticeDraft: 影響路線が無ければエラー', () => {
  assert.equal(validateNoticeDraft(network, masters, { ...validNotice(), lineId: '' }), '影響路線を選択してください。');
  assert.equal(validateNoticeDraft(network, masters, { ...validNotice(), lineId: 'LZ' }), '影響路線を選択してください。');
});

test('validateNoticeDraft: 下書き以外で発生日時が無ければエラー、下書きなら通る', () => {
  const missingDate = { ...validNotice(), occurrence: { ...validNotice().occurrence, month: null } };
  assert.equal(validateNoticeDraft(network, masters, missingDate), '発生日時の月・日を入力してください。');
  assert.equal(validateNoticeDraft(network, masters, { ...missingDate, state: 'draft' }), null);
});

test('validateNoticeDraft: 影響区間の始点・終点が必要', () => {
  const notice = { ...validNotice(), range: { fromStationId: null, toStationId: null, direction: null } };
  assert.equal(validateNoticeDraft(network, masters, notice), '影響区間の始点・終点を選択してください。');
});

test('validateNoticeDraft: 環状線・ラケット型では区間の方向が必要', () => {
  const notice = { ...validNotice(), lineId: 'LB', range: { fromStationId: 'S2', toStationId: 'S3', direction: null } };
  assert.equal(validateNoticeDraft(network, masters, notice), '影響区間の方向を選択してください。');
  assert.equal(validateNoticeDraft(network, masters, { ...notice, range: { ...notice.range, direction: 'forward' } }), null);
});

test('validateNoticeDraft: 方向がどちらもfalseならエラー', () => {
  const notice = { ...validNotice(), directions: { forward: false, backward: false } };
  assert.equal(validateNoticeDraft(network, masters, notice), '方向（進行方向）のいずれかを選択してください。');
});

test('validateNoticeDraft: 状態未選択はエラー', () => {
  const notice = { ...validNotice(), status: { code: '', heading: '', body: '' } };
  assert.equal(validateNoticeDraft(network, masters, notice), '状態を選択してください。');
});

test('validateNoticeDraft: 種別を配列にした場合は1つ以上必要', () => {
  const notice = { ...validNotice(), categoryIds: [] };
  assert.equal(validateNoticeDraft(network, masters, notice), '影響種別を少なくとも1つ選択するか「すべて」を選択してください。');
  assert.equal(validateNoticeDraft(network, masters, { ...notice, categoryIds: ['Lo'] }), null);
});

test('validateNoticeDraft: 原因未選択はエラー、原因が「その他」なら見出し・本文が必要', () => {
  assert.equal(validateNoticeDraft(network, masters, { ...validNotice(), cause: { ...validNotice().cause, code: '' } }), '原因を選択してください。');
  const other = { ...validNotice(), cause: { code: 'other', heading: null, body: null, lineOption: 'affected', lineId: null, range: null } };
  assert.equal(validateNoticeDraft(network, masters, other), '原因見出しと原因本文を入力してください。');
  assert.equal(validateNoticeDraft(network, masters, { ...other, cause: { ...other.cause, heading: '見出し', body: '本文' } }), null);
});

test('validateNoticeDraft: 原因のlineOptionがlineなら原因路線が必要', () => {
  const notice = { ...validNotice(), cause: { ...validNotice().cause, lineOption: 'line', lineId: null } };
  assert.equal(validateNoticeDraft(network, masters, notice), '原因路線を選択してください。');
  assert.equal(validateNoticeDraft(network, masters, { ...notice, cause: { ...notice.cause, lineId: 'LB' } }), null);
});

test('validateNoticeDraft: 直通設定の対象路線が影響路線と同じ、または無ければエラー', () => {
  const sameLine = { ...validNotice(), throughServices: [{ lineId: 'LA', state: 'suspended', target: 'mutual', showOnThroughLine: false }] };
  assert.equal(validateNoticeDraft(network, masters, sameLine), '直通設定の対象路線が正しくありません。');
  const ok = { ...validNotice(), throughServices: [{ lineId: 'LB', state: 'suspended', target: 'mutual', showOnThroughLine: false }] };
  assert.equal(validateNoticeDraft(network, masters, ok), null);
});

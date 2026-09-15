import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { convertV1ToV2 } from '../shared/convert-v1-to-v2.js';
import { generateNoticeText } from '../shared/notice-text.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

function loadV1Latest() {
  const text = readFileSync(join(__dirname, 'fixtures', 'v1-latest.json'), 'utf-8');
  return JSON.parse(text).data;
}

test('フィクスチャの8件：v1の generated_text と完全に一致する', () => {
  const v1data = loadV1Latest();
  const { network, operations } = convertV1ToV2(v1data);
  const raw = v1data.serviceStatuses.filter(st => !st.generated_from);
  assert.equal(raw.length, 8);
  raw.forEach(st => {
    const notice = operations.notices.find(n => n.id === st.id);
    const result = generateNoticeText(notice, network, operations.masters);
    assert.deepEqual(result, st.generated_text, `id=${st.id}`);
  });
});

// 以降は editor.js の generateServiceStatusText を手で読み、期待値を手計算した人工ケース。
// 参照した v1 のコード（当時の行番号）：editor.js:3706-3744 generateServiceStatusText
// および buildSegmentText(3565) buildDirectionText(3574) buildTurnbackText(3583)
// buildOccurrenceText(3604) buildCauseText(3612) buildThroughServicesText(3638)
// buildNoticeTypeList(3558)

const network = {
  lines: [
    {
      id: 'LA', name: 'A線', stations: ['St1', 'St2'],
      directions: { forward: '下り線', backward: '上り線' },
      categories: [{ id: 'Lo', name: '普通' }, { id: 'Ra', name: '快速' }],
    },
    {
      id: 'LB', name: 'B線', stations: ['St3', 'St4'],
      directions: { forward: '下り線', backward: '上り線' },
      categories: [{ id: 'Lo', name: '普通' }],
    },
  ],
  stations: [
    { id: 'St1', name: '一番' },
    { id: 'St2', name: '二番' },
    { id: 'St3', name: '三番' },
    { id: 'St4', name: '四番' },
  ],
};

const masters = {
  statusTemplates: [
    { code: 'OfS_SUSPEND', statusId: 'OfS', label: '運転見合わせ', heading: '運転見合わせ', body: '運転を見合わせています' },
    { code: 'Aff_SKIP', statusId: 'Aff', label: '一部駅通過', heading: '一部駅通過', body: '各駅を通過します' },
    { code: 'DSS_STOP', statusId: 'DSS', label: '直通運転中止', heading: '直通運転中止', body: '直通運転を中止しています' },
  ],
  causes: [
    { code: 'signal_check', label: '信号の確認', heading: '信号の確認', body: '信号の確認をしているため', defaultLineOption: 'affected' },
    { code: 'other', label: 'その他', heading: null, body: null, defaultLineOption: 'hidden' },
  ],
};

function baseNotice(overrides) {
  return Object.assign({
    id: 'nt_test',
    state: 'published',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    updatedBy: null,
    lineId: 'LA',
    range: null,
    directions: { forward: true, backward: true },
    categoryIds: null,
    turnback: { start: false, end: false },
    throughServices: [],
    text: { mode: 'auto', custom: null },
  }, overrides);
}

test('人工ケース1: 一部の区間（両方向）', () => {
  // buildSegmentText: 区間ありなら「A駅～B駅間」。bothDirectionsSelected のため「で」で接続（3728行目）
  const notice = baseNotice({
    occurrence: { year: 2026, month: 5, day: 10, hour: 9, minute: 5, timezone: 'Asia/Tokyo' },
    range: { fromStationId: 'St1', toStationId: 'St2', direction: null },
    status: { code: 'OfS_SUSPEND', heading: '運転見合わせ', body: '運転を見合わせています' },
    cause: { code: 'signal_check', heading: null, body: null, lineOption: 'affected', lineId: null, range: null },
  });
  const result = generateNoticeText(notice, network, masters);
  assert.deepEqual(result, {
    heading: '【A線】信号の確認　運転見合わせ',
    body: '5月10日9時05分ごろ、A線で信号の確認をしているため、一番駅～二番駅間で運転を見合わせています。',
  });
});

test('人工ケース2: 片方向だけ（下り線）、cause.lineOption=hidden', () => {
  // buildDirectionText: down だけなら「下り線で」(3579行目)。buildCauseText: lineOption==='hidden' は路線名を出さない(3617-3619行目)
  const notice = baseNotice({
    occurrence: { year: 2026, month: 6, day: 1, hour: null, minute: null, timezone: 'Asia/Tokyo' },
    directions: { forward: true, backward: false },
    status: { code: 'OfS_SUSPEND', heading: '運転見合わせ', body: '運転を見合わせています' },
    cause: { code: 'signal_check', heading: null, body: null, lineOption: 'hidden', lineId: null, range: null },
  });
  const result = generateNoticeText(notice, network, masters);
  assert.deepEqual(result, {
    heading: '【A線】信号の確認　運転見合わせ',
    body: '6月1日、信号の確認をしているため、下り線で運転を見合わせています。',
  });
});

test('人工ケース3: 種別の指定あり', () => {
  // buildNoticeTypeList: notice_types_all が false のとき「<種別名>列車が」(3562行目)
  const notice = baseNotice({
    occurrence: { year: 2026, month: 7, day: 2, hour: 8, minute: 15, timezone: 'Asia/Tokyo' },
    categoryIds: ['Ra'],
    status: { code: 'Aff_SKIP', heading: '一部駅通過', body: '各駅を通過します' },
    cause: { code: 'signal_check', heading: null, body: null, lineOption: 'affected', lineId: null, range: null },
  });
  const result = generateNoticeText(notice, network, masters);
  assert.deepEqual(result, {
    heading: '【A線】信号の確認　一部駅通過',
    body: '7月2日8時15分ごろ、A線で信号の確認をしているため、快速列車が各駅を通過します。',
  });
});

test('人工ケース4: 原因が「その他」で見出しと本文あり', () => {
  // buildCauseText: cause.body を優先して使う(3615行目)。status.code が masters にない "notice" は getStatusLabel で「お知らせ」(3709/2855行目)
  const notice = baseNotice({
    occurrence: { year: 2026, month: 8, day: 3, hour: null, minute: null, timezone: 'Asia/Tokyo' },
    status: { code: 'notice', heading: null, body: '各駅で遅れが生じています' },
    cause: { code: 'other', heading: '車両点検のため', body: '車両点検を実施しているため', lineOption: 'hidden', lineId: null, range: null },
  });
  const result = generateNoticeText(notice, network, masters);
  assert.deepEqual(result, {
    heading: '【A線】車両点検のため　お知らせ',
    body: '8月3日、車両点検を実施しているため、各駅で遅れが生じています。',
  });
});

test('人工ケース5: 折り返しあり（全線・起点側のみ）', () => {
  // buildTurnbackText: 全線なら line.stations の最初・最後を使う(3587-3590行目)。start のみなら「<駅>駅で折り返し運転を行っています。」(3599行目)
  const notice = baseNotice({
    occurrence: { year: 2026, month: 9, day: 1, hour: null, minute: null, timezone: 'Asia/Tokyo' },
    turnback: { start: true, end: false },
    status: { code: 'OfS_SUSPEND', heading: '運転見合わせ', body: '運転を見合わせています' },
    cause: { code: 'signal_check', heading: null, body: null, lineOption: 'affected', lineId: null, range: null },
  });
  const result = generateNoticeText(notice, network, masters);
  assert.deepEqual(result, {
    heading: '【A線】信号の確認　運転見合わせ',
    body: '9月1日、A線で信号の確認をしているため、運転を見合わせています。一番駅で折り返し運転を行っています。',
  });
});

test('人工ケース6: 直通運転中止（DSS）で相手の路線あり', () => {
  // generateServiceStatusText: status_id==='DSS' のとき body は buildThroughServicesText(entry, true) のみ(3714-3715行目)。
  // through は isDss のとき追加しない(3738行目)
  const notice = baseNotice({
    occurrence: { year: 2026, month: 10, day: 5, hour: null, minute: null, timezone: 'Asia/Tokyo' },
    status: { code: 'DSS_STOP', heading: '直通運転中止', body: '直通運転を中止しています' },
    cause: { code: 'signal_check', heading: null, body: null, lineOption: 'affected', lineId: null, range: null },
    throughServices: [{ lineId: 'LB', state: 'suspended', target: 'mutual', showOnThroughLine: false }],
  });
  const result = generateNoticeText(notice, network, masters);
  assert.deepEqual(result, {
    heading: '【A線】信号の確認　直通運転中止',
    body: '10月5日、A線で信号の確認をしているため、B線との直通運転を中止しています。',
  });
});

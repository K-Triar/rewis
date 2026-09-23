import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { inferSegment, repairSegments } from '../../../src/editor/core/segment-infer.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
function loadFixture(name) {
  return JSON.parse(readFileSync(join(__dirname, '..', '..', 'fixtures', name), 'utf-8'));
}
const network = loadFixture('v2-minimal-network.json');

test('prevSegment の路線が候補にあれば、そのまま返す', () => {
  // S2〜S3 は LA・LB どちらにも含まれる
  const result = inferSegment(network, 'S2', 'S3', { lineId: 'LB', categoryId: 'Lo' });
  assert.deepEqual(result, { lineId: 'LB', categoryId: 'Lo' });
});

test('候補が1つなら、その路線。種別は prevSegment と同じ名前があればそれ', () => {
  // S3〜S4 は LB のみ
  const result = inferSegment(network, 'S3', 'S4', { lineId: 'LA', categoryId: 'Lo' });
  assert.equal(result.lineId, 'LB');
  assert.equal(result.categoryId, 'Lo'); // LBのcategoriesにも同名「普通」がある
});

test('候補が1つで prevSegment がなければ categories[0]', () => {
  const result = inferSegment(network, 'S3', 'S4', null);
  assert.deepEqual(result, { lineId: 'LB', categoryId: 'Lo' });
});

test('候補が0件なら未確定', () => {
  const result = inferSegment(network, 'S1', 'S4', null);
  assert.deepEqual(result, { lineId: null, categoryId: null });
});

test('候補が2件以上で prevSegment もなければ未確定', () => {
  const result = inferSegment(network, 'S2', 'S3', null);
  assert.deepEqual(result, { lineId: null, categoryId: null });
});

test('repairSegments: 有効な値は変更しない', () => {
  const stops = [{ stationId: 'S1' }, { stationId: 'S2' }];
  const segments = [{ lineId: 'LA', categoryId: 'Lo' }];
  const result = repairSegments(network, stops, segments);
  assert.equal(result[0], segments[0]); // 同じ参照のまま
});

test('repairSegments: ない・null・路線が両駅を含まない場合は修復する', () => {
  const stops = [{ stationId: 'S1' }, { stationId: 'S2' }, { stationId: 'S3' }];
  const segments = [undefined, { lineId: 'NOPE', categoryId: 'x' }]; // 存在しない路線＝両駅を含まない扱い
  const result = repairSegments(network, stops, segments);
  assert.deepEqual(result[0], { lineId: 'LA', categoryId: 'Lo' });
  // S2〜S3はLA/LB両方候補なのでprevSegment(修復後のresult[0]=LA)が使われる
  assert.deepEqual(result[1], { lineId: 'LA', categoryId: 'Lo' });
});

test('repairSegments: 入力を書き換えない', () => {
  const stops = [{ stationId: 'S1' }, { stationId: 'S2' }];
  const segments = [null];
  const before = structuredClone(segments);
  repairSegments(network, stops, segments);
  assert.deepEqual(segments, before);
});

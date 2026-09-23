import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { validateV1, compareCounts, LARGE_DROP_RATIO } from '../../src/shared/validate-v1.js';
import { toPublicV1 } from '../../src/shared/public-v1.js';

const fixturePath = fileURLToPath(new URL('../fixtures/v1-latest.json', import.meta.url));
function loadFixtureData() {
  const fixture = JSON.parse(readFileSync(fixturePath, 'utf8'));
  return fixture.data;
}

test('本番データのフィクスチャは errors が0件になる', () => {
  const data = loadFixtureData();
  const result = validateV1(data);
  assert.deepEqual(result.errors, []);
  assert.equal(result.ok, true);
});

test('{} を渡すと V1_TYPE エラーになる', () => {
  const result = validateV1({});
  assert.ok(result.errors.some(e => e.code === 'V1_TYPE'));
  assert.equal(result.ok, false);
});

test('{"foo":1} を渡すと V1_TYPE エラーになる', () => {
  const result = validateV1({ foo: 1 });
  assert.ok(result.errors.some(e => e.code === 'V1_TYPE'));
  assert.equal(result.ok, false);
});

test('駅を1つ削除すると参照が切れて V1_REF エラーになる', () => {
  const data = loadFixtureData();
  const removedStationId = data.stations[0].stationId;
  data.stations = data.stations.slice(1);
  const result = validateV1(data);
  assert.ok(result.errors.some(e => e.code === 'V1_REF' && e.message.includes(removedStationId)));
});

test('segmentId を重複させると V1_DUP_ID エラーになる', () => {
  const data = loadFixtureData();
  data.segments[1] = { ...data.segments[1], segmentId: data.segments[0].segmentId };
  const result = validateV1(data);
  assert.ok(result.errors.some(e => e.code === 'V1_DUP_ID'));
});

test('duration を "abc" にすると V1_DURATION エラーになる', () => {
  const data = loadFixtureData();
  data.segments[0] = { ...data.segments[0], duration: 'abc' };
  const result = validateV1(data);
  assert.ok(result.errors.some(e => e.code === 'V1_DURATION'));
});

test('compareCounts: 駅を223件から0件にすると dropRatio が1になる', () => {
  const result = compareCounts({ stations: new Array(223).fill({}) }, { stations: [] });
  const stationsResult = result.find(r => r.key === 'stations');
  assert.equal(stationsResult.before, 223);
  assert.equal(stationsResult.after, 0);
  assert.equal(stationsResult.dropRatio, 1);
});

test('compareCounts: before が0のときは dropRatio が0になる', () => {
  const result = compareCounts({ stations: [] }, { stations: [] });
  const stationsResult = result.find(r => r.key === 'stations');
  assert.equal(stationsResult.dropRatio, 0);
});

test('LARGE_DROP_RATIO は0.3', () => {
  assert.equal(LARGE_DROP_RATIO, 0.3);
});

test('toPublicV1: published:false の運行情報とhistoryを除去し、元のdataを変更しない', () => {
  const data = loadFixtureData();
  const originalJson = JSON.stringify(data);
  const publicData = toPublicV1(data);

  assert.ok(publicData.serviceStatuses.every(st => st.published === true));
  assert.ok(publicData.serviceStatuses.every(st => !('history' in st)));
  assert.equal(JSON.stringify(data), originalJson);
});

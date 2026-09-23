import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { suggestRun } from '../../../src/editor/core/run-suggest.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
function loadFixture(name) {
  return JSON.parse(readFileSync(join(__dirname, '..', '..', 'fixtures', name), 'utf-8'));
}
const network = loadFixture('v2-minimal-network.json');

test('駅・のりばが一致する組がいちばん優先される', () => {
  const run = suggestRun(network, { stationId: 'S1', platformId: '1' }, { stationId: 'S2', platformId: '1' });
  assert.equal(run, 60);
});

test('駅だけ一致（のりば違い）は次点', () => {
  const run = suggestRun(network, { stationId: 'S1', platformId: '2' }, { stationId: 'S2', platformId: '9' });
  assert.equal(run, 60);
});

test('逆向きの一致は最後の候補', () => {
  const run = suggestRun(network, { stationId: 'S4', platformId: '1' }, { stationId: 'S3', platformId: '1' });
  assert.equal(run, 70);
});

test('見つからなければ null', () => {
  const run = suggestRun(network, { stationId: 'S1', platformId: '1' }, { stationId: 'S3', platformId: '1' });
  assert.equal(run, null);
});

test('excludeServiceId で自分自身を除外できる', () => {
  const onlyService = {
    ...network,
    services: [
      {
        id: 'sv_only',
        circular: false,
        stops: [
          { stationId: 'S1', platformId: '1', run: 123 },
          { stationId: 'S2', platformId: '1' }
        ]
      }
    ]
  };
  const withoutExclude = suggestRun(onlyService, { stationId: 'S1', platformId: '1' }, { stationId: 'S2', platformId: '1' });
  assert.equal(withoutExclude, 123);

  const withExclude = suggestRun(
    onlyService,
    { stationId: 'S1', platformId: '1' },
    { stationId: 'S2', platformId: '1' },
    { excludeServiceId: 'sv_only' }
  );
  assert.equal(withExclude, null);
});

test('extraServices は network.services より先に探される', () => {
  const extra = {
    id: 'sv_extra',
    circular: false,
    stops: [
      { stationId: 'S1', platformId: '1', run: 999 },
      { stationId: 'S2', platformId: '1' }
    ]
  };
  const run = suggestRun(
    network,
    { stationId: 'S1', platformId: '1' },
    { stationId: 'S2', platformId: '1' },
    { extraServices: [extra] }
  );
  assert.equal(run, 999);
});

test('環状運転は最後→最初の駅間も候補になる', () => {
  const run = suggestRun(network, { stationId: 'S4', platformId: '1' }, { stationId: 'S2', platformId: '1' });
  assert.equal(run, 70);
});

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { COL, ROW, visibleStationIds, resolvePositions } from '../editor-core/auto-layout.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

function loadNetwork() {
  return JSON.parse(readFileSync(join(__dirname, 'fixtures', 'v2-minimal-network.json'), 'utf-8'));
}

function toObj(map) {
  const obj = {};
  map.forEach((v, k) => { obj[k] = v; });
  return obj;
}

test('保存された配置が優先されること', () => {
  const network = loadNetwork();
  const saved = { S1: { x: 999, y: 888 } };
  const positions = resolvePositions(network, saved);
  assert.deepEqual(positions.get('S1'), { x: 999, y: 888 });
});

test('共有する駅に x がそろうこと（LA→LBの順で処理し、S2/S3の位置を引き継いでS4を置く）', () => {
  const network = loadNetwork();
  const positions = resolvePositions(network, {});
  assert.deepEqual(positions.get('S1'), { x: 0, y: 0 });
  assert.deepEqual(positions.get('S2'), { x: COL, y: 0 });
  assert.deepEqual(positions.get('S3'), { x: COL * 2, y: 0 });
  assert.deepEqual(positions.get('S4'), { x: COL * 3, y: ROW });
});

test('路線にも運行系統にも乗換にも出てこない駅は表示されないこと', () => {
  const network = loadNetwork();
  network.stations.push({ id: 'S5', name: 'S5駅', kana: 'えすご', platforms: [], location: null });

  const visible = visibleStationIds(network, {});
  assert.equal(visible.has('S5'), false);

  const positions = resolvePositions(network, {});
  assert.equal(positions.has('S5'), false);
});

test('同じ入力から同じ結果になること', () => {
  const network = loadNetwork();
  const saved = { S3: { x: 42, y: 7 } };
  const a = toObj(resolvePositions(network, saved));
  const b = toObj(resolvePositions(loadNetwork(), saved));
  assert.deepEqual(a, b);
});

test('存在しない駅の保存配置は無視されること', () => {
  const network = loadNetwork();
  const saved = { S99: { x: 1, y: 1 } };

  const visible = visibleStationIds(network, saved);
  assert.equal(visible.has('S99'), false);

  const positions = resolvePositions(network, saved);
  assert.equal(positions.has('S99'), false);
});

test('visibleStationIds: 路線・運行系統・乗換のいずれかにあれば表示される', () => {
  const network = {
    stations: [
      { id: 'A', name: 'A', kana: '', platforms: [], location: null },
      { id: 'B', name: 'B', kana: '', platforms: [], location: null },
      { id: 'C', name: 'C', kana: '', platforms: [], location: null },
      { id: 'D', name: 'D', kana: '', platforms: [], location: null }
    ],
    lines: [{ id: 'L1', stations: ['A'] }],
    services: [{ id: 'sv1', stops: [{ stationId: 'B' }] }],
    transfers: [{ id: 't1', from: { stationId: 'C', platformId: null }, to: { stationId: 'C', platformId: null } }]
  };
  const visible = visibleStationIds(network, {});
  assert.equal(visible.has('A'), true);
  assert.equal(visible.has('B'), true);
  assert.equal(visible.has('C'), true);
  assert.equal(visible.has('D'), false);
});

test('駅が空の路線は飛ばすこと', () => {
  const network = loadNetwork();
  network.lines.push({ id: 'LC', stations: [] });
  const positions = resolvePositions(network, {});
  assert.equal(positions.size, 4);
});

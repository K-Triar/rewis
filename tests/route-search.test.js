import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { buildModel } from '../shared/model.js';
import { buildSearchGraph, searchRoutes } from '../shared/route-search.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

function loadFixture(name) {
  return JSON.parse(readFileSync(join(__dirname, 'fixtures', name), 'utf-8'));
}

const network = loadFixture('v2-routes/network.json');
const model = buildModel(network, [], {});
const graph = buildSearchGraph(model);

function search(fromStationId, toStationId, opts = {}) {
  return searchRoutes(model, graph, { fromStationId, toStationId, ...opts });
}

test('1. 境界駅で直通：乗換0回、sections が2つ', () => {
  const routes = search('s1a', 's1e');
  assert.ok(routes.length > 0);
  const best = routes[0];
  assert.equal(best.transferCount, 0);
  assert.equal(best.legs.length, 1);
  assert.equal(best.legs[0].type, 'ride');
  assert.equal(best.legs[0].sections.length, 2);
  assert.equal(best.legs[0].sections[0].lineId, 'L1');
  assert.equal(best.legs[0].sections[1].lineId, 'L2');
});

test('2. 並走する2路線・直通しない運行系統：乗換1回', () => {
  const routes = search('s2a', 's2c');
  assert.ok(routes.length > 0);
  const best = routes[0];
  assert.equal(best.transferCount, 1);
  const rideLegs = best.legs.filter(l => l.type === 'ride');
  assert.equal(rideLegs.length, 2);
  assert.equal(rideLegs[0].serviceId, 'sv_s2a');
  assert.equal(rideLegs[1].serviceId, 'sv_s2b');
});

test('3. 同じ種別で直通する・しない列車がある：行先の違う経路が出る', () => {
  const routes = search('s3a', 's3b');
  assert.ok(routes.length >= 2);
  const headsigns = new Set(routes.map(r => r.legs[0].headsign));
  assert.ok(headsigns.has('s3c行'));
  assert.ok(headsigns.has('s3d行'));
});

test('4. 環状線で最後から先頭へまたぐ移動：乗り換えずに到着', () => {
  const routes = search('s4d', 's4b');
  assert.ok(routes.length > 0);
  const best = routes[0];
  assert.equal(best.transferCount, 0);
  assert.equal(best.legs.length, 1);
  const stops = best.legs[0].stops.map(s => s.stationId);
  assert.deepEqual(stops, ['s4d', 's4a', 's4b']);
});

test('5. ラケット型：2回目に通るときに降りられる', () => {
  const routes = search('s5a', 's5b', { viaStationIds: ['s5c'] });
  assert.ok(routes.length > 0);
  const best = routes[0];
  assert.equal(best.transferCount, 0);
  const stops = best.legs[0].stops.map(s => s.stationId);
  assert.deepEqual(stops, ['s5a', 's5b', 's5c', 's5b']);
});

test('6. 別の駅への徒歩連絡：walk の TransferLeg が入り、所要時間に加わる', () => {
  const routes = search('s6start', 's6end');
  assert.ok(routes.length > 0);
  const best = routes[0];
  const walkLeg = best.legs.find(l => l.type === 'transfer' && l.kind === 'walk');
  assert.ok(walkLeg);
  assert.equal(walkLeg.fromStationId, 's6a');
  assert.equal(walkLeg.toStationId, 's6b');
  assert.equal(walkLeg.duration, 120);
  assert.equal(best.totalDuration, 15 + 120 + 15);
});

test('7. board:false の駅からは乗れない', () => {
  const routes = search('s7a', 's7c');
  assert.deepEqual(routes, []);
});

test('8. 経由駅を2つ指定：指定した順番で通過する', () => {
  const forward = search('s8a', 's8e', { viaStationIds: ['s8b', 's8d'] });
  assert.ok(forward.length > 0);
  const stops = forward[0].legs[0].stops.map(s => s.stationId);
  assert.deepEqual(stops, ['s8a', 's8b', 's8c', 's8d', 's8e']);

  const reversed = search('s8a', 's8e', { viaStationIds: ['s8d', 's8b'] });
  assert.deepEqual(reversed, []);
});

test('9. 車両種別の絞り込み：条件に合わない運行系統は使われない', () => {
  const filteredGraph = buildSearchGraph(model, { vehicleTypeIds: new Set(['TC']) });
  const routes = searchRoutes(model, filteredGraph, { fromStationId: 's9a', toStationId: 's9c' });
  assert.deepEqual(routes, []);

  const allGraph = buildSearchGraph(model, { vehicleTypeIds: new Set(['TC', 'SX']) });
  const routesAll = searchRoutes(model, allGraph, { fromStationId: 's9a', toStationId: 's9c' });
  assert.ok(routesAll.length > 0);
});

test('9b. 自社線のみの絞り込み', () => {
  const ownOnlyGraph = buildSearchGraph(model, { ownCompanyOnly: true });
  const routes = searchRoutes(model, ownOnlyGraph, { fromStationId: 's9a', toStationId: 's9c' });
  assert.deepEqual(routes, []);
});

test('10. penalty（time / balance / transfer）でモードによって並び順が変わる', () => {
  const timeRoutes = search('s10a', 's10z', { transferPenalty: 0 });
  const transferRoutes = search('s10a', 's10z', { transferPenalty: 30 });

  assert.equal(timeRoutes[0].legs.filter(l => l.type === 'ride')[0].serviceId, 'sv_s10a');
  assert.equal(timeRoutes[0].totalDuration, 85);

  assert.equal(transferRoutes[0].legs.filter(l => l.type === 'ride')[0].serviceId, 'sv_s10direct');
  assert.equal(transferRoutes[0].totalDuration, 100);
});

test('11. 出発駅と到着駅が同じ・経路がない場合は空の配列', () => {
  assert.deepEqual(search('s1a', 's1a'), []);
  assert.deepEqual(search('s11a', 's11b'), []);
});

test('12. 出発駅の別のりばから無関係な列車に乗る候補は、乗ってすぐ降りて乗り換えるだけの経路にならない', () => {
  const routes = search('s12a', 's12b');
  assert.equal(routes.length, 1);
  assert.equal(routes[0].legs.length, 1);
  assert.equal(routes[0].legs[0].type, 'ride');
  assert.equal(routes[0].legs[0].serviceId, 'sv_s12direct');
  routes.forEach(route => {
    const firstLeg = route.legs[0];
    if (firstLeg.type === 'ride') {
      assert.ok(firstLeg.stops.length >= 2, '1駅も進まない乗車が経路の先頭に来てはいけない');
    }
  });
});

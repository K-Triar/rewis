import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { buildModel } from '../../src/shared/model.js';
import { buildSearchGraph, searchRoutes } from '../../src/shared/route-search.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

function loadFixture(name) {
  return JSON.parse(readFileSync(join(__dirname, '..', 'fixtures', name), 'utf-8'));
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

test('3. 同じ区間を同じのりば・種別で走る行先違いの系統：1つの経路にまとまり、行先を併記する', () => {
  const routes = search('s3a', 's3b');
  assert.equal(routes.length, 1);
  assert.deepEqual(routes[0].legs[0].headsigns, ['s3c行', 's3d行']);
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

test('13. 分岐する行先違いの系統：共通区間では1つの経路になり、行先はデータの並び順で併記する', () => {
  const routes = search('s13a', 's13b');
  assert.equal(routes.length, 1);
  const leg = routes[0].legs[0];
  assert.deepEqual(leg.headsigns, ['s13w行', 's13g行']);
  assert.deepEqual(leg.alternativeHeadsigns, leg.headsigns.filter(h => h !== leg.headsign));
});

test('14. 同じのりばで同じ列車に乗り換えるだけの経路は、1回の乗車にまとまる', () => {
  const routes = search('s13a', 's13g');
  assert.equal(routes.length, 1);
  const best = routes[0];
  assert.equal(best.transferCount, 0);
  assert.equal(best.legs.length, 1);
  assert.equal(best.legs[0].serviceId, 'sv_s13g');
  assert.deepEqual(best.legs[0].stops.map(s => s.stationId), ['s13a', 's13b', 's13g']);
  assert.equal(best.totalDuration, 20);
  assert.equal(best.score, 20);
});

test('15. 別ののりばへの乗換は、同じ列車とみなさず乗換として残る', () => {
  const routes = search('s13a', 's13z');
  assert.equal(routes.length, 1);
  const best = routes[0];
  assert.equal(best.transferCount, 1);
  assert.deepEqual(best.legs.map(l => l.type), ['ride', 'transfer', 'ride']);
  assert.deepEqual(best.legs[0].headsigns, ['s13w行', 's13g行']);
  assert.equal(best.legs[2].serviceId, 'sv_s13z');
});

test('16. のりば指定なし（null）の駅での乗換は、同じ列車か分からないのでまとめない', () => {
  const routes = search('s14a', 's14c');
  assert.equal(routes[0].transferCount, 0);
  assert.equal(routes[0].legs[0].serviceId, 'sv_s14c');
  const withTransfer = routes.find(r => r.transferCount === 1);
  assert.ok(withTransfer);
  assert.equal(withTransfer.legs[0].serviceId, 'sv_s14d');
  assert.equal(withTransfer.legs[1].fromStationId, 's14b');
});

function rideStations(route) {
  return route.legs.filter(l => l.type === 'ride').map(l => l.stops.map(s => s.stationId));
}

test('17. 登録済みの乗換より未登録ののりばを中継するほうが安くても、乗ってすぐ降りる中継は使わず最適経路が残る', () => {
  // s15m: 1→2 は 45 秒で登録済み。1→3→2 は未登録（既定 10 秒）だが、3 番で乗ってすぐ降りないと中継できない
  const routes = search('s15a', 's15b');
  assert.ok(routes.length > 0);
  const best = routes[0];
  assert.deepEqual(best.legs.map(l => l.type), ['ride', 'transfer', 'ride']);
  assert.equal(best.legs[1].fromPlatformId, '1');
  assert.equal(best.legs[1].toPlatformId, '2');
  assert.equal(best.legs[1].duration, 45);
  routes.forEach(route => {
    route.legs.forEach(leg => {
      if (leg.type === 'ride') assert.ok(leg.stops.length >= 2, '1駅も進まない乗車があってはいけない');
    });
  });
});

test('18. 徒歩連絡だけで着く経路：乗車なし・乗換0回', () => {
  const routes = search('s16a', 's16b');
  assert.ok(routes.length > 0);
  const best = routes[0];
  assert.equal(best.legs.length, 1);
  assert.equal(best.legs[0].type, 'transfer');
  assert.equal(best.legs[0].kind, 'walk');
  assert.equal(best.transferCount, 0);
  assert.equal(best.totalDuration, 20);
});

test('19. 列車が発着しない駅を挟んで徒歩連絡を乗り継げる', () => {
  const routes = search('s17a', 's17b');
  assert.ok(routes.length > 0);
  const best = routes[0];
  assert.deepEqual(best.legs.map(l => `${l.kind}:${l.fromStationId}>${l.toStationId}`), ['walk:s17a>s17m', 'walk:s17m>s17b']);
  assert.equal(best.transferCount, 0);
  assert.equal(best.totalDuration, 40);
});

test('20. 出発時に強制した列車で逆方向へ進み、通った駅を戻ってくる遠回りの候補は出さない', () => {
  const routes = search('s18a', 's18b');
  assert.ok(routes.length > 0);
  routes.forEach(route => {
    assert.ok(!rideStations(route).flat().includes('s18c'), '逆方向の s18c を回って戻る経路が出てはいけない');
  });
});

test('21. 経由駅をまたぐ重複（経由駅へ行って出発駅を通って戻る）は、経由指定から必然なので残す', () => {
  const routes = search('s18a', 's18b', { viaStationIds: ['s18c'] });
  assert.ok(routes.length > 0);
  assert.deepEqual(rideStations(routes[0]), [['s18a', 's18c'], ['s18c', 's18a', 's18b']]);
});

test('22. 基本の探索結果の周回（途中駅で乗れない列車に乗るため折り返す）は残す', () => {
  // sv_s19exp は s19a で乗り降りできないので、s19x まで行って乗り、s19a を通過して s19z へ向かうしかない
  const routes = search('s19a', 's19z');
  assert.equal(routes.length, 1);
  assert.deepEqual(rideStations(routes[0]), [['s19a', 's19x'], ['s19x', 's19a', 's19z']]);
});

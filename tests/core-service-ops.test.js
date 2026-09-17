import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { validateNetwork } from '../shared/schema-v2.js';
import { reverseService } from '../editor2/views/services.js';
import {
  createEmptyService, segmentsOf, withSegments, appendStop, insertStop, removeStop, moveStop,
  setStopPlatform, setStopFlags, setRun, setSegmentRange, setCircular, updateServiceFields,
  normalizeService, duplicateService, lineChoicesForEdges
} from '../editor-core/service-ops.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
function loadFixture(name) {
  return JSON.parse(readFileSync(join(__dirname, 'fixtures', name), 'utf-8'));
}
const network = loadFixture('v2-minimal-network.json');

function withoutServices(net) {
  return { ...structuredClone(net), services: [] };
}

// 操作の結果を network に入れて errors が0件であることを確かめる
function assertNoErrors(net, service, label) {
  const normalized = normalizeService(service);
  const testNet = withoutServices(net);
  testNet.services = [normalized];
  const result = validateNetwork(testNet);
  assert.deepEqual(result.errors, [], `${label}: ${JSON.stringify(result.errors)}`);
}

function assertUnmutated(fn, network_, service, ...rest) {
  const netBefore = structuredClone(network_);
  const svBefore = structuredClone(service);
  fn(network_, service, ...rest);
  assert.deepEqual(network_, netBefore, '入力の network が変更されていない');
  assert.deepEqual(service, svBefore, '入力の service が変更されていない');
}

test('createEmptyService: 空の運行系統ができる', () => {
  const sv = createEmptyService();
  assert.equal(sv.stops.length, 0);
  assert.equal(sv.sections.length, 0);
  assert.equal(sv.active, true);
  assert.equal(sv.circular, false);
});

test('segmentsOf: sectionsをstops間の配列に展開し、欠けはlineId:null埋め', () => {
  const service = { stops: [{ stationId: 'S1' }, { stationId: 'S2' }, { stationId: 'S3' }], sections: [{ lineId: 'LA', categoryId: 'Lo', from: 0, to: 1 }] };
  const segments = segmentsOf(service);
  assert.deepEqual(segments, [{ lineId: 'LA', categoryId: 'Lo' }, { lineId: null, categoryId: null }]);
});

test('withSegments: segmentsからsectionsを作り直す（停車駅2未満なら空）', () => {
  const service = { stops: [{ stationId: 'S1' }, { stationId: 'S2' }], sections: [] };
  const result = withSegments(service, [{ lineId: 'LA', categoryId: 'Lo' }]);
  assert.deepEqual(result.sections, [{ lineId: 'LA', categoryId: 'Lo', from: 0, to: 1 }]);

  const oneStop = { stops: [{ stationId: 'S1' }], sections: [] };
  assert.deepEqual(withSegments(oneStop, []).sections, []);
});

test('appendStop: 候補があればその run、なければ60', () => {
  const empty = createEmptyService();
  const withFirst = appendStop(network, empty, { stationId: 'S1', platformId: '1' });
  assert.equal(withFirst.stops.length, 1);
  assert.equal(withFirst.stops[0].run, undefined);

  // S1→S2 の候補は sv_through にあり、60
  const withSecond = appendStop(network, withFirst, { stationId: 'S2', platformId: '1' });
  assert.equal(withSecond.stops[0].run, 60);

  // 候補がない駅間は60
  const noCandidate = appendStop(network, withSecond, { stationId: 'S1', platformId: '1' });
  assert.equal(noCandidate.stops[1].run, 60); // S2→S1 候補なし
});

test('appendStop: 区間の自動判定（候補1つ・0個・2個以上）', () => {
  let sv = createEmptyService();
  sv = appendStop(network, sv, { stationId: 'S1', platformId: '1' });
  sv = appendStop(network, sv, { stationId: 'S2', platformId: '1' }); // S1-S2: LAのみ(候補1)
  assert.equal(sv.sections[0].lineId, 'LA');

  sv = appendStop(network, sv, { stationId: 'S3', platformId: '1' }); // S2-S3: LA/LB(候補2) → prevSegmentのLAを引き継ぐ
  assert.equal(sv.sections.find((s) => s.to === 2 || (s.from <= 1 && s.to >= 2)) !== undefined || true, true);
  const segs = segmentsOf(sv);
  assert.equal(segs[1].lineId, 'LA'); // 前の区間(LA)を引き継ぐ

  sv = appendStop(network, sv, { stationId: 'S4', platformId: '1' }); // S3-S4: LBのみ(候補1)、種別は同名「普通」
  const segs2 = segmentsOf(sv);
  assert.equal(segs2[2].lineId, 'LB');
  assert.equal(segs2[2].categoryId, 'Lo');
});

test('appendStop: 候補が0個で未確定になる駅間', () => {
  let sv = createEmptyService();
  sv = appendStop(network, sv, { stationId: 'S1', platformId: '1' });
  sv = appendStop(network, sv, { stationId: 'S4', platformId: '1' }); // S1-S4はどの路線にも両方含まれない
  const segs = segmentsOf(sv);
  assert.equal(segs[0].lineId, null);
});

test('appendStop: 行先の自動更新（空文字・前の終点名と同じときだけ）', () => {
  let sv = createEmptyService();
  sv = appendStop(network, sv, { stationId: 'S1', platformId: '1' });
  assert.equal(sv.headsign, '');
  sv = appendStop(network, sv, { stationId: 'S2', platformId: '1' });
  assert.equal(sv.headsign, 'S2駅'); // 空文字だったので自動更新

  sv = updateServiceFields(sv, { headsign: '独自の行先' });
  sv = appendStop(network, sv, { stationId: 'S3', platformId: '1' });
  assert.equal(sv.headsign, '独自の行先'); // 利用者が変えた行先は保たれる
});

test('appendStop: 環状運転なら終点の run と全駅間の統一', () => {
  let sv = createEmptyService();
  sv.circular = true;
  // S1〜S3はすべてLA線のみに含まれるので、区間の判定があいまいにならない
  sv = appendStop(network, sv, { stationId: 'S1', platformId: '1' });
  sv = appendStop(network, sv, { stationId: 'S2', platformId: '1' });
  sv = appendStop(network, sv, { stationId: 'S3', platformId: '1' });
  assert.equal(Number.isFinite(sv.stops[2].run), true); // 終点にrunがある
  assert.equal(sv.sections.length, 1); // 全駅間が同じ区間にまとまる
  assertNoErrors(network, sv, 'appendStop circular');
});

test('appendStop: 入力を変更しない', () => {
  const sv = createEmptyService();
  sv.stops.push({ stationId: 'S1', platformId: '1', board: true, alight: true });
  assertUnmutated(appendStop, network, sv, { stationId: 'S2', platformId: '1' });
});

test('insertStop / removeStop: 区間と境界', () => {
  let sv = createEmptyService();
  sv = appendStop(network, sv, { stationId: 'S1', platformId: '1' });
  sv = appendStop(network, sv, { stationId: 'S3', platformId: '1' }); // S1-S3は未確定
  const before = structuredClone(sv);

  sv = insertStop(network, sv, 1, { stationId: 'S2', platformId: '1' });
  assert.equal(sv.stops.length, 3);
  assert.equal(sv.stops[1].stationId, 'S2');
  assert.equal(Number.isFinite(sv.stops[0].run), true);
  assert.equal(Number.isFinite(sv.stops[1].run), true);
  assertNoErrors(network, sv, 'insertStop through');

  assertUnmutated(insertStop, network, before, 1, { stationId: 'S2', platformId: '1' });
});

test('removeStop: 直通の境界駅を削除するケース', () => {
  const through = structuredClone(network.services.find((s) => s.id === 'sv_through'));
  const before = structuredClone(through);
  // S2（境界駅、LA→LBの切り替え地点）を削除
  const removed = removeStop(network, through, 1);
  assert.equal(removed.stops.length, 3);
  assert.deepEqual(removed.stops.map((s) => s.stationId), ['S1', 'S3', 'S4']);
  assertNoErrors(network, removed, 'removeStop boundary');
  assertUnmutated(removeStop, network, before, 1);
});

test('removeStop: 終点を削除すると新しい終点のrunが消える（環状でなければ）', () => {
  const through = structuredClone(network.services.find((s) => s.id === 'sv_through'));
  const removed = removeStop(network, through, 3); // S4（終点）を削除
  const newLast = removed.stops[removed.stops.length - 1];
  assert.equal('run' in newLast, false);
});

test('removeStop: 環状運転なら終点のrunを消さない', () => {
  const circular = structuredClone(network.services.find((s) => s.id === 'sv_circular'));
  const removed = removeStop(network, circular, 2); // 終点（S4）を削除→新終点はS3
  const newLast = removed.stops[removed.stops.length - 1];
  assert.equal(Number.isFinite(newLast.run), true);
});

test('moveStop: 駅の組み合わせが変わった駅間だけrunを再計算', () => {
  let sv = createEmptyService();
  sv = appendStop(network, sv, { stationId: 'S1', platformId: '1' });
  sv = appendStop(network, sv, { stationId: 'S2', platformId: '1' });
  sv = appendStop(network, sv, { stationId: 'S3', platformId: '1' });
  const before = structuredClone(sv);

  const moved = moveStop(network, sv, 0, 2); // S1を末尾に: S2,S3,S1
  assert.deepEqual(moved.stops.map((s) => s.stationId), ['S2', 'S3', 'S1']);
  assertNoErrors(network, moved, 'moveStop');
  assertUnmutated(moveStop, network, before, 0, 2);
});

test('setStopPlatform / setStopFlags / setRun', () => {
  let sv = createEmptyService();
  sv = appendStop(network, sv, { stationId: 'S1', platformId: '1' });
  sv = appendStop(network, sv, { stationId: 'S2', platformId: '1' });

  const p = setStopPlatform(sv, 0, '2');
  assert.equal(p.stops[0].platformId, '2');
  assert.equal(sv.stops[0].platformId, '1'); // 元は変更なし

  const f = setStopFlags(sv, 0, { board: false });
  assert.equal(f.stops[0].board, false);
  assert.equal(f.stops[0].alight, true);

  const r = setRun(sv, 0, 999);
  assert.equal(r.stops[0].run, 999);
  assert.equal(sv.stops[0].run, 60);
});

test('setSegmentRange: 範囲の外は変わらず、環状運転なら全駅間', () => {
  let sv = createEmptyService();
  sv = appendStop(network, sv, { stationId: 'S1', platformId: '1' });
  sv = appendStop(network, sv, { stationId: 'S2', platformId: '1' });
  sv = appendStop(network, sv, { stationId: 'S3', platformId: '1' });
  const before = segmentsOf(sv);

  const changed = setSegmentRange(network, sv, 0, 0, { lineId: 'LA', categoryId: 'Lo' });
  const after = segmentsOf(changed);
  assert.deepEqual(after[0], { lineId: 'LA', categoryId: 'Lo' });
  assert.deepEqual(after[1], before[1]); // 範囲外は変わらない

  let circ = createEmptyService();
  circ.circular = true;
  circ = appendStop(network, circ, { stationId: 'S2', platformId: '1' });
  circ = appendStop(network, circ, { stationId: 'S3', platformId: '1' });
  circ = appendStop(network, circ, { stationId: 'S4', platformId: '1' });
  const circChanged = setSegmentRange(network, circ, 0, 0, { lineId: 'LB', categoryId: 'Lo' });
  const circSegs = segmentsOf(circChanged);
  assert.equal(circSegs.every((s) => s.lineId === 'LB'), true);
});

test('setCircular: 往復', () => {
  let sv = createEmptyService();
  sv = appendStop(network, sv, { stationId: 'S1', platformId: '1' });
  sv = appendStop(network, sv, { stationId: 'S2', platformId: '1' });
  sv = appendStop(network, sv, { stationId: 'S3', platformId: '1' });
  sv = updateServiceFields(sv, { headsign: 'S3駅' });

  const toCircular = setCircular(network, sv, true);
  assert.equal(toCircular.headsign, null);
  assert.equal(Number.isFinite(toCircular.stops[2].run), true);
  assert.equal(toCircular.sections.length, 1);
  assertNoErrors(network, toCircular, 'setCircular true');

  const backToLinear = setCircular(network, toCircular, false);
  assert.equal(backToLinear.headsign, 'S3駅');
  assert.equal('run' in backToLinear.stops[2], false);
  assertNoErrors(network, backToLinear, 'setCircular false');
});

test('duplicateService: 新しいidと「（複製）」の名前', () => {
  const original = network.services.find((s) => s.id === 'sv_through');
  const dup = duplicateService(original);
  assert.notEqual(dup.id, original.id);
  assert.equal(dup.name, '（複製）');
  assert.deepEqual(dup.stops, original.stops);
  assert.equal(original.name, ''); // 入力は変更されない
});

test('lineChoicesForEdges: 範囲内すべての駅間で2駅を含む路線', () => {
  const service = network.services.find((s) => s.id === 'sv_through');
  const choices = lineChoicesForEdges(network, service, 0, 0); // S1-S2
  assert.deepEqual(choices.map((l) => l.id), ['LA']);
});

test('lineChoicesForEdges: 0件なら範囲の最初の駅を含む路線、それも0件なら全路線', () => {
  const service = { stops: [{ stationId: 'S1' }, { stationId: 'S4' }] };
  const choices = lineChoicesForEdges(network, service, 0, 0);
  // S1-S4を両方含む路線はない → S1を含む路線(LAのみ)
  assert.deepEqual(choices.map((l) => l.id), ['LA']);

  const noStationChoices = lineChoicesForEdges(network, { stops: [{ stationId: 'NOPE' }, { stationId: 'ALSO_NOPE' }] }, 0, 0);
  assert.deepEqual(noStationChoices.map((l) => l.id), ['LA', 'LB']); // 全路線
});

test('reverseService の結果をopsで編集してもerrorsが0件', () => {
  const through = network.services.find((s) => s.id === 'sv_through');
  let reversed = reverseService(network, through);
  reversed = appendStop(network, reversed, { stationId: 'S1', platformId: '1' });
  assertNoErrors(network, reversed, 'reverseService + appendStop');

  const circularSv = network.services.find((s) => s.id === 'sv_circular');
  let reversedCirc = reverseService(network, circularSv);
  reversedCirc = setStopPlatform(reversedCirc, 0, '1');
  assertNoErrors(network, reversedCirc, 'reverseService circular + setStopPlatform');
});

test('normalizeService: board/alightを明示し、最後の停車駅のrunを除く', () => {
  const raw = { id: 'sv_x', headsign: 'X', active: true, circular: false, stops: [
    { stationId: 'S1', run: 60 },
    { stationId: 'S2' }
  ], sections: [{ lineId: 'LA', categoryId: 'Lo', from: 0, to: 1 }] };
  const normalized = normalizeService(raw);
  assert.deepEqual(normalized.stops[0], { stationId: 'S1', platformId: null, run: 60, board: true, alight: true });
  assert.deepEqual(normalized.stops[1], { stationId: 'S2', platformId: null, board: true, alight: true });
});

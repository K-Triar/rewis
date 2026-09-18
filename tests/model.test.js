import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { buildModel, computeAffectedIndices, throughTargetsFor, primaryNotice } from '../shared/model.js';
import { convertV1ToV2 } from '../shared/convert-v1-to-v2.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

function loadFixture(name) {
  return JSON.parse(readFileSync(join(__dirname, 'fixtures', name), 'utf-8'));
}

function loadV1Latest() {
  return loadFixture('v1-latest.json').data;
}

const network = loadFixture('v2-minimal-network.json');
const operationsDoc = loadFixture('v2-minimal-operations.json');
const publicNotices = operationsDoc.notices.map(n => ({ ...n, rendered: { heading: '', body: '' } }));

test('stationById / lineById / companyById / serviceById がすべて引ける', () => {
  const model = buildModel(network, [], operationsDoc.masters);
  assert.equal(model.stationById.get('S1').name, 'S1駅');
  assert.equal(model.lineById.get('LA').name, 'A線');
  assert.equal(model.companyById.get('C1').name, 'C鉄道');
  assert.equal(model.serviceById.get('sv_through').headsign, 'S4駅');
});

test('linesByStation は line.stations の並びから作る', () => {
  const model = buildModel(network, [], operationsDoc.masters);
  assert.deepEqual(model.linesByStation.get('S2'), ['LA', 'LB']);
  assert.deepEqual(model.linesByStation.get('S1'), ['LA']);
  assert.deepEqual(model.linesByStation.get('S4'), ['LB']);
});

test('activeServices は active!==false のものだけ', () => {
  const net = JSON.parse(JSON.stringify(network));
  net.services[2].active = false;
  const model = buildModel(net, [], operationsDoc.masters);
  assert.equal(model.activeServices.length, 2);
  assert.ok(!model.activeServices.some(s => s.id === 'sv_back'));
});

test('stopsByLineCategory は区間の停車駅を両端含めて集める', () => {
  const model = buildModel(network, [], operationsDoc.masters);
  const laLo = model.stopsByLineCategory.get('LA').get('Lo');
  assert.deepEqual([...laLo].sort(), ['S1', 'S2', 'S3']);
  const lbLo = model.stopsByLineCategory.get('LB').get('Lo');
  assert.deepEqual([...lbLo].sort(), ['S2', 'S3', 'S4']);
});

test('throughLinks は直通する区間どうしを to/from で結ぶ', () => {
  const model = buildModel(network, [], operationsDoc.masters);
  const laLo = model.throughLinks.get('LA').get('Lo');
  assert.deepEqual(laLo.to, ['LB']);
  assert.deepEqual(laLo.from, []);
  const lbLo = model.throughLinks.get('LB').get('Lo');
  assert.deepEqual(lbLo.from, ['LA']);
});

test('walkTransfersByStation は駅が異なる乗換だけ、bidirectionalなら逆向きも入る', () => {
  const model = buildModel(network, [], operationsDoc.masters);
  assert.equal(model.walkTransfersByStation.has('S2'), false);
  assert.deepEqual(model.walkTransfersByStation.get('S1'), [{ toStationId: 'S4', seconds: 300 }]);
  assert.deepEqual(model.walkTransfersByStation.get('S4'), [{ toStationId: 'S1', seconds: 300 }]);
});

test('noticesByLine は路線ごとにまとめ、updatedAt の新しい順に並ぶ', () => {
  const extra = { ...publicNotices[0], id: 'nt_x2', updatedAt: '2026-05-01T00:00:00.000Z' };
  const model = buildModel(network, [publicNotices[0], extra], operationsDoc.masters);
  const list = model.noticesByLine.get('LA');
  assert.deepEqual(list.map(n => n.id), ['nt_x2', 'nt_x1']);
});

test('primaryNotice: 状態の重さが大きいものを優先する（updatedAtが古くても）', () => {
  const lower = { ...publicNotices[0], id: 'nt_low', updatedAt: '2026-06-01T00:00:00.000Z', status: { code: 'other', heading: 'お知らせ', body: '' } };
  const model = buildModel(network, [publicNotices[0], lower], operationsDoc.masters);
  assert.equal(primaryNotice(model, 'LA').id, 'nt_x1');
  assert.equal(model.primaryNotice('LA').id, 'nt_x1');
});

test('primaryNotice: 重さが同じなら updatedAt の新しい方', () => {
  const newer = { ...publicNotices[0], id: 'nt_newer', updatedAt: '2026-06-01T00:00:00.000Z' };
  const model = buildModel(network, [publicNotices[0], newer], operationsDoc.masters);
  assert.equal(primaryNotice(model, 'LA').id, 'nt_newer');
});

test('primaryNotice: notice がなければ null', () => {
  const model = buildModel(network, [], operationsDoc.masters);
  assert.equal(primaryNotice(model, 'LA'), null);
});

test('補助関数 stationName / lineName / categoryName', () => {
  const model = buildModel(network, [], operationsDoc.masters);
  assert.equal(model.stationName('S1'), 'S1駅');
  assert.equal(model.lineName('LA'), 'A線');
  assert.equal(model.categoryName('LA', 'Lo'), '普通');
});

test('computeAffectedIndices: range が null なら全駅', () => {
  const line = network.lines.find(l => l.id === 'LA');
  assert.deepEqual(computeAffectedIndices(line, null), [0, 1, 2]);
});

test('computeAffectedIndices: direction がない場合は添字の小さい方から大きい方まで', () => {
  const line = network.lines.find(l => l.id === 'LA');
  assert.deepEqual(computeAffectedIndices(line, { fromStationId: 'S3', toStationId: 'S1', direction: null }), [0, 1, 2]);
  assert.deepEqual(computeAffectedIndices(line, { fromStationId: 'S1', toStationId: 'S2', direction: null }), [0, 1]);
});

test('computeAffectedIndices: 環状線でdirectionがforwardなら折り返さずに進む', () => {
  const line = network.lines.find(l => l.id === 'LB'); // stations: S2,S3,S4 loop startIndex 0
  assert.deepEqual(computeAffectedIndices(line, { fromStationId: 'S4', toStationId: 'S3', direction: 'forward' }), [2, 0, 1]);
});

test('computeAffectedIndices: 環状線でdirectionがnullでもforward扱いで進む', () => {
  const line = network.lines.find(l => l.id === 'LB');
  assert.deepEqual(computeAffectedIndices(line, { fromStationId: 'S4', toStationId: 'S3', direction: null }), [2, 0, 1]);
});

test('computeAffectedIndices: 環状線でdirectionがbackwardなら逆向きに進む', () => {
  const line = network.lines.find(l => l.id === 'LB');
  assert.deepEqual(computeAffectedIndices(line, { fromStationId: 'S2', toStationId: 'S4', direction: 'backward' }), [0, 2]);
});

test('computeAffectedIndices: 該当駅が路線にない場合は空配列', () => {
  const line = network.lines.find(l => l.id === 'LA');
  assert.deepEqual(computeAffectedIndices(line, { fromStationId: 'S4', toStationId: 'S1', direction: null }), []);
});

test('throughTargetsFor: 片方向しかない場合はその向きだけ', () => {
  assert.deepEqual(throughTargetsFor(network, 'LA'), [{ lineId: 'LB', allowedTargets: ['affected_to_through'] }]);
  assert.deepEqual(throughTargetsFor(network, 'LB'), [{ lineId: 'LA', allowedTargets: ['through_to_affected'] }]);
});

test('throughTargetsFor: 両方向あれば mutual も選べる', () => {
  const net = JSON.parse(JSON.stringify(network));
  net.services.push({
    id: 'sv_extra', name: '', headsign: null, active: true, circular: false,
    stops: [
      { stationId: 'S3', platformId: '1', run: 70 },
      { stationId: 'S2', platformId: '1', run: 60, board: true, alight: true },
      { stationId: 'S1', platformId: '1' },
    ],
    sections: [
      { lineId: 'LB', categoryId: 'Lo', from: 0, to: 1 },
      { lineId: 'LA', categoryId: 'Lo', from: 1, to: 2 },
    ],
  });
  assert.deepEqual(throughTargetsFor(net, 'LA'), [
    { lineId: 'LB', allowedTargets: ['affected_to_through', 'through_to_affected', 'mutual'] },
  ]);
});

test('throughTargetsFor: lineId が指定されていなければ空配列', () => {
  assert.deepEqual(throughTargetsFor(network, ''), []);
});

test('本番フィクスチャを変換したものでも例外が出ない', () => {
  const v1data = loadV1Latest();
  const { network: net, operations } = convertV1ToV2(v1data);
  const notices = operations.notices.map(n => ({ ...n, rendered: { heading: '', body: '' } }));
  assert.doesNotThrow(() => buildModel(net, notices, operations.masters));
});

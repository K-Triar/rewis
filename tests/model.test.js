import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { buildModel, computeAffectedIndices } from '../shared/model.js';
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

test('computeAffectedIndices: 環状線でdirectionがbackwardなら逆向きに進む', () => {
  const line = network.lines.find(l => l.id === 'LB');
  assert.deepEqual(computeAffectedIndices(line, { fromStationId: 'S2', toStationId: 'S4', direction: 'backward' }), [0, 2]);
});

test('computeAffectedIndices: 該当駅が路線にない場合は空配列', () => {
  const line = network.lines.find(l => l.id === 'LA');
  assert.deepEqual(computeAffectedIndices(line, { fromStationId: 'S4', toStationId: 'S1', direction: null }), []);
});

test('本番フィクスチャを変換したものでも例外が出ない', () => {
  const v1data = loadV1Latest();
  const { network: net, operations } = convertV1ToV2(v1data);
  const notices = operations.notices.map(n => ({ ...n, rendered: { heading: '', body: '' } }));
  assert.doesNotThrow(() => buildModel(net, notices, operations.masters));
});

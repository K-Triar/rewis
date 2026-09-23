import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { findReferences } from '../../../src/editor/core/refs.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

function loadFixture(name) {
  const text = readFileSync(join(__dirname, '..', '..', 'fixtures', name), 'utf-8');
  return JSON.parse(text);
}

function fixtures() {
  return {
    network: loadFixture('v2-minimal-network.json'),
    operations: loadFixture('v2-minimal-operations.json')
  };
}

test('company: 参照している路線を返す', () => {
  const { network } = fixtures();
  const refs = findReferences(network, null, { type: 'company', id: 'C1' });
  assert.equal(refs.length, 2);
  assert.ok(refs.every((r) => r.kind === 'line'));
});

test('company: 参照がなければ空', () => {
  const { network } = fixtures();
  const refs = findReferences(network, null, { type: 'company', id: 'NOBODY' });
  assert.deepEqual(refs, []);
});

test('station: 路線・運行系統・乗換・運行情報の参照を返す', () => {
  const { network, operations } = fixtures();
  // S1: LAのstations、sv_through/sv_backのstops、tr_s1_s4_walkのfrom
  const refs = findReferences(network, operations, { type: 'station', id: 'S1' });
  const kinds = refs.map((r) => r.kind).sort();
  assert.deepEqual(kinds, ['line', 'service', 'service', 'transfer']);
});

test('station: 運行情報の range に使われていれば notice も含まれる', () => {
  const { network, operations } = fixtures();
  operations.notices[0].range = { fromStationId: 'S3', toStationId: 'S4', direction: null };
  const refs = findReferences(network, operations, { type: 'station', id: 'S3' });
  assert.ok(refs.some((r) => r.kind === 'notice'));
});

test('platform: 停車駅・乗換で使われているのりばを返す', () => {
  const { network } = fixtures();
  const refs = findReferences(network, null, { type: 'platform', stationId: 'S2', id: '1' });
  assert.ok(refs.some((r) => r.kind === 'service'));
  assert.ok(refs.some((r) => r.kind === 'transfer'));
});

test('platform: 使われていないのりばは空', () => {
  const { network } = fixtures();
  network.stations.find((s) => s.id === 'S3').platforms.push({ id: '2', label: '2' });
  const refs = findReferences(network, null, { type: 'platform', stationId: 'S3', id: '2' });
  assert.deepEqual(refs, []);
});

test('line: 区間・運行情報から参照されていれば返す', () => {
  const { network, operations } = fixtures();
  const refs = findReferences(network, operations, { type: 'line', id: 'LA' });
  assert.ok(refs.some((r) => r.kind === 'service'));
  assert.ok(refs.some((r) => r.kind === 'notice'));
});

test('category: その路線・種別の区間・運行情報から参照されていれば返す', () => {
  const { network, operations } = fixtures();
  operations.notices[0].categoryIds = ['Lo'];
  const refs = findReferences(network, operations, { type: 'category', lineId: 'LA', id: 'Lo' });
  assert.ok(refs.some((r) => r.kind === 'service'));
  assert.ok(refs.some((r) => r.kind === 'notice'));
});

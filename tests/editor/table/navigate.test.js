import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { refToFocus, resolveIssueFocus } from '../../../src/editor/table/navigate.js';

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

test('refToFocus: line/service/transfer/stationGroup は飛び先を返す', () => {
  assert.deepEqual(refToFocus({ kind: 'line', id: 'LA', label: '路線「A線」' }), { tab: 'lines', type: 'line', id: 'LA' });
  assert.deepEqual(refToFocus({ kind: 'service', id: 'sv_through', label: '運行系統' }), { tab: 'services', type: 'service', id: 'sv_through' });
  assert.deepEqual(refToFocus({ kind: 'transfer', id: 'tr_1', label: '乗換設定' }), { tab: 'transfers', type: 'transfer', id: 'tr_1' });
  assert.deepEqual(refToFocus({ kind: 'stationGroup', id: 'grp_1', label: '駅グループ' }), { tab: 'transfers', type: 'stationGroup', id: 'grp_1' });
});

test('refToFocus: notice は運行情報タブの飛び先を返す', () => {
  assert.deepEqual(refToFocus({ kind: 'notice', id: 'n1', label: '運行情報' }), { tab: 'operations', type: 'notice', id: 'n1' });
});

test('refToFocus: 不明な種類やnullはnull', () => {
  assert.equal(refToFocus(null), null);
  assert.equal(refToFocus({ kind: 'unknown', id: 'x' }), null);
});

test('resolveIssueFocus: stations[n] は駅タブのその駅IDを返す', () => {
  const docs = fixtures();
  const focus = resolveIssueFocus('network', { code: 'E_TYPE', path: 'stations[2].platforms', message: '' }, docs);
  assert.deepEqual(focus, { tab: 'stations', type: 'station', id: 'S3' });
});

test('resolveIssueFocus: lines[n] は路線タブのその路線IDを返す', () => {
  const docs = fixtures();
  const focus = resolveIssueFocus('network', { code: 'W_LINE_SHORT', path: 'lines[1].stations', message: '' }, docs);
  assert.deepEqual(focus, { tab: 'lines', type: 'line', id: 'LB' });
});

test('resolveIssueFocus: services[n]... は運行系統タブのその運行系統IDを返す', () => {
  const docs = fixtures();
  const focus = resolveIssueFocus('network', { code: 'W_STOP_NO_PLATFORM', path: 'services[0].stops[3].platformId', message: '' }, docs);
  assert.deepEqual(focus, { tab: 'services', type: 'service', id: 'sv_through' });
});

test('resolveIssueFocus: transfers[n] / stationGroups[n] は乗換・駅グループタブを返す', () => {
  const docs = fixtures();
  assert.deepEqual(
    resolveIssueFocus('network', { code: 'E_TRANSFER_DUP', path: 'transfers[1]', message: '' }, docs),
    { tab: 'transfers', type: 'transfer', id: 'tr_s1_s4_walk' }
  );
  const withGroup = fixtures();
  withGroup.network.stationGroups = [{ id: 'grp_1', name: 'グループ1', stationIds: ['S1', 'S2'] }];
  assert.deepEqual(
    resolveIssueFocus('network', { code: 'E_GROUP', path: 'stationGroups[0].stationIds', message: '' }, withGroup),
    { tab: 'transfers', type: 'stationGroup', id: 'grp_1' }
  );
});

test('resolveIssueFocus: notices[n] は運行情報タブのその運行情報IDを返す', () => {
  const docs = fixtures();
  const focus = resolveIssueFocus('operations', { code: 'E_NOTICE_STATE', path: 'notices[0].state', message: '' }, docs);
  assert.deepEqual(focus, { tab: 'operations', type: 'notice', id: 'nt_x1' });
});

test('resolveIssueFocus: 配列添字のないpath（meta.ownCompanyIdなど）はnull', () => {
  const docs = fixtures();
  assert.equal(resolveIssueFocus('network', { code: 'E_OWN_COMPANY', path: 'meta.ownCompanyId', message: '' }, docs), null);
  assert.equal(resolveIssueFocus('network', { code: 'E_TYPE', path: '', message: '' }, docs), null);
});

test('resolveIssueFocus: 範囲外の添字やドキュメント未読込はnull', () => {
  const docs = fixtures();
  assert.equal(resolveIssueFocus('network', { code: 'X', path: 'stations[99]', message: '' }, docs), null);
  assert.equal(resolveIssueFocus('network', { code: 'X', path: 'stations[0]', message: '' }, { network: null, operations: null }), null);
});

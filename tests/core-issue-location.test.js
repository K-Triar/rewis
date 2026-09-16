import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { describeIssueLocation, resolveIssueTarget, serviceTitle } from '../editor-core/issue-location.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

function loadFixture(name) {
  return JSON.parse(readFileSync(join(__dirname, 'fixtures', name), 'utf-8'));
}

const network = loadFixture('v2-minimal-network.json');
const operations = loadFixture('v2-minimal-operations.json');
const docs = { network, operations };

function issue(path, message = 'msg') {
  return { code: 'E_TEST', path, message };
}

test('serviceTitle: headsign があればそれ', () => {
  assert.equal(serviceTitle(network, network.services[0]), 'S4駅');
});

test('serviceTitle: headsign がなく circular なら（環状）<路線名>', () => {
  assert.equal(serviceTitle(network, network.services[1]), '（環状）B線');
});

test('serviceTitle: どちらもなければ id', () => {
  const sv = { id: 'sv_x', headsign: null, circular: false, sections: [] };
  assert.equal(serviceTitle(network, sv), 'sv_x');
});

test('describeIssueLocation: stations[i]', () => {
  assert.equal(describeIssueLocation('network', issue('stations[1].name'), docs), '駅「S2駅」');
});

test('describeIssueLocation: stations[i].platforms[j]', () => {
  assert.equal(describeIssueLocation('network', issue('stations[1].platforms[1].label'), docs), '駅「S2駅」ののりば「2」');
});

test('describeIssueLocation: lines[i]', () => {
  assert.equal(describeIssueLocation('network', issue('lines[0].color'), docs), '路線「A線」');
});

test('describeIssueLocation: lines[i].categories[j]', () => {
  assert.equal(describeIssueLocation('network', issue('lines[0].categories[0].name'), docs), '路線「A線」の種別「普通」');
});

test('describeIssueLocation: services[i] / services[i].stops / services[i].sections（添字なし）', () => {
  assert.equal(describeIssueLocation('network', issue('services[0]'), docs), '運行系統「S4駅」');
  assert.equal(describeIssueLocation('network', issue('services[0].stops'), docs), '運行系統「S4駅」');
  assert.equal(describeIssueLocation('network', issue('services[0].sections'), docs), '運行系統「S4駅」');
});

test('describeIssueLocation: services[i].stops[j]', () => {
  assert.equal(
    describeIssueLocation('network', issue('services[0].stops[1].platformId'), docs),
    '運行系統「S4駅」の 2 番目の停車駅（S2駅）'
  );
});

test('describeIssueLocation: services[i].sections[j]', () => {
  assert.equal(
    describeIssueLocation('network', issue('services[0].sections[1].lineId'), docs),
    '運行系統「S4駅」の S2駅〜S4駅 の路線・種別'
  );
});

test('describeIssueLocation: transfers[i]（駅内・のりばあり）', () => {
  assert.equal(describeIssueLocation('network', issue('transfers[0].seconds'), docs), '乗換「S2駅 1 → S2駅 2」');
});

test('describeIssueLocation: transfers[i]（徒歩連絡・のりばなし）', () => {
  assert.equal(describeIssueLocation('network', issue('transfers[1].seconds'), docs), '乗換「S1駅 → S4駅」');
});

test('describeIssueLocation: stationGroups[i]', () => {
  const withGroup = { ...network, stationGroups: [{ id: 'grp_x', name: '梅田', stationIds: ['S1'] }] };
  assert.equal(
    describeIssueLocation('network', issue('stationGroups[0].name'), { network: withGroup, operations }),
    '駅グループ「梅田」'
  );
});

test('describeIssueLocation: companies[i]', () => {
  assert.equal(describeIssueLocation('network', issue('companies[0].name'), docs), '鉄道会社「C鉄道」');
});

test('describeIssueLocation: notices[i]（operations）', () => {
  assert.equal(describeIssueLocation('operations', issue('notices[0].status'), docs), '運行情報 1 件目');
});

test('describeIssueLocation: それ以外 → 全体', () => {
  assert.equal(describeIssueLocation('network', issue('meta.appName'), docs), '全体');
  assert.equal(describeIssueLocation('network', issue(''), docs), '全体');
  assert.equal(describeIssueLocation('network', issue(undefined), docs), '全体');
});

test('describeIssueLocation: 添字が範囲外なら添字をそのまま使う', () => {
  assert.equal(describeIssueLocation('network', issue('stations[99].name'), docs), '駅「99」');
});

test('resolveIssueTarget: stations/lines/services/transfers/companies', () => {
  assert.deepEqual(resolveIssueTarget('network', issue('stations[1].name'), docs), { tab: 'stations', id: 'S2', sub: null });
  assert.deepEqual(resolveIssueTarget('network', issue('lines[0].color'), docs), { tab: 'lines', id: 'LA', sub: null });
  assert.deepEqual(resolveIssueTarget('network', issue('companies[0].name'), docs), { tab: 'companies', id: 'C1', sub: null });
  assert.deepEqual(resolveIssueTarget('network', issue('transfers[0].seconds'), docs), { tab: 'transfers', id: 'tr_s2_1_2', sub: null });
});

test('resolveIssueTarget: services[i].stops[j] の sub', () => {
  assert.deepEqual(
    resolveIssueTarget('network', issue('services[0].stops[1].platformId'), docs),
    { tab: 'services', id: 'sv_through', sub: { type: 'stop', index: 1 } }
  );
});

test('resolveIssueTarget: services[i].sections[j] の sub は section.from', () => {
  assert.deepEqual(
    resolveIssueTarget('network', issue('services[0].sections[1].lineId'), docs),
    { tab: 'services', id: 'sv_through', sub: { type: 'edge', index: 1 } }
  );
});

test('resolveIssueTarget: stationGroups は tab:transfers, sub:{type:group}', () => {
  const withGroup = { ...network, stationGroups: [{ id: 'grp_x', name: '梅田', stationIds: ['S1'] }] };
  assert.deepEqual(
    resolveIssueTarget('network', issue('stationGroups[0].name'), { network: withGroup, operations }),
    { tab: 'transfers', id: 'grp_x', sub: { type: 'group' } }
  );
});

test('resolveIssueTarget: 添字が範囲外なら null', () => {
  assert.equal(resolveIssueTarget('network', issue('stations[99].name'), docs), null);
});

test('resolveIssueTarget: notices（飛び先なし）や全体は null', () => {
  assert.equal(resolveIssueTarget('operations', issue('notices[0].status'), docs), null);
  assert.equal(resolveIssueTarget('network', issue('meta.appName'), docs), null);
  assert.equal(resolveIssueTarget('network', issue(''), docs), null);
});

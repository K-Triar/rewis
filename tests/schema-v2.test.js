import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { validateNetwork, validateOperations } from '../shared/schema-v2.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

function loadFixture(name) {
  const text = readFileSync(join(__dirname, 'fixtures', name), 'utf-8');
  return JSON.parse(text);
}

function network() {
  return loadFixture('v2-minimal-network.json');
}

function operations() {
  return loadFixture('v2-minimal-operations.json');
}

function hasCode(list, code) {
  return list.some(i => i.code === code);
}

test('v2-minimal-network.json は errors が0件になる', () => {
  const result = validateNetwork(network());
  assert.deepEqual(result.errors, []);
});

test('v2-minimal-operations.json は errors が0件になる', () => {
  const result = validateOperations(operations(), network());
  assert.deepEqual(result.errors, []);
});

test('meta.ownCompanyId は配列（複数自社）でも errors が0件になる', () => {
  const net = network();
  net.companies.push({ id: 'C2', name: 'D鉄道' });
  net.meta.ownCompanyId = ['C1', 'C2'];
  const result = validateNetwork(net);
  assert.deepEqual(result.errors, []);
});

test('meta.ownCompanyId が空配列だと E_OWN_COMPANY', () => {
  const net = network();
  net.meta.ownCompanyId = [];
  assert.ok(hasCode(validateNetwork(net).errors, 'E_OWN_COMPANY'));
});

test('meta.ownCompanyId の配列に存在しないIDが含まれると E_OWN_COMPANY', () => {
  const net = network();
  net.meta.ownCompanyId = ['C1', 'NOPE'];
  assert.ok(hasCode(validateNetwork(net).errors, 'E_OWN_COMPANY'));
});

test('どの路線にも属さない駅を追加しても errors も warnings も増えない', () => {
  const base = validateNetwork(network());
  const net = network();
  net.stations.push({ id: 'S9', name: 'S9駅', kana: 'えすきゅう', platforms: [{ id: '1', label: '1' }], location: null });
  const result = validateNetwork(net);
  assert.equal(result.errors.length, base.errors.length);
  assert.equal(result.warnings.length, base.warnings.length);
});

test('駅の layout: 省略・null・{x, y}（数値）は通り、それ以外は E_TYPE になる', () => {
  const check = (layout, hasLayout = true) => {
    const net = network();
    if (hasLayout) net.stations[0].layout = layout;
    return validateNetwork(net).errors.filter(e => e.path === 'stations[0].layout');
  };
  assert.equal(check(undefined, false).length, 0);
  assert.equal(check(null).length, 0);
  assert.equal(check({ x: 10, y: -20.5 }).length, 0);
  assert.equal(check({ x: 10 })[0].code, 'E_TYPE');
  assert.equal(check({ x: '1', y: 2 })[0].code, 'E_TYPE');
  assert.equal(check({ x: NaN, y: 2 })[0].code, 'E_TYPE');
});

const networkErrorCases = {
  E_SCHEMA_VERSION: net => { net.schemaVersion = '1.0.0'; },
  E_KIND: net => { net.kind = 'wrong'; },
  E_TYPE: net => { net.companies = 'not-an-array'; },
  E_ID_FORMAT: net => { net.companies[0].id = 'bad id!'; },
  E_DUP_ID: net => { net.companies.push({ id: 'C1', name: '重複' }); },
  E_REF: net => { net.lines[0].companyId = 'NOPE'; },
  E_OWN_COMPANY: net => { net.meta.ownCompanyId = 'NOPE'; },
  E_LINE_STATION_DUP: net => { net.lines[0].stations.push('S1'); },
  E_LOOP_INDEX: net => { net.lines[1].loop.startIndex = 99; },
  E_LINE_NO_CATEGORY: net => { net.lines[0].categories = []; },
  E_SERVICE_STOPS: net => { net.services[0].stops = [net.services[0].stops[0]]; },
  E_STOP_PLATFORM: net => { net.services[0].stops[0].platformId = '99'; },
  E_RUN: net => { net.services[0].stops[0].run = -1; },
  E_SECTIONS: net => { net.services[0].sections = []; },
  E_SECTION_CATEGORY: net => { net.services[0].sections[0].categoryId = 'NOPE'; },
  E_SECTION_STATION: net => { net.services[0].sections[0].lineId = 'LB'; },
  E_CIRCULAR_SECTIONS: net => { net.services[0].circular = true; },
  E_TRANSFER_SELF: net => { net.transfers[0].to = { ...net.transfers[0].from }; },
  E_TRANSFER_INTRA_PLATFORM: net => { net.transfers[0].to.platformId = null; },
  E_TRANSFER_DUP: net => { net.transfers.push({ ...net.transfers[0], id: 'tr_dup' }); },
  E_GROUP: net => { net.stationGroups.push({ id: 'grp_x', name: '単独', stationIds: ['S1'] }); },
};

for (const [code, mutate] of Object.entries(networkErrorCases)) {
  test(`network: ${code} を検出する`, () => {
    const net = network();
    mutate(net);
    const result = validateNetwork(net);
    assert.equal(hasCode(result.errors, code), true, `errors に ${code} が含まれること`);
  });
}

const networkWarningCases = {
  W_STOP_NO_PLATFORM: net => { net.services[0].stops[0].platformId = null; },
  W_LINE_SHORT: net => { net.lines[0].stations = ['S1']; },
  W_LINE_STATION_UNSERVED: net => { net.services = net.services.filter(s => s.id !== 'sv_back'); },
  W_SERVICE_INACTIVE: net => { net.services[0].active = false; },
};

for (const [code, mutate] of Object.entries(networkWarningCases)) {
  test(`network: ${code} を検出する`, () => {
    const net = network();
    mutate(net);
    const result = validateNetwork(net);
    assert.equal(hasCode(result.warnings, code), true, `warnings に ${code} が含まれること`);
  });
}

const operationsErrorCases = {
  E_NOTICE_STATE: (ops) => { ops.notices[0].state = 'invalid'; },
  E_REF: (ops) => { ops.notices[0].lineId = 'NOPE'; },
  E_NOTICE_RANGE: (ops) => { ops.notices[0].range = { fromStationId: 'NOPE', toStationId: 'NOPE', direction: null }; },
  E_NOTICE_CATEGORY: (ops) => { ops.notices[0].categoryIds = ['NOPE']; },
  E_STATUS_CODE: (ops) => { ops.notices[0].status.code = 'NOPE'; },
  E_CAUSE_CODE: (ops) => { ops.notices[0].cause.code = 'NOPE'; },
  E_OCCURRENCE: (ops) => { ops.notices[0].occurrence.month = null; },
  E_THROUGH_LINE: (ops) => { ops.notices[0].throughServices = [{ lineId: 'LA', state: 'none', target: 'mutual', showOnThroughLine: false }]; },
};

for (const [code, mutate] of Object.entries(operationsErrorCases)) {
  test(`operations: ${code} を検出する`, () => {
    const ops = operations();
    mutate(ops);
    const result = validateOperations(ops, network());
    assert.equal(hasCode(result.errors, code), true, `errors に ${code} が含まれること`);
  });
}

test('operations: W_NOTICE_DIRECTIONS を検出する', () => {
  const ops = operations();
  ops.notices[0].directions = { forward: false, backward: false };
  const result = validateOperations(ops, network());
  assert.equal(hasCode(result.warnings, 'W_NOTICE_DIRECTIONS'), true);
});

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import worker from '../worker/src/index.js';
import { MemoryKV } from './helpers/memory-kv.js';

const ORIGIN = 'http://localhost:8787';
const SALT = 'test-salt';
const PASSWORD = 'test-password';

function sha256Hex(input) {
  return createHash('sha256').update(input).digest('hex');
}

function makeEnv(overrides = {}) {
  return {
    DATA_KV: new MemoryKV(),
    TOKEN_KV: new MemoryKV(),
    PASSWORD_SALT: SALT,
    AUTH_USERS_JSON: JSON.stringify([{ userId: 'tester', passwordHash: sha256Hex(PASSWORD + SALT) }]),
    ALLOWED_ORIGIN: 'http://127.0.0.1:5502',
    LATEST_REQUIRES_AUTH: 'false',
    ...overrides
  };
}

function req(path, init = {}) {
  return new Request(ORIGIN + path, init);
}

async function login(env) {
  const res = await worker.fetch(req('/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ userId: 'tester', password: PASSWORD })
  }), env);
  const body = await res.json();
  return body.token;
}

function validV1Data() {
  return {
    meta: { ownCompanyId: 'C1' },
    companies: [{ companyId: 'C1', companyName: 'テスト会社' }],
    trainTypes: [{ trainTypeId: 'T1' }],
    lines: [{
      lineId: 'L1',
      companyId: 'C1',
      trainType: 'T1',
      serviceCategories: [['Lo', '普通']],
      stationOrder: ['S1', 'S2']
    }],
    stations: [
      { stationId: 'S1', stationName: 'あ駅' },
      { stationId: 'S2', stationName: 'い駅' }
    ],
    segments: [{
      segmentId: 'SEG1',
      lineId: 'L1',
      fromStationId: 'S1',
      toStationId: 'S2',
      duration: 60,
      guidance: '普通',
      platforms: { S1: '1', S2: '1' }
    }],
    throughServiceConfigs: [],
    platformTransfers: [],
    serviceStatuses: [
      { id: 'st-published', published: true, affected_line_id: 'L1', history: [{ v: 1 }] },
      { id: 'st-draft', published: false, affected_line_id: '', history: [] }
    ]
  };
}

async function saveOnce(env, token, baseRevision, data = validV1Data()) {
  return worker.fetch(req('/data/save', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ data, client: 'test', baseRevision })
  }), env);
}

test('ログインしてから保存すると revision が1になる', async () => {
  const env = makeEnv();
  const token = await login(env);
  assert.ok(token);

  const res = await saveOnce(env, token, 0);
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.revision, 1);
});

test('baseRevision が古いと409', async () => {
  const env = makeEnv();
  const token = await login(env);
  await saveOnce(env, token, 0);

  const res = await saveOnce(env, token, 0);
  assert.equal(res.status, 409);
  const body = await res.json();
  assert.equal(body.error, 'conflict');
  assert.equal(body.latestRevision, 1);
});

test('baseRevision がないと428', async () => {
  const env = makeEnv();
  const token = await login(env);
  const res = await worker.fetch(req('/data/save', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ data: validV1Data(), client: 'test' })
  }), env);
  assert.equal(res.status, 428);
});

test('{}を保存すると422', async () => {
  const env = makeEnv();
  const token = await login(env);
  const res = await worker.fetch(req('/data/save', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ data: {}, client: 'test', baseRevision: 0 })
  }), env);
  assert.equal(res.status, 422);
  const body = await res.json();
  assert.equal(body.error, 'validation_failed');
  assert.ok(Array.isArray(body.errors));
});

test('/data/public に下書きとhistoryが含まれない', async () => {
  const env = makeEnv();
  const token = await login(env);
  await saveOnce(env, token, 0);

  const res = await worker.fetch(req('/data/public'), env);
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.data.serviceStatuses.length, 1);
  assert.equal(body.data.serviceStatuses[0].id, 'st-published');
  assert.ok(!('history' in body.data.serviceStatuses[0]));
});

test('60回保存しても、履歴の1件目が最新の版になる', async () => {
  const env = makeEnv();
  const token = await login(env);

  let rev = 0;
  for (let i = 0; i < 60; i += 1) {
    const res = await saveOnce(env, token, rev);
    const body = await res.json();
    assert.equal(res.status, 200);
    rev = body.revision;
  }
  assert.equal(rev, 60);

  const historyRes = await worker.fetch(req('/data/history?limit=5', {
    headers: { Authorization: `Bearer ${token}` }
  }), env);
  const historyBody = await historyRes.json();
  assert.equal(historyBody.items[0].revision, 60);
});

test('古い形式のキーを混ぜても一覧に出る', async () => {
  const env = makeEnv();
  const token = await login(env);
  await saveOnce(env, token, 0);

  // 旧形式のキーを直接投入する（W2 の旧仕様を模擬）
  await env.DATA_KV.put('data:history:1000000000000', JSON.stringify({
    data: validV1Data(),
    meta: { revision: 0, updatedAt: '2020-01-01T00:00:00.000Z', updatedBy: 'legacy', client: 'legacy' }
  }));

  const historyRes = await worker.fetch(req('/data/history?limit=50', {
    headers: { Authorization: `Bearer ${token}` }
  }), env);
  const historyBody = await historyRes.json();
  assert.ok(historyBody.items.some((item) => item.key === 'data:history:1000000000000'));
});

test('ロールバックすると新しい版になり、中身が指定した版と一致する', async () => {
  const env = makeEnv();
  const token = await login(env);

  const firstData = validV1Data();
  firstData.stations[0].stationName = '最初の駅';
  await saveOnce(env, token, 0, firstData);

  const secondData = validV1Data();
  secondData.stations[0].stationName = '2番目の駅';
  await saveOnce(env, token, 1, secondData);

  const historyRes = await worker.fetch(req('/data/history?limit=50', {
    headers: { Authorization: `Bearer ${token}` }
  }), env);
  const historyBody = await historyRes.json();
  const firstEntryKey = historyBody.items.find((item) => item.revision === 1).key;

  const rollbackRes = await worker.fetch(req('/data/rollback', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ key: firstEntryKey, baseRevision: 2 })
  }), env);
  assert.equal(rollbackRes.status, 200);
  const rollbackBody = await rollbackRes.json();
  assert.equal(rollbackBody.revision, 3);

  const latestRes = await worker.fetch(req('/data/latest', {
    headers: { Authorization: `Bearer ${token}` }
  }), env);
  const latestBody = await latestRes.json();
  assert.equal(latestBody.data.stations[0].stationName, '最初の駅');
  assert.equal(latestBody.meta.rollbackFrom, firstEntryKey);
});

test('LATEST_REQUIRES_AUTH="true"のとき、未認証の/data/latestは401', async () => {
  const env = makeEnv({ LATEST_REQUIRES_AUTH: 'true' });
  const token = await login(env);
  await saveOnce(env, token, 0);

  const res = await worker.fetch(req('/data/latest'), env);
  assert.equal(res.status, 401);

  const authedRes = await worker.fetch(req('/data/latest', {
    headers: { Authorization: `Bearer ${token}` }
  }), env);
  assert.equal(authedRes.status, 200);
});

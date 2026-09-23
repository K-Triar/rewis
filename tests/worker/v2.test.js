import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import worker from '../../worker/src/index.js';
import { MemoryKV } from '../helpers/memory-kv.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ORIGIN = 'http://localhost:8787';
const SALT = 'test-salt';
const PASSWORD = 'test-password';
const ADMIN_PASSWORD = 'admin-password';

function sha256Hex(input) {
  return createHash('sha256').update(input).digest('hex');
}

function loadFixture(name) {
  const text = readFileSync(join(__dirname, '..', 'fixtures', name), 'utf-8');
  return JSON.parse(text);
}

function makeEnv(overrides = {}) {
  return {
    DATA_KV: new MemoryKV(),
    TOKEN_KV: new MemoryKV(),
    PASSWORD_SALT: SALT,
    AUTH_USERS_JSON: JSON.stringify([
      { userId: 'tester', passwordHash: sha256Hex(PASSWORD + SALT) },
      { userId: 'admin', passwordHash: sha256Hex(ADMIN_PASSWORD + SALT) }
    ]),
    ADMIN_USERS: 'admin',
    ALLOWED_ORIGIN: 'http://127.0.0.1:5502',
    LATEST_REQUIRES_AUTH: 'false',
    ...overrides
  };
}

function req(path, init = {}) {
  return new Request(ORIGIN + path, init);
}

async function login(env, userId = 'tester', password = PASSWORD) {
  const res = await worker.fetch(req('/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ userId, password })
  }), env);
  const body = await res.json();
  return body.token;
}

function authHeaders(token) {
  return { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` };
}

async function importFixture(env, token, { force } = {}) {
  const network = loadFixture('v2-minimal-network.json');
  const operations = loadFixture('v2-minimal-operations.json');
  return worker.fetch(req('/v2/admin/import', {
    method: 'POST',
    headers: authHeaders(token),
    body: JSON.stringify({ network, operations, force })
  }), env);
}

test('管理者でない人が移行を実行すると403', async () => {
  const env = makeEnv();
  const token = await login(env);
  const res = await importFixture(env, token);
  assert.equal(res.status, 403);
});

test('取り込み → 読み込み → 保存 → 409 → 履歴 → ロールバック → /v2/public に下書きがない', async () => {
  const env = makeEnv();
  const adminToken = await login(env, 'admin', ADMIN_PASSWORD);

  const importRes = await importFixture(env, adminToken);
  assert.equal(importRes.status, 200);
  const importBody = await importRes.json();
  assert.equal(importBody.network.revision, 1);
  assert.equal(importBody.operations.revision, 1);

  // 読み込み
  const getRes = await worker.fetch(req('/v2/doc/network', { headers: authHeaders(adminToken) }), env);
  assert.equal(getRes.status, 200);
  const getBody = await getRes.json();
  assert.equal(getBody.meta.revision, 1);
  const networkDoc = getBody.doc;

  // 保存（駅名を変える）
  networkDoc.stations[0].name = '変更後の駅名';
  const saveRes = await worker.fetch(req('/v2/doc/network/save', {
    method: 'POST',
    headers: authHeaders(adminToken),
    body: JSON.stringify({ doc: networkDoc, baseRevision: 1, client: 'test' })
  }), env);
  assert.equal(saveRes.status, 200);
  const saveBody = await saveRes.json();
  assert.equal(saveBody.revision, 2);

  // 409：古い baseRevision
  const conflictRes = await worker.fetch(req('/v2/doc/network/save', {
    method: 'POST',
    headers: authHeaders(adminToken),
    body: JSON.stringify({ doc: networkDoc, baseRevision: 1, client: 'test' })
  }), env);
  assert.equal(conflictRes.status, 409);
  const conflictBody = await conflictRes.json();
  assert.equal(conflictBody.latestRevision, 2);

  // 履歴
  const histRes = await worker.fetch(req('/v2/history/network?limit=10', { headers: authHeaders(adminToken) }), env);
  assert.equal(histRes.status, 200);
  const histBody = await histRes.json();
  assert.equal(histBody.items.length, 2);
  assert.equal(histBody.items[0].revision, 2);
  const rev1Key = histBody.items.find((i) => i.revision === 1).key;

  // 履歴の本体
  const histItemRes = await worker.fetch(req(`/v2/history/network/item?key=${encodeURIComponent(rev1Key)}`, {
    headers: authHeaders(adminToken)
  }), env);
  assert.equal(histItemRes.status, 200);
  const histItemBody = await histItemRes.json();
  assert.notEqual(histItemBody.doc.stations[0].name, '変更後の駅名');

  // ロールバック
  const rollbackRes = await worker.fetch(req('/v2/rollback/network', {
    method: 'POST',
    headers: authHeaders(adminToken),
    body: JSON.stringify({ key: rev1Key, baseRevision: 2 })
  }), env);
  assert.equal(rollbackRes.status, 200);
  const rollbackBody = await rollbackRes.json();
  assert.equal(rollbackBody.revision, 3);

  const afterRollback = await worker.fetch(req('/v2/doc/network', { headers: authHeaders(adminToken) }), env);
  const afterRollbackBody = await afterRollback.json();
  assert.notEqual(afterRollbackBody.doc.stations[0].name, '変更後の駅名');
  assert.equal(afterRollbackBody.meta.rollbackFrom, rev1Key);

  // /v2/public に下書きがない
  const publicRes = await worker.fetch(req('/v2/public'), env);
  assert.equal(publicRes.status, 200);
  const publicBody = await publicRes.json();
  assert.equal(publicBody.notices.length, 1);
  assert.equal(publicBody.notices[0].state, 'published');
});

test('network の変更で運行情報の参照が切れる場合は422になり、影響を受ける運行情報を返す', async () => {
  const env = makeEnv();
  const adminToken = await login(env, 'admin', ADMIN_PASSWORD);
  await importFixture(env, adminToken);

  // どの運行系統からも使われていない路線 LC を追加し、運行情報 nt_x2 で参照する
  const networkDoc = (await (await worker.fetch(req('/v2/doc/network', { headers: authHeaders(adminToken) }), env)).json()).doc;
  networkDoc.lines.push({
    id: 'LC', name: 'C線', companyId: 'C1', color: '#888888', vehicleTypeId: 'V1',
    stations: ['S1', 'S2'], loop: null,
    directions: { forward: '下り線', backward: '上り線' },
    categories: [{ id: 'Lo', name: '普通' }]
  });
  const withExtraLineRes = await worker.fetch(req('/v2/doc/network/save', {
    method: 'POST',
    headers: authHeaders(adminToken),
    body: JSON.stringify({ doc: networkDoc, baseRevision: 1, client: 'test' })
  }), env);
  assert.equal(withExtraLineRes.status, 200);

  const operationsDoc = (await (await worker.fetch(req('/v2/doc/operations', { headers: authHeaders(adminToken) }), env)).json()).doc;
  operationsDoc.notices.push({ ...operationsDoc.notices[0], id: 'nt_x2', lineId: 'LC' });
  const opsSaveRes = await worker.fetch(req('/v2/doc/operations/save', {
    method: 'POST',
    headers: authHeaders(adminToken),
    body: JSON.stringify({ doc: operationsDoc, baseRevision: 1, client: 'test' })
  }), env);
  assert.equal(opsSaveRes.status, 200);

  // LC を削除すると、nt_x2 の lineId 参照が壊れる
  const brokenNetwork = JSON.parse(JSON.stringify(networkDoc));
  brokenNetwork.lines = brokenNetwork.lines.filter((l) => l.id !== 'LC');
  const invalidRes = await worker.fetch(req('/v2/doc/network/save', {
    method: 'POST',
    headers: authHeaders(adminToken),
    body: JSON.stringify({ doc: brokenNetwork, baseRevision: 2, client: 'test' })
  }), env);
  assert.equal(invalidRes.status, 422);
  const invalidBody = await invalidRes.json();
  assert.equal(invalidBody.error, 'validation_failed');
  assert.deepEqual(invalidBody.affectedNoticeIds, ['nt_x2']);

  // network は書き換わっていないこと
  const stillNetworkRes = await worker.fetch(req('/v2/doc/network', { headers: authHeaders(adminToken) }), env);
  const stillNetworkBody = await stillNetworkRes.json();
  assert.equal(stillNetworkBody.meta.revision, 2);
  assert.ok(stillNetworkBody.doc.lines.some((l) => l.id === 'LC'));
});

test('自身のドキュメントが検証エラーなら422', async () => {
  const env = makeEnv();
  const adminToken = await login(env, 'admin', ADMIN_PASSWORD);
  await importFixture(env, adminToken);

  const res = await worker.fetch(req('/v2/doc/network/save', {
    method: 'POST',
    headers: authHeaders(adminToken),
    body: JSON.stringify({ doc: { schemaVersion: '2.0.0', kind: 'network' }, baseRevision: 1, client: 'test' })
  }), env);
  assert.equal(res.status, 422);
  const body = await res.json();
  assert.equal(body.error, 'validation_failed');
  assert.ok(body.errors.length > 0);
});

test('baseRevision がないと428', async () => {
  const env = makeEnv();
  const adminToken = await login(env, 'admin', ADMIN_PASSWORD);
  await importFixture(env, adminToken);

  const res = await worker.fetch(req('/v2/doc/network/save', {
    method: 'POST',
    headers: authHeaders(adminToken),
    body: JSON.stringify({ doc: loadFixture('v2-minimal-network.json'), client: 'test' })
  }), env);
  assert.equal(res.status, 428);
});

test('未初期化の /v2/doc/:kind は404、/v2/public も404', async () => {
  const env = makeEnv();
  const token = await login(env);

  const docRes = await worker.fetch(req('/v2/doc/network', { headers: authHeaders(token) }), env);
  assert.equal(docRes.status, 404);

  const publicRes = await worker.fetch(req('/v2/public'), env);
  assert.equal(publicRes.status, 404);
});

test('未認証の /v2/doc/:kind は401だが /v2/public は認証不要', async () => {
  const env = makeEnv();
  const adminToken = await login(env, 'admin', ADMIN_PASSWORD);
  await importFixture(env, adminToken);

  const docRes = await worker.fetch(req('/v2/doc/network'), env);
  assert.equal(docRes.status, 401);

  const publicRes = await worker.fetch(req('/v2/public'), env);
  assert.equal(publicRes.status, 200);
});

test('すでに v2 が初期化されていて force なしで移行すると409、force ありなら成功', async () => {
  const env = makeEnv();
  const adminToken = await login(env, 'admin', ADMIN_PASSWORD);
  await importFixture(env, adminToken);

  const conflictRes = await importFixture(env, adminToken);
  assert.equal(conflictRes.status, 409);

  const forcedRes = await importFixture(env, adminToken, { force: true });
  assert.equal(forcedRes.status, 200);
  const forcedBody = await forcedRes.json();
  assert.equal(forcedBody.network.revision, 2);
  assert.equal(forcedBody.operations.revision, 2);
});

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import worker from '../../worker/src/index.js';
import { MemoryKV } from '../helpers/memory-kv.js';

const ORIGIN = 'http://localhost:8787';
const SALT = 'test-salt';
const LEGACY_PASSWORD = 'legacy-password';
const ADMIN_PASSWORD = 'admin-password';
const NEW_PASSWORD = 'new-password-123';

function sha256Hex(input) {
  return createHash('sha256').update(input).digest('hex');
}

function makeEnv(overrides = {}) {
  return {
    DATA_KV: new MemoryKV(),
    TOKEN_KV: new MemoryKV(),
    PASSWORD_SALT: SALT,
    AUTH_USERS_JSON: JSON.stringify([
      { userId: 'tester', passwordHash: sha256Hex(LEGACY_PASSWORD + SALT) },
      { userId: 'ktriar', passwordHash: sha256Hex(ADMIN_PASSWORD + SALT) }
    ]),
    ADMIN_USERS: 'ktriar',
    ALLOWED_ORIGIN: 'http://127.0.0.1:5502',
    PBKDF2_ITERATIONS: '1000',
    ...overrides
  };
}

async function call(env, path, { method = 'GET', token = null, body } = {}) {
  const headers = {};
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await worker.fetch(new Request(ORIGIN + path, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body)
  }), env);
  return { status: res.status, body: await res.json() };
}

function login(env, userId, password) {
  return call(env, '/auth/login', { method: 'POST', body: { userId, password } });
}

async function adminToken(env) {
  const res = await login(env, 'ktriar', ADMIN_PASSWORD);
  assert.equal(res.status, 200);
  return res.body.token;
}

async function storedUser(env, userId) {
  const text = await env.DATA_KV.get(`auth:user:${userId}`);
  return text ? JSON.parse(text) : null;
}

test('旧方式のユーザーはログインすると新方式に移り、以後は AUTH_USERS_JSON がなくても入れる', async () => {
  const env = makeEnv();
  const res = await login(env, 'tester', LEGACY_PASSWORD);
  assert.equal(res.status, 200);
  assert.equal(res.body.userId, 'tester');
  assert.equal(res.body.isAdmin, false);

  const record = await storedUser(env, 'tester');
  assert.equal(record.credential.alg, 'pbkdf2-sha256');
  assert.equal(record.status, 'active');
  assert.ok(!JSON.stringify(record).includes(LEGACY_PASSWORD));

  env.AUTH_USERS_JSON = '';
  env.PASSWORD_SALT = '';
  assert.equal((await login(env, 'tester', LEGACY_PASSWORD)).status, 200);
  assert.equal((await login(env, 'tester', 'wrong-password')).status, 401);
});

test('ADMIN_USERS のユーザーはログイン応答と /auth/me で管理者と分かる', async () => {
  const env = makeEnv();
  const token = await adminToken(env);
  const me = await call(env, '/auth/me', { token });
  assert.equal(me.status, 200);
  assert.deepEqual([me.body.userId, me.body.isAdmin], ['ktriar', true]);
});

test('知らないユーザー・間違ったパスワード・AUTH_USERS_JSON なしは 401', async () => {
  const env = makeEnv();
  assert.equal((await login(env, 'nobody', 'whatever-password')).status, 401);
  assert.equal((await login(env, 'tester', 'wrong')).status, 401);
  const empty = makeEnv({ AUTH_USERS_JSON: '' });
  assert.equal((await login(empty, 'tester', LEGACY_PASSWORD)).status, 401);
});

test('招待リンクで新しいユーザーが自分でパスワードを設定し、リンクは一度しか使えない', async () => {
  const env = makeEnv();
  const token = await adminToken(env);

  const invite = await call(env, '/auth/admin/invite', { method: 'POST', token, body: { userId: 'newbie', purpose: 'new' } });
  assert.equal(invite.status, 200);
  assert.ok(invite.body.expiresAt > Date.now() + 23 * 60 * 60 * 1000);

  // 招待中（パスワード未設定）はログインできない
  assert.equal((await login(env, 'newbie', NEW_PASSWORD)).status, 401);

  const check = await call(env, '/auth/invite/check', { method: 'POST', body: { token: invite.body.token } });
  assert.equal(check.status, 200);
  assert.deepEqual([check.body.userId, check.body.purpose], ['newbie', 'new']);

  const short = await call(env, '/auth/invite/accept', { method: 'POST', body: { token: invite.body.token, password: 'short' } });
  assert.equal(short.status, 400);
  assert.equal(short.body.error, 'password_too_short');

  const accept = await call(env, '/auth/invite/accept', { method: 'POST', body: { token: invite.body.token, password: NEW_PASSWORD } });
  assert.equal(accept.status, 200);
  assert.equal(accept.body.userId, 'newbie');
  assert.equal((await call(env, '/auth/me', { token: accept.body.token })).status, 200);

  const again = await call(env, '/auth/invite/accept', { method: 'POST', body: { token: invite.body.token, password: 'another-password-1' } });
  assert.equal(again.status, 404);
  assert.equal((await login(env, 'newbie', NEW_PASSWORD)).status, 200);
});

test('招待リンクを発行し直すと古いリンクは使えない', async () => {
  const env = makeEnv();
  const token = await adminToken(env);
  const first = await call(env, '/auth/admin/invite', { method: 'POST', token, body: { userId: 'newbie', purpose: 'new' } });
  const second = await call(env, '/auth/admin/invite', { method: 'POST', token, body: { userId: 'newbie', purpose: 'new' } });
  assert.equal(second.status, 200);
  assert.equal((await call(env, '/auth/invite/check', { method: 'POST', body: { token: first.body.token } })).status, 404);
  assert.equal((await call(env, '/auth/invite/check', { method: 'POST', body: { token: second.body.token } })).status, 200);
});

test('期限切れ・形の違う招待トークンは使えない', async () => {
  const env = makeEnv();
  const token = await adminToken(env);
  const invite = await call(env, '/auth/admin/invite', { method: 'POST', token, body: { userId: 'newbie', purpose: 'new' } });

  const inviteKey = Array.from(env.DATA_KV.store.keys()).find((k) => k.startsWith('auth:invite:'));
  const value = JSON.parse(await env.DATA_KV.get(inviteKey));
  await env.DATA_KV.put(inviteKey, JSON.stringify({ ...value, expiresAt: Date.now() - 1 }));

  assert.equal((await call(env, '/auth/invite/check', { method: 'POST', body: { token: invite.body.token } })).status, 404);
  assert.equal((await call(env, '/auth/invite/check', { method: 'POST', body: { token: 'x' } })).status, 404);
  assert.equal((await call(env, '/auth/invite/check', { method: 'POST', body: {} })).status, 404);
});

test('既にいるユーザーへの新規招待は 409、いないユーザーの再設定は 404、不正な ID は 400', async () => {
  const env = makeEnv();
  const token = await adminToken(env);
  assert.equal((await call(env, '/auth/admin/invite', { method: 'POST', token, body: { userId: 'tester', purpose: 'new' } })).status, 409);
  assert.equal((await call(env, '/auth/admin/invite', { method: 'POST', token, body: { userId: 'ghost', purpose: 'reset' } })).status, 404);
  assert.equal((await call(env, '/auth/admin/invite', { method: 'POST', token, body: { userId: 'bad id!', purpose: 'new' } })).status, 400);
});

test('再設定リンク: 設定するまでは今のパスワードで入れ、設定後は古いパスワードと以前のログインが使えない', async () => {
  const env = makeEnv();
  const admin = await adminToken(env);
  const oldSession = (await login(env, 'tester', LEGACY_PASSWORD)).body.token;

  const reset = await call(env, '/auth/admin/invite', { method: 'POST', token: admin, body: { userId: 'tester', purpose: 'reset' } });
  assert.equal(reset.status, 200);
  assert.equal((await login(env, 'tester', LEGACY_PASSWORD)).status, 200);

  const accept = await call(env, '/auth/invite/accept', { method: 'POST', body: { token: reset.body.token, password: NEW_PASSWORD } });
  assert.equal(accept.status, 200);
  assert.equal((await login(env, 'tester', LEGACY_PASSWORD)).status, 401);
  assert.equal((await login(env, 'tester', NEW_PASSWORD)).status, 200);
  assert.equal((await call(env, '/auth/me', { token: oldSession })).status, 401);
});

test('旧方式のままのユーザーにも再設定リンクを発行できる', async () => {
  const env = makeEnv();
  const admin = await adminToken(env);
  const reset = await call(env, '/auth/admin/invite', { method: 'POST', token: admin, body: { userId: 'tester', purpose: 'reset' } });
  assert.equal(reset.status, 200);
  // 記録は作られるが、旧方式のパスワードはそのまま使える
  assert.equal((await storedUser(env, 'tester')).credential.alg, 'legacy-sha256');
  assert.equal((await login(env, 'tester', LEGACY_PASSWORD)).status, 200);
});

test('管理者でないユーザーは管理 API を使えない', async () => {
  const env = makeEnv();
  const token = (await login(env, 'tester', LEGACY_PASSWORD)).body.token;
  assert.equal((await call(env, '/auth/admin/users', { token })).status, 403);
  assert.equal((await call(env, '/auth/admin/invite', { method: 'POST', token, body: { userId: 'x1', purpose: 'new' } })).status, 403);
  assert.equal((await call(env, '/auth/admin/disable', { method: 'POST', token, body: { userId: 'ktriar', disabled: true } })).status, 403);
  assert.equal((await call(env, '/auth/admin/invite/revoke', { method: 'POST', token, body: { userId: 'ktriar' } })).status, 403);
  assert.equal((await call(env, '/auth/admin/users')).status, 401);
});

test('無効にするとログインと既存のログインが使えず、有効に戻すと入れる。管理者と自分は無効にできない', async () => {
  const env = makeEnv();
  const admin = await adminToken(env);
  const session = (await login(env, 'tester', LEGACY_PASSWORD)).body.token;

  const off = await call(env, '/auth/admin/disable', { method: 'POST', token: admin, body: { userId: 'tester', disabled: true } });
  assert.equal(off.status, 200);
  assert.equal((await call(env, '/auth/me', { token: session })).status, 401);
  const denied = await login(env, 'tester', LEGACY_PASSWORD);
  assert.equal(denied.status, 403);
  assert.equal(denied.body.error, 'account_disabled');
  assert.equal((await call(env, '/auth/admin/invite', { method: 'POST', token: admin, body: { userId: 'tester', purpose: 'reset' } })).status, 409);

  assert.equal((await call(env, '/auth/admin/disable', { method: 'POST', token: admin, body: { userId: 'tester', disabled: false } })).status, 200);
  assert.equal((await login(env, 'tester', LEGACY_PASSWORD)).status, 200);

  assert.equal((await call(env, '/auth/admin/disable', { method: 'POST', token: admin, body: { userId: 'ktriar', disabled: true } })).status, 400);
});

test('旧方式のままのユーザーも無効にでき、AUTH_USERS_JSON にいても入れない', async () => {
  const env = makeEnv();
  const admin = await adminToken(env);
  assert.equal((await call(env, '/auth/admin/disable', { method: 'POST', token: admin, body: { userId: 'tester', disabled: true } })).status, 200);
  assert.equal((await login(env, 'tester', LEGACY_PASSWORD)).status, 403);
});

test('ユーザー一覧に旧方式・招待中・管理者が分かる形で出る。招待の取り消しで招待中のユーザーは消える', async () => {
  const env = makeEnv();
  const admin = await adminToken(env);
  await call(env, '/auth/admin/invite', { method: 'POST', token: admin, body: { userId: 'newbie', purpose: 'new' } });

  const list = await call(env, '/auth/admin/users', { token: admin });
  assert.equal(list.status, 200);
  const byId = Object.fromEntries(list.body.users.map((u) => [u.userId, u]));
  assert.deepEqual(Object.keys(byId).sort(), ['ktriar', 'newbie', 'tester']);
  assert.equal(byId.ktriar.isAdmin, true);
  assert.equal(byId.ktriar.legacy, false); // ログインした時点で新方式に移っている
  assert.equal(byId.tester.legacy, true);
  assert.equal(byId.newbie.status, 'invited');
  assert.equal(byId.newbie.invite.purpose, 'new');
  assert.ok(!JSON.stringify(list.body).includes('hash'));

  assert.equal((await call(env, '/auth/admin/invite/revoke', { method: 'POST', token: admin, body: { userId: 'newbie' } })).status, 200);
  const after = await call(env, '/auth/admin/users', { token: admin });
  assert.ok(!after.body.users.some((u) => u.userId === 'newbie'));
  assert.ok(!Array.from(env.DATA_KV.store.keys()).some((k) => k.startsWith('auth:invite:')));
});

test('パスワード変更: 今のパスワードが違えば 401、変えるとほかのログインは切れ、新しいトークンが返る', async () => {
  const env = makeEnv();
  const first = (await login(env, 'tester', LEGACY_PASSWORD)).body.token;
  const other = (await login(env, 'tester', LEGACY_PASSWORD)).body.token;

  const wrong = await call(env, '/auth/password', { method: 'POST', token: first, body: { currentPassword: 'nope', newPassword: NEW_PASSWORD } });
  assert.equal(wrong.status, 401);
  const short = await call(env, '/auth/password', { method: 'POST', token: first, body: { currentPassword: LEGACY_PASSWORD, newPassword: 'short' } });
  assert.equal(short.status, 400);

  const ok = await call(env, '/auth/password', { method: 'POST', token: first, body: { currentPassword: LEGACY_PASSWORD, newPassword: NEW_PASSWORD } });
  assert.equal(ok.status, 200);
  assert.equal((await call(env, '/auth/me', { token: ok.body.token })).status, 200);
  assert.equal((await call(env, '/auth/me', { token: first })).status, 401);
  assert.equal((await call(env, '/auth/me', { token: other })).status, 401);
  assert.equal((await login(env, 'tester', NEW_PASSWORD)).status, 200);
});

test('PBKDF2_ITERATIONS を上げると、次のログインで計算し直す', async () => {
  const env = makeEnv();
  await login(env, 'tester', LEGACY_PASSWORD);
  assert.equal((await storedUser(env, 'tester')).credential.iterations, 1000);
  env.PBKDF2_ITERATIONS = '2000';
  assert.equal((await login(env, 'tester', LEGACY_PASSWORD)).status, 200);
  assert.equal((await storedUser(env, 'tester')).credential.iterations, 2000);
});

test('試行回数の上限を超えると 429（ユーザー名と IP の両方で数える）', async () => {
  const seen = [];
  const env = makeEnv({
    AUTH_RATE_LIMITER: {
      async limit({ key }) {
        seen.push(key);
        return { success: seen.length <= 2 };
      }
    }
  });
  const res = await worker.fetch(new Request(ORIGIN + '/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'CF-Connecting-IP': '203.0.113.5' },
    body: JSON.stringify({ userId: 'Tester', password: LEGACY_PASSWORD })
  }), env);
  // ID は大文字小文字を区別するので失敗するが、数えるときは小文字にそろえる（大文字違いで上限を回避させない）
  assert.equal(res.status, 401);
  assert.deepEqual(seen, ['login:tester', 'ip:203.0.113.5']);

  const limited = await login(env, 'tester', LEGACY_PASSWORD);
  assert.equal(limited.status, 429);
  assert.equal(limited.body.error, 'too_many_attempts');
});

test('履歴の読み出し API からアカウントの記録は読めない', async () => {
  const env = makeEnv();
  const token = await adminToken(env);
  const res = await call(env, `/v2/history/network/item?key=${encodeURIComponent('auth:user:ktriar')}`, { token });
  assert.equal(res.status, 400);
});

test('新規の形に合わない旧方式の ID でも、移行・再設定・無効化ができる', async () => {
  const env = makeEnv({
    AUTH_USERS_JSON: JSON.stringify([
      { userId: 'ktriar', passwordHash: sha256Hex(ADMIN_PASSWORD + SALT) },
      { userId: 'K Triar 2', passwordHash: sha256Hex(LEGACY_PASSWORD + SALT) }
    ])
  });
  const admin = await adminToken(env);
  const reset = await call(env, '/auth/admin/invite', { method: 'POST', token: admin, body: { userId: 'K Triar 2', purpose: 'reset' } });
  assert.equal(reset.status, 200);

  assert.equal((await login(env, 'K Triar 2', LEGACY_PASSWORD)).status, 200);
  assert.equal((await storedUser(env, 'K Triar 2')).credential.alg, 'pbkdf2-sha256');
  env.AUTH_USERS_JSON = '';
  assert.equal((await login(env, 'K Triar 2', LEGACY_PASSWORD)).status, 200);

  const off = await call(env, '/auth/admin/disable', { method: 'POST', token: admin, body: { userId: 'K Triar 2', disabled: true } });
  assert.equal(off.status, 200);
  assert.equal(off.body.user.disabled, true);
});

test('管理 API は更新後のユーザーを返す（一覧を読み直さなくてよい）', async () => {
  const env = makeEnv();
  const admin = await adminToken(env);
  const invite = await call(env, '/auth/admin/invite', { method: 'POST', token: admin, body: { userId: 'newbie', purpose: 'new' } });
  assert.deepEqual(
    [invite.body.user.userId, invite.body.user.status, invite.body.user.invite.purpose, invite.body.user.isAdmin],
    ['newbie', 'invited', 'new', false]
  );
  assert.ok(!JSON.stringify(invite.body.user).includes('hash'));

  const revoke = await call(env, '/auth/admin/invite/revoke', { method: 'POST', token: admin, body: { userId: 'newbie' } });
  assert.equal(revoke.body.user, null);

  const reset = await call(env, '/auth/admin/invite', { method: 'POST', token: admin, body: { userId: 'tester', purpose: 'reset' } });
  assert.equal(reset.body.user.legacy, true);
  const cancel = await call(env, '/auth/admin/invite/revoke', { method: 'POST', token: admin, body: { userId: 'tester' } });
  assert.deepEqual([cancel.body.user.status, cancel.body.user.invite], ['active', null]);
});

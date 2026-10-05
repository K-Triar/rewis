const TOKEN_KEY = 'rewis_worker_token';
const EXPIRES_KEY = 'rewis_worker_token_expires_at';
const USER_KEY = 'rewis_worker_user_id';
const ADMIN_KEY = 'rewis_worker_is_admin';
const API_BASE_KEY = 'rewis_worker_api_base';

export function normalizeBase(value) {
  return String(value || '').trim().replace(/\/$/, '');
}

// 本番の Worker URL。公開ページと同じ assets/js/rewis_public_config.js を正本にする
export function getDefaultApiBase() {
  const config = globalThis.REWIS_PUBLIC_DATA_SOURCE;
  return normalizeBase(config && config.workerApiBase);
}

export function getSavedApiBase() {
  return localStorage.getItem(API_BASE_KEY) || getDefaultApiBase();
}

// 既定値と同じ値や空欄は保存せず、既定値に戻す（ローカル Worker で試すときだけ上書きが残る）
export function saveApiBase(value) {
  const normalized = normalizeBase(value);
  if (normalized && normalized !== getDefaultApiBase()) {
    localStorage.setItem(API_BASE_KEY, normalized);
  } else {
    localStorage.removeItem(API_BASE_KEY);
  }
  return getSavedApiBase();
}

export function getSavedSession() {
  const token = sessionStorage.getItem(TOKEN_KEY) || null;
  const expiresAt = Number(sessionStorage.getItem(EXPIRES_KEY) || 0);
  const userId = sessionStorage.getItem(USER_KEY) || '';
  const isAdmin = sessionStorage.getItem(ADMIN_KEY) === 'true';
  if (token && expiresAt > Date.now()) {
    return { token, expiresAt, userId, isAdmin };
  }
  return null;
}

export function clearSession() {
  sessionStorage.removeItem(TOKEN_KEY);
  sessionStorage.removeItem(EXPIRES_KEY);
  sessionStorage.removeItem(USER_KEY);
  sessionStorage.removeItem(ADMIN_KEY);
}

// ログイン・パスワード設定の応答（{ token, expiresAt, userId, isAdmin }）をこのタブのセッションにする
function saveSession(body, fallbackUserId = '') {
  const expiresAt = Number(body.expiresAt || (Date.now() + 15 * 60 * 1000));
  const userId = body.userId || fallbackUserId;
  const isAdmin = body.isAdmin === true;
  sessionStorage.setItem(TOKEN_KEY, body.token);
  sessionStorage.setItem(EXPIRES_KEY, String(expiresAt));
  sessionStorage.setItem(USER_KEY, userId);
  sessionStorage.setItem(ADMIN_KEY, String(isAdmin));
  return { token: body.token, expiresAt, userId, isAdmin };
}

// Worker が返すエラーコードを画面に出す文にする
const ERROR_MESSAGES = {
  invalid_credentials: 'ユーザーIDかパスワードが違います。',
  account_disabled: 'このアカウントは無効になっています。管理者に連絡してください。',
  too_many_attempts: '試行回数が多すぎます。1分ほど待ってからやり直してください。',
  missing_credentials: 'ユーザーIDとパスワードを入力してください。',
  password_too_short: 'パスワードは12文字以上にしてください。',
  password_too_long: 'パスワードが長すぎます（256文字まで）。',
  password_too_common: '推測されやすいパスワードです。同じ文字や連続した文字の並び、数字だけ、よく使われる語やユーザーIDに数字を足しただけのものは使えません。',
  invalid_invite: 'このリンクは使えません。期限が切れたか、使用済みか、新しいリンクが発行されています。管理者に再発行を依頼してください。',
  invalid_user_id: 'ユーザーIDは半角英数字で始め、半角英数字と _ . - の32文字以内にしてください。',
  user_exists: 'そのユーザーIDはすでに使われています。',
  user_not_found: 'ユーザーが見つかりません。',
  user_disabled: '無効になっているユーザーです。先に有効にしてください。',
  cannot_disable_admin: '管理者と自分自身は無効にできません。',
  unauthorized: 'ログインの有効期限が切れました。もう一度ログインしてください。',
  forbidden: 'この操作は管理者だけが行えます。'
};

export function errorMessage(code, fallback = '処理に失敗しました') {
  return ERROR_MESSAGES[code] || `${fallback}（${code || '通信エラー'}）`;
}

export async function login(base, userId, password) {
  const res = await fetch(normalizeBase(base) + '/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ userId, password })
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok || !body.token) {
    throw new Error(errorMessage(body.error, 'ログインに失敗しました'));
  }
  return saveSession(body, userId);
}

export async function logout(base, token) {
  if (base && token) {
    try {
      await fetch(normalizeBase(base) + '/auth/logout', {
        method: 'POST',
        headers: { Authorization: 'Bearer ' + token }
      });
    } catch {
      // ログアウトのAPI呼び出しが失敗しても、ローカルのセッションは消す
    }
  }
  clearSession();
}

async function authedFetch(base, token, path, init = {}) {
  const headers = { ...(init.headers || {}) };
  if (token) headers.Authorization = 'Bearer ' + token;
  const res = await fetch(normalizeBase(base) + path, { ...init, headers });
  const body = await res.json().catch(() => ({}));
  return { ok: res.ok, status: res.status, body };
}

export function getDoc(base, token, kind) {
  return authedFetch(base, token, `/v2/doc/${kind}`, { cache: 'no-store' });
}

export function saveDoc(base, token, kind, doc, baseRevision, client = 'rewis-editor2') {
  return authedFetch(base, token, `/v2/doc/${kind}/save`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ doc, baseRevision, client })
  });
}

export function getHistory(base, token, kind, { limit = 50, cursor = null } = {}) {
  const qs = new URLSearchParams({ limit: String(limit) });
  if (cursor) qs.set('cursor', cursor);
  return authedFetch(base, token, `/v2/history/${kind}?${qs.toString()}`, { cache: 'no-store' });
}

export function getHistoryItem(base, token, kind, key) {
  return authedFetch(base, token, `/v2/history/${kind}/item?key=${encodeURIComponent(key)}`, { cache: 'no-store' });
}

export function rollback(base, token, kind, key, baseRevision) {
  return authedFetch(base, token, `/v2/rollback/${kind}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ key, baseRevision })
  });
}

async function postJson(base, path, payload, token = null) {
  return authedFetch(base, token, path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });
}

export function getMe(base, token) {
  return authedFetch(base, token, '/auth/me', { cache: 'no-store' });
}

// 成功するとこのタブのセッションを新しいトークンに差し替える（ほかの端末のログインは切れる）
export async function changePassword(base, token, currentPassword, newPassword) {
  const res = await postJson(base, '/auth/password', { currentPassword, newPassword }, token);
  if (res.ok && res.body.token) saveSession(res.body);
  return res;
}

export function checkInvite(base, inviteToken) {
  return postJson(base, '/auth/invite/check', { token: inviteToken });
}

// 成功するとそのままログインした状態になる
export async function acceptInvite(base, inviteToken, password) {
  const res = await postJson(base, '/auth/invite/accept', { token: inviteToken, password });
  if (res.ok && res.body.token) saveSession(res.body);
  return res;
}

export function adminListUsers(base, token) {
  return authedFetch(base, token, '/auth/admin/users', { cache: 'no-store' });
}

// purpose: 'new'（新しいユーザーの招待）| 'reset'（パスワード再設定）
export function adminCreateInvite(base, token, userId, purpose) {
  return postJson(base, '/auth/admin/invite', { userId, purpose }, token);
}

export function adminRevokeInvite(base, token, userId) {
  return postJson(base, '/auth/admin/invite/revoke', { userId }, token);
}

export function adminSetDisabled(base, token, userId, disabled) {
  return postJson(base, '/auth/admin/disable', { userId, disabled }, token);
}

export async function getPublic(base) {
  const res = await fetch(normalizeBase(base) + '/v2/public', { cache: 'no-store' });
  const body = await res.json().catch(() => ({}));
  return { ok: res.ok, status: res.status, body };
}

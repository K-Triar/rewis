const TOKEN_KEY = 'rewis_worker_token';
const EXPIRES_KEY = 'rewis_worker_token_expires_at';
const USER_KEY = 'rewis_worker_user_id';
const API_BASE_KEY = 'rewis_worker_api_base';

export function normalizeBase(value) {
  return String(value || '').trim().replace(/\/$/, '');
}

export function getSavedApiBase() {
  return localStorage.getItem(API_BASE_KEY) || '';
}

export function saveApiBase(value) {
  const normalized = normalizeBase(value);
  if (normalized) {
    localStorage.setItem(API_BASE_KEY, normalized);
  } else {
    localStorage.removeItem(API_BASE_KEY);
  }
  return normalized;
}

export function getSavedSession() {
  const token = sessionStorage.getItem(TOKEN_KEY) || null;
  const expiresAt = Number(sessionStorage.getItem(EXPIRES_KEY) || 0);
  const userId = sessionStorage.getItem(USER_KEY) || '';
  if (token && expiresAt > Date.now()) {
    return { token, expiresAt, userId };
  }
  return null;
}

export function clearSession() {
  sessionStorage.removeItem(TOKEN_KEY);
  sessionStorage.removeItem(EXPIRES_KEY);
  sessionStorage.removeItem(USER_KEY);
}

function saveSession(token, expiresAt, userId) {
  sessionStorage.setItem(TOKEN_KEY, token);
  sessionStorage.setItem(EXPIRES_KEY, String(expiresAt));
  sessionStorage.setItem(USER_KEY, userId);
}

export async function login(base, userId, password) {
  const res = await fetch(normalizeBase(base) + '/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ userId, password })
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok || !body.token) {
    throw new Error(body.error || 'ログインに失敗しました');
  }
  const expiresAt = Number(body.expiresAt || (Date.now() + 15 * 60 * 1000));
  saveSession(body.token, expiresAt, userId);
  return { token: body.token, expiresAt, userId };
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

export async function getPublic(base) {
  const res = await fetch(normalizeBase(base) + '/v2/public', { cache: 'no-store' });
  const body = await res.json().catch(() => ({}));
  return { ok: res.ok, status: res.status, body };
}

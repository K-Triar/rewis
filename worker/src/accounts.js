// 編集者アカウント（ユーザー・招待リンク・パスワードハッシュ）。
// ユーザーと招待は DATA_KV の auth: 以下に置く（履歴などの読み出し API はキーの接頭辞を検査しているので、外から読めない）。
//
// ユーザーの記録: auth:user:<userId>
//   { userId, status: 'invited' | 'active', credential, disabled, sessionsValidAfter,
//     invite: { hash, purpose, expiresAt, createdBy } | null, createdAt, createdBy, updatedAt }
//   credential は { alg: 'pbkdf2-sha256', iterations, salt, hash }（salt / hash は base64url）。
//   旧方式（AUTH_USERS_JSON + PASSWORD_SALT）のユーザーを無効化したときなどは、旧方式のハッシュを
//   { alg: 'legacy-sha256', hash } として写す。ログインに成功した時点で pbkdf2 に置き換わる。
//
// 招待リンク: auth:invite:<SHA-256(トークン)>
//   { userId, purpose: 'new' | 'reset', expiresAt }。トークンそのものは保存しない。
//   ユーザーの記録の invite.hash と一致するものだけを有効とする（再発行すると古いリンクは使えなくなる）。
//
// KV に記録があるユーザーは、記録が正本（AUTH_USERS_JSON の同じ ID は見ない）。
// 記録がなく AUTH_USERS_JSON にだけいるユーザーは旧方式で確認し、ログインに成功したら記録を作る。

const USER_PREFIX = 'auth:user:';
const INVITE_PREFIX = 'auth:invite:';

export const MIN_PASSWORD_LENGTH = 12;
export const MAX_PASSWORD_LENGTH = 256;
export const INVITE_TTL_SECONDS = 24 * 60 * 60;

// 無料プランの CPU 時間（1 リクエスト 10ms）に収まる回数を既定にする。
// PBKDF2_ITERATIONS で変えられ、値を上げると次のログインから順に計算し直される。
const DEFAULT_PBKDF2_ITERATIONS = 10000;
// Workers の WebCrypto が受け付ける上限
const MAX_PBKDF2_ITERATIONS = 100000;

const USER_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,31}$/;

// 新しく作るユーザーID の形。旧方式（AUTH_USERS_JSON）の ID はこの形でなくても使える
export function isValidUserId(userId) {
  return USER_ID_PATTERN.test(String(userId || ''));
}

// KV のキーにしてよい ID か（既存の ID も含めて受け付ける範囲）
function isStorableUserId(userId) {
  const value = String(userId || '');
  return value.length > 0 && value.length <= 64 && !/[\u0000-\u001f\u007f]/.test(value);
}

// 文字種の組み合わせは求めず、長さと「推測されやすい形」だけを見る。問題がなければ null
export function passwordProblem(password, userId = '') {
  const value = String(password || '');
  if (value.length < MIN_PASSWORD_LENGTH) return 'password_too_short';
  if (value.length > MAX_PASSWORD_LENGTH) return 'password_too_long';
  if (isGuessablePassword(value, userId)) return 'password_too_common';
  return null;
}

// よく使われる語。数字や記号を足しただけのもの（Password1234! など）を弾く
const WEAK_WORDS = [
  'password', 'passwrd', 'pass', 'qwerty', 'admin', 'login', 'letmein', 'welcome', 'iloveyou',
  'test', 'user', 'guest', 'editor', 'rewis', 'ktriar', 'minecraft', 'traincarts', 'train', 'railway'
];

// キーボードや文字の並び（逆順も見る）。この一部をそのまま使ったもの（123456789012, qwertyuiopas など）を弾く
const SEQUENCES = [
  '01234567890123456789',
  'abcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyz',
  'qwertyuiopasdfghjklzxcvbnmqwertyuiopasdfghjklzxcvbnm',
  '1qaz2wsx3edc4rfv5tgb6yhn7ujm8ik9ol0p',
  '1q2w3e4r5t6y7u8i9o0p'
];

function isGuessablePassword(password, userId) {
  const lower = password.toLowerCase();
  // 使っている文字が少ない（aaaaaaaaaaaa, abababababab など）
  if (new Set(lower).size < 5) return true;
  // 文字や数字の並び
  if (SEQUENCES.some((seq) => seq.includes(lower) || seq.split('').reverse().join('').includes(lower))) return true;
  // 英字を除くと数字と記号だけ、または英字部分がよく使われる語（の繰り返し）
  const letters = lower.replace(/[^a-z]/g, '');
  if (letters.length === 0 && /^[\x20-\x7e]+$/.test(password)) return true;
  // 前後の数字・記号を外し、@→a や 0→o のような置き換えを戻した形でも見る（P@ssw0rd!2024 など）
  const core = lower.replace(/^[^a-z]+|[^a-z]+$/g, '').replace(/[@4]/g, 'a').replace(/0/g, 'o')
    .replace(/[1!]/g, 'i').replace(/3/g, 'e').replace(/[5$]/g, 's').replace(/7/g, 't');
  const isWeakWord = (text) => text.length > 0
    && WEAK_WORDS.some((word) => text.replace(new RegExp(word, 'g'), '') === '');
  if (isWeakWord(letters) || isWeakWord(core.replace(/[^a-z]/g, ''))) return true;
  // ユーザーIDを除くと短すぎる
  const id = String(userId || '').toLowerCase();
  if (id.length >= 3 && lower.split(id).join('').length < 8) return true;
  return false;
}

export function pbkdf2Iterations(env) {
  const n = Number(env.PBKDF2_ITERATIONS || DEFAULT_PBKDF2_ITERATIONS);
  if (!Number.isFinite(n)) return DEFAULT_PBKDF2_ITERATIONS;
  return Math.min(MAX_PBKDF2_ITERATIONS, Math.max(1000, Math.floor(n)));
}

export function isAdmin(userId, env) {
  const raw = String(env.ADMIN_USERS || '').trim();
  if (!raw) return false;
  return raw.split(',').map((s) => s.trim()).filter(Boolean).includes(userId);
}

// ---- パスワードハッシュ ----

async function pbkdf2(password, saltBytes, iterations) {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(password),
    'PBKDF2',
    false,
    ['deriveBits']
  );
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', hash: 'SHA-256', salt: saltBytes, iterations },
    key,
    256
  );
  return new Uint8Array(bits);
}

export async function hashPassword(password, env) {
  const iterations = pbkdf2Iterations(env);
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const hash = await pbkdf2(String(password), salt, iterations);
  return { alg: 'pbkdf2-sha256', iterations, salt: toBase64Url(salt), hash: toBase64Url(hash) };
}

export async function verifyPassword(password, credential, env) {
  if (!credential) return false;
  if (credential.alg === 'pbkdf2-sha256') {
    const salt = fromBase64Url(credential.salt);
    const hash = await pbkdf2(String(password), salt, Number(credential.iterations));
    return safeEqual(toBase64Url(hash), String(credential.hash || ''));
  }
  if (credential.alg === 'legacy-sha256') {
    const hash = await sha256Hex(String(password) + String(env.PASSWORD_SALT || ''));
    return safeEqual(hash, String(credential.hash || '').toLowerCase());
  }
  return false;
}

export function needsRehash(credential, env) {
  return !credential
    || credential.alg !== 'pbkdf2-sha256'
    || Number(credential.iterations) < pbkdf2Iterations(env);
}

// 存在しないユーザーでも同じくらい時間をかけ、応答時間からユーザーの有無を推測されにくくする
export async function burnPasswordCheck(password, env) {
  await pbkdf2(String(password || ''), new Uint8Array(16), pbkdf2Iterations(env));
}

// ---- ユーザー ----

export async function getUser(env, userId) {
  if (!isStorableUserId(userId)) return null;
  const text = await env.DATA_KV.get(USER_PREFIX + userId);
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

export async function putUser(env, record) {
  const now = new Date().toISOString();
  const next = { ...record, updatedAt: now };
  await env.DATA_KV.put(USER_PREFIX + next.userId, JSON.stringify(next), {
    // 一覧表示で本体を読まずに済むように、表示に要る分だけを metadata に持たせる
    metadata: userSummary(next)
  });
  return next;
}

export async function deleteUser(env, userId) {
  await env.DATA_KV.delete(USER_PREFIX + userId);
}

// 管理画面に返す形（ハッシュや招待トークンのハッシュは含めない）
export function publicUser(record, env) {
  const summary = userSummary(record);
  const invite = summary.invite && Number(summary.invite.expiresAt) > Date.now() ? summary.invite : null;
  return { userId: record.userId, ...summary, invite, isAdmin: isAdmin(record.userId, env) };
}

function userSummary(record) {
  return {
    status: record.status,
    disabled: !!record.disabled,
    legacy: !!(record.credential && record.credential.alg === 'legacy-sha256'),
    invite: record.invite ? { purpose: record.invite.purpose, expiresAt: record.invite.expiresAt } : null,
    updatedAt: record.updatedAt
  };
}

// AUTH_USERS_JSON（旧方式）。全員が移行して消したあとは空配列になる
export function loadLegacyUsers(env) {
  const raw = String(env.AUTH_USERS_JSON || '').trim();
  if (!raw) return [];
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    console.error('AUTH_USERS_JSON is not valid JSON');
    return [];
  }
  if (!Array.isArray(parsed)) return [];
  return parsed
    .map((u) => ({
      userId: String(u.userId || '').trim(),
      passwordHash: String(u.passwordHash || '').trim().toLowerCase()
    }))
    .filter((u) => u.userId && u.passwordHash);
}

export function findLegacyUser(env, userId) {
  return loadLegacyUsers(env).find((u) => u.userId === userId) || null;
}

// KV の記録がなければ旧方式から作る（無効化や再設定リンクの発行のときに使う）。どちらにもいなければ null
export async function getOrAdoptUser(env, userId) {
  const record = await getUser(env, userId);
  if (record) return record;
  const legacy = findLegacyUser(env, userId);
  if (!legacy) return null;
  return {
    userId,
    status: 'active',
    credential: { alg: 'legacy-sha256', hash: legacy.passwordHash },
    disabled: false,
    sessionsValidAfter: 0,
    invite: null,
    createdAt: new Date().toISOString(),
    createdBy: 'legacy'
  };
}

export async function listUsers(env) {
  const users = new Map();
  let cursor;
  do {
    const page = await env.DATA_KV.list({ prefix: USER_PREFIX, cursor });
    for (const key of page.keys) {
      const userId = key.name.slice(USER_PREFIX.length);
      const meta = key.metadata || {};
      users.set(userId, {
        userId,
        status: meta.status || 'active',
        disabled: !!meta.disabled,
        legacy: !!meta.legacy,
        invite: meta.invite || null,
        updatedAt: meta.updatedAt || null
      });
    }
    cursor = page.list_complete ? undefined : page.cursor;
  } while (cursor);

  for (const legacy of loadLegacyUsers(env)) {
    if (users.has(legacy.userId)) continue;
    users.set(legacy.userId, {
      userId: legacy.userId,
      status: 'active',
      disabled: false,
      legacy: true,
      invite: null,
      updatedAt: null
    });
  }

  const now = Date.now();
  return Array.from(users.values())
    .map((u) => ({
      ...u,
      invite: u.invite && Number(u.invite.expiresAt) > now ? u.invite : null,
      isAdmin: isAdmin(u.userId, env)
    }))
    .sort((a, b) => a.userId.localeCompare(b.userId));
}

// ---- 招待リンク ----

export async function createInvite(env, record, purpose, createdBy) {
  if (record.invite && record.invite.hash) {
    await env.DATA_KV.delete(INVITE_PREFIX + record.invite.hash);
  }
  const token = toBase64Url(crypto.getRandomValues(new Uint8Array(32)));
  const hash = await sha256Hex(token);
  const expiresAt = Date.now() + INVITE_TTL_SECONDS * 1000;
  await env.DATA_KV.put(
    INVITE_PREFIX + hash,
    JSON.stringify({ userId: record.userId, purpose, expiresAt }),
    { expirationTtl: INVITE_TTL_SECONDS }
  );
  const saved = await putUser(env, { ...record, invite: { hash, purpose, expiresAt, createdBy } });
  return { token, expiresAt, record: saved };
}

// 有効な招待なら { invite, record, hash }、使えなければ null
export async function findInvite(env, token) {
  const value = String(token || '');
  if (!/^[A-Za-z0-9_-]{20,100}$/.test(value)) return null;
  const hash = await sha256Hex(value);
  const text = await env.DATA_KV.get(INVITE_PREFIX + hash);
  if (!text) return null;
  let invite;
  try {
    invite = JSON.parse(text);
  } catch {
    return null;
  }
  if (!invite || Date.now() > Number(invite.expiresAt)) return null;
  const record = await getUser(env, invite.userId);
  if (!record || !record.invite || !safeEqual(record.invite.hash, hash) || record.disabled) return null;
  return { invite, record, hash };
}

export async function removeInvite(env, record) {
  if (record.invite && record.invite.hash) {
    await env.DATA_KV.delete(INVITE_PREFIX + record.invite.hash);
  }
  return { ...record, invite: null };
}

// ---- 共通の小物 ----

export function toBase64Url(bytes) {
  let binary = '';
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function fromBase64Url(text) {
  const normalized = String(text || '').replace(/-/g, '+').replace(/_/g, '/');
  const padded = normalized + '='.repeat((4 - (normalized.length % 4)) % 4);
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

export async function sha256Hex(input) {
  const bytes = new TextEncoder().encode(input);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  const arr = new Uint8Array(digest);
  let out = '';
  for (const b of arr) {
    out += b.toString(16).padStart(2, '0');
  }
  return out;
}

export function safeEqual(a, b) {
  const aStr = String(a || '');
  const bStr = String(b || '');
  if (aStr.length !== bStr.length) return false;
  let result = 0;
  for (let i = 0; i < aStr.length; i += 1) {
    result |= aStr.charCodeAt(i) ^ bStr.charCodeAt(i);
  }
  return result === 0;
}

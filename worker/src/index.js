export default {
  async fetch(request, env) {
    try {
      if (request.method === 'OPTIONS') {
        return new Response(null, { headers: corsHeaders(request, env) });
      }

      const url = new URL(request.url);
      const path = url.pathname;

      if (request.method === 'GET' && path === '/health') {
        return json({ ok: true, service: 'rewis-editor-api' }, 200, request, env);
      }

      if (request.method === 'POST' && path === '/auth/login') {
        return handleLogin(request, env);
      }

      if (request.method === 'POST' && path === '/auth/logout') {
        return handleLogout(request, env);
      }

      if (request.method === 'GET' && path === '/data/latest') {
        return handleGetLatestData(request, env);
      }

      if (request.method === 'GET' && path === '/data/history') {
        return handleGetHistory(request, env);
      }

      if (request.method === 'POST' && path === '/data/save') {
        return handleSaveData(request, env);
      }

      return json({ error: 'not_found' }, 404, request, env);
    } catch (error) {
      return json({ error: 'internal_error', detail: String(error.message || error) }, 500, request, env);
    }
  }
};

async function handleLogin(request, env) {
  const body = await readJsonBody(request);
  const userId = String(body.userId || '').trim();
  const password = String(body.password || '');

  if (!userId || !password) {
    return json({ error: 'missing_credentials' }, 400, request, env);
  }

  const users = await loadUsers(env);
  const target = users.find((u) => u.userId === userId);
  if (!target || !target.passwordHash) {
    return json({ error: 'invalid_credentials' }, 401, request, env);
  }

  const passwordHash = await sha256Hex(password + String(env.PASSWORD_SALT || ''));
  if (!safeEqual(passwordHash, String(target.passwordHash).toLowerCase())) {
    return json({ error: 'invalid_credentials' }, 401, request, env);
  }

  const token = generateToken();
  const ttlSeconds = Math.max(60, Number(env.TOKEN_TTL_SECONDS || 1800));
  const expiresAt = Date.now() + ttlSeconds * 1000;

  await env.TOKEN_KV.put(
    token,
    JSON.stringify({ userId, expiresAt }),
    { expirationTtl: ttlSeconds }
  );

  return json({ token, expiresAt }, 200, request, env);
}

async function handleLogout(request, env) {
  const token = getBearerToken(request);
  if (token) {
    await env.TOKEN_KV.delete(token);
  }
  return json({ ok: true }, 200, request, env);
}

async function handleSaveData(request, env) {
  const auth = await requireAuth(request, env);
  if (!auth.ok) {
    return json({ error: 'unauthorized' }, 401, request, env);
  }

  const body = await readJsonBody(request);
  if (!body || typeof body !== 'object' || !body.data || typeof body.data !== 'object') {
    return json({ error: 'invalid_payload' }, 400, request, env);
  }

  const now = new Date().toISOString();
  const record = {
    data: body.data,
    meta: {
      updatedAt: now,
      updatedBy: auth.userId,
      client: String(body.client || 'unknown')
    }
  };

  await env.DATA_KV.put('data:latest', JSON.stringify(record));
  await env.DATA_KV.put(`data:history:${Date.now()}`, JSON.stringify(record));

  return json({ ok: true, updatedAt: now }, 200, request, env);
}

async function handleGetLatestData(request, env) {
  const text = await env.DATA_KV.get('data:latest');
  if (!text) {
    return json({ error: 'not_initialized' }, 404, request, env);
  }

  const payload = JSON.parse(text);
  return jsonNoCache(payload, 200, request, env);
}

async function handleGetHistory(request, env) {
  const auth = await requireAuth(request, env);
  if (!auth.ok) {
    return json({ error: 'unauthorized' }, 401, request, env);
  }

  const url = new URL(request.url);
  const limitRaw = Number(url.searchParams.get('limit') || 50);
  const limit = Math.min(200, Math.max(1, Number.isFinite(limitRaw) ? Math.floor(limitRaw) : 50));

  const listed = await env.DATA_KV.list({ prefix: 'data:history:', limit });
  const keys = (listed.keys || [])
    .map((k) => String(k.name || ''))
    .filter((k) => k.startsWith('data:history:'))
    .sort((a, b) => {
      const ta = Number(a.slice('data:history:'.length)) || 0;
      const tb = Number(b.slice('data:history:'.length)) || 0;
      return tb - ta;
    });

  const rows = await Promise.all(keys.map(async (key) => {
    try {
      const text = await env.DATA_KV.get(key);
      if (!text) return null;
      const payload = JSON.parse(text);
      const meta = payload && payload.meta ? payload.meta : {};
      return {
        key,
        savedAt: meta.updatedAt || null,
        updatedBy: meta.updatedBy || null,
        client: meta.client || null
      };
    } catch {
      return {
        key,
        savedAt: null,
        updatedBy: null,
        client: null
      };
    }
  }));

  return json({ items: rows.filter(Boolean) }, 200, request, env);
}

async function requireAuth(request, env) {
  const token = getBearerToken(request);
  if (!token) return { ok: false };

  const raw = await env.TOKEN_KV.get(token);
  if (!raw) return { ok: false };

  let session = null;
  try {
    session = JSON.parse(raw);
  } catch {
    return { ok: false };
  }

  if (!session || !session.expiresAt || Date.now() > Number(session.expiresAt)) {
    await env.TOKEN_KV.delete(token);
    return { ok: false };
  }

  return { ok: true, userId: String(session.userId || '') };
}

function getBearerToken(request) {
  const auth = request.headers.get('Authorization') || '';
  if (!auth.startsWith('Bearer ')) return '';
  return auth.slice('Bearer '.length).trim();
}

async function loadUsers(env) {
  const raw = String(env.AUTH_USERS_JSON || '').trim();
  if (!raw) {
    throw new Error('AUTH_USERS_JSON is not set');
  }

  let parsed = null;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error('AUTH_USERS_JSON is not valid JSON');
  }

  if (!Array.isArray(parsed)) {
    throw new Error('AUTH_USERS_JSON must be an array');
  }

  return parsed.map((u) => ({
    userId: String(u.userId || '').trim(),
    passwordHash: String(u.passwordHash || '').trim().toLowerCase()
  }));
}

async function readJsonBody(request) {
  const text = await request.text();
  if (!text) return {};
  return JSON.parse(text);
}

function json(data, status, request, env) {
  return new Response(JSON.stringify(data, null, 2), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-cache, no-store, must-revalidate',
      'Pragma': 'no-cache',
      'Expires': '0',
      ...corsHeaders(request, env)
    }
  });
}

function jsonNoCache(data, status, request, env) {
  return new Response(JSON.stringify(data, null, 2), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store, no-cache, must-revalidate, max-age=0',
      'Pragma': 'no-cache',
      'Expires': '0',
      'ETag': generateETag(),
      ...corsHeaders(request, env)
    }
  });
}

function generateETag() {
  const str = Date.now().toString() + Math.random().toString(36);
  return '"' + str.split('').reduce((h, c) => ((h << 5) - h) + c.charCodeAt(0) | 0, 0).toString(16) + '"';
}

function corsHeaders(request, env) {
  const origin = request.headers.get('Origin') || '';
  const allowedOrigin = String(env.ALLOWED_ORIGIN || '').trim();
  const useOrigin = allowedOrigin || origin || '*';

  return {
    'Access-Control-Allow-Origin': useOrigin,
    'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Max-Age': '86400',
    'Vary': 'Origin'
  };
}

function generateToken() {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return toBase64Url(bytes);
}

function toBase64Url(bytes) {
  let binary = '';
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

async function sha256Hex(input) {
  const bytes = new TextEncoder().encode(input);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  const arr = new Uint8Array(digest);
  let out = '';
  for (const b of arr) {
    out += b.toString(16).padStart(2, '0');
  }
  return out;
}

function safeEqual(a, b) {
  const aStr = String(a || '');
  const bStr = String(b || '');
  if (aStr.length !== bStr.length) return false;
  let result = 0;
  for (let i = 0; i < aStr.length; i += 1) {
    result |= aStr.charCodeAt(i) ^ bStr.charCodeAt(i);
  }
  return result === 0;
}

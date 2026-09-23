import { validateV1 } from '../../src/shared/validate-v1.js';
import { toPublicV1 } from '../../src/shared/public-v1.js';
import { validateNetwork, validateOperations } from '../../src/shared/schema-v2.js';
import { compilePublic } from '../../src/shared/compile-public.js';

const NEW_HISTORY_PREFIX = 'data:hist:';
const OLD_HISTORY_PREFIX = 'data:history:';

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

      if (request.method === 'GET' && path === '/data/public') {
        return handleGetPublicData(request, env);
      }

      if (request.method === 'GET' && path === '/data/latest') {
        return handleGetLatestData(request, env);
      }

      if (request.method === 'GET' && path === '/data/history') {
        return handleGetHistory(request, env);
      }

      if (request.method === 'GET' && path === '/data/history/item') {
        return handleGetHistoryItem(request, env);
      }

      if (request.method === 'POST' && path === '/data/save') {
        return handleSaveData(request, env);
      }

      if (request.method === 'POST' && path === '/data/rollback') {
        return handleRollback(request, env);
      }

      const v2DocMatch = path.match(/^\/v2\/doc\/([^/]+)$/);
      if (request.method === 'GET' && v2DocMatch) {
        return handleV2GetDoc(v2DocMatch[1], request, env);
      }

      const v2SaveMatch = path.match(/^\/v2\/doc\/([^/]+)\/save$/);
      if (request.method === 'POST' && v2SaveMatch) {
        return handleV2Save(v2SaveMatch[1], request, env);
      }

      const v2HistMatch = path.match(/^\/v2\/history\/([^/]+)$/);
      if (request.method === 'GET' && v2HistMatch) {
        return handleV2History(v2HistMatch[1], request, env);
      }

      const v2HistItemMatch = path.match(/^\/v2\/history\/([^/]+)\/item$/);
      if (request.method === 'GET' && v2HistItemMatch) {
        return handleV2HistoryItem(v2HistItemMatch[1], request, env);
      }

      const v2RollbackMatch = path.match(/^\/v2\/rollback\/([^/]+)$/);
      if (request.method === 'POST' && v2RollbackMatch) {
        return handleV2Rollback(v2RollbackMatch[1], request, env);
      }

      if (request.method === 'GET' && path === '/v2/public') {
        return handleV2GetPublic(request, env);
      }

      if (request.method === 'POST' && path === '/v2/admin/import') {
        return handleV2AdminImport(request, env);
      }

      return json({ error: 'not_found' }, 404, request, env);
    } catch (error) {
      console.error(error);
      return json({ error: 'internal_error' }, 500, request, env);
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

async function handleGetPublicData(request, env) {
  const latest = await getLatestRecord(env);
  if (!latest) {
    return json({ error: 'not_initialized' }, 404, request, env);
  }

  const meta = latest.meta || {};
  return jsonNoCache({
    data: toPublicV1(latest.data),
    meta: { revision: meta.revision ?? 0, updatedAt: meta.updatedAt || null }
  }, 200, request, env);
}

async function handleGetLatestData(request, env) {
  if (String(env.LATEST_REQUIRES_AUTH || '') === 'true') {
    const auth = await requireAuth(request, env);
    if (!auth.ok) {
      return json({ error: 'unauthorized' }, 401, request, env);
    }
  }

  const latest = await getLatestRecord(env);
  if (!latest) {
    return json({ error: 'not_initialized' }, 404, request, env);
  }

  const meta = latest.meta || {};
  return jsonNoCache({
    data: latest.data,
    meta: { ...meta, revision: meta.revision ?? 0 }
  }, 200, request, env);
}

async function handleSaveData(request, env) {
  if (String(env.V1_SAVE_DISABLED || '') === 'true') {
    return json({ error: 'v1_save_disabled' }, 410, request, env);
  }

  const auth = await requireAuth(request, env);
  if (!auth.ok) {
    return json({ error: 'unauthorized' }, 401, request, env);
  }

  const body = await readJsonBody(request);
  if (!body || typeof body !== 'object' || !body.data || typeof body.data !== 'object') {
    return json({ error: 'invalid_payload' }, 400, request, env);
  }

  if (!isNonNegativeInteger(body.baseRevision)) {
    return json({ error: 'revision_required' }, 428, request, env);
  }

  const { errors } = validateV1(body.data);
  if (errors.length > 0) {
    return json({ error: 'validation_failed', errors: errors.slice(0, 50) }, 422, request, env);
  }

  const latest = await getLatestRecord(env);
  const currentRev = latest?.meta?.revision ?? 0;

  if (body.baseRevision !== currentRev) {
    return json({
      error: 'conflict',
      latestRevision: currentRev,
      updatedAt: latest?.meta?.updatedAt || null,
      updatedBy: latest?.meta?.updatedBy || null
    }, 409, request, env);
  }

  const now = new Date().toISOString();
  const newRev = currentRev + 1;
  const record = {
    data: body.data,
    meta: {
      revision: newRev,
      updatedAt: now,
      updatedBy: auth.userId,
      client: String(body.client || 'unknown')
    }
  };

  await putRecordAsLatestAndHistory(env, record);

  return json({ ok: true, revision: newRev, updatedAt: now }, 200, request, env);
}

async function handleGetHistory(request, env) {
  const auth = await requireAuth(request, env);
  if (!auth.ok) {
    return json({ error: 'unauthorized' }, 401, request, env);
  }

  const url = new URL(request.url);
  const limitRaw = Number(url.searchParams.get('limit') || 50);
  const limit = Math.min(200, Math.max(1, Number.isFinite(limitRaw) ? Math.floor(limitRaw) : 50));
  const cursorParam = url.searchParams.get('cursor') || null;

  let items = [];
  let nextCursor = null;

  if (!cursorParam || cursorParam.startsWith('n:')) {
    const kvCursor = cursorParam ? cursorParam.slice('n:'.length) : undefined;
    const listed = await env.DATA_KV.list({ prefix: NEW_HISTORY_PREFIX, limit, cursor: kvCursor || undefined });
    items = (listed.keys || []).map(newFormatKeyToItem);

    if (!listed.list_complete && listed.cursor) {
      nextCursor = 'n:' + listed.cursor;
    } else {
      const remaining = limit - items.length;
      if (remaining > 0) {
        const oldPage = await getOldFormatHistoryPage(env, 0, remaining);
        items = items.concat(oldPage.items);
        nextCursor = oldPage.cursor;
      } else {
        const oldPage = await getOldFormatHistoryPage(env, 0, 0);
        nextCursor = oldPage.hasAny ? 'l:0' : null;
      }
    }
  } else if (cursorParam.startsWith('l:')) {
    const offset = Math.max(0, Number(cursorParam.slice('l:'.length)) || 0);
    const oldPage = await getOldFormatHistoryPage(env, offset, limit);
    items = oldPage.items;
    nextCursor = oldPage.cursor;
  }

  return json({ items, cursor: nextCursor }, 200, request, env);
}

async function handleGetHistoryItem(request, env) {
  const auth = await requireAuth(request, env);
  if (!auth.ok) {
    return json({ error: 'unauthorized' }, 401, request, env);
  }

  const url = new URL(request.url);
  const key = url.searchParams.get('key') || '';
  if (!key.startsWith(NEW_HISTORY_PREFIX) && !key.startsWith(OLD_HISTORY_PREFIX)) {
    return json({ error: 'invalid_key' }, 400, request, env);
  }

  const text = await env.DATA_KV.get(key);
  if (!text) {
    return json({ error: 'not_found' }, 404, request, env);
  }

  const record = JSON.parse(text);
  return json(record, 200, request, env);
}

async function handleRollback(request, env) {
  if (String(env.V1_SAVE_DISABLED || '') === 'true') {
    return json({ error: 'v1_save_disabled' }, 410, request, env);
  }

  const auth = await requireAuth(request, env);
  if (!auth.ok) {
    return json({ error: 'unauthorized' }, 401, request, env);
  }

  const body = await readJsonBody(request);
  const key = String(body.key || '');
  if (!key.startsWith(NEW_HISTORY_PREFIX) && !key.startsWith(OLD_HISTORY_PREFIX)) {
    return json({ error: 'invalid_key' }, 400, request, env);
  }

  if (!isNonNegativeInteger(body.baseRevision)) {
    return json({ error: 'revision_required' }, 428, request, env);
  }

  const latest = await getLatestRecord(env);
  const currentRev = latest?.meta?.revision ?? 0;

  if (body.baseRevision !== currentRev) {
    return json({
      error: 'conflict',
      latestRevision: currentRev,
      updatedAt: latest?.meta?.updatedAt || null,
      updatedBy: latest?.meta?.updatedBy || null
    }, 409, request, env);
  }

  const targetText = await env.DATA_KV.get(key);
  if (!targetText) {
    return json({ error: 'not_found' }, 404, request, env);
  }
  const target = JSON.parse(targetText);

  const { errors } = validateV1(target.data);
  if (errors.length > 0) {
    return json({ error: 'validation_failed', errors: errors.slice(0, 50) }, 422, request, env);
  }

  const now = new Date().toISOString();
  const newRev = currentRev + 1;
  const record = {
    data: target.data,
    meta: {
      revision: newRev,
      updatedAt: now,
      updatedBy: auth.userId,
      client: 'rewis-rollback',
      rollbackFrom: key
    }
  };

  await putRecordAsLatestAndHistory(env, record);

  return json({ ok: true, revision: newRev, updatedAt: now }, 200, request, env);
}

function isValidV2Kind(kind) {
  return kind === 'network' || kind === 'operations';
}

function isPlainObjectLike(v) {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

async function getV2Record(env, kind) {
  const text = await env.DATA_KV.get(`v2:${kind}:latest`);
  if (!text) return null;
  return JSON.parse(text);
}

let _histSeqV2 = 0;

async function putV2RecordAsLatestAndHistory(env, kind, record) {
  await env.DATA_KV.put(`v2:${kind}:latest`, JSON.stringify(record));
  _histSeqV2 += 1;
  const histKey = `v2:hist:${kind}:` + invertedTimestamp(Date.now()) + '-' + invertedSeq(_histSeqV2);
  await env.DATA_KV.put(histKey, JSON.stringify(record), { metadata: record.meta });
}

async function recompilePublicV2(env) {
  const networkRecord = await getV2Record(env, 'network');
  const operationsRecord = await getV2Record(env, 'operations');
  if (!networkRecord || !operationsRecord) return;
  const pub = compilePublic(networkRecord, operationsRecord);
  await env.DATA_KV.put('v2:public:latest', JSON.stringify(pub));
}

function affectedNoticeIds(errors, operationsDoc) {
  const notices = (operationsDoc && Array.isArray(operationsDoc.notices)) ? operationsDoc.notices : [];
  const ids = new Set();
  errors.forEach((e) => {
    const m = /^notices\[(\d+)\]/.exec(e.path || '');
    if (m) {
      const notice = notices[Number(m[1])];
      if (notice && notice.id) ids.add(notice.id);
    }
  });
  return Array.from(ids);
}

function isAdmin(userId, env) {
  const raw = String(env.ADMIN_USERS || '').trim();
  if (!raw) return false;
  return raw.split(',').map((s) => s.trim()).filter(Boolean).includes(userId);
}

async function handleV2GetDoc(kind, request, env) {
  if (!isValidV2Kind(kind)) return json({ error: 'not_found' }, 404, request, env);

  const auth = await requireAuth(request, env);
  if (!auth.ok) return json({ error: 'unauthorized' }, 401, request, env);

  const record = await getV2Record(env, kind);
  if (!record) return json({ error: 'not_initialized' }, 404, request, env);

  return jsonNoCache({ doc: record.doc, meta: record.meta }, 200, request, env);
}

async function handleV2Save(kind, request, env) {
  if (!isValidV2Kind(kind)) return json({ error: 'not_found' }, 404, request, env);

  const auth = await requireAuth(request, env);
  if (!auth.ok) return json({ error: 'unauthorized' }, 401, request, env);

  const body = await readJsonBody(request);
  if (!body || typeof body !== 'object' || !isPlainObjectLike(body.doc)) {
    return json({ error: 'invalid_payload' }, 400, request, env);
  }
  if (!isNonNegativeInteger(body.baseRevision)) {
    return json({ error: 'revision_required' }, 428, request, env);
  }

  const current = await getV2Record(env, kind);
  const currentRev = current?.meta?.revision ?? 0;
  if (body.baseRevision !== currentRev) {
    return json({
      error: 'conflict',
      latestRevision: currentRev,
      updatedAt: current?.meta?.updatedAt || null,
      updatedBy: current?.meta?.updatedBy || null
    }, 409, request, env);
  }

  const otherKind = kind === 'network' ? 'operations' : 'network';
  const otherRecord = await getV2Record(env, otherKind);
  const otherDoc = otherRecord ? otherRecord.doc : null;

  if (kind === 'network') {
    const netCheck = validateNetwork(body.doc);
    if (!netCheck.ok) {
      return json({ error: 'validation_failed', errors: netCheck.errors.slice(0, 50) }, 422, request, env);
    }
    if (otherDoc) {
      const opsCheck = validateOperations(otherDoc, body.doc);
      if (!opsCheck.ok) {
        return json({
          error: 'validation_failed',
          errors: opsCheck.errors.slice(0, 50),
          affectedNoticeIds: affectedNoticeIds(opsCheck.errors, otherDoc)
        }, 422, request, env);
      }
    }
  } else {
    const opsCheck = validateOperations(body.doc, otherDoc);
    if (!opsCheck.ok) {
      return json({ error: 'validation_failed', errors: opsCheck.errors.slice(0, 50) }, 422, request, env);
    }
  }

  const now = new Date().toISOString();
  const newRev = currentRev + 1;
  const record = {
    doc: body.doc,
    meta: {
      revision: newRev,
      updatedAt: now,
      updatedBy: auth.userId,
      client: String(body.client || 'unknown')
    }
  };

  await putV2RecordAsLatestAndHistory(env, kind, record);
  await recompilePublicV2(env);

  return json({ ok: true, revision: newRev, updatedAt: now }, 200, request, env);
}

async function handleV2History(kind, request, env) {
  if (!isValidV2Kind(kind)) return json({ error: 'not_found' }, 404, request, env);

  const auth = await requireAuth(request, env);
  if (!auth.ok) return json({ error: 'unauthorized' }, 401, request, env);

  const url = new URL(request.url);
  const limitRaw = Number(url.searchParams.get('limit') || 50);
  const limit = Math.min(200, Math.max(1, Number.isFinite(limitRaw) ? Math.floor(limitRaw) : 50));
  const cursor = url.searchParams.get('cursor') || undefined;

  const listed = await env.DATA_KV.list({ prefix: `v2:hist:${kind}:`, limit, cursor });
  const items = (listed.keys || []).map(newFormatKeyToItem);
  const nextCursor = listed.list_complete ? null : listed.cursor;

  return json({ items, cursor: nextCursor }, 200, request, env);
}

async function handleV2HistoryItem(kind, request, env) {
  if (!isValidV2Kind(kind)) return json({ error: 'not_found' }, 404, request, env);

  const auth = await requireAuth(request, env);
  if (!auth.ok) return json({ error: 'unauthorized' }, 401, request, env);

  const url = new URL(request.url);
  const key = url.searchParams.get('key') || '';
  const prefix = `v2:hist:${kind}:`;
  if (!key.startsWith(prefix)) {
    return json({ error: 'invalid_key' }, 400, request, env);
  }

  const text = await env.DATA_KV.get(key);
  if (!text) return json({ error: 'not_found' }, 404, request, env);

  return json(JSON.parse(text), 200, request, env);
}

async function handleV2Rollback(kind, request, env) {
  if (!isValidV2Kind(kind)) return json({ error: 'not_found' }, 404, request, env);

  const auth = await requireAuth(request, env);
  if (!auth.ok) return json({ error: 'unauthorized' }, 401, request, env);

  const body = await readJsonBody(request);
  const key = String(body.key || '');
  const prefix = `v2:hist:${kind}:`;
  if (!key.startsWith(prefix)) {
    return json({ error: 'invalid_key' }, 400, request, env);
  }
  if (!isNonNegativeInteger(body.baseRevision)) {
    return json({ error: 'revision_required' }, 428, request, env);
  }

  const current = await getV2Record(env, kind);
  const currentRev = current?.meta?.revision ?? 0;
  if (body.baseRevision !== currentRev) {
    return json({
      error: 'conflict',
      latestRevision: currentRev,
      updatedAt: current?.meta?.updatedAt || null,
      updatedBy: current?.meta?.updatedBy || null
    }, 409, request, env);
  }

  const targetText = await env.DATA_KV.get(key);
  if (!targetText) return json({ error: 'not_found' }, 404, request, env);
  const target = JSON.parse(targetText);

  const otherKind = kind === 'network' ? 'operations' : 'network';
  const otherRecord = await getV2Record(env, otherKind);
  const otherDoc = otherRecord ? otherRecord.doc : null;

  if (kind === 'network') {
    const netCheck = validateNetwork(target.doc);
    if (!netCheck.ok) {
      return json({ error: 'validation_failed', errors: netCheck.errors.slice(0, 50) }, 422, request, env);
    }
    if (otherDoc) {
      const opsCheck = validateOperations(otherDoc, target.doc);
      if (!opsCheck.ok) {
        return json({
          error: 'validation_failed',
          errors: opsCheck.errors.slice(0, 50),
          affectedNoticeIds: affectedNoticeIds(opsCheck.errors, otherDoc)
        }, 422, request, env);
      }
    }
  } else {
    const opsCheck = validateOperations(target.doc, otherDoc);
    if (!opsCheck.ok) {
      return json({ error: 'validation_failed', errors: opsCheck.errors.slice(0, 50) }, 422, request, env);
    }
  }

  const now = new Date().toISOString();
  const newRev = currentRev + 1;
  const record = {
    doc: target.doc,
    meta: {
      revision: newRev,
      updatedAt: now,
      updatedBy: auth.userId,
      client: 'rewis-rollback',
      rollbackFrom: key
    }
  };

  await putV2RecordAsLatestAndHistory(env, kind, record);
  await recompilePublicV2(env);

  return json({ ok: true, revision: newRev, updatedAt: now }, 200, request, env);
}

async function handleV2GetPublic(request, env) {
  const text = await env.DATA_KV.get('v2:public:latest');
  if (!text) return json({ error: 'not_initialized' }, 404, request, env);
  return jsonNoCache(JSON.parse(text), 200, request, env);
}

async function handleV2AdminImport(request, env) {
  const auth = await requireAuth(request, env);
  if (!auth.ok) return json({ error: 'unauthorized' }, 401, request, env);
  if (!isAdmin(auth.userId, env)) return json({ error: 'forbidden' }, 403, request, env);

  const body = await readJsonBody(request);
  if (!body || typeof body !== 'object' || !isPlainObjectLike(body.network) || !isPlainObjectLike(body.operations)) {
    return json({ error: 'invalid_payload' }, 400, request, env);
  }

  const netCheck = validateNetwork(body.network);
  const opsCheck = validateOperations(body.operations, body.network);
  if (!netCheck.ok || !opsCheck.ok) {
    return json({
      error: 'validation_failed',
      networkErrors: netCheck.errors.slice(0, 50),
      operationsErrors: opsCheck.errors.slice(0, 50)
    }, 422, request, env);
  }

  const existingNetwork = await getV2Record(env, 'network');
  if (existingNetwork && !body.force) {
    return json({ error: 'conflict', message: 'v2 はすでに初期化されています' }, 409, request, env);
  }
  const existingOperations = await getV2Record(env, 'operations');

  const now = new Date().toISOString();

  const networkRev = (existingNetwork?.meta?.revision ?? 0) + 1;
  const networkRecord = {
    doc: body.network,
    meta: { revision: networkRev, updatedAt: now, updatedBy: auth.userId, client: 'rewis-migration' }
  };
  await putV2RecordAsLatestAndHistory(env, 'network', networkRecord);

  const operationsRev = (existingOperations?.meta?.revision ?? 0) + 1;
  const operationsRecord = {
    doc: body.operations,
    meta: { revision: operationsRev, updatedAt: now, updatedBy: auth.userId, client: 'rewis-migration' }
  };
  await putV2RecordAsLatestAndHistory(env, 'operations', operationsRecord);

  await recompilePublicV2(env);

  return json({
    ok: true,
    network: { revision: networkRev },
    operations: { revision: operationsRev },
    updatedAt: now
  }, 200, request, env);
}

async function getLatestRecord(env) {
  const text = await env.DATA_KV.get('data:latest');
  if (!text) return null;
  return JSON.parse(text);
}

let _histSeq = 0;

async function putRecordAsLatestAndHistory(env, record) {
  await env.DATA_KV.put('data:latest', JSON.stringify(record));
  // 反転タイムスタンプだけでは同一ミリ秒内の連続保存でキーが衝突し、かつ順序も不定になる。
  // 単調増加カウンタを反転させた値を添えて、一意性と新しい順の並びを両立させる。
  _histSeq += 1;
  const histKey = NEW_HISTORY_PREFIX + invertedTimestamp(Date.now()) + '-' + invertedSeq(_histSeq);
  await env.DATA_KV.put(histKey, JSON.stringify(record), { metadata: record.meta });
}

function invertedTimestamp(ts) {
  return String(Number.MAX_SAFE_INTEGER - ts).padStart(16, '0');
}

function invertedSeq(seq) {
  return String(Number.MAX_SAFE_INTEGER - seq).padStart(16, '0');
}

function newFormatKeyToItem(k) {
  const meta = k.metadata || {};
  return {
    key: k.name,
    revision: meta.revision ?? null,
    savedAt: meta.updatedAt || null,
    updatedBy: meta.updatedBy || null,
    client: meta.client || null,
    rollbackFrom: meta.rollbackFrom || null
  };
}

async function listAllOldFormatKeys(env) {
  let keys = [];
  let cursor;
  for (;;) {
    const listed = await env.DATA_KV.list({ prefix: OLD_HISTORY_PREFIX, limit: 1000, cursor });
    keys = keys.concat(listed.keys || []);
    if (listed.list_complete || !listed.cursor) break;
    cursor = listed.cursor;
  }
  keys.sort((a, b) => {
    const ta = Number(a.name.slice(OLD_HISTORY_PREFIX.length)) || 0;
    const tb = Number(b.name.slice(OLD_HISTORY_PREFIX.length)) || 0;
    return tb - ta;
  });
  return keys;
}

async function getOldFormatHistoryPage(env, offset, limit) {
  const allKeys = await listAllOldFormatKeys(env);
  if (limit === 0) {
    return { items: [], cursor: null, hasAny: allKeys.length > offset };
  }
  const page = allKeys.slice(offset, offset + limit);
  const items = await Promise.all(page.map(async (k) => {
    const text = await env.DATA_KV.get(k.name);
    let meta = {};
    if (text) {
      try {
        const payload = JSON.parse(text);
        meta = payload.meta || {};
      } catch {
        meta = {};
      }
    }
    return {
      key: k.name,
      revision: meta.revision ?? null,
      savedAt: meta.updatedAt || null,
      updatedBy: meta.updatedBy || null,
      client: meta.client || null,
      rollbackFrom: meta.rollbackFrom || null
    };
  }));
  const nextOffset = offset + limit;
  const cursor = nextOffset < allKeys.length ? `l:${nextOffset}` : null;
  return { items, cursor, hasAny: allKeys.length > offset };
}

function isNonNegativeInteger(n) {
  return typeof n === 'number' && Number.isInteger(n) && n >= 0;
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
  const allowedOrigins = String(env.ALLOWED_ORIGIN || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  let useOrigin;
  if (allowedOrigins.length === 0) {
    useOrigin = origin || '*';
  } else if (allowedOrigins.includes(origin) || isLocalDevOrigin(origin)) {
    useOrigin = origin;
  } else {
    useOrigin = allowedOrigins[0];
  }

  return {
    'Access-Control-Allow-Origin': useOrigin,
    'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Max-Age': '86400',
    'Vary': 'Origin'
  };
}

// ローカル開発用サーバー（Live Server 等）からのアクセスを許可する。
// localhost / 127.0.0.1、自宅LAN (10.0.1.0/24)、Tailscale (100.64.0.0/10) の http のみ。ポートは任意。
function isLocalDevOrigin(origin) {
  const m = /^http:\/\/([^/:]+)(?::\d{1,5})?$/.exec(origin);
  if (!m) return false;
  const host = m[1];
  if (host === 'localhost' || host === '127.0.0.1') return true;
  const ip = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(host);
  if (!ip) return false;
  const o = ip.slice(1).map(Number);
  if (o.some((n) => n > 255)) return false;
  if (o[0] === 10 && o[1] === 0 && o[2] === 1) return true;
  if (o[0] === 100 && o[1] >= 64 && o[1] <= 127) return true;
  return false;
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

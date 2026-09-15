import { convertV1ToV2 } from './convert-v1-to-v2.js';
import { toPublicV1 } from './public-v1.js';
import v1Overrides from './v1-overrides.js';
import { buildModel } from './model.js';

export function getPublicWorkerApiBase() {
  const configured = String((globalThis.REWIS_PUBLIC_DATA_SOURCE && globalThis.REWIS_PUBLIC_DATA_SOURCE.workerApiBase) || '').trim();
  let saved = '';
  try {
    saved = String((globalThis.localStorage && globalThis.localStorage.getItem('rewis_worker_api_base')) || '').trim();
  } catch {
    saved = '';
  }
  return (configured || saved).replace(/\/$/, '');
}

function extractPayload(payload) {
  if (payload && typeof payload === 'object') {
    return (payload.data && typeof payload.data === 'object') ? payload.data : payload;
  }
  throw new Error('不正なデータ形式です');
}

async function fetchPublicV1Raw(workerBase, fetchImpl) {
  const publicRes = await fetchImpl(workerBase + '/data/public', { cache: 'no-store' });
  if (publicRes.ok) return extractPayload(await publicRes.json());
  if (publicRes.status === 404) {
    const latestRes = await fetchImpl(workerBase + '/data/latest', { cache: 'no-store' });
    if (!latestRes.ok) throw new Error('データの取得に失敗しました');
    return extractPayload(await latestRes.json());
  }
  throw new Error('データの取得に失敗しました');
}

function renderedFromV1Status(v1Status) {
  if (!v1Status) return { heading: '', body: '' };
  if (v1Status.preview && v1Status.preview.editable) {
    const text = v1Status.published_text || '';
    const idx = text.indexOf('\n');
    if (idx === -1) return { heading: text, body: '' };
    return { heading: text.slice(0, idx), body: text.slice(idx + 1) };
  }
  return v1Status.generated_text || { heading: '', body: '' };
}

async function loadV1(workerBase, fetchImpl) {
  const raw = await fetchPublicV1Raw(workerBase, fetchImpl);
  const filtered = toPublicV1(raw);
  const { network, operations } = convertV1ToV2(filtered, v1Overrides);
  const v1StatusById = new Map((filtered.serviceStatuses || []).map(st => [st.id, st]));

  const notices = operations.notices
    .filter(n => n.state === 'published')
    .map(n => ({ ...n, rendered: renderedFromV1Status(v1StatusById.get(n.id)) }));

  const model = buildModel(network, notices, operations.masters);
  return { model, source: 'v1', v1Raw: raw };
}

async function loadV2(workerBase, fetchImpl) {
  const res = await fetchImpl(workerBase + '/v2/public', { cache: 'no-store' });
  if (!res.ok) throw new Error('データの取得に失敗しました');
  const p = await res.json();
  const model = buildModel(p.network, p.notices, p.masters);
  return { model, source: 'v2' };
}

export async function loadPublicModel({ workerBase, dataVersion = 1, fetchImpl = fetch } = {}) {
  const base = (workerBase || getPublicWorkerApiBase());
  if (!base) throw new Error('データ取得元（Workers API）が設定されていません');
  if (dataVersion === 2) return loadV2(base, fetchImpl);
  return loadV1(base, fetchImpl);
}

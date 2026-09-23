export const ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;

export function isValidId(s) {
  return typeof s === 'string' && ID_PATTERN.test(s);
}

const ID_CHARS = '0123456789abcdefghijklmnopqrstuvwxyz';

export function newId(prefix) {
  const bytes = new Uint8Array(10);
  globalThis.crypto.getRandomValues(bytes);
  let suffix = '';
  for (let i = 0; i < bytes.length; i++) {
    suffix += ID_CHARS[bytes[i] % ID_CHARS.length];
  }
  return `${prefix}_${suffix}`;
}

export function sanitizeIdPart(s) {
  return String(s).replace(/[^A-Za-z0-9_-]/g, '_');
}

// meta.ownCompanyId は文字列（従来）または配列（複数自社）のどちらもとりうる。常に配列で扱うための正規化。
export function ownCompanyIds(meta) {
  const v = meta && meta.ownCompanyId;
  if (Array.isArray(v)) return v.filter(Boolean);
  return v ? [v] : [];
}

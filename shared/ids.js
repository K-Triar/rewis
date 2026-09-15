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

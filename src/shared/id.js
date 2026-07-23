import { randomBytes, randomUUID } from 'node:crypto';

/**
 * ID generation helpers.
 *
 * The legacy json-server auto-assigned short, URL-safe string ids (e.g.
 * "j8NOjThxVxI") to records created without an explicit `id`. We reproduce
 * that behaviour so the existing Android client keeps working unchanged.
 */

const ALPHABET =
  'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789_-';

/**
 * Generate a short, URL-safe, json-server-compatible id.
 * @param {number} size number of characters (json-server default is 11)
 * @returns {string}
 */
export function generateShortId(size = 11) {
  const bytes = randomBytes(size);
  let out = '';
  for (let i = 0; i < size; i += 1) {
    out += ALPHABET[bytes[i] & 63];
  }
  return out;
}

/**
 * Generate a UUID v4 (used for ticket / booking-seat business ids).
 * @returns {string}
 */
export function generateUuid() {
  return randomUUID();
}

/**
 * Generate the next zero-padded sequential id for a prefixed id space,
 * e.g. `acc_001` -> `acc_002`, `mem_prof_007` -> `mem_prof_008`.
 *
 * @param {Array<object>} list existing records
 * @param {string} prefix id prefix including trailing separator (e.g. "acc_")
 * @param {string} idField field that holds the business id
 * @param {number} pad zero-padding width
 * @returns {string}
 */
export function generateSequentialId(list, prefix, idField, pad = 3) {
  let maxNum = 0;
  for (const item of list) {
    const value = item?.[idField];
    if (typeof value === 'string' && value.startsWith(prefix)) {
      const num = Number.parseInt(value.slice(prefix.length), 10);
      if (!Number.isNaN(num) && num > maxNum) {
        maxNum = num;
      }
    }
  }
  return `${prefix}${String(maxNum + 1).padStart(pad, '0')}`;
}

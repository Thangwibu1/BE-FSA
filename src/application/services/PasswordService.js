import { randomBytes, scrypt as scryptCallback, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';

const scrypt = promisify(scryptCallback);
const PREFIX = 'scrypt';

export function isPasswordHash(value) {
  return typeof value === 'string' && value.startsWith(`${PREFIX}$`);
}

export async function hashPassword(password) {
  if (typeof password !== 'string' || password.length < 6) {
    throw new Error('Password must contain at least 6 characters');
  }
  const salt = randomBytes(16).toString('hex');
  const derived = await scrypt(password, salt, 64);
  return `${PREFIX}$${salt}$${Buffer.from(derived).toString('hex')}`;
}

export async function verifyPassword(password, storedValue) {
  if (!isPasswordHash(storedValue)) {
    // Backward compatibility for the supplied seed. A successful login upgrades it.
    return typeof password === 'string' && password === storedValue;
  }
  const [, salt, expectedHex] = storedValue.split('$');
  const expected = Buffer.from(expectedHex, 'hex');
  const actual = Buffer.from(await scrypt(password, salt, expected.length));
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

export function sanitizeAccount(account) {
  if (!account) return account;
  const { passwordHash: _passwordHash, password: _password, ...safe } = account;
  return safe;
}

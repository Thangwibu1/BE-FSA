import { createHmac, timingSafeEqual } from 'node:crypto';
import { UnauthorizedError } from '../../shared/errors.js';

function encode(value) {
  return Buffer.from(JSON.stringify(value)).toString('base64url');
}

function decode(value) {
  return JSON.parse(Buffer.from(value, 'base64url').toString('utf8'));
}

export class AuthTokenService {
  constructor(secret, lifetimeSeconds = 8 * 60 * 60, refreshLifetimeSeconds = 30 * 24 * 60 * 60) {
    this.secret = secret;
    this.lifetimeSeconds = lifetimeSeconds;
    this.refreshLifetimeSeconds = refreshLifetimeSeconds;
  }

  #sign(account, type, lifetimeSeconds) {
    const now = Math.floor(Date.now() / 1000);
    const payload = encode({
      sub: account.accountId,
      role: account.role,
      typ: type,
      ver: Number(account.authTokenVersion || 0),
      iat: now,
      exp: now + lifetimeSeconds,
    });
    const signature = createHmac('sha256', this.secret).update(payload).digest('base64url');
    return `${payload}.${signature}`;
  }

  signAccess(account) {
    return this.#sign(account, 'access', this.lifetimeSeconds);
  }

  signRefresh(account) {
    return this.#sign(account, 'refresh', this.refreshLifetimeSeconds);
  }

  issue(account) {
    return {
      accessToken: this.signAccess(account),
      refreshToken: this.signRefresh(account),
      tokenType: 'Bearer',
      expiresIn: this.lifetimeSeconds,
      refreshExpiresIn: this.refreshLifetimeSeconds,
    };
  }

  #verify(token, expectedType) {
    try {
      const [payload, signature] = String(token).split('.');
      if (!payload || !signature) throw new Error('Malformed token');
      const expected = createHmac('sha256', this.secret).update(payload).digest();
      const actual = Buffer.from(signature, 'base64url');
      if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) throw new Error('Invalid signature');
      const claims = decode(payload);
      if (!claims.sub || claims.exp <= Math.floor(Date.now() / 1000)) throw new Error('Expired token');
      if (claims.typ !== expectedType) throw new Error('Unexpected token type');
      return claims;
    } catch {
      throw new UnauthorizedError('Invalid or expired access token');
    }
  }

  verifyAccess(token) {
    return this.#verify(token, 'access');
  }

  verifyRefresh(token) {
    return this.#verify(token, 'refresh');
  }

  // Backwards-compatible aliases used by existing callers and tests.
  sign(account) {
    return this.signAccess(account);
  }

  verify(token) {
    return this.verifyAccess(token);
  }
}

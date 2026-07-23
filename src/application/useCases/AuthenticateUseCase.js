import { UnauthorizedError, ValidationError } from '../../shared/errors.js';
import { COLLECTIONS } from '../../domain/collections.js';
import { hashPassword, isPasswordHash, sanitizeAccount, verifyPassword } from '../services/PasswordService.js';

function escapeRegex(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Login use-case (functional requirement 3.1.1).
 *
 * The Android client historically authenticated by pulling the ACCOUNT list
 * and matching locally. This use-case offers a proper server-side endpoint
 * (`POST /login`) that validates credentials, refreshes `lastLoginAt`, and
 * returns the account together with its member profile (if any).
 */
export class AuthenticateUseCase {
  /** @param {import('../../domain/ports/ResourceRepository.js').ResourceRepository} repository */
  constructor(repository, tokenService) {
    this.repository = repository;
    this.tokenService = tokenService;
  }

  /**
   * @param {{ username?: string, password?: string }} credentials
   * @returns {Promise<{ message: string, account: object, memberProfile: object|null }>}
   */
  async execute({ username, password } = {}) {
    if (!username || !password) {
      throw new ValidationError('username and password are required');
    }

    const account = await this.repository.findOne(COLLECTIONS.ACCOUNT.name, {
      username: { $regex: `^${escapeRegex(username)}$`, $options: 'i' },
    });
    if (!account || !await verifyPassword(password, account.passwordHash)) {
      throw new UnauthorizedError('User / password is invalid. Please try again!');
    }
    if (account.status === 'LOCKED' || account.status === 'BLOCKED') {
      throw new UnauthorizedError('Account has been locked!');
    }
    if (account.status && account.status !== 'ACTIVE') {
      throw new UnauthorizedError('Account is not active');
    }

    const now = new Date().toISOString();
    const securityPatch = { lastLoginAt: now };
    if (!isPasswordHash(account.passwordHash)) securityPatch.passwordHash = await hashPassword(password);
    await this.repository.patch(COLLECTIONS.ACCOUNT.name, account.id, securityPatch);

    const memberProfile = await this.repository.findOne(
      COLLECTIONS.MEMBER_PROFILE.name,
      { accountId: account.accountId },
    );

    return {
      message: 'Login successful',
      ...this.tokenService.issue({ ...account, ...securityPatch }),
      account: sanitizeAccount({ ...account, lastLoginAt: now }),
      memberProfile: memberProfile ?? null,
    };
  }
}

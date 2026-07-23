import { COLLECTIONS } from '../../domain/collections.js';
import { ConflictError, NotFoundError, UnauthorizedError, ValidationError } from '../../shared/errors.js';
import { hashPassword, sanitizeAccount, verifyPassword } from '../services/PasswordService.js';

function escapeRegex(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export class AccountUseCase {
  constructor(repository, tokenService) {
    this.repository = repository;
    this.tokenService = tokenService;
  }

  async getCurrent(accountId) {
    const account = await this.repository.findOne(COLLECTIONS.ACCOUNT.name, { accountId });
    if (!account) throw new NotFoundError('Account not found');
    const memberProfile = await this.repository.findOne(COLLECTIONS.MEMBER_PROFILE.name, { accountId });
    return { account: sanitizeAccount(account), memberProfile: memberProfile ?? null };
  }

  async refreshSession({ refreshToken } = {}) {
    if (!refreshToken) throw new ValidationError('Refresh token is required');
    const claims = this.tokenService.verifyRefresh(refreshToken);
    const account = await this.repository.findOne(COLLECTIONS.ACCOUNT.name, { accountId: claims.sub });
    if (!account || account.status !== 'ACTIVE') throw new UnauthorizedError('Account is not active');
    if (Number(claims.ver || 0) !== Number(account.authTokenVersion || 0)) {
      throw new UnauthorizedError('Session has been revoked');
    }
    return { message: 'Token refreshed successfully', ...this.tokenService.issue(account) };
  }

  async logout({ refreshToken } = {}) {
    if (!refreshToken) throw new ValidationError('Refresh token is required');
    const claims = this.tokenService.verifyRefresh(refreshToken);
    const account = await this.repository.findOne(COLLECTIONS.ACCOUNT.name, { accountId: claims.sub });
    if (!account) return { message: 'Logout successful' };
    if (Number(claims.ver || 0) !== Number(account.authTokenVersion || 0)) {
      return { message: 'Logout successful' };
    }
    await this.repository.patch(COLLECTIONS.ACCOUNT.name, account.id, {
      authTokenVersion: Number(account.authTokenVersion || 0) + 1,
      updatedAt: new Date().toISOString(),
    });
    return { message: 'Logout successful' };
  }

  async updateProfile(accountId, patch = {}) {
    const account = await this.repository.findOne(COLLECTIONS.ACCOUNT.name, { accountId });
    if (!account) throw new NotFoundError('Account not found');
    const allowed = ['fullName', 'email', 'phoneNumber', 'dateOfBirth', 'gender', 'identityCard', 'address', 'avatarUrl'];
    const update = Object.fromEntries(allowed.filter((field) => patch[field] !== undefined).map((field) => [field, patch[field]]));
    if (Object.keys(update).length === 0) throw new ValidationError('No profile fields supplied');
    const uniqueFields = ['email', 'phoneNumber', 'identityCard'];
    for (const field of uniqueFields) {
      if (!update[field]) continue;
      const duplicate = await this.repository.findOne(COLLECTIONS.ACCOUNT.name, {
        [field]: field === 'email' ? { $regex: `^${escapeRegex(update[field])}$`, $options: 'i' } : update[field],
      });
      if (duplicate && duplicate.accountId !== accountId) throw new ConflictError(`${field} already exists`);
    }
    update.updatedAt = new Date().toISOString();
    return sanitizeAccount(await this.repository.patch(COLLECTIONS.ACCOUNT.name, account.id, update));
  }

  async changePassword(accountId, { currentPassword, newPassword } = {}) {
    if (!currentPassword || !newPassword) throw new ValidationError('Current password and new password are required');
    if (newPassword.length < 6) throw new ValidationError('New password must contain at least 6 characters');
    const account = await this.repository.findOne(COLLECTIONS.ACCOUNT.name, { accountId });
    if (!account || !await verifyPassword(currentPassword, account.passwordHash)) {
      throw new UnauthorizedError('Current password is incorrect');
    }
    const updated = await this.repository.patch(COLLECTIONS.ACCOUNT.name, account.id, {
      passwordHash: await hashPassword(newPassword),
      authTokenVersion: Number(account.authTokenVersion || 0) + 1,
      updatedAt: new Date().toISOString(),
    });
    return { message: 'Password changed successfully', ...this.tokenService.issue(updated) };
  }
}

import { ConflictError, ValidationError } from '../../shared/errors.js';
import { COLLECTIONS } from '../../domain/collections.js';
import { hashPassword, sanitizeAccount } from '../services/PasswordService.js';

function escapeRegex(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Create an ACCOUNT and matching MEMBER_PROFILE using the legacy contract. */
export class RegisterAccountUseCase {
  /** @param {import('../../domain/ports/ResourceRepository.js').ResourceRepository} repository */
  constructor(repository) {
    this.repository = repository;
  }

  /**
   * @param {object} body
   * @returns {Promise<{ message: string, account: object, memberProfile: object }>}
   */
  async execute(body = {}) {
    const {
      username,
      password,
      passwordHash,
      fullName,
      email,
      phoneNumber,
      dateOfBirth,
      gender,
      identityCard,
      address,
    } = body;

    if (
      !username
      || (!password && !passwordHash)
      || !fullName
      || !email
      || !phoneNumber
      || !dateOfBirth
      || !gender
      || !identityCard
      || !address
    ) {
      throw new ValidationError('Missing required fields', {
        required: [
          'username', 'password', 'fullName', 'email', 'phoneNumber',
          'dateOfBirth', 'gender', 'identityCard', 'address',
        ],
      });
    }

    const duplicates = await this.repository.findMany(COLLECTIONS.ACCOUNT.name, {
      $or: [
        { username: { $regex: `^${escapeRegex(username)}$`, $options: 'i' } },
        { email: { $regex: `^${escapeRegex(email)}$`, $options: 'i' } },
        { phoneNumber },
        { identityCard },
      ],
    });
    if (duplicates.length > 0) {
      throw new ConflictError('Username, email, phone number or identity card already exists');
    }

    const accountId = await this.repository.nextBusinessId(COLLECTIONS.ACCOUNT);
    const memberId = await this.repository.nextBusinessId(COLLECTIONS.MEMBER_PROFILE);
    const now = new Date().toISOString();

    const account = {
      id: accountId,
      accountId,
      username,
      passwordHash: await hashPassword(password || passwordHash),
      fullName,
      email,
      phoneNumber,
      dateOfBirth,
      gender,
      identityCard,
      address,
      avatarUrl: body.avatarUrl || null,
      // Never allow public registration to grant elevated privileges.
      role: 'MEMBER',
      status: 'ACTIVE',
      createdAt: now,
      updatedAt: now,
      lastLoginAt: now,
    };

    const memberProfile = {
      id: memberId,
      memberId,
      accountId,
      points: 0,
      tier: 'STANDARD',
      favoriteGenres: Array.isArray(body.favoriteGenres) ? body.favoriteGenres : [],
      joinedAt: now,
    };

    await this.repository.insert(COLLECTIONS.ACCOUNT.name, account);
    try {
      await this.repository.insert(COLLECTIONS.MEMBER_PROFILE.name, memberProfile);
    } catch (error) {
      // Keep the two-write operation consistent if profile creation fails.
      await this.repository.delete(COLLECTIONS.ACCOUNT.name, account.id).catch(() => {});
      throw error;
    }

    return { message: 'Registration successful', account: sanitizeAccount(account), memberProfile };
  }
}

import { ConflictError, NotFoundError, ValidationError } from '../../shared/errors.js';
import { hashPassword, isPasswordHash, sanitizeAccount } from './PasswordService.js';

/**
 * Generic CRUD application service for a single collection.
 *
 * One instance is created per registered collection (see the composition root).
 * It depends only on the {@link ResourceRepository} port, so it is fully
 * decoupled from MongoDB (Dependency Inversion). All json-server response
 * semantics that the Android client relies on are honoured here.
 */
export class ResourceService {
  /**
   * @param {import('../../domain/collections.js').CollectionDefinition} definition
   * @param {import('../../domain/ports/ResourceRepository.js').ResourceRepository} repository
   */
  constructor(definition, repository) {
    this.definition = definition;
    this.repository = repository;
    // Serialize SHOWTIME writes inside this API process so two concurrent
    // requests cannot both pass the overlap check before either is inserted.
    this.showtimeWriteTail = Promise.resolve();
  }

  get name() {
    return this.definition.name;
  }

  /**
   * @param {import('../../domain/ports/ResourceRepository.js').ListQuery} query
   * @returns {Promise<import('../../domain/ports/ResourceRepository.js').ListResult>}
   */
  async list(query) {
    const result = await this.repository.list(this.name, query);
    return this.name === 'ACCOUNT'
      ? { ...result, data: result.data.map(sanitizeAccount) }
      : result;
  }

  /**
   * @param {string} id
   * @returns {Promise<object>}
   */
  async getById(id) {
    const doc = await this.repository.findById(this.name, id);
    if (!doc) {
      throw new NotFoundError(`${this.name} with id "${id}" not found`);
    }
    return this.name === 'ACCOUNT' ? sanitizeAccount(doc) : doc;
  }

  /**
   * Create a document (json-server POST semantics: server assigns `id` when
   * the client did not provide one).
   * @param {object} body
   * @returns {Promise<object>}
   */
  async create(body) {
    if (!body || Array.isArray(body) || typeof body !== 'object') {
      throw new ValidationError('Body must be a JSON object');
    }

    const document = { ...body };
    if (this.name === 'ACCOUNT') {
      const rawPassword = document.password ?? document.passwordHash;
      if (!rawPassword) throw new ValidationError('Password is required');
      document.passwordHash = isPasswordHash(rawPassword) ? rawPassword : await hashPassword(rawPassword);
      delete document.password;
    }
    const { idField } = this.definition;

    if (document.id === undefined || document.id === null || document.id === '') {
      document.id = document[idField] || await this.repository.nextBusinessId(this.definition);
    }
    if (document[idField] === undefined || document[idField] === null || document[idField] === '') {
      document[idField] = document.id;
    }
    if (this.name === 'BOOKING' && !document.bookingCode) {
      document.bookingCode = document[idField];
    }
    const createDocument = async () => {
      if (this.name === 'SHOWTIME') await this.validateShowtime(document);
      return this.repository.insert(this.name, document);
    };
    const created = this.name === 'SHOWTIME'
      ? await this.runSerializedShowtimeWrite(createDocument)
      : await createDocument();
    return this.name === 'ACCOUNT' ? sanitizeAccount(created) : created;
  }

  /**
   * Full replace (PUT). json-server upserts, so a missing record is created.
   * @param {string} id
   * @param {object} body
   * @returns {Promise<object>}
   */
  async replace(id, body) {
    if (!body || Array.isArray(body) || typeof body !== 'object') {
      throw new ValidationError('Body must be a JSON object');
    }
    const replacement = { ...body };
    if (this.name === 'ACCOUNT') {
      const existing = await this.repository.findById(this.name, id);
      const rawPassword = replacement.password ?? replacement.passwordHash;
      replacement.passwordHash = rawPassword
        ? (isPasswordHash(rawPassword) ? rawPassword : await hashPassword(rawPassword))
        : existing?.passwordHash;
      delete replacement.password;
    }
    const replaceDocument = async () => {
      if (this.name === 'SHOWTIME') await this.validateShowtime(replacement, id);
      return this.repository.replace(this.name, id, replacement);
    };
    const replaced = this.name === 'SHOWTIME'
      ? await this.runSerializedShowtimeWrite(replaceDocument)
      : await replaceDocument();
    if (!replaced) {
      throw new NotFoundError(`${this.name} with id "${id}" not found`);
    }
    return this.name === 'ACCOUNT' ? sanitizeAccount(replaced) : replaced;
  }

  /**
   * Partial update (PATCH).
   * @param {string} id
   * @param {object} patch
   * @returns {Promise<object>}
   */
  async patch(id, patch) {
    if (!patch || Array.isArray(patch) || typeof patch !== 'object') {
      throw new ValidationError('Body must be a JSON object');
    }
    const safePatch = { ...patch };
    if (this.name === 'ACCOUNT') {
      const rawPassword = safePatch.password ?? safePatch.passwordHash;
      if (rawPassword) safePatch.passwordHash = isPasswordHash(rawPassword) ? rawPassword : await hashPassword(rawPassword);
      else delete safePatch.passwordHash;
      delete safePatch.password;
    }
    let updated;
    if (this.name === 'SHOWTIME') {
      updated = await this.runSerializedShowtimeWrite(async () => {
        const existing = await this.repository.findById(this.name, id);
        if (!existing) return null;
        await this.validateShowtime({ ...existing, ...safePatch }, id);
        return this.repository.patch(this.name, id, safePatch);
      });
    } else if (this.name === 'SHOWTIME_SEAT' && safePatch.status === 'BOOKED') {
      updated = await this.repository.patchWhere(
        this.name,
        id,
        safePatch,
        { status: { $ne: 'BOOKED' } },
      );
      if (!updated && await this.repository.findById(this.name, id)) {
        throw new ConflictError('Seat has already been booked');
      }
    } else {
      updated = await this.repository.patch(this.name, id, safePatch);
    }
    if (!updated) {
      throw new NotFoundError(`${this.name} with id "${id}" not found`);
    }
    return this.name === 'ACCOUNT' ? sanitizeAccount(updated) : updated;
  }

  /**
   * @param {string} id
   * @returns {Promise<object>}
   */
  async remove(id) {
    const deleted = await this.repository.delete(this.name, id);
    if (!deleted) {
      throw new NotFoundError(`${this.name} with id "${id}" not found`);
    }
    return this.name === 'ACCOUNT' ? sanitizeAccount(deleted) : deleted;
  }

  /** Run one showtime mutation at a time within this application process. */
  async runSerializedShowtimeWrite(operation) {
    const previous = this.showtimeWriteTail;
    let release;
    this.showtimeWriteTail = new Promise((resolve) => { release = resolve; });
    await previous;
    try {
      return await operation();
    } finally {
      release();
    }
  }

  /** Validate the time window and reject any overlap in the same room. */
  async validateShowtime(showtime, excludedId = undefined) {
    const start = Date.parse(showtime.startAt);
    const end = Date.parse(showtime.endAt);
    if (!showtime.roomId || !Number.isFinite(start) || !Number.isFinite(end) || start >= end) {
      throw new ValidationError('Showtime requires a room and a valid startAt/endAt range');
    }

    const roomShowtimes = await this.repository.findMany('SHOWTIME', { roomId: showtime.roomId });
    const conflict = roomShowtimes.find((existing) => {
      const existingId = existing.id ?? existing.showtimeId;
      if (excludedId && (existingId === excludedId || existing.showtimeId === excludedId)) return false;
      if (String(existing.status).toUpperCase() === 'CANCELLED') return false;
      const existingStart = Date.parse(existing.startAt);
      const existingEnd = Date.parse(existing.endAt);
      return Number.isFinite(existingStart) && Number.isFinite(existingEnd)
        && existingStart < end && existingEnd > start;
    });

    if (conflict) {
      throw new ConflictError(
        `Showtime conflicts with ${conflict.showtimeId ?? conflict.id} in room ${showtime.roomId}`,
        { conflictingShowtimeId: conflict.showtimeId ?? conflict.id },
      );
    }
  }
}

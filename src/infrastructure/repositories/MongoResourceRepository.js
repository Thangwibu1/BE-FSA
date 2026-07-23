import { ResourceRepository } from '../../domain/ports/ResourceRepository.js';
import { getCollectionDefinition } from '../../domain/collections.js';

/**
 * MongoDB implementation of the {@link ResourceRepository} port.
 *
 * Design notes / json-server compatibility:
 *  - The public documents expose a string `id` field (the client keys off it).
 *    We store that value BOTH as the Mongo `_id` and as a plain `id` field so
 *    lookups by `id` are index-backed and returned documents already carry it.
 *  - `_id` is always stripped from the returned payloads to keep responses
 *    identical to the legacy json-server output.
 *  - Operator filters ({gt,gte,lt,lte,ne}) map onto Mongo `$gt/$gte/...`.
 *  - `q` performs a case-insensitive "contains" across all string fields.
 */
export class MongoResourceRepository extends ResourceRepository {
  /** @param {import('mongodb').Db} db */
  constructor(db) {
    super();
    /** @private */
    this.db = db;
  }

  /** @private */
  collection(name) {
    return this.db.collection(name);
  }

  /** Remove Mongo internals from an outgoing document. @private */
  static clean(doc) {
    if (!doc) return doc;
    const { _id, ...rest } = doc;
    return rest;
  }

  /** Build a Mongo filter document from normalised ListQuery.filters. @private */
  static buildFilter(filters = {}, q, searchFields = []) {
    /** @type {Record<string, any>} */
    const mongoFilter = {};

    for (const [field, value] of Object.entries(filters)) {
      if (value && typeof value === 'object' && !Array.isArray(value)) {
        /** @type {Record<string, any>} */
        const ops = {};
        for (const [op, opValue] of Object.entries(value)) {
          ops[`$${op}`] = opValue;
        }
        mongoFilter[field] = ops;
      } else if (Array.isArray(value)) {
        // Repeated query key -> match any (json-server "in" behaviour).
        mongoFilter[field] = { $in: value };
      } else {
        mongoFilter[field] = value;
      }
    }

    if (q && searchFields.length > 0) {
      const safe = String(q).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      // Mongo regex also matches string elements inside arrays, which covers
      // fields such as actors, genres and favoriteGenres.
      mongoFilter.$or = searchFields.map((field) => ({
        [field]: { $regex: safe, $options: 'i' },
      }));
    }

    return mongoFilter;
  }

  /** Build a Mongo sort spec from ["field", "-other"]. @private */
  static buildSort(sort) {
    if (!sort || sort.length === 0) return undefined;
    /** @type {Record<string, 1 | -1>} */
    const spec = {};
    for (const field of sort) {
      if (field.startsWith('-')) spec[field.slice(1)] = -1;
      else spec[field] = 1;
    }
    return spec;
  }

  async list(collection, query = {}) {
    const { filters = {}, sort, start, limit, page, perPage, q } = query;
    const definition = getCollectionDefinition(collection);
    const mongoFilter = MongoResourceRepository.buildFilter(filters, q, definition?.searchFields);
    const col = this.collection(collection);

    const total = await col.countDocuments(mongoFilter);

    let cursor = col.find(mongoFilter, { projection: { _id: 0 } });

    const sortSpec = MongoResourceRepository.buildSort(sort);
    if (sortSpec) cursor = cursor.sort(sortSpec);

    let paginated = false;
    if (page !== undefined) {
      paginated = true;
      const size = perPage ?? 10;
      cursor = cursor.skip((page - 1) * size).limit(size);
    } else {
      if (start !== undefined) cursor = cursor.skip(start);
      if (limit !== undefined) cursor = cursor.limit(limit);
    }

    const data = await cursor.toArray();
    return { data, total, paginated };
  }

  async findById(collection, id) {
    const idField = getCollectionDefinition(collection)?.idField;
    const clauses = [{ _id: id }, { id }];
    if (idField) clauses.push({ [idField]: id });
    const doc = await this.collection(collection).findOne(
      { $or: clauses },
      { projection: { _id: 0 } },
    );
    return doc ?? null;
  }

  async findOne(collection, criteria) {
    const doc = await this.collection(collection).findOne(criteria, {
      projection: { _id: 0 },
    });
    return doc ?? null;
  }

  async findMany(collection, criteria = {}) {
    return this.collection(collection)
      .find(criteria, { projection: { _id: 0 } })
      .toArray();
  }

  async count(collection, criteria = {}) {
    return this.collection(collection).countDocuments(criteria);
  }

  async nextBusinessId(definition) {
    const counter = await this.db.collection('_counters').findOneAndUpdate(
      { _id: definition.name },
      { $inc: { seq: 1 }, $setOnInsert: { updatedAt: new Date() } },
      { upsert: true, returnDocument: 'after' },
    );
    return `${definition.idPrefix}${String(counter.seq).padStart(definition.idPad ?? 3, '0')}`;
  }

  async insert(collection, document) {
    // Use the public `id` as the primary key so lookups are index-backed.
    const toStore = { ...document, _id: document.id };
    await this.collection(collection).insertOne(toStore);
    await this.#advanceCounter(collection, document);
    return MongoResourceRepository.clean(toStore);
  }

  async replace(collection, id, document) {
    const existing = await this.#findStoredById(collection, id);
    if (!existing) return null;

    const definition = getCollectionDefinition(collection);
    const toStore = {
      ...document,
      id: existing.id ?? String(existing._id),
      _id: existing._id,
    };
    if (!toStore[definition?.idField]) {
      toStore[definition.idField] = existing[definition.idField] ?? id;
    }
    const result = await this.collection(collection).findOneAndReplace(
      { _id: existing._id },
      toStore,
      { returnDocument: 'after', projection: { _id: 0 } },
    );
    await this.#advanceCounter(collection, toStore);
    return result ?? null;
  }

  async patch(collection, id, patch) {
    // Never allow the immutable keys to be overwritten by a patch body.
    const definition = getCollectionDefinition(collection);
    const { _id, id: _ignore, [definition?.idField]: _businessId, ...safePatch } = patch ?? {};
    const existing = await this.#findStoredById(collection, id);
    if (!existing) return null;
    const result = await this.collection(collection).findOneAndUpdate(
      { _id: existing._id },
      { $set: safePatch },
      { returnDocument: 'after', projection: { _id: 0 } },
    );
    return result ?? null;
  }

  async patchWhere(collection, id, patch, criteria = {}) {
    const definition = getCollectionDefinition(collection);
    const { _id, id: _ignore, [definition?.idField]: _businessId, ...safePatch } = patch ?? {};
    const existing = await this.#findStoredById(collection, id);
    if (!existing) return null;
    const result = await this.collection(collection).findOneAndUpdate(
      { _id: existing._id, ...criteria },
      { $set: safePatch },
      { returnDocument: 'after', projection: { _id: 0 } },
    );
    return result ?? null;
  }

  async delete(collection, id) {
    const existing = await this.#findStoredById(collection, id);
    if (!existing) return null;
    const result = await this.collection(collection).findOneAndDelete(
      { _id: existing._id },
      { projection: { _id: 0 } },
    );
    return result ?? null;
  }

  async #findStoredById(collection, id) {
    const definition = getCollectionDefinition(collection);
    const clauses = [{ _id: id }, { id }];
    if (definition?.idField) clauses.push({ [definition.idField]: id });
    return this.collection(collection).findOne({ $or: clauses });
  }

  async #advanceCounter(collection, document) {
    const definition = getCollectionDefinition(collection);
    const value = definition && document?.[definition.idField];
    if (!definition?.idPrefix || typeof value !== 'string' || !value.startsWith(definition.idPrefix)) {
      return;
    }
    const sequence = Number.parseInt(value.slice(definition.idPrefix.length), 10);
    if (!Number.isFinite(sequence)) return;
    await this.db.collection('_counters').updateOne(
      { _id: collection },
      { $max: { seq: sequence }, $set: { updatedAt: new Date() } },
      { upsert: true },
    );
  }
}

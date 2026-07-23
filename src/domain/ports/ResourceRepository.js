/**
 * Port (interface) describing the persistence contract required by the
 * application layer. The application/use-cases depend on THIS abstraction,
 * never on MongoDB directly (Dependency Inversion Principle).
 *
 * Any adapter (MongoDB, in-memory, SQL, ...) may implement it. Methods that
 * are not overridden throw, making an incomplete adapter fail loudly.
 *
 * @typedef {Object} ListQuery
 * @property {Record<string, any>} [filters] equality / operator filters
 * @property {string[]} [sort] fields to sort by (prefix "-" for descending)
 * @property {number} [start] offset (json-server _start)
 * @property {number} [limit] max rows
 * @property {number} [page] 1-based page number (json-server _page)
 * @property {number} [perPage] page size (json-server _per_page)
 * @property {string} [q] full-text search term
 *
 * @typedef {Object} ListResult
 * @property {object[]} data
 * @property {number} total total matching rows (before pagination)
 * @property {boolean} paginated whether pagination params were supplied
 */
export class ResourceRepository {
  /**
   * @param {string} _collection
   * @param {ListQuery} _query
   * @returns {Promise<ListResult>}
   */
  async list(_collection, _query) {
    throw new Error('ResourceRepository.list not implemented');
  }

  /**
   * @param {string} _collection
   * @param {string} _id
   * @returns {Promise<object|null>}
   */
  async findById(_collection, _id) {
    throw new Error('ResourceRepository.findById not implemented');
  }

  /**
   * @param {string} _collection
   * @param {Record<string, any>} _criteria
   * @returns {Promise<object|null>}
   */
  async findOne(_collection, _criteria) {
    throw new Error('ResourceRepository.findOne not implemented');
  }

  /**
   * @param {string} _collection
   * @param {Record<string, any>} [_criteria]
   * @returns {Promise<object[]>}
   */
  async findMany(_collection, _criteria) {
    throw new Error('ResourceRepository.findMany not implemented');
  }

  /**
   * @param {string} _collection
   * @param {Record<string, any>} [_criteria]
   * @returns {Promise<number>}
   */
  async count(_collection, _criteria = {}) {
    throw new Error('ResourceRepository.count not implemented');
  }

  /**
   * Atomically reserve the next business id for a collection.
   * @param {import('../collections.js').CollectionDefinition} _definition
   * @returns {Promise<string>}
   */
  async nextBusinessId(_definition) {
    throw new Error('ResourceRepository.nextBusinessId not implemented');
  }

  /**
   * @param {string} _collection
   * @param {object} _document
   * @returns {Promise<object>}
   */
  async insert(_collection, _document) {
    throw new Error('ResourceRepository.insert not implemented');
  }

  /**
   * @param {string} _collection
   * @param {string} _id
   * @param {object} _document
   * @returns {Promise<object|null>}
   */
  async replace(_collection, _id, _document) {
    throw new Error('ResourceRepository.replace not implemented');
  }

  /**
   * @param {string} _collection
   * @param {string} _id
   * @param {Record<string, any>} _patch
   * @returns {Promise<object|null>}
   */
  async patch(_collection, _id, _patch) {
    throw new Error('ResourceRepository.patch not implemented');
  }

  /**
   * Patch only when the persisted document also matches `criteria`.
   * @param {string} _collection
   * @param {string} _id
   * @param {Record<string, any>} _patch
   * @param {Record<string, any>} _criteria
   * @returns {Promise<object|null>}
   */
  async patchWhere(_collection, _id, _patch, _criteria) {
    throw new Error('ResourceRepository.patchWhere not implemented');
  }

  /**
   * @param {string} _collection
   * @param {string} _id
   * @returns {Promise<object|null>}
   */
  async delete(_collection, _id) {
    throw new Error('ResourceRepository.delete not implemented');
  }
}

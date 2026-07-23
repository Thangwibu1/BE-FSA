import { ResourceRepository } from '../../src/domain/ports/ResourceRepository.js';
import { getCollectionDefinition } from '../../src/domain/collections.js';

function clone(value) {
  return structuredClone(value);
}

function matchesValue(actual, expected) {
  if (expected && typeof expected === 'object' && !Array.isArray(expected)) {
    if ('$regex' in expected) {
      return new RegExp(expected.$regex, expected.$options ?? '').test(String(actual ?? ''));
    }
    return Object.entries(expected).every(([operator, value]) => {
      if (operator === '$gt' || operator === 'gt') return actual > value;
      if (operator === '$gte' || operator === 'gte') return actual >= value;
      if (operator === '$lt' || operator === 'lt') return actual < value;
      if (operator === '$lte' || operator === 'lte') return actual <= value;
      if (operator === '$ne' || operator === 'ne') return actual !== value;
      if (operator === '$in') return value.includes(actual);
      return false;
    });
  }
  if (Array.isArray(expected)) return expected.includes(actual);
  return actual === expected;
}

function matchesCriteria(document, criteria = {}) {
  if (criteria.$or) return criteria.$or.some((item) => matchesCriteria(document, item));
  return Object.entries(criteria).every(([field, expected]) => matchesValue(document[field], expected));
}

export class InMemoryResourceRepository extends ResourceRepository {
  constructor(seed = {}) {
    super();
    this.data = new Map(
      Object.entries(seed)
        .filter(([, value]) => Array.isArray(value))
        .map(([name, rows]) => [name, clone(rows)]),
    );
    this.counters = new Map();
  }

  collection(name) {
    if (!this.data.has(name)) this.data.set(name, []);
    return this.data.get(name);
  }

  async list(collection, query = {}) {
    let rows = this.collection(collection).filter((row) => {
      if (!matchesCriteria(row, query.filters)) return false;
      if (!query.q) return true;
      return JSON.stringify(row).toLowerCase().includes(String(query.q).toLowerCase());
    });
    const total = rows.length;
    if (query.sort) {
      rows = [...rows].sort((left, right) => {
        for (const item of query.sort) {
          const descending = item.startsWith('-');
          const field = descending ? item.slice(1) : item;
          const result = String(left[field] ?? '').localeCompare(
            String(right[field] ?? ''), undefined, { numeric: true },
          );
          if (result !== 0) return descending ? -result : result;
        }
        return 0;
      });
    }
    let paginated = false;
    if (query.page !== undefined) {
      paginated = true;
      const size = query.perPage ?? 10;
      rows = rows.slice((query.page - 1) * size, query.page * size);
    } else {
      const start = query.start ?? 0;
      const end = query.limit === undefined ? undefined : start + query.limit;
      rows = rows.slice(start, end);
    }
    return { data: clone(rows), total, paginated };
  }

  async findById(collection, id) {
    const definition = getCollectionDefinition(collection);
    const row = this.collection(collection).find(
      (item) => item.id === id || item[definition.idField] === id,
    );
    return row ? clone(row) : null;
  }

  async findOne(collection, criteria) {
    const row = this.collection(collection).find((item) => matchesCriteria(item, criteria));
    return row ? clone(row) : null;
  }

  async findMany(collection, criteria = {}) {
    return clone(this.collection(collection).filter((item) => matchesCriteria(item, criteria)));
  }

  async count(collection, criteria = {}) {
    return this.collection(collection).filter((item) => matchesCriteria(item, criteria)).length;
  }

  async nextBusinessId(definition) {
    if (!this.counters.has(definition.name)) {
      let max = 0;
      for (const row of this.collection(definition.name)) {
        const value = row[definition.idField];
        if (typeof value !== 'string' || !value.startsWith(definition.idPrefix)) continue;
        const sequence = Number.parseInt(value.slice(definition.idPrefix.length), 10);
        if (Number.isFinite(sequence)) max = Math.max(max, sequence);
      }
      this.counters.set(definition.name, max);
    }
    const sequence = this.counters.get(definition.name) + 1;
    this.counters.set(definition.name, sequence);
    return `${definition.idPrefix}${String(sequence).padStart(definition.idPad ?? 3, '0')}`;
  }

  async insert(collection, document) {
    const definition = getCollectionDefinition(collection);
    const duplicate = this.collection(collection).some(
      (item) => item.id === document.id || item[definition.idField] === document[definition.idField],
    );
    if (duplicate) {
      const error = new Error('duplicate key');
      error.code = 11000;
      throw error;
    }
    this.collection(collection).push(clone(document));
    return clone(document);
  }

  async replace(collection, id, document) {
    const definition = getCollectionDefinition(collection);
    const index = this.collection(collection).findIndex(
      (item) => item.id === id || item[definition.idField] === id,
    );
    if (index < 0) return null;
    const existing = this.collection(collection)[index];
    const replacement = {
      ...clone(document),
      id: existing.id,
      [definition.idField]: document[definition.idField] || existing[definition.idField],
    };
    this.collection(collection)[index] = replacement;
    return clone(replacement);
  }

  async patch(collection, id, patch) {
    const definition = getCollectionDefinition(collection);
    const index = this.collection(collection).findIndex(
      (item) => item.id === id || item[definition.idField] === id,
    );
    if (index < 0) return null;
    const { id: _id, [definition.idField]: _businessId, ...safePatch } = clone(patch);
    this.collection(collection)[index] = { ...this.collection(collection)[index], ...safePatch };
    return clone(this.collection(collection)[index]);
  }

  async patchWhere(collection, id, patch, criteria = {}) {
    const existing = await this.findById(collection, id);
    if (!existing || !matchesCriteria(existing, criteria)) return null;
    return this.patch(collection, id, patch);
  }

  async delete(collection, id) {
    const definition = getCollectionDefinition(collection);
    const index = this.collection(collection).findIndex(
      (item) => item.id === id || item[definition.idField] === id,
    );
    if (index < 0) return null;
    return clone(this.collection(collection).splice(index, 1)[0]);
  }
}

/**
 * Translate a raw HTTP query object (json-server dialect) into a normalised
 * {@link import('../domain/ports/ResourceRepository.js').ListQuery}.
 *
 * Supported json-server features:
 *   - Equality filters:      ?role=ADMIN&status=ACTIVE
 *   - Operator filters:      ?points_gte=100&points_lte=500&status_ne=INACTIVE
 *                            (operators: _gt, _gte, _lt, _lte, _ne)
 *   - Sorting:               ?_sort=points,-createdAt   (prefix "-" = desc)
 *   - Slice pagination:      ?_start=0&_end=20  |  ?_start=0&_limit=20
 *   - Page pagination:       ?_page=2&_per_page=10
 *   - Full-text search:      ?q=nolan
 *
 * Reserved keys (all prefixed with "_", plus "q") never become filters.
 */

const OPERATOR_SUFFIXES = ['_gte', '_lte', '_gt', '_lt', '_ne'];
const RESERVED = new Set([
  '_sort',
  '_order',
  '_start',
  '_end',
  '_limit',
  '_page',
  '_per_page',
  'q',
]);

/** Coerce string query values into number / boolean / null where sensible. */
function coerce(value) {
  if (Array.isArray(value)) return value.map(coerce);
  if (typeof value !== 'string') return value;
  if (value === 'true') return true;
  if (value === 'false') return false;
  if (value === 'null') return null;
  // Preserve numeric-looking identifiers such as phone numbers and zero-padded
  // seat numbers. Only canonical numeric strings are coerced.
  if (value !== '' && !Number.isNaN(Number(value)) && String(Number(value)) === value) {
    return Number(value);
  }
  return value;
}

/**
 * @param {Record<string, any>} raw
 * @returns {import('../domain/ports/ResourceRepository.js').ListQuery}
 */
export function parseListQuery(raw = {}) {
  /** @type {Record<string, any>} */
  const filters = {};

  for (const [key, rawValue] of Object.entries(raw)) {
    if (RESERVED.has(key)) continue;

    const suffix = OPERATOR_SUFFIXES.find((op) => key.endsWith(op));
    if (suffix) {
      const field = key.slice(0, -suffix.length);
      const op = suffix.slice(1); // drop leading "_"
      filters[field] = { ...(filters[field] ?? {}), [op]: coerce(rawValue) };
    } else {
      filters[key] = coerce(rawValue);
    }
  }

  /** @type {import('../domain/ports/ResourceRepository.js').ListQuery} */
  const query = { filters };

  // --- Sorting ---
  if (raw._sort) {
    const fields = String(raw._sort)
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    // Legacy json-server v0: _sort=field&_order=desc
    if (raw._order && fields.length === 1) {
      const desc = String(raw._order).toLowerCase() === 'desc';
      query.sort = [desc ? `-${fields[0]}` : fields[0]];
    } else {
      query.sort = fields;
    }
  }

  // --- Pagination (page based) ---
  if (raw._page !== undefined) {
    query.page = Math.max(1, Number.parseInt(raw._page, 10) || 1);
    query.perPage = Math.max(1, Number.parseInt(raw._per_page ?? '10', 10) || 10);
  }

  // --- Pagination (slice based) ---
  if (raw._start !== undefined) {
    query.start = Math.max(0, Number.parseInt(raw._start, 10) || 0);
  }
  if (raw._end !== undefined) {
    const end = Number.parseInt(raw._end, 10);
    if (!Number.isNaN(end)) query.limit = Math.max(0, end - (query.start ?? 0));
  } else if (raw._limit !== undefined) {
    const limit = Number.parseInt(raw._limit, 10);
    if (!Number.isNaN(limit)) query.limit = Math.max(0, limit);
  }

  // --- Full-text ---
  if (raw.q !== undefined && String(raw.q).length > 0) {
    query.q = String(raw.q);
  }

  return query;
}

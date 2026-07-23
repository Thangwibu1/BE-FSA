const nullableString = { type: 'string', nullable: true };
const nullableNumber = { type: 'number', nullable: true };
const stringArray = { type: 'array', items: { type: 'string' } };

function resource(properties, required = []) {
  return {
    properties: {
      id: { type: 'string', description: 'Public json-server compatible id' },
      ...properties,
    },
    required,
  };
}

/**
 * Request/OpenAPI schemas for the complete MovieTheaterServer data contract.
 * Business ids are optional on create because the Fastify service can allocate
 * them safely; every other required field mirrors the legacy Swagger input.
 */
export const RESOURCE_SCHEMAS = {
  ACCOUNT: resource({
    accountId: { type: 'string' },
    username: { type: 'string', minLength: 1 },
    passwordHash: { type: 'string', minLength: 1 },
    fullName: { type: 'string', minLength: 1 },
    email: { type: 'string', minLength: 3 },
    phoneNumber: { type: 'string', minLength: 1 },
    dateOfBirth: nullableString,
    gender: nullableString,
    identityCard: nullableString,
    address: nullableString,
    avatarUrl: nullableString,
    role: { type: 'string' },
    status: { type: 'string' },
    createdAt: nullableString,
    updatedAt: nullableString,
    lastLoginAt: nullableString,
  }, ['username', 'passwordHash', 'fullName', 'email', 'phoneNumber', 'role', 'status']),

  MEMBER_PROFILE: resource({
    memberId: { type: 'string' },
    accountId: { type: 'string' },
    points: { type: 'integer', minimum: 0 },
    tier: { type: 'string' },
    favoriteGenres: stringArray,
    joinedAt: nullableString,
  }, ['accountId', 'points', 'tier']),

  CINEMA_ROOM: resource({
    roomId: { type: 'string' },
    roomName: { type: 'string', minLength: 1 },
    screenType: { type: 'string' },
    capacity: { type: 'integer', minimum: 0 },
    status: { type: 'string' },
  }, ['roomName', 'screenType', 'capacity', 'status']),

  SEAT: resource({
    seatId: { type: 'string' },
    roomId: { type: 'string' },
    seatRow: { type: 'string', minLength: 1 },
    seatNumber: { type: 'integer', minimum: 1 },
    seatType: { type: 'string' },
    status: { type: 'string' },
  }, ['roomId', 'seatRow', 'seatNumber', 'seatType', 'status']),

  MOVIE: resource({
    movieId: { type: 'string' },
    title: { type: 'string', minLength: 1 },
    originalTitle: nullableString,
    description: nullableString,
    durationMin: { type: 'integer', minimum: 1 },
    director: nullableString,
    actors: stringArray,
    genres: stringArray,
    productionCompany: nullableString,
    releaseDate: { type: 'string' },
    fromDate: nullableString,
    toDate: nullableString,
    version: nullableString,
    language: nullableString,
    subtitle: nullableString,
    ageRating: nullableString,
    posterUrl: nullableString,
    bannerUrl: nullableString,
    trailerUrl: nullableString,
    status: { type: 'string' },
  }, ['title', 'durationMin', 'releaseDate', 'status']),

  SHOWTIME: resource({
    showtimeId: { type: 'string' },
    movieId: { type: 'string' },
    roomId: { type: 'string' },
    startAt: { type: 'string' },
    endAt: { type: 'string' },
    basePrice: { type: 'number', minimum: 0 },
    format: nullableString,
    status: { type: 'string' },
  }, ['movieId', 'roomId', 'startAt', 'endAt', 'basePrice', 'status']),

  SHOWTIME_SEAT: resource({
    showtimeSeatId: { type: 'string' },
    showtimeId: { type: 'string' },
    seatId: { type: 'string' },
    seatType: { type: 'string' },
    status: { type: 'string' },
    price: { type: 'number', minimum: 0 },
  }, ['showtimeId', 'seatId', 'seatType', 'status', 'price']),

  PROMOTION: resource({
    promotionId: { type: 'string' },
    code: { type: 'string', minLength: 1 },
    title: { type: 'string', minLength: 1 },
    description: nullableString,
    discountType: { type: 'string' },
    discountValue: { type: 'number', minimum: 0 },
    maxDiscountAmount: nullableNumber,
    minOrderAmount: nullableNumber,
    startAt: nullableString,
    endAt: nullableString,
    status: { type: 'string' },
    imageUrl: nullableString,
    applicableSources: { type: 'array', items: { type: 'string' } },
    applicableFormats: { type: 'array', items: { type: 'string' } },
    applicableDaysOfWeek: { type: 'array', items: { type: 'string' } },
    minTickets: { type: 'integer', minimum: 1 },
    maxTickets: { type: 'integer', minimum: 1 },
    memberOnly: { type: 'boolean' },
    firstBookingOnly: { type: 'boolean' },
    usageLimit: { type: 'integer', minimum: 1 },
    perMemberLimit: { type: 'integer', minimum: 1 },
    startHour: { type: 'integer', minimum: 0, maximum: 23 },
    endHour: { type: 'integer', minimum: 1, maximum: 24 },
    minimumAdvanceHours: { type: 'integer', minimum: 0 },
  }, ['code', 'title', 'discountType', 'discountValue', 'status']),

  BOOKING: resource({
    bookingId: { type: 'string' },
    bookingCode: { type: 'string' },
    accountId: nullableString,
    showtimeId: { type: 'string' },
    promotionId: nullableString,
    bookedByEmployeeId: nullableString,
    subtotalAmount: { type: 'number', minimum: 0 },
    discountAmount: { type: 'number', minimum: 0 },
    pointsUsed: { type: 'integer', minimum: 0 },
    pointsEarned: { type: 'integer', minimum: 0 },
    totalAmount: { type: 'number', minimum: 0 },
    paymentMethod: nullableString,
    paymentStatus: nullableString,
    bookingStatus: { type: 'string' },
    bookingSource: nullableString,
    customerType: nullableString,
    convertedTicketQuantity: { type: 'integer', minimum: 0, maximum: 8 },
    pointsPerTicket: { type: 'integer', minimum: 0 },
    confirmedAt: nullableString,
    confirmedByEmployeeId: nullableString,
    cancelledAt: nullableString,
    cancelReason: nullableString,
    createdAt: nullableString,
    updatedAt: nullableString,
  }, ['showtimeId', 'totalAmount', 'bookingStatus']),

  BOOKING_SEAT: resource({
    bookingSeatId: { type: 'string' },
    bookingId: { type: 'string' },
    showtimeSeatId: { type: 'string' },
    price: { type: 'number', minimum: 0 },
  }, ['bookingId', 'showtimeSeatId', 'price']),

  TICKET: resource({
    ticketId: { type: 'string' },
    bookingId: { type: 'string' },
    bookingSeatId: { type: 'string' },
    ticketCode: { type: 'string', minLength: 1 },
    issuedAt: { type: 'string' },
    isUsed: { type: 'boolean' },
    usedAt: nullableString,
    checkedInByEmployeeId: nullableString,
  }, ['bookingId', 'bookingSeatId', 'ticketCode', 'issuedAt', 'isUsed']),

  POINT_HISTORY: resource({
    pointHistoryId: { type: 'string' },
    accountId: { type: 'string' },
    bookingId: nullableString,
    movieId: nullableString,
    transactionType: { type: 'string' },
    points: { type: 'integer', minimum: 0 },
    createdAt: { type: 'string' },
    description: nullableString,
  }, ['accountId', 'transactionType', 'points', 'createdAt']),
};

const RESOURCE_DESCRIPTIONS = {
  ACCOUNT: 'Movie theater user account. Read responses never contain password or passwordHash.',
  MEMBER_PROFILE: 'Member loyalty profile linked one-to-one to an account.',
  CINEMA_ROOM: 'Physical auditorium and screen configuration.',
  SEAT: 'Physical seat definition within a cinema room.',
  MOVIE: 'Movie catalog entry and its presentation metadata.',
  SHOWTIME: 'Scheduled movie session in one room. Time intervals in the same room cannot overlap.',
  SHOWTIME_SEAT: 'Bookable seat and authoritative price for a specific showtime.',
  PROMOTION: 'Voucher configuration and all server-enforced eligibility conditions.',
  BOOKING: 'Confirmed or managed sale record.',
  BOOKING_SEAT: 'Join record between a booking and a selected showtime seat.',
  TICKET: 'Issued admission ticket and its check-in state.',
  POINT_HISTORY: 'Immutable audit record for loyalty points earned or used.',
};

const FIELD_DESCRIPTIONS = {
  id: 'Public json-server compatible id. Usually matches the business id for server-created records.',
  accountId: 'Account business id.', memberId: 'Member profile business id.', roomId: 'Cinema room business id.',
  seatId: 'Physical seat business id.', movieId: 'Movie business id.', showtimeId: 'Showtime business id.',
  showtimeSeatId: 'Showtime-seat business id.', promotionId: 'Promotion business id.', bookingId: 'Booking business id.',
  bookingSeatId: 'Booking-seat business id.', ticketId: 'Ticket business id.', pointHistoryId: 'Point-history business id.',
  passwordHash: 'Password supplied for an administrator-created account. The server hashes clear input and never returns this field.',
  startAt: 'Inclusive ISO 8601 start date/time.', endAt: 'Inclusive ISO 8601 expiry/end date/time.',
  createdAt: 'ISO 8601 creation timestamp.', updatedAt: 'ISO 8601 last-update timestamp.',
  releaseDate: 'Movie release date in YYYY-MM-DD form.', fromDate: 'First date the movie is shown.', toDate: 'Last date the movie is shown.',
  status: 'Current lifecycle/availability status.', role: 'Authorization role: MEMBER, EMPLOYEE, or ADMIN.',
  code: 'Unique voucher code; booking matching is case-insensitive.', discountType: 'Discount calculation: PERCENT or FIXED_AMOUNT.',
  discountValue: 'Percentage or VND amount determined by discountType.', maxDiscountAmount: 'Maximum VND discount; null means uncapped.',
  minOrderAmount: 'Minimum payable subtotal in VND before this voucher applies.',
  applicableSources: 'Allowed booking sources such as ONLINE or COUNTER. Empty means all sources.',
  applicableFormats: 'Allowed show formats such as 2D, 3D, or IMAX. Empty means all formats.',
  applicableDaysOfWeek: 'Allowed English weekday names. Empty means every day.',
  memberOnly: 'Whether a member account is required.', firstBookingOnly: 'Whether the voucher is limited to the member first paid booking.',
  usageLimit: 'Maximum successful uses across all customers.', perMemberLimit: 'Maximum successful uses by one member.',
  minimumAdvanceHours: 'Minimum hours between booking time and showtime start.',
  basePrice: 'Base ticket price in VND.', price: 'Authoritative seat/line price in VND.',
  points: 'Loyalty point amount or current balance.', pointsUsed: 'Points spent by this booking.', pointsEarned: 'Points earned from this booking.',
  subtotalAmount: 'Total before discounts in VND.', discountAmount: 'Total applied discount in VND.', totalAmount: 'Final payable amount in VND.',
  convertedTicketQuantity: 'Number of tickets converted using loyalty points.', pointsPerTicket: 'Points required for one converted ticket.',
  isUsed: 'Whether the ticket has already been checked in.', usedAt: 'ISO 8601 check-in timestamp, or null before use.',
};

const FIELD_EXAMPLES = {
  id: 'mov_001', accountId: 'acc_006', memberId: 'mem_prof_006', roomId: 'room_001', seatId: 'seat_0001',
  movieId: 'mov_001', showtimeId: 'show_001', showtimeSeatId: 'sh_st_00001', promotionId: 'promo_001',
  bookingId: 'BK-8271', bookingSeatId: 'bk_st_00001', ticketId: 'tk_00001', pointHistoryId: 'point_001',
  username: 'mem_anhtu', fullName: 'Nguyen Anh Tu', email: 'anhtu@example.com', phoneNumber: '0901234567',
  roomName: 'Cinema 1', seatRow: 'A', seatNumber: 1, title: 'Interstellar', durationMin: 169,
  releaseDate: '2014-11-07', startAt: '2026-07-16T12:00:00.000Z', endAt: '2026-07-16T14:49:00.000Z',
  basePrice: 90000, price: 90000, code: 'WELCOME20', discountType: 'PERCENT', discountValue: 20,
  subtotalAmount: 180000, discountAmount: 36000, totalAmount: 144000, ticketCode: 'QR-BK-8271-1',
  createdAt: '2026-07-16T08:00:00.000Z', updatedAt: '2026-07-16T08:00:00.000Z',
};

for (const [resourceName, definition] of Object.entries(RESOURCE_SCHEMAS)) {
  definition.description = RESOURCE_DESCRIPTIONS[resourceName];
  for (const [field, schema] of Object.entries(definition.properties)) {
    const label = field.replace(/([a-z])([A-Z])/g, '$1 $2').replaceAll('_', ' ').toLowerCase();
    definition.properties[field] = {
      ...schema,
      description: FIELD_DESCRIPTIONS[field] ?? `${label[0].toUpperCase()}${label.slice(1)}.`,
      ...(FIELD_EXAMPLES[field] !== undefined ? { example: FIELD_EXAMPLES[field] } : {}),
    };
  }
}

export function createBodySchema(definition) {
  return {
    description: `Fields used to create or replace this resource. ${definition?.description ?? ''}`.trim(),
    type: 'object',
    additionalProperties: true,
    properties: definition?.properties ?? {},
    required: definition?.required ?? [],
  };
}

export function patchBodySchema(definition) {
  return {
    description: `Any writable subset of this resource. ${definition?.description ?? ''}`.trim(),
    type: 'object',
    additionalProperties: true,
    properties: definition?.properties ?? {},
  };
}

export function documentSchema(definition, options = {}) {
  const omitted = new Set(options.omit ?? []);
  const properties = Object.fromEntries(
    Object.entries(definition?.properties ?? {}).filter(([name]) => !omitted.has(name)),
  );
  return {
    ...((options.description ?? definition?.description) ? { description: options.description ?? definition.description } : {}),
    type: 'object',
    additionalProperties: true,
    properties,
  };
}

export function listQuerySchema() {
  return {
    type: 'object',
    additionalProperties: true,
    properties: {
      q: { type: 'string', description: 'Case-insensitive search across resource text fields' },
      _sort: { type: 'string', description: 'Comma-separated fields. Prefix a field with `-` for descending order.', example: '-createdAt,title' },
      _order: { type: 'string', enum: ['asc', 'desc'], description: 'Legacy sort direction used with `_sort`', example: 'asc' },
      _start: { type: 'integer', minimum: 0, description: 'Zero-based slice start index', example: 0 },
      _end: { type: 'integer', minimum: 0, description: 'Exclusive slice end index', example: 20 },
      _limit: { type: 'integer', minimum: 0, description: 'Maximum number of returned records', example: 20 },
      _page: { type: 'integer', minimum: 1, description: 'One-based page number. Enables the metadata response envelope.', example: 1 },
      _per_page: { type: 'integer', minimum: 1, description: 'Page size used together with `_page`', example: 10 },
    },
  };
}

export function listResponseSchema(definition, options = {}) {
  const item = documentSchema(definition, options);
  const nullablePage = { type: 'integer', nullable: true };
  return {
    description: 'Either an array (default) or a page metadata envelope when `_page` is supplied.',
    oneOf: [
      { type: 'array', items: item },
      {
        type: 'object',
        required: ['first', 'prev', 'next', 'last', 'pages', 'items', 'data'],
        properties: {
          first: { type: 'integer' },
          prev: nullablePage,
          next: nullablePage,
          last: { type: 'integer' },
          pages: { type: 'integer' },
          items: { type: 'integer' },
          data: { type: 'array', items: item },
        },
      },
    ],
  };
}

export const idParamsSchema = {
  type: 'object',
  required: ['id'],
  properties: {
    id: {
      type: 'string', minLength: 1,
      description: 'Public `id` or the resource business id (for example `movieId`, `bookingId`, or `ticketId`)',
      example: 'movie_001',
    },
  },
};

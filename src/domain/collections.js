/**
 * Domain registry of every persisted collection.
 *
 * This is the single source of truth that drives the otherwise generic CRUD
 * machinery. Adding a new resource is as simple as adding an entry here
 * (Open/Closed Principle: extend without modifying use-cases or controllers).
 *
 * @typedef {Object} CollectionDefinition
 * @property {string} name        Public REST resource name (matches json-server & client).
 * @property {string} idField     Business/natural id field carried inside each document.
 * @property {string} [idPrefix]  Prefix used when auto-generating sequential business ids.
 * @property {number} [idPad]     Zero-padding width for sequential business ids.
 * @property {string[]} [searchFields] Fields included in the json-server `q` search.
 */

/** @type {Record<string, CollectionDefinition>} */
export const COLLECTIONS = {
  ACCOUNT: {
    name: 'ACCOUNT', idField: 'accountId', idPrefix: 'acc_', idPad: 3,
    searchFields: ['accountId', 'username', 'fullName', 'email', 'phoneNumber', 'identityCard', 'address', 'role', 'status'],
  },
  MEMBER_PROFILE: {
    name: 'MEMBER_PROFILE',
    idField: 'memberId',
    idPrefix: 'mem_prof_',
    idPad: 3,
    searchFields: ['memberId', 'accountId', 'tier', 'favoriteGenres'],
  },
  CINEMA_ROOM: {
    name: 'CINEMA_ROOM', idField: 'roomId', idPrefix: 'room_', idPad: 3,
    searchFields: ['roomId', 'roomName', 'screenType', 'status'],
  },
  SEAT: {
    name: 'SEAT', idField: 'seatId', idPrefix: 'seat_', idPad: 4,
    searchFields: ['seatId', 'roomId', 'seatRow', 'seatType', 'status'],
  },
  MOVIE: {
    name: 'MOVIE', idField: 'movieId', idPrefix: 'mov_', idPad: 3,
    searchFields: [
      'movieId', 'title', 'originalTitle', 'description', 'director', 'actors',
      'genres', 'productionCompany', 'language', 'subtitle', 'ageRating', 'status',
    ],
  },
  SHOWTIME: {
    name: 'SHOWTIME', idField: 'showtimeId', idPrefix: 'show_', idPad: 3,
    searchFields: ['showtimeId', 'movieId', 'roomId', 'startAt', 'format', 'status'],
  },
  SHOWTIME_SEAT: {
    name: 'SHOWTIME_SEAT',
    idField: 'showtimeSeatId',
    idPrefix: 'sh_st_',
    idPad: 5,
    searchFields: ['showtimeSeatId', 'showtimeId', 'seatId', 'seatType', 'status'],
  },
  PROMOTION: {
    name: 'PROMOTION', idField: 'promotionId', idPrefix: 'promo_', idPad: 3,
    searchFields: ['promotionId', 'code', 'title', 'description', 'discountType', 'status'],
  },
  BOOKING: {
    name: 'BOOKING', idField: 'bookingId', idPrefix: 'BK-', idPad: 4,
    searchFields: ['bookingId', 'bookingCode', 'accountId', 'showtimeId', 'paymentMethod', 'paymentStatus', 'bookingStatus'],
  },
  BOOKING_SEAT: {
    name: 'BOOKING_SEAT', idField: 'bookingSeatId', idPrefix: 'bk_st_', idPad: 5,
    searchFields: ['bookingSeatId', 'bookingId', 'showtimeSeatId'],
  },
  TICKET: {
    name: 'TICKET', idField: 'ticketId', idPrefix: 'tk_', idPad: 5,
    searchFields: ['ticketId', 'bookingId', 'bookingSeatId', 'ticketCode', 'checkedInByEmployeeId'],
  },
  POINT_HISTORY: {
    name: 'POINT_HISTORY',
    idField: 'pointHistoryId',
    idPrefix: 'point_',
    idPad: 3,
    searchFields: ['pointHistoryId', 'accountId', 'bookingId', 'movieId', 'transactionType', 'description'],
  },
};

/** Ordered list of collection names (matches db.json layout). */
export const COLLECTION_NAMES = Object.keys(COLLECTIONS);

/**
 * @param {string} name
 * @returns {CollectionDefinition | undefined}
 */
export function getCollectionDefinition(name) {
  return COLLECTIONS[name];
}

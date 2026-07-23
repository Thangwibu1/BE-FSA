import { COLLECTIONS } from '../../../domain/collections.js';

const duplicateSafeString = (field) => ({
  unique: true,
  partialFilterExpression: { [field]: { $type: 'string' } },
});

const RESOURCE_INDEXES = {
  ACCOUNT: [
    [{ username: 1 }, { ...duplicateSafeString('username'), name: 'uq_account_username', collation: { locale: 'en', strength: 2 } }],
    [{ email: 1 }, { ...duplicateSafeString('email'), name: 'uq_account_email', collation: { locale: 'en', strength: 2 } }],
    [{ phoneNumber: 1 }, { ...duplicateSafeString('phoneNumber'), name: 'uq_account_phone' }],
    [{ identityCard: 1 }, { ...duplicateSafeString('identityCard'), name: 'uq_account_identity_card' }],
    [{ role: 1, status: 1 }, { name: 'ix_account_role_status' }],
  ],
  MEMBER_PROFILE: [
    [{ accountId: 1 }, { ...duplicateSafeString('accountId'), name: 'uq_member_profile_account' }],
    [{ tier: 1, points: -1 }, { name: 'ix_member_profile_tier_points' }],
  ],
  CINEMA_ROOM: [
    [{ roomName: 1 }, { ...duplicateSafeString('roomName'), name: 'uq_cinema_room_name' }],
    [{ status: 1 }, { name: 'ix_cinema_room_status' }],
  ],
  SEAT: [
    [{ roomId: 1, seatRow: 1, seatNumber: 1 }, { unique: true, name: 'uq_seat_room_position' }],
    [{ roomId: 1, status: 1 }, { name: 'ix_seat_room_status' }],
  ],
  MOVIE: [
    [{ status: 1, releaseDate: -1 }, { name: 'ix_movie_status_release_date' }],
    [{ title: 'text', originalTitle: 'text', director: 'text', actors: 'text', genres: 'text' }, { name: 'tx_movie_search', default_language: 'none' }],
  ],
  SHOWTIME: [
    [{ movieId: 1, startAt: 1 }, { name: 'ix_showtime_movie_start' }],
    [{ roomId: 1, startAt: 1, endAt: 1 }, { name: 'ix_showtime_room_time' }],
    [{ status: 1, startAt: 1 }, { name: 'ix_showtime_status_start' }],
  ],
  SHOWTIME_SEAT: [
    [{ showtimeId: 1, seatId: 1 }, { unique: true, name: 'uq_showtime_seat' }],
    [{ showtimeId: 1, status: 1 }, { name: 'ix_showtime_seat_status' }],
  ],
  PROMOTION: [
    [{ code: 1 }, { ...duplicateSafeString('code'), name: 'uq_promotion_code', collation: { locale: 'en', strength: 2 } }],
    [{ status: 1, startAt: 1, endAt: 1 }, { name: 'ix_promotion_active_window' }],
  ],
  BOOKING: [
    [{ bookingCode: 1 }, { ...duplicateSafeString('bookingCode'), name: 'uq_booking_code' }],
    [{ accountId: 1, createdAt: -1 }, { name: 'ix_booking_account_created' }],
    [{ showtimeId: 1, bookingStatus: 1 }, { name: 'ix_booking_showtime_status' }],
  ],
  BOOKING_SEAT: [
    [{ bookingId: 1, showtimeSeatId: 1 }, { unique: true, name: 'uq_booking_showtime_seat' }],
    [{ bookingId: 1 }, { name: 'ix_booking_seat_booking' }],
  ],
  TICKET: [
    [{ ticketCode: 1 }, { ...duplicateSafeString('ticketCode'), name: 'uq_ticket_code' }],
    [{ bookingSeatId: 1 }, { ...duplicateSafeString('bookingSeatId'), name: 'uq_ticket_booking_seat' }],
    [{ bookingId: 1 }, { name: 'ix_ticket_booking' }],
    [{ isUsed: 1, issuedAt: -1 }, { name: 'ix_ticket_usage' }],
  ],
  POINT_HISTORY: [
    [{ accountId: 1, createdAt: -1 }, { name: 'ix_point_history_account_created' }],
    [{ bookingId: 1 }, { name: 'ix_point_history_booking' }],
  ],
};

export default {
  id: '001_create_collections_and_indexes',
  description: 'Create all movie-theater collections and query/uniqueness indexes',
  async up(db) {
    const existing = new Set((await db.listCollections({}, { nameOnly: true }).toArray()).map((item) => item.name));

    for (const definition of Object.values(COLLECTIONS)) {
      if (!existing.has(definition.name)) await db.createCollection(definition.name);
      // Existing Mongo installations may predate the public id convention.
      // Backfill before unique indexes are created so those indexes can build.
      const missingIds = await db.collection(definition.name).find({
        $or: [
          { id: { $exists: false } },
          { [definition.idField]: { $exists: false } },
        ],
      }).toArray();
      for (const row of missingIds) {
        const id = String(row.id ?? row[definition.idField] ?? row._id);
        await db.collection(definition.name).updateOne(
          { _id: row._id },
          { $set: { id, [definition.idField]: String(row[definition.idField] ?? id) } },
        );
      }
      const indexes = [
        [{ id: 1 }, { unique: true, name: `uq_${definition.name.toLowerCase()}_id` }],
        [{ [definition.idField]: 1 }, { unique: true, name: `uq_${definition.name.toLowerCase()}_${definition.idField}` }],
        ...(RESOURCE_INDEXES[definition.name] ?? []),
      ];
      for (const [keys, options] of indexes) {
        await db.collection(definition.name).createIndex(keys, options);
      }
    }

    if (!existing.has('_counters')) await db.createCollection('_counters');
  },
};

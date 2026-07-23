export const RESOURCE_CASES = {
  ACCOUNT: {
    idField: 'accountId',
    payload: {
      username: 'crud_account', passwordHash: 'crud_password', fullName: 'CRUD Account',
      email: 'crud-account@example.com', phoneNumber: '0988000001', role: 'EMPLOYEE', status: 'ACTIVE',
    },
  },
  MEMBER_PROFILE: {
    idField: 'memberId',
    payload: { accountId: 'acc_crud_owner', points: 10, tier: 'STANDARD', favoriteGenres: ['ACTION'] },
  },
  CINEMA_ROOM: {
    idField: 'roomId',
    payload: { roomName: 'CRUD Integration Room', screenType: '2D', capacity: 20, status: 'ACTIVE' },
  },
  SEAT: {
    idField: 'seatId',
    payload: { roomId: 'room_crud', seatRow: 'Z', seatNumber: 99, seatType: 'VIP', status: 'ACTIVE' },
  },
  MOVIE: {
    idField: 'movieId',
    payload: {
      title: 'CRUD Integration Movie', durationMin: 100, releaseDate: '2026-07-14',
      status: 'COMING_SOON', actors: ['Integration Actor'], genres: ['TEST'],
    },
  },
  SHOWTIME: {
    idField: 'showtimeId',
    payload: {
      movieId: 'mov_crud', roomId: 'room_crud', startAt: '2026-12-01T10:00:00Z',
      endAt: '2026-12-01T12:00:00Z', basePrice: 75000, status: 'OPEN', format: '2D Digital',
    },
  },
  SHOWTIME_SEAT: {
    idField: 'showtimeSeatId',
    payload: {
      showtimeId: 'show_crud', seatId: 'seat_crud', seatType: 'STANDARD',
      status: 'AVAILABLE', price: 75000,
    },
  },
  PROMOTION: {
    idField: 'promotionId',
    payload: {
      code: 'CRUD_INTEGRATION', title: 'CRUD Integration Promotion',
      discountType: 'PERCENT', discountValue: 10, status: 'ACTIVE',
    },
  },
  BOOKING: {
    idField: 'bookingId',
    payload: {
      bookingCode: 'CRUD-BOOKING-CODE', accountId: 'acc_crud', showtimeId: 'show_crud',
      subtotalAmount: 75000, discountAmount: 0, pointsUsed: 0, pointsEarned: 7500,
      totalAmount: 75000, bookingStatus: 'CONFIRMED', paymentMethod: 'CASH', paymentStatus: 'PAID',
    },
  },
  BOOKING_SEAT: {
    idField: 'bookingSeatId',
    payload: { bookingId: 'BK-CRUD', showtimeSeatId: 'sh_st_crud', price: 75000 },
  },
  TICKET: {
    idField: 'ticketId',
    payload: {
      bookingId: 'BK-CRUD', bookingSeatId: 'bk_st_crud', ticketCode: 'QR-CRUD-1',
      issuedAt: '2026-07-14T10:00:00Z', isUsed: false,
    },
  },
  POINT_HISTORY: {
    idField: 'pointHistoryId',
    payload: {
      accountId: 'acc_crud', bookingId: 'BK-CRUD', movieId: 'mov_crud',
      transactionType: 'EARN', points: 75, createdAt: '2026-07-14T10:00:00Z',
      description: 'CRUD integration points',
    },
  },
};

export async function exerciseResourceContract(app, resource, definition, assert) {
  const createdResponse = await app.inject({
    method: 'POST', url: `/${resource}`, payload: definition.payload,
  });
  assert.equal(createdResponse.statusCode, 201, `${resource} POST: ${createdResponse.body}`);
  const created = createdResponse.json();
  assert.ok(created.id, `${resource} must expose id`);
  assert.ok(created[definition.idField], `${resource} must expose ${definition.idField}`);

  const getByBusinessId = await app.inject({
    method: 'GET', url: `/${resource}/${encodeURIComponent(created[definition.idField])}`,
  });
  assert.equal(getByBusinessId.statusCode, 200, `${resource} GET by business id`);
  assert.equal(getByBusinessId.json().id, created.id);

  const filtered = await app.inject({
    method: 'GET',
    url: `/${resource}?${definition.idField}=${encodeURIComponent(created[definition.idField])}`,
  });
  assert.equal(filtered.statusCode, 200, `${resource} filtered GET`);
  assert.equal(filtered.json().length, 1);

  const patched = await app.inject({
    method: 'PATCH',
    url: `/${resource}/${encodeURIComponent(created.id)}`,
    payload: { integrationFlag: 'patched', id: 'cannot-change-id', [definition.idField]: 'cannot-change-business-id' },
  });
  assert.equal(patched.statusCode, 200, `${resource} PATCH: ${patched.body}`);
  assert.equal(patched.json().integrationFlag, 'patched');
  assert.equal(patched.json().id, created.id);
  assert.equal(patched.json()[definition.idField], created[definition.idField]);

  const replaced = await app.inject({
    method: 'PUT',
    url: `/${resource}/${encodeURIComponent(created[definition.idField])}`,
    payload: {
      ...definition.payload,
      [definition.idField]: created[definition.idField],
      integrationFlag: 'replaced',
    },
  });
  assert.equal(replaced.statusCode, 200, `${resource} PUT: ${replaced.body}`);
  assert.equal(replaced.json().id, created.id);
  assert.equal(replaced.json().integrationFlag, 'replaced');

  const deleted = await app.inject({
    method: 'DELETE', url: `/${resource}/${encodeURIComponent(created[definition.idField])}`,
  });
  assert.equal(deleted.statusCode, 200, `${resource} DELETE: ${deleted.body}`);
  assert.equal(deleted.json().id, created.id);
  assert.equal((await app.inject({
    method: 'GET', url: `/${resource}/${encodeURIComponent(created.id)}`,
  })).statusCode, 404);
}

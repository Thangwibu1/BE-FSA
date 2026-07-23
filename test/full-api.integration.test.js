import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { MongoClient } from 'mongodb';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { buildApp } from '../src/app.js';
import { runMigrations } from '../src/infrastructure/db/migrate.js';
import { seedDatabase } from '../src/infrastructure/db/seed.js';
import { RESOURCE_CASES, exerciseResourceContract } from './helpers/resourceCases.js';

const silentLogger = { info() {}, error() {} };
let mongoServer;
let mongoClient;
let app;

before(async () => {
  mongoServer = await MongoMemoryServer.create();
  mongoClient = new MongoClient(mongoServer.getUri());
  await mongoClient.connect();
  const db = mongoClient.db('movie_theater_full_api_test');
  await runMigrations(db, silentLogger);
  await seedDatabase(db, silentLogger);
  app = await buildApp(db, { logger: false, authDisabled: true });
  await app.ready();
});

after(async () => {
  await app?.close();
  await mongoClient?.close();
  await mongoServer?.stop();
});

for (const [resource, definition] of Object.entries(RESOURCE_CASES)) {
  test(`${resource} implements the complete CRUD contract`, async () => {
    await exerciseResourceContract(app, resource, definition, assert);
  });
}

test('auth handles registration, case-insensitive login, status and duplicate fields', async () => {
  const registration = {
    username: 'mongo_full_member', password: 'secret123', fullName: 'Mongo Full Member',
    email: 'mongo-full-member@example.com', phoneNumber: '0977000001',
    dateOfBirth: '2001-01-01', gender: 'FEMALE', identityCard: '001201000001',
    address: 'Integration Test Address', role: 'ADMIN', status: 'BLOCKED',
  };
  const registered = await app.inject({ method: 'POST', url: '/register', payload: registration });
  assert.equal(registered.statusCode, 201, registered.body);
  assert.equal(registered.json().account.role, 'MEMBER');
  assert.equal(registered.json().account.status, 'ACTIVE');

  const login = await app.inject({
    method: 'POST', url: '/login', payload: { username: 'MONGO_FULL_MEMBER', password: 'secret123' },
  });
  assert.equal(login.statusCode, 200, login.body);
  assert.equal(login.json().memberProfile.accountId, registered.json().account.accountId);

  const wrongPassword = await app.inject({
    method: 'POST', url: '/login', payload: { username: registration.username, password: 'wrong' },
  });
  assert.equal(wrongPassword.statusCode, 401);

  const duplicateIdentity = await app.inject({
    method: 'POST',
    url: '/register',
    payload: {
      ...registration,
      username: 'different_member', email: 'different@example.com', phoneNumber: '0977000002',
    },
  });
  assert.equal(duplicateIdentity.statusCode, 409);
});

test('query dialect handles equality, arrays, operators, sorting, slicing, pages and search', async () => {
  const phone = await app.inject({ method: 'GET', url: '/ACCOUNT?phoneNumber=0901234567' });
  assert.equal(phone.statusCode, 200);
  assert.equal(phone.json().length, 1);

  const range = await app.inject({
    method: 'GET', url: '/MEMBER_PROFILE?points_gte=100&points_lte=500&_sort=-points',
  });
  assert.ok(range.json().length > 0);
  assert.ok(range.json().every((row) => row.points >= 100 && row.points <= 500));
  assert.ok(range.json()[0].points >= range.json().at(-1).points);

  const search = await app.inject({ method: 'GET', url: '/MOVIE?q=Sci-Fi' });
  assert.ok(search.json().some((movie) => movie.genres.includes('Sci-Fi')));

  const slice = await app.inject({ method: 'GET', url: '/SEAT?_start=10&_end=15' });
  assert.equal(slice.json().length, 5);

  const page = await app.inject({ method: 'GET', url: '/SHOWTIME_SEAT?_page=2&_per_page=25' });
  assert.equal(page.json().data.length, 25);
  assert.equal(page.json().prev, 1);
  assert.equal(page.json().next, 3);
  assert.equal(Number(page.headers['x-total-count']), 1440);
});

test('concurrent creates allocate unique sequential business ids', async () => {
  const responses = await Promise.all(Array.from({ length: 20 }, (_, index) => app.inject({
    method: 'POST',
    url: '/POINT_HISTORY',
    payload: {
      accountId: 'acc_006', transactionType: 'EARN', points: index + 1,
      createdAt: `2026-07-14T11:${String(index).padStart(2, '0')}:00Z`,
      description: `Concurrent integration ${index}`,
    },
  })));
  assert.ok(responses.every((response) => response.statusCode === 201));
  const rows = responses.map((response) => response.json());
  assert.equal(new Set(rows.map((row) => row.pointHistoryId)).size, 20);
  await Promise.all(rows.map((row) => app.inject({ method: 'DELETE', url: `/POINT_HISTORY/${row.id}` })));
});

test('concurrent seat reservations allow exactly one winner', async () => {
  const seat = await app.inject({
    method: 'POST',
    url: '/SHOWTIME_SEAT',
    payload: {
      showtimeId: 'show_concurrent', seatId: 'seat_concurrent', seatType: 'STANDARD',
      status: 'AVAILABLE', price: 65000,
    },
  });
  assert.equal(seat.statusCode, 201, seat.body);
  const id = seat.json().id;
  const attempts = await Promise.all([
    app.inject({ method: 'PATCH', url: `/SHOWTIME_SEAT/${id}`, payload: { status: 'BOOKED' } }),
    app.inject({ method: 'PATCH', url: `/SHOWTIME_SEAT/${id}`, payload: { status: 'BOOKED' } }),
  ]);
  assert.deepEqual(attempts.map((response) => response.statusCode).sort(), [200, 409]);
  await app.inject({ method: 'DELETE', url: `/SHOWTIME_SEAT/${id}` });
});

test('showtime writes reject room overlaps, including concurrent creates and updates', async () => {
  const payloads = [
    {
      showtimeId: 'show_conflict_a', movieId: 'mov_001', roomId: 'room_001',
      startAt: '2030-01-10T10:00:00Z', endAt: '2030-01-10T12:00:00Z',
      basePrice: 80000, status: 'OPEN', format: '2D',
    },
    {
      showtimeId: 'show_conflict_b', movieId: 'mov_002', roomId: 'room_001',
      startAt: '2030-01-10T10:30:00Z', endAt: '2030-01-10T12:30:00Z',
      basePrice: 80000, status: 'OPEN', format: '2D',
    },
  ];
  const attempts = await Promise.all(payloads.map((payload) => app.inject({
    method: 'POST', url: '/SHOWTIME', payload,
  })));
  assert.deepEqual(attempts.map((response) => response.statusCode).sort(), [201, 409]);

  const winner = attempts.find((response) => response.statusCode === 201).json();
  const adjacentStart = new Date(winner.endAt);
  const adjacentEnd = new Date(adjacentStart.getTime() + 60 * 60_000);
  const adjacent = await app.inject({
    method: 'POST', url: '/SHOWTIME',
    payload: {
      showtimeId: 'show_conflict_adjacent', movieId: 'mov_003', roomId: 'room_001',
      startAt: adjacentStart.toISOString(), endAt: adjacentEnd.toISOString(),
      basePrice: 80000, status: 'OPEN', format: '2D',
    },
  });
  assert.equal(adjacent.statusCode, 201, adjacent.body);

  const overlappingStart = new Date(new Date(winner.endAt).getTime() - 30 * 60_000);
  const patched = await app.inject({
    method: 'PATCH', url: `/SHOWTIME/${adjacent.json().id}`,
    payload: { startAt: overlappingStart.toISOString() },
  });
  assert.equal(patched.statusCode, 409, patched.body);

  await app.inject({ method: 'DELETE', url: `/SHOWTIME/${winner.id}` });
  await app.inject({ method: 'DELETE', url: `/SHOWTIME/${adjacent.json().id}` });
});

test('promotion quotes normalize voucher codes and enforce source, minimum order and discount caps', async () => {
  const promotion = await app.inject({
    method: 'POST', url: '/PROMOTION',
    payload: {
      code: 'QUOTE10', title: 'Quote test', discountType: 'PERCENT', discountValue: 10,
      maxDiscountAmount: 12000, minOrderAmount: 50000, applicableSources: ['COUNTER'],
      startAt: '2026-01-01T00:00:00Z', endAt: '2030-12-31T23:59:59Z', status: 'ACTIVE',
    },
  });
  assert.equal(promotion.statusCode, 201, promotion.body);

  const seats = (await app.inject({ method: 'GET', url: '/SHOWTIME_SEAT?showtimeId=show_001&status=AVAILABLE' })).json().slice(0, 2);
  const quote = await app.inject({
    method: 'POST', url: '/counter-sales/quote',
    payload: {
      showtimeId: 'show_001', showtimeSeatIds: seats.map((seat) => seat.showtimeSeatId),
      promotionCode: '  quote10  ', accountId: null,
    },
  });
  assert.equal(quote.statusCode, 200, quote.body);
  assert.equal(quote.json().promotionCode, 'QUOTE10');
  assert.equal(quote.json().promotionDiscount, Math.min(Math.floor(quote.json().subtotalAmount * 0.1), 12000));
  assert.equal(quote.json().totalAmount, quote.json().subtotalAmount - quote.json().promotionDiscount);

  const sourceRestricted = await app.inject({
    method: 'PATCH', url: `/PROMOTION/${promotion.json().id}`,
    payload: { applicableSources: ['ONLINE'] },
  });
  assert.equal(sourceRestricted.statusCode, 200);
  const rejected = await app.inject({
    method: 'POST', url: '/counter-sales/quote',
    payload: {
      showtimeId: 'show_001', showtimeSeatIds: [seats[0].showtimeSeatId], promotionCode: 'QUOTE10',
    },
  });
  assert.equal(rejected.statusCode, 400);
  assert.match(rejected.json().error, /ONLINE/);

  await app.inject({ method: 'DELETE', url: `/PROMOTION/${promotion.json().id}` });
});

test('walk-in booking accepts a null account and receives a server booking code', async () => {
  const response = await app.inject({
    method: 'POST',
    url: '/BOOKING',
    payload: {
      accountId: null,
      showtimeId: 'show_001',
      totalAmount: 65000,
      bookingStatus: 'CONFIRMED',
      customerType: 'WALK_IN',
    },
  });
  assert.equal(response.statusCode, 201, response.body);
  assert.equal(response.json().accountId, null);
  assert.equal(response.json().bookingCode, response.json().bookingId);
  await app.inject({ method: 'DELETE', url: `/BOOKING/${response.json().id}` });
});

test('metadata, health, OpenAPI, CORS, validation, conflicts and 404 are stable', async () => {
  const metadata = await app.inject({ method: 'GET', url: '/' });
  assert.equal(metadata.statusCode, 200);
  assert.equal(metadata.json().resources.MOVIE, 20);
  assert.equal((await app.inject({ method: 'GET', url: '/health' })).statusCode, 200);

  const swagger = await app.inject({ method: 'GET', url: '/swagger.json' });
  assert.equal(Object.keys(swagger.json().paths).filter((path) => /^[A-Z_]+/.test(path.slice(1))).length, 24);

  const invalid = await app.inject({ method: 'POST', url: '/MOVIE', payload: { title: 'Missing fields' } });
  assert.equal(invalid.statusCode, 400);
  assert.equal((await app.inject({ method: 'GET', url: '/DOES_NOT_EXIST' })).statusCode, 404);

  const preflight = await app.inject({
    method: 'OPTIONS', url: '/MOVIE',
    headers: { origin: 'http://localhost:5173', 'access-control-request-method': 'GET' },
  });
  assert.equal(preflight.statusCode, 204);
  assert.equal(preflight.headers['access-control-allow-origin'], '*');
});

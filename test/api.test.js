import assert from 'node:assert/strict';
import { readFile, unlink } from 'node:fs/promises';
import path from 'node:path';
import { after, before, test } from 'node:test';
import { buildApp } from '../src/app.js';
import { InMemoryResourceRepository } from './helpers/InMemoryResourceRepository.js';
import { config } from '../src/config/env.js';

let app;

before(async () => {
  const seed = JSON.parse(await readFile(new URL('../seed/db.json', import.meta.url), 'utf8'));
  const repository = new InMemoryResourceRepository(seed);
  app = await buildApp({ command: async () => ({ ok: 1 }) }, { logger: false, repository, authDisabled: true });
  await app.ready();
});

after(async () => {
  await app.close();
});

test('serves metadata, health, Swagger and all seeded resources', async () => {
  const metadata = await app.inject({ method: 'GET', url: '/' });
  assert.equal(metadata.statusCode, 200);
  assert.equal(metadata.json().name, 'Movie Theater API');
  assert.equal(metadata.json().resources.MOVIE, 20);
  assert.equal(metadata.json().resources.POINT_HISTORY, 2);

  assert.equal((await app.inject({ method: 'GET', url: '/health' })).statusCode, 200);
  const swagger = await app.inject({ method: 'GET', url: '/swagger.json' });
  assert.equal(swagger.statusCode, 200);
  assert.equal(swagger.json().openapi, '3.0.3');
  assert.ok(swagger.json().paths['/POINT_HISTORY/{id}']);
});

test('OpenAPI completely documents every route, security rule, payload and error contract', async () => {
  const ui = await app.inject({ method: 'GET', url: '/api-docs/' });
  assert.equal(ui.statusCode, 200);

  const response = await app.inject({ method: 'GET', url: '/swagger.json' });
  assert.equal(response.statusCode, 200);
  const specification = response.json();
  assert.equal(Object.keys(specification.paths).length, 43);
  assert.equal(specification.components.securitySchemes.bearerAuth.scheme, 'bearer');

  const httpMethods = new Set(['get', 'post', 'put', 'patch', 'delete']);
  const operations = Object.values(specification.paths)
    .flatMap((path) => Object.entries(path).filter(([method]) => httpMethods.has(method)).map(([, operation]) => operation));
  assert.equal(operations.length, 91);
  assert.equal(new Set(operations.map((operation) => operation.operationId)).size, operations.length);
  for (const operation of operations) {
    assert.ok(operation.operationId, 'Every operation must have a stable operationId');
    assert.ok(operation.summary, `${operation.operationId} must have a summary`);
    assert.ok(operation.description, `${operation.operationId} must have a description`);
    assert.ok(operation.tags?.length, `${operation.operationId} must have a tag`);
    assert.ok(operation.responses?.['200'] || operation.responses?.['201'], `${operation.operationId} must document success`);
    assert.ok(operation.responses?.['500'], `${operation.operationId} must document server errors`);
  }

  assert.deepEqual(specification.paths['/ACCOUNT'].get.security, [{ bearerAuth: [] }]);
  assert.equal(specification.paths['/ACCOUNT'].get.responses['200'].headers['X-Total-Count'].schema.type, 'integer');
  assert.deepEqual(specification.paths['/ACCOUNT'].post.security, [{ bearerAuth: [] }]);
  assert.equal(specification.paths['/MOVIE'].get.security, undefined);
  assert.deepEqual(specification.paths['/bookings'].post.security, [{ bearerAuth: [] }]);
  assert.ok(specification.paths['/bookings'].post.responses['409']);
  assert.ok(specification.paths['/register'].post.responses['400']);
  assert.ok(specification.paths['/register'].post.responses['409']);

  const uploadSchema = specification.paths['/uploads/images'].post.requestBody
    .content['multipart/form-data'].schema;
  assert.deepEqual(uploadSchema.required, ['file']);
  assert.equal(uploadSchema.properties.file.format, 'binary');

  const loginAccount = specification.paths['/login'].post.responses['200']
    .content['application/json'].schema.properties.account;
  assert.equal(loginAccount.properties.passwordHash, undefined);
  const accountRead = specification.paths['/ACCOUNT/{id}'].get.responses['200']
    .content['application/json'].schema;
  assert.equal(accountRead.properties.passwordHash, undefined);
});

test('admin can upload an image and the returned public URL serves it', async () => {
  const boundary = '----codex-image-upload';
  const image = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const payload = Buffer.concat([
    Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="poster.png"\r\nContent-Type: image/png\r\n\r\n`),
    image,
    Buffer.from(`\r\n--${boundary}--\r\n`),
  ]);
  const response = await app.inject({
    method: 'POST', url: '/uploads/images', payload,
    headers: { 'content-type': `multipart/form-data; boundary=${boundary}` },
  });
  assert.equal(response.statusCode, 201, response.body);
  const pathname = new URL(response.json().url).pathname;
  const served = await app.inject({ method: 'GET', url: pathname });
  assert.equal(served.statusCode, 200);
  assert.deepEqual(served.rawPayload, image);
  await unlink(path.join(config.uploads.directory, path.basename(pathname)));
});

test('supports filters, operators, search, sort and pagination', async () => {
  const byPhone = await app.inject({ method: 'GET', url: '/ACCOUNT?phoneNumber=0901234567' });
  assert.equal(byPhone.statusCode, 200);
  assert.equal(byPhone.json()[0].username, 'admin_huy');

  const movies = await app.inject({ method: 'GET', url: '/MOVIE?q=nolan&_sort=-durationMin' });
  assert.equal(movies.statusCode, 200);
  assert.ok(movies.json().length >= 2);
  assert.ok(movies.json()[0].durationMin >= movies.json()[1].durationMin);

  const profiles = await app.inject({ method: 'GET', url: '/MEMBER_PROFILE?points_gte=100&_page=1&_per_page=3' });
  assert.equal(profiles.statusCode, 200);
  assert.equal(profiles.json().data.length, 3);
  assert.equal(profiles.json().first, 1);
  assert.ok(Number(profiles.headers['x-total-count']) >= 3);
});

test('looks up records by public id or business id', async () => {
  const booking = await app.inject({ method: 'GET', url: '/BOOKING/BK-8271' });
  assert.equal(booking.statusCode, 200);
  assert.equal(booking.json().id, 'j8NOjThxVxI');

  const byPublicId = await app.inject({ method: 'GET', url: '/BOOKING/j8NOjThxVxI' });
  assert.equal(byPublicId.statusCode, 200);
  assert.equal(byPublicId.json().bookingId, 'BK-8271');
});

test('supports create, replace, patch and delete with generated business ids', async () => {
  const created = await app.inject({
    method: 'POST',
    url: '/PROMOTION',
    payload: {
      code: 'TEST_FASTIFY',
      title: 'Test promotion',
      discountType: 'PERCENT',
      discountValue: 10,
      status: 'ACTIVE',
    },
  });
  assert.equal(created.statusCode, 201, created.body);
  assert.equal(created.json().id, 'promo_021');
  assert.equal(created.json().promotionId, 'promo_021');

  const replaced = await app.inject({
    method: 'PUT',
    url: '/PROMOTION/promo_021',
    payload: {
      promotionId: 'promo_021',
      code: 'TEST_FASTIFY_2',
      title: 'Replaced promotion',
      discountType: 'FIXED_AMOUNT',
      discountValue: 15000,
      status: 'ACTIVE',
    },
  });
  assert.equal(replaced.statusCode, 200, replaced.body);
  assert.equal(replaced.json().code, 'TEST_FASTIFY_2');

  const patched = await app.inject({
    method: 'PATCH', url: '/PROMOTION/promo_021', payload: { status: 'INACTIVE' },
  });
  assert.equal(patched.statusCode, 200);
  assert.equal(patched.json().status, 'INACTIVE');

  const deleted = await app.inject({ method: 'DELETE', url: '/PROMOTION/promo_021' });
  assert.equal(deleted.statusCode, 200);
  assert.equal(deleted.json().promotionId, 'promo_021');
  assert.equal((await app.inject({ method: 'GET', url: '/PROMOTION/promo_021' })).statusCode, 404);
});

test('PUT never creates a missing resource', async () => {
  const response = await app.inject({
    method: 'PUT',
    url: '/PROMOTION/does-not-exist',
    payload: {
      code: 'NOPE', title: 'Nope', discountType: 'PERCENT', discountValue: 1, status: 'ACTIVE',
    },
  });
  assert.equal(response.statusCode, 404);
});

test('register enforces member privileges and login is case-insensitive', async () => {
  const payload = {
    username: 'fastify_member',
    password: 'secret123',
    fullName: 'Fastify Member',
    email: 'fastify-member@example.com',
    phoneNumber: '0900000000',
    dateOfBirth: '2000-01-01',
    gender: 'MALE',
    identityCard: '1234567890',
    address: '123 Test Street',
    role: 'ADMIN',
    status: 'BLOCKED',
  };
  const response = await app.inject({ method: 'POST', url: '/register', payload });
  assert.equal(response.statusCode, 201, response.body);
  assert.equal(response.json().account.role, 'MEMBER');
  assert.equal(response.json().account.status, 'ACTIVE');
  assert.equal(response.json().memberProfile.accountId, response.json().account.accountId);

  const login = await app.inject({
    method: 'POST', url: '/login', payload: { username: 'FASTIFY_MEMBER', password: 'secret123' },
  });
  assert.equal(login.statusCode, 200, login.body);
  assert.equal(login.json().account.username, 'fastify_member');

  const duplicate = await app.inject({
    method: 'POST',
    url: '/register',
    payload: { ...payload, username: 'another', email: 'another@example.com' },
  });
  assert.equal(duplicate.statusCode, 409);
});

test('register rejects an incomplete legacy payload and CORS preflight works', async () => {
  const incomplete = await app.inject({
    method: 'POST',
    url: '/register',
    payload: {
      username: 'incomplete', password: 'secret', fullName: 'Incomplete',
      email: 'incomplete@example.com', phoneNumber: '0911111111',
    },
  });
  assert.equal(incomplete.statusCode, 400);

  const options = await app.inject({
    method: 'OPTIONS',
    url: '/MOVIE',
    headers: {
      origin: 'http://localhost:5173',
      'access-control-request-method': 'GET',
    },
  });
  assert.equal(options.statusCode, 204);
  assert.equal(options.headers['access-control-allow-origin'], '*');
});

test('auth session exposes me, refreshes tokens, rotates after password change and logs out', async () => {
  const seed = JSON.parse(await readFile(new URL('../seed/db.json', import.meta.url), 'utf8'));
  const repository = new InMemoryResourceRepository(seed);
  const secureApp = await buildApp({ command: async () => ({ ok: 1 }) }, { logger: false, repository });
  await secureApp.ready();
  try {
    const login = await secureApp.inject({
      method: 'POST', url: '/login', payload: { username: 'mem_anhtu', password: 'example123' },
    });
    assert.equal(login.statusCode, 200, login.body);
    const first = login.json();
    assert.ok(first.accessToken);
    assert.ok(first.refreshToken);
    assert.ok(first.expiresIn > 0);
    assert.equal((await secureApp.inject({
      method: 'GET', url: '/auth/me', headers: { authorization: `Bearer ${first.refreshToken}` },
    })).statusCode, 401);
    assert.equal((await secureApp.inject({
      method: 'POST', url: '/auth/refresh', payload: { refreshToken: first.accessToken },
    })).statusCode, 401);

    const firstAuth = { authorization: `Bearer ${first.accessToken}` };
    const me = await secureApp.inject({ method: 'GET', url: '/auth/me', headers: firstAuth });
    assert.equal(me.statusCode, 200, me.body);
    assert.equal(me.json().account.accountId, 'acc_006');
    assert.equal(me.json().account.passwordHash, undefined);

    const refreshed = await secureApp.inject({
      method: 'POST', url: '/auth/refresh', payload: { refreshToken: first.refreshToken },
    });
    assert.equal(refreshed.statusCode, 200, refreshed.body);
    assert.ok(refreshed.json().accessToken);
    assert.ok(refreshed.json().refreshToken);

    const changed = await secureApp.inject({
      method: 'POST', url: '/auth/change-password', headers: firstAuth,
      payload: { currentPassword: 'example123', newPassword: 'changed123' },
    });
    assert.equal(changed.statusCode, 200, changed.body);
    assert.ok(changed.json().refreshToken);
    assert.equal((await secureApp.inject({ method: 'GET', url: '/auth/me', headers: firstAuth })).statusCode, 401);

    const changedAuth = { authorization: `Bearer ${changed.json().accessToken}` };
    assert.equal((await secureApp.inject({ method: 'GET', url: '/auth/me', headers: changedAuth })).statusCode, 200);
    const logout = await secureApp.inject({
      method: 'POST', url: '/auth/logout', payload: { refreshToken: changed.json().refreshToken },
    });
    assert.equal(logout.statusCode, 200, logout.body);
    assert.equal((await secureApp.inject({ method: 'GET', url: '/auth/me', headers: changedAuth })).statusCode, 401);
  } finally {
    await secureApp.close();
  }
});

test('security and server-side booking rules protect credentials, roles, prices and seats', async () => {
  const seed = JSON.parse(await readFile(new URL('../seed/db.json', import.meta.url), 'utf8'));
  seed.BOOKING.push({
    id: 'foreign-booking', bookingId: 'BK-FOREIGN', bookingCode: 'BK-FOREIGN', accountId: 'acc_007',
    showtimeId: 'show_017', subtotalAmount: 120000, discountAmount: 0, pointsUsed: 0,
    pointsEarned: 0, totalAmount: 120000, bookingStatus: 'CONFIRMED',
  });
  seed.BOOKING_SEAT.push({ id: 'foreign-seat', bookingSeatId: 'foreign-seat', bookingId: 'BK-FOREIGN', showtimeSeatId: 'sh_st_00385', price: 120000 });
  seed.TICKET.push({ id: 'foreign-ticket', ticketId: 'foreign-ticket', bookingId: 'BK-FOREIGN', bookingSeatId: 'foreign-seat', ticketCode: 'QR-FOREIGN', issuedAt: new Date().toISOString(), isUsed: false });
  const repository = new InMemoryResourceRepository(seed);
  const secureApp = await buildApp({ command: async () => ({ ok: 1 }) }, { logger: false, repository });
  await secureApp.ready();
  try {
    assert.equal((await secureApp.inject({ method: 'GET', url: '/ACCOUNT' })).statusCode, 401);
    assert.equal((await secureApp.inject({ method: 'GET', url: '/MOVIE' })).statusCode, 200);

    const memberLogin = await secureApp.inject({
      method: 'POST', url: '/login', payload: { username: 'mem_anhtu', password: 'example123' },
    });
    assert.equal(memberLogin.statusCode, 200, memberLogin.body);
    assert.ok(memberLogin.json().accessToken);
    assert.equal(memberLogin.json().account.passwordHash, undefined);
    const memberAuth = { authorization: `Bearer ${memberLogin.json().accessToken}` };
    const ownAccounts = await secureApp.inject({ method: 'GET', url: '/ACCOUNT', headers: memberAuth });
    assert.equal(ownAccounts.statusCode, 200);
    assert.deepEqual(ownAccounts.json().map((row) => row.accountId), ['acc_006']);
    assert.equal((await secureApp.inject({ method: 'GET', url: '/ACCOUNT/acc_001', headers: memberAuth })).statusCode, 403);
    const ownTickets = await secureApp.inject({ method: 'GET', url: '/TICKET', headers: memberAuth });
    assert.equal(ownTickets.statusCode, 200);
    assert.equal(ownTickets.json().some((row) => row.ticketId === 'foreign-ticket'), false);
    assert.equal((await secureApp.inject({ method: 'GET', url: '/TICKET/foreign-ticket', headers: memberAuth })).statusCode, 403);
    assert.equal((await secureApp.inject({ method: 'GET', url: '/BOOKING_SEAT/foreign-seat', headers: memberAuth })).statusCode, 403);
    assert.equal((await secureApp.inject({
      method: 'POST', url: '/PROMOTION', headers: memberAuth,
      payload: { code: 'HACK', title: 'No', discountType: 'PERCENT', discountValue: 100, status: 'ACTIVE' },
    })).statusCode, 403);

    const employeeLogin = await secureApp.inject({
      method: 'POST', url: '/login', payload: { username: 'emp_cuong', password: 'example123' },
    });
    const employeeAuth = { authorization: `Bearer ${employeeLogin.json().accessToken}` };
    const memberDirectory = await secureApp.inject({ method: 'GET', url: '/ACCOUNT', headers: employeeAuth });
    assert.equal(memberDirectory.statusCode, 200);
    assert.ok(memberDirectory.json().length > 0);
    assert.ok(memberDirectory.json().every((row) => row.role === 'MEMBER'));

    const seat = seed.SHOWTIME_SEAT.find((row) => row.showtimeId === 'show_001' && row.status === 'AVAILABLE');
    const sale = await secureApp.inject({
      method: 'POST', url: '/bookings', headers: memberAuth,
      payload: { showtimeId: 'show_001', showtimeSeatIds: [seat.showtimeSeatId], convertedTicketQuantity: 1 },
    });
    assert.equal(sale.statusCode, 201, sale.body);
    assert.equal(sale.json().booking.pointsUsed, 100);
    assert.equal(sale.json().booking.totalAmount, 0);
    const duplicate = await secureApp.inject({
      method: 'POST', url: '/bookings', headers: memberAuth,
      payload: { showtimeId: 'show_001', showtimeSeatIds: [seat.showtimeSeatId] },
    });
    assert.equal(duplicate.statusCode, 409);
  } finally {
    await secureApp.close();
  }
});

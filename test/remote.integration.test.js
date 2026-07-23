import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { MongoClient } from 'mongodb';
import { buildApp } from '../src/app.js';
import { config } from '../src/config/env.js';
import { runMigrations, getMigrationStatus } from '../src/infrastructure/db/migrate.js';
import { seedDatabase } from '../src/infrastructure/db/seed.js';
import { RESOURCE_CASES, exerciseResourceContract } from './helpers/resourceCases.js';

const enabled = String(process.env.RUN_REMOTE_INTEGRATION).toLowerCase() === 'true';
const silentLogger = { info() {}, error() {} };
let client;
let db;
let app;

before(async () => {
  if (!enabled) return;
  const baseName = config.mongo.dbName ?? 'movie_theater_fastify';
  const databaseName = `${baseName}_integration_test`;
  if (!databaseName.endsWith('_integration_test')) {
    throw new Error('Remote test database must end with _integration_test');
  }
  client = new MongoClient(config.mongo.uri, { serverSelectionTimeoutMS: 10000 });
  await client.connect();
  db = client.db(databaseName);
  await db.dropDatabase();
  await runMigrations(db, silentLogger);
  await seedDatabase(db, silentLogger);
  app = await buildApp(db, { logger: false, authDisabled: true });
  await app.ready();
});

after(async () => {
  if (!enabled) return;
  await app?.close();
  // This database is created solely by this test suite and never contains app data.
  await db?.dropDatabase();
  await client?.close();
});

test('remote MongoDB passes migrations, indexes, seed and every CRUD API', { skip: !enabled }, async () => {
  assert.ok((await getMigrationStatus(db)).every((migration) => migration.status === 'applied'));
  assert.equal(await db.collection('SHOWTIME_SEAT').countDocuments(), 1440);
  assert.ok((await db.collection('ACCOUNT').indexes()).some(
    (index) => index.name === 'uq_account_username' && index.unique,
  ));

  for (const [resource, definition] of Object.entries(RESOURCE_CASES)) {
    await exerciseResourceContract(app, resource, definition, assert);
  }
});

test('remote MongoDB passes auth, query and API discovery contracts', { skip: !enabled }, async () => {
  const registration = await app.inject({
    method: 'POST',
    url: '/register',
    payload: {
      username: 'remote_test_member', password: 'secret123', fullName: 'Remote Test Member',
      email: 'remote-test-member@example.com', phoneNumber: '0966000001',
      dateOfBirth: '2000-02-02', gender: 'MALE', identityCard: '001200000099',
      address: 'Remote Integration Test',
    },
  });
  assert.equal(registration.statusCode, 201, registration.body);

  const login = await app.inject({
    method: 'POST',
    url: '/login',
    payload: { username: 'REMOTE_TEST_MEMBER', password: 'secret123' },
  });
  assert.equal(login.statusCode, 200, login.body);

  const search = await app.inject({ method: 'GET', url: '/MOVIE?q=Sci-Fi&_sort=-durationMin' });
  assert.ok(search.json().length > 0);
  const page = await app.inject({ method: 'GET', url: '/SEAT?_page=1&_per_page=10' });
  assert.equal(page.json().data.length, 10);
  assert.equal(page.json().items, 480);
  assert.equal((await app.inject({ method: 'GET', url: '/swagger.json' })).statusCode, 200);
  assert.equal((await app.inject({ method: 'GET', url: '/health' })).statusCode, 200);
});

import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { MongoClient } from 'mongodb';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { runMigrations, getMigrationStatus } from '../src/infrastructure/db/migrate.js';
import { seedDatabase } from '../src/infrastructure/db/seed.js';
import { MongoResourceRepository } from '../src/infrastructure/repositories/MongoResourceRepository.js';

const silentLogger = { info() {}, error() {} };
let server;
let client;
let db;

before(async () => {
  server = await MongoMemoryServer.create();
  client = new MongoClient(server.getUri());
  await client.connect();
  db = client.db('movie_theater_test');
});

after(async () => {
  await client?.close();
  await server?.stop();
});

test('migrations and seed run idempotently against MongoDB', async () => {
  const firstRun = await runMigrations(db, silentLogger);
  assert.deepEqual(firstRun, [
    '001_create_collections_and_indexes',
    '002_backfill_ids_and_counters',
  ]);
  assert.deepEqual(await runMigrations(db, silentLogger), []);
  assert.ok((await getMigrationStatus(db)).every((item) => item.status === 'applied'));

  const firstSeed = await seedDatabase(db, silentLogger);
  assert.equal(firstSeed.ACCOUNT.inserted, 25);
  assert.equal(firstSeed.SHOWTIME_SEAT.inserted, 1440);
  assert.equal(firstSeed.POINT_HISTORY.inserted, 2);

  const secondSeed = await seedDatabase(db, silentLogger);
  assert.equal(secondSeed.ACCOUNT.inserted, 0);
  assert.equal(secondSeed.ACCOUNT.skipped, 25);
  assert.equal(await db.collection('MOVIE').countDocuments(), 20);

  const accountIndexes = await db.collection('ACCOUNT').indexes();
  assert.ok(accountIndexes.some((index) => index.name === 'uq_account_username' && index.unique));
  assert.equal((await db.collection('_counters').findOne({ _id: 'PROMOTION' })).seq, 20);

  await db.collection('MOVIE').insertOne({ _id: 'temporary', id: 'temporary', movieId: 'temporary' });
  const freshSeed = await seedDatabase(db, silentLogger, { fresh: true });
  assert.equal(freshSeed.MOVIE.inserted, 20);
  assert.equal(await db.collection('MOVIE').countDocuments(), 20);
});

test('Mongo repository supports business ids, atomic ids and non-upserting PUT', async () => {
  const repository = new MongoResourceRepository(db);
  const booking = await repository.findById('BOOKING', 'BK-8271');
  assert.equal(booking.id, 'j8NOjThxVxI');

  const replacedBooking = await repository.replace('BOOKING', 'BK-8271', {
    ...booking,
    bookingStatus: 'CHECKED',
  });
  assert.equal(replacedBooking.id, 'j8NOjThxVxI');
  assert.equal((await repository.findById('BOOKING', 'BK-8271')).bookingStatus, 'CHECKED');

  assert.equal(await repository.replace('BOOKING', 'missing', {}), null);

  const search = await repository.list('MOVIE', { q: 'nolan', sort: ['-durationMin'] });
  assert.ok(search.data.length >= 2);
  assert.ok(search.data[0].durationMin >= search.data[1].durationMin);
  assert.ok((await repository.list('MOVIE', { q: 'Sci-Fi' })).data.length >= 1);

  const nextId = await repository.nextBusinessId({
    name: 'PROMOTION', idField: 'promotionId', idPrefix: 'promo_', idPad: 3,
  });
  assert.equal(nextId, 'promo_021');

  await repository.insert('PROMOTION', {
    id: nextId,
    promotionId: nextId,
    code: 'MONGO_TEST',
    title: 'Mongo Test',
    discountType: 'PERCENT',
    discountValue: 5,
    status: 'ACTIVE',
  });
  assert.equal((await repository.findById('PROMOTION', nextId)).code, 'MONGO_TEST');
  assert.equal((await repository.delete('PROMOTION', nextId)).promotionId, nextId);
});

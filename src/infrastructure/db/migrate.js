import { pathToFileURL } from 'node:url';
import { mongoConnection } from './mongoConnection.js';
import { migrations } from './migrations/index.js';

const MIGRATION_COLLECTION = '_migrations';
const LOCK_COLLECTION = '_migration_lock';

async function acquireLock(db) {
  await db.collection(LOCK_COLLECTION).deleteOne({
    _id: 'global',
    acquiredAt: { $lt: new Date(Date.now() - 5 * 60 * 1000) },
  });
  try {
    await db.collection(LOCK_COLLECTION).insertOne({
      _id: 'global',
      acquiredAt: new Date(),
      pid: process.pid,
    });
  } catch (error) {
    if (error?.code === 11000) {
      throw new Error('Another migration process is already running');
    }
    throw error;
  }
}

/** Apply every pending migration exactly once. */
export async function runMigrations(db, logger = console) {
  await acquireLock(db);
  const appliedNow = [];
  try {
    const migrationCollection = db.collection(MIGRATION_COLLECTION);
    await migrationCollection.createIndex({ appliedAt: 1 }, { name: 'ix_migrations_applied_at' });
    const applied = new Set(
      (await migrationCollection.find({}, { projection: { _id: 1 } }).toArray())
        .map((item) => item._id),
    );

    for (const migration of migrations) {
      if (applied.has(migration.id)) continue;
      logger.info?.(`Applying migration ${migration.id}...`);
      await migration.up(db);
      await migrationCollection.insertOne({
        _id: migration.id,
        description: migration.description,
        appliedAt: new Date(),
      });
      appliedNow.push(migration.id);
    }
  } finally {
    await db.collection(LOCK_COLLECTION).deleteOne({ _id: 'global' }).catch(() => {});
  }

  logger.info?.(appliedNow.length
    ? `Applied ${appliedNow.length} migration(s).`
    : 'Database migrations are up to date.');
  return appliedNow;
}

export async function getMigrationStatus(db) {
  const existing = await db.listCollections({ name: MIGRATION_COLLECTION }, { nameOnly: true }).hasNext();
  const applied = existing
    ? new Set((await db.collection(MIGRATION_COLLECTION).find({}).toArray()).map((item) => item._id))
    : new Set();
  return migrations.map((migration) => ({
    id: migration.id,
    description: migration.description,
    status: applied.has(migration.id) ? 'applied' : 'pending',
  }));
}

async function main() {
  const command = process.argv[2] ?? 'up';
  const db = await mongoConnection.connect({ logger: console });
  if (command === 'up') {
    await runMigrations(db, console);
  } else if (command === 'status') {
    const status = await getMigrationStatus(db);
    console.table(status);
  } else {
    throw new Error(`Unknown migration command "${command}". Use "up" or "status".`);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main()
    .then(() => mongoConnection.close())
    .catch(async (error) => {
      console.error('Migration failed:', error);
      await mongoConnection.close();
      process.exitCode = 1;
    });
}

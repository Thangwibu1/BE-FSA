import { readFile } from 'node:fs/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';
import { mongoConnection } from './mongoConnection.js';
import { runMigrations } from './migrate.js';
import { syncCounters } from './counters.js';
import { COLLECTIONS, COLLECTION_NAMES } from '../../domain/collections.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const DEFAULT_SEED_FILE = path.resolve(__dirname, '../../../seed/db.json');

/**
 * Load MovieTheaterServer's db.json into MongoDB.
 *
 * Default mode only fills empty collections and is safe on application restart.
 * `fresh` intentionally clears every application collection before importing.
 */
export async function seedDatabase(db, logger = console, options = {}) {
  const seedFile = options.seedFile ?? DEFAULT_SEED_FILE;
  const source = JSON.parse(await readFile(seedFile, 'utf8'));
  const fresh = options.fresh === true;
  const summary = {};

  for (const name of COLLECTION_NAMES) {
    const rows = Array.isArray(source[name]) ? source[name] : [];
    const collection = db.collection(name);
    const existing = await collection.countDocuments();

    if (fresh && existing > 0) await collection.deleteMany({});
    if (!fresh && existing > 0) {
      summary[name] = { inserted: 0, skipped: existing };
      continue;
    }

    const definition = COLLECTIONS[name];
    const documents = rows.map((row) => {
      const id = row.id ?? row[definition.idField];
      if (!id) throw new Error(`Seed row in ${name} is missing id and ${definition.idField}`);
      return {
        ...row,
        id: String(id),
        [definition.idField]: String(row[definition.idField] ?? id),
        _id: String(id),
      };
    });

    if (documents.length > 0) await collection.insertMany(documents, { ordered: true });
    summary[name] = { inserted: documents.length, skipped: 0 };
  }

  await syncCounters(db);
  logger.info?.(`Seed complete for database "${db.databaseName}".`);
  for (const [name, result] of Object.entries(summary)) {
    logger.info?.(`  ${name.padEnd(16)} inserted=${String(result.inserted).padStart(4)} skipped=${result.skipped}`);
  }
  return summary;
}

async function main() {
  const fresh = process.argv.includes('--fresh') || process.argv.includes('--drop');
  const db = await mongoConnection.connect({ logger: console });
  await runMigrations(db, console);
  await seedDatabase(db, console, { fresh });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main()
    .then(() => mongoConnection.close())
    .catch(async (error) => {
      console.error('Seed failed:', error);
      await mongoConnection.close();
      process.exitCode = 1;
    });
}

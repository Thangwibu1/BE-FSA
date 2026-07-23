import createCollectionsAndIndexes from './001_create_collections_and_indexes.js';
import backfillIdsAndCounters from './002_backfill_ids_and_counters.js';

export const migrations = [
  createCollectionsAndIndexes,
  backfillIdsAndCounters,
];

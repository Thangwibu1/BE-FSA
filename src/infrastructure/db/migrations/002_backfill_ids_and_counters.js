import { COLLECTIONS } from '../../../domain/collections.js';
import { syncCounters } from '../counters.js';

export default {
  id: '002_backfill_ids_and_counters',
  description: 'Backfill public/business ids and initialize atomic id counters',
  async up(db) {
    for (const definition of Object.values(COLLECTIONS)) {
      const collection = db.collection(definition.name);
      const rows = await collection.find({
        $or: [
          { id: { $exists: false } },
          { [definition.idField]: { $exists: false } },
        ],
      }).toArray();

      for (const row of rows) {
        const publicId = row.id ?? row[definition.idField] ?? String(row._id);
        const businessId = row[definition.idField] ?? publicId;
        await collection.updateOne(
          { _id: row._id },
          { $set: { id: String(publicId), [definition.idField]: String(businessId) } },
        );
      }
    }

    await syncCounters(db);
  },
};

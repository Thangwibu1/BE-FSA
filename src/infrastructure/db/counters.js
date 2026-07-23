import { COLLECTIONS } from '../../domain/collections.js';

function highestSequence(rows, definition) {
  let max = 0;
  for (const row of rows) {
    const value = row?.[definition.idField];
    if (typeof value !== 'string' || !value.startsWith(definition.idPrefix)) continue;
    const sequence = Number.parseInt(value.slice(definition.idPrefix.length), 10);
    if (Number.isFinite(sequence)) max = Math.max(max, sequence);
  }
  return max;
}

/** Rebuild atomic id counters from the current business ids. */
export async function syncCounters(db) {
  const counters = db.collection('_counters');
  for (const definition of Object.values(COLLECTIONS)) {
    const rows = await db.collection(definition.name)
      .find({}, { projection: { [definition.idField]: 1 } })
      .toArray();
    await counters.replaceOne(
      { _id: definition.name },
      { _id: definition.name, seq: highestSequence(rows, definition), updatedAt: new Date() },
      { upsert: true },
    );
  }
}

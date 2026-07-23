import { mkdir, writeFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import path from 'node:path';
import { mongoConnection } from './mongoConnection.js';
import { runMigrations } from './migrate.js';
import { syncCounters } from './counters.js';
import { buildShowtimeSchedule, validateShowtimeSchedule } from './showtimeSchedule.js';

const findFlag = (name, fallback) => {
  const prefix = `--${name}=`;
  return process.argv.find((arg) => arg.startsWith(prefix))?.slice(prefix.length) ?? fallback;
};

function saigonToday() {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Ho_Chi_Minh', year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(new Date());
  const value = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${value.year}-${value.month}-${value.day}`;
}

function addDays(dateString, days) {
  const date = new Date(`${dateString}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

async function insertInChunks(collection, documents, size = 5_000) {
  for (let index = 0; index < documents.length; index += size) {
    await collection.insertMany(documents.slice(index, index + size), { ordered: true });
  }
}

async function restoreBackup(db, backup) {
  for (const name of ['TICKET', 'POINT_HISTORY', 'BOOKING_SEAT', 'BOOKING', 'SHOWTIME_SEAT', 'SHOWTIME']) {
    await db.collection(name).deleteMany({});
  }
  for (const name of ['SHOWTIME', 'SHOWTIME_SEAT', 'BOOKING', 'BOOKING_SEAT', 'TICKET', 'POINT_HISTORY']) {
    if (backup[name].length > 0) await insertInChunks(db.collection(name), backup[name]);
  }
  await syncCounters(db);
}

export async function reseedShowtimes(db, options = {}) {
  const startDate = options.startDate ?? addDays(saigonToday(), 1);
  const days = Number(options.days ?? 30);
  const showsPerMovie = Number(options.showsPerMovie ?? 5);
  const dryRun = options.dryRun === true;

  const movies = await db.collection('MOVIE').find({}).sort({ movieId: 1 }).toArray();
  const rooms = await db.collection('CINEMA_ROOM').find({ status: 'ACTIVE' }).sort({ roomId: 1 }).toArray();
  const roomIds = rooms.map((room) => room.roomId ?? room.id);
  const seats = await db.collection('SEAT').find({ roomId: { $in: roomIds }, status: 'ACTIVE' }).toArray();
  const generated = buildShowtimeSchedule({ movies, rooms, seats, startDate, days, showsPerMovie });

  const summary = {
    startDate,
    endDate: addDays(startDate, days - 1),
    movies: movies.length,
    activeRooms: rooms.length,
    showsPerMoviePerDay: showsPerMovie,
    showtimes: generated.showtimes.length,
    showtimeSeats: generated.showtimeSeats.length,
    dryRun,
  };
  if (dryRun) return summary;

  const oldShowtimes = await db.collection('SHOWTIME').find({}).toArray();
  const oldShowtimeIds = oldShowtimes.map((row) => row.showtimeId ?? row.id);
  const oldShowtimeSeats = await db.collection('SHOWTIME_SEAT').find({ showtimeId: { $in: oldShowtimeIds } }).toArray();
  const oldBookings = await db.collection('BOOKING').find({ showtimeId: { $in: oldShowtimeIds } }).toArray();
  const oldBookingIds = oldBookings.map((row) => row.bookingId ?? row.id);
  const oldBookingSeats = oldBookingIds.length
    ? await db.collection('BOOKING_SEAT').find({ bookingId: { $in: oldBookingIds } }).toArray()
    : [];
  const oldBookingSeatIds = oldBookingSeats.map((row) => row.bookingSeatId ?? row.id);
  const ticketClauses = [];
  if (oldBookingIds.length) ticketClauses.push({ bookingId: { $in: oldBookingIds } });
  if (oldBookingSeatIds.length) ticketClauses.push({ bookingSeatId: { $in: oldBookingSeatIds } });
  const oldTickets = ticketClauses.length
    ? await db.collection('TICKET').find({ $or: ticketClauses }).toArray()
    : [];
  // Store full related collections so rollback restores the database exactly,
  // including history records unrelated to the showtimes being replaced.
  const backup = {};
  for (const name of ['SHOWTIME', 'SHOWTIME_SEAT', 'BOOKING', 'BOOKING_SEAT', 'TICKET', 'POINT_HISTORY']) {
    backup[name] = await db.collection(name).find({}).toArray();
  }

  const backupDirectory = path.resolve('backups');
  await mkdir(backupDirectory, { recursive: true });
  const stamp = new Date().toISOString().replaceAll(':', '-');
  const backupPath = path.join(backupDirectory, `showtime-reset-${stamp}.json`);
  await writeFile(backupPath, JSON.stringify(backup, null, 2), 'utf8');

  try {
    if (oldBookingIds.length) {
      await db.collection('TICKET').deleteMany({ $or: ticketClauses });
      await db.collection('POINT_HISTORY').deleteMany({ bookingId: { $in: oldBookingIds } });
      await db.collection('BOOKING_SEAT').deleteMany({ bookingId: { $in: oldBookingIds } });
      await db.collection('BOOKING').deleteMany({ showtimeId: { $in: oldShowtimeIds } });
    }
    await db.collection('SHOWTIME_SEAT').deleteMany({});
    await db.collection('SHOWTIME').deleteMany({});
    await insertInChunks(db.collection('SHOWTIME'), generated.showtimes);
    await insertInChunks(db.collection('SHOWTIME_SEAT'), generated.showtimeSeats);
    await syncCounters(db);

    const persistedShowtimes = await db.collection('SHOWTIME').find({}).toArray();
    validateShowtimeSchedule({
      showtimes: persistedShowtimes,
      movieIds: movies.map((movie) => movie.movieId ?? movie.id),
      days,
      showsPerMovie,
      turnaroundMinutes: 20,
    });
    summary.backupPath = backupPath;
    summary.removedDependentBookings = oldBookings.length;
    summary.removedDependentTickets = oldTickets.length;
    return summary;
  } catch (error) {
    await restoreBackup(db, backup);
    throw error;
  }
}

async function main() {
  const db = await mongoConnection.connect({ logger: console });
  await runMigrations(db, console);
  const summary = await reseedShowtimes(db, {
    startDate: findFlag('start', undefined),
    days: findFlag('days', 30),
    showsPerMovie: findFlag('shows-per-movie', 5),
    dryRun: process.argv.includes('--dry-run'),
  });
  console.log(JSON.stringify(summary, null, 2));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main()
    .then(() => mongoConnection.close())
    .catch(async (error) => {
      console.error('Showtime reseed failed:', error);
      await mongoConnection.close();
      process.exitCode = 1;
    });
}

const MINUTES_PER_DAY = 24 * 60;

function addDays(dateString, days) {
  const date = new Date(`${dateString}T00:00:00Z`);
  if (Number.isNaN(date.getTime())) throw new Error(`Invalid start date: ${dateString}`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function localIso(date, minuteOfDay) {
  const hour = Math.floor(minuteOfDay / 60);
  const minute = minuteOfDay % 60;
  return `${date}T${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}:00+07:00`;
}

function basePriceForRoom(room) {
  const type = String(room.screenType ?? '').toUpperCase();
  if (type.includes('4DX')) return 150_000;
  if (type.includes('IMAX')) return 130_000;
  if (type.includes('SCREENX')) return 120_000;
  if (type.includes('3D')) return 100_000;
  return 80_000;
}

function rotate(rows, offset) {
  if (rows.length === 0) return [];
  const normalized = offset % rows.length;
  return [...rows.slice(normalized), ...rows.slice(0, normalized)];
}

/**
 * Build a deterministic schedule with a turnaround gap. A movie never
 * overlaps itself, and a room never hosts overlapping shows.
 */
export function buildShowtimeSchedule({
  movies,
  rooms,
  seats,
  startDate,
  days = 30,
  showsPerMovie = 5,
  openingHour = 6,
  turnaroundMinutes = 20,
}) {
  if (!Array.isArray(movies) || movies.length === 0) throw new Error('At least one movie is required');
  if (!Array.isArray(rooms) || rooms.length === 0) throw new Error('At least one active room is required');
  if (!Number.isInteger(days) || days < 1) throw new Error('days must be a positive integer');
  if (!Number.isInteger(showsPerMovie) || showsPerMovie < 1) throw new Error('showsPerMovie must be a positive integer');

  const normalizedMovies = [...movies]
    .map((movie) => ({ ...movie, movieId: String(movie.movieId ?? movie.id), durationMin: Number(movie.durationMin) }))
    .sort((left, right) => left.movieId.localeCompare(right.movieId));
  if (normalizedMovies.some((movie) => !movie.movieId || !Number.isFinite(movie.durationMin) || movie.durationMin <= 0)) {
    throw new Error('Every movie must have an id and a positive durationMin');
  }

  const normalizedRooms = [...rooms]
    .map((room) => ({ ...room, roomId: String(room.roomId ?? room.id) }))
    .sort((left, right) => left.roomId.localeCompare(right.roomId));
  const seatsByRoom = new Map();
  for (const seat of seats) {
    const roomSeats = seatsByRoom.get(seat.roomId) ?? [];
    roomSeats.push(seat);
    seatsByRoom.set(seat.roomId, roomSeats);
  }
  for (const room of normalizedRooms) {
    const roomSeats = seatsByRoom.get(room.roomId) ?? [];
    if (roomSeats.length === 0) throw new Error(`Active room ${room.roomId} has no active seats`);
    roomSeats.sort((left, right) => String(left.seatId ?? left.id).localeCompare(String(right.seatId ?? right.id)));
  }

  const showtimes = [];
  const showtimeSeats = [];
  let showtimeSequence = 0;
  let showtimeSeatSequence = 0;
  const openingMinute = openingHour * 60;

  for (let dayIndex = 0; dayIndex < days; dayIndex += 1) {
    const date = addDays(startDate, dayIndex);
    const roomAvailableAt = new Map(normalizedRooms.map((room) => [room.roomId, openingMinute]));
    const movieAvailableAt = new Map(normalizedMovies.map((movie) => [movie.movieId, openingMinute]));

    for (let round = 0; round < showsPerMovie; round += 1) {
      // Keep the duration-balanced movie order stable across days. Rotating
      // it by day can cluster several long titles late and push the last show
      // past midnight; room rotation still varies room allocation by date.
      const movieOrder = rotate(normalizedMovies, round * 7);
      const roomOrder = rotate(normalizedRooms, dayIndex + round * 5);

      for (const movie of movieOrder) {
        let selectedRoom;
        let selectedStart = Number.POSITIVE_INFINITY;
        for (const room of roomOrder) {
          const candidate = Math.max(
            roomAvailableAt.get(room.roomId),
            movieAvailableAt.get(movie.movieId),
          );
          if (candidate < selectedStart) {
            selectedStart = candidate;
            selectedRoom = room;
          }
        }

        const endMinute = selectedStart + movie.durationMin;
        if (endMinute >= MINUTES_PER_DAY) {
          throw new Error(
            `Schedule capacity exceeded on ${date}; ${movie.title ?? movie.movieId} would end after midnight`,
          );
        }

        showtimeSequence += 1;
        const showtimeId = `show_${String(showtimeSequence).padStart(6, '0')}`;
        const format = String(selectedRoom.screenType || movie.version || '2D').toUpperCase();
        const basePrice = basePriceForRoom(selectedRoom);
        const showtime = {
          _id: showtimeId,
          id: showtimeId,
          showtimeId,
          movieId: movie.movieId,
          roomId: selectedRoom.roomId,
          startAt: localIso(date, selectedStart),
          endAt: localIso(date, endMinute),
          basePrice,
          format,
          status: 'OPEN',
        };
        showtimes.push(showtime);

        for (const seat of seatsByRoom.get(selectedRoom.roomId)) {
          showtimeSeatSequence += 1;
          const showtimeSeatId = `sh_st_${String(showtimeSeatSequence).padStart(8, '0')}`;
          const seatType = String(seat.seatType).toUpperCase() === 'VIP' ? 'VIP' : 'STANDARD';
          showtimeSeats.push({
            _id: showtimeSeatId,
            id: showtimeSeatId,
            showtimeSeatId,
            showtimeId,
            seatId: String(seat.seatId ?? seat.id),
            seatType,
            status: 'AVAILABLE',
            price: basePrice + (seatType === 'VIP' ? 50_000 : 0),
          });
        }

        roomAvailableAt.set(selectedRoom.roomId, endMinute + turnaroundMinutes);
        movieAvailableAt.set(movie.movieId, endMinute + turnaroundMinutes);
      }
    }
  }

  validateShowtimeSchedule({
    showtimes,
    movieIds: normalizedMovies.map((movie) => movie.movieId),
    days,
    showsPerMovie,
    turnaroundMinutes,
  });
  return { showtimes, showtimeSeats };
}

export function validateShowtimeSchedule({ showtimes, movieIds, days, showsPerMovie, turnaroundMinutes = 0 }) {
  const byRoom = new Map();
  const byMovie = new Map();
  const counts = new Map();

  for (const showtime of showtimes) {
    const start = Date.parse(showtime.startAt);
    const end = Date.parse(showtime.endAt);
    if (!Number.isFinite(start) || !Number.isFinite(end) || start >= end) {
      throw new Error(`Invalid time window for ${showtime.showtimeId}`);
    }
    const roomRows = byRoom.get(showtime.roomId) ?? [];
    roomRows.push({ ...showtime, start, end });
    byRoom.set(showtime.roomId, roomRows);
    const movieRows = byMovie.get(showtime.movieId) ?? [];
    movieRows.push({ ...showtime, start, end });
    byMovie.set(showtime.movieId, movieRows);
    const key = `${showtime.startAt.slice(0, 10)}|${showtime.movieId}`;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }

  const assertNoOverlap = (groups, label, gap) => {
    for (const [id, rows] of groups) {
      rows.sort((left, right) => left.start - right.start);
      for (let index = 1; index < rows.length; index += 1) {
        if (rows[index].start < rows[index - 1].end + gap * 60_000) {
          throw new Error(`${label} ${id} conflicts: ${rows[index - 1].showtimeId} and ${rows[index].showtimeId}`);
        }
      }
    }
  };
  assertNoOverlap(byRoom, 'Room', turnaroundMinutes);
  assertNoOverlap(byMovie, 'Movie', turnaroundMinutes);

  const expectedDates = [...new Set(showtimes.map((row) => row.startAt.slice(0, 10)))];
  if (expectedDates.length !== days) throw new Error(`Expected ${days} schedule dates, found ${expectedDates.length}`);
  for (const date of expectedDates) {
    for (const movieId of movieIds) {
      const actual = counts.get(`${date}|${movieId}`) ?? 0;
      if (actual !== showsPerMovie) {
        throw new Error(`${movieId} has ${actual} shows on ${date}; expected ${showsPerMovie}`);
      }
    }
  }
  return true;
}

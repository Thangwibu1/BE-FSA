import assert from 'node:assert/strict';
import test from 'node:test';
import { buildShowtimeSchedule, validateShowtimeSchedule } from '../src/infrastructure/db/showtimeSchedule.js';

test('monthly showtime builder creates five conflict-free shows per movie per day', () => {
  const movies = [
    { movieId: 'mov_a', title: 'A', durationMin: 120 },
    { movieId: 'mov_b', title: 'B', durationMin: 100 },
  ];
  const rooms = [
    { roomId: 'room_a', screenType: '2D', status: 'ACTIVE' },
    { roomId: 'room_b', screenType: 'IMAX', status: 'ACTIVE' },
  ];
  const seats = [
    { seatId: 'seat_a', roomId: 'room_a', seatType: 'STANDARD' },
    { seatId: 'seat_b', roomId: 'room_b', seatType: 'VIP' },
  ];
  const result = buildShowtimeSchedule({
    movies, rooms, seats, startDate: '2030-01-01', days: 2, showsPerMovie: 5,
  });

  assert.equal(result.showtimes.length, 20);
  assert.equal(result.showtimeSeats.length, 20);
  assert.equal(new Set(result.showtimes.map((row) => row.showtimeId)).size, 20);
  assert.equal(new Set(result.showtimeSeats.map((row) => row.showtimeSeatId)).size, 20);
  assert.ok(result.showtimeSeats.some((row) => row.price === 180000));
  assert.equal(validateShowtimeSchedule({
    showtimes: result.showtimes,
    movieIds: movies.map((movie) => movie.movieId),
    days: 2,
    showsPerMovie: 5,
    turnaroundMinutes: 20,
  }), true);
});

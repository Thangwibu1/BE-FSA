import { COLLECTIONS } from '../../domain/collections.js';
import { ConflictError, NotFoundError, ValidationError } from '../../shared/errors.js';

const POINTS_PER_TICKET = 100;
const POINT_EARN_RATE = 0.1;

export class BookingService {
  constructor(repository) {
    this.repository = repository;
  }

  async createOnline(accountId, body) {
    return this.#createSale({ ...body, accountId, source: 'ONLINE' });
  }

  async createCounter(employeeId, body) {
    return this.#createSale({ ...body, employeeId, accountId: body.accountId || null, source: 'COUNTER' });
  }

  async quoteOnline(accountId, body) {
    return this.#quoteSale({ ...body, accountId, source: 'ONLINE' });
  }

  async quoteCounter(employeeId, body) {
    return this.#quoteSale({ ...body, employeeId, accountId: body.accountId || null, source: 'COUNTER' });
  }

  async #createSale({ showtimeId, showtimeSeatIds, promotionCode, convertedTicketQuantity = 0, accountId, employeeId, source }) {
    const pricing = await this.#priceSale({
      showtimeId, showtimeSeatIds, promotionCode, convertedTicketQuantity, accountId, source,
    });
    const {
      showtime, seats, profile, converted, pointsUsed, promotion, subtotalAmount,
      discountAmount, totalAmount, pointsEarned,
    } = pricing;
    const now = new Date().toISOString();
    const reserved = [];
    const created = [];
    let profileUpdated = false;

    try {
      for (const seat of seats) {
        const result = await this.repository.patchWhere(
          COLLECTIONS.SHOWTIME_SEAT.name, seat.id, { status: 'BOOKED' }, { status: 'AVAILABLE' },
        );
        if (!result) throw new ConflictError(`Seat ${seat.seatId} has already been booked`);
        reserved.push(seat);
      }

      const bookingId = await this.repository.nextBusinessId(COLLECTIONS.BOOKING);
      const booking = await this.repository.insert(COLLECTIONS.BOOKING.name, {
        id: bookingId, bookingId, bookingCode: bookingId, accountId: accountId ?? null,
        showtimeId: showtime.showtimeId, promotionId: promotion?.promotionId ?? null,
        bookedByEmployeeId: employeeId ?? null, subtotalAmount, discountAmount, pointsUsed,
        pointsEarned, totalAmount, paymentMethod: source === 'COUNTER' ? 'CASH' : 'CASH',
        paymentStatus: 'PAID', bookingStatus: 'CONFIRMED', bookingSource: source,
        customerType: accountId ? 'MEMBER' : 'WALK_IN', convertedTicketQuantity: converted,
        pointsPerTicket: POINTS_PER_TICKET, createdAt: now, updatedAt: now,
      });
      created.push([COLLECTIONS.BOOKING.name, booking.id]);

      const tickets = [];
      for (let index = 0; index < reserved.length; index += 1) {
        const seat = reserved[index];
        const bookingSeatId = await this.repository.nextBusinessId(COLLECTIONS.BOOKING_SEAT);
        const bookingSeat = await this.repository.insert(COLLECTIONS.BOOKING_SEAT.name, {
          id: bookingSeatId, bookingSeatId, bookingId, showtimeSeatId: seat.showtimeSeatId,
          price: Number(seat.price || showtime.basePrice || 0),
        });
        created.push([COLLECTIONS.BOOKING_SEAT.name, bookingSeat.id]);
        const ticketId = await this.repository.nextBusinessId(COLLECTIONS.TICKET);
        const ticket = await this.repository.insert(COLLECTIONS.TICKET.name, {
          id: ticketId, ticketId, bookingId, bookingSeatId, ticketCode: `QR-${bookingId}-${index + 1}`,
          issuedAt: now, isUsed: false, usedAt: null, checkedInByEmployeeId: null,
        });
        created.push([COLLECTIONS.TICKET.name, ticket.id]);
        tickets.push(ticket);
      }

      if (profile) {
        await this.repository.patch(COLLECTIONS.MEMBER_PROFILE.name, profile.id, {
          points: profile.points - pointsUsed + pointsEarned,
        });
        profileUpdated = true;
        if (pointsUsed > 0) await this.#pointHistory(accountId, bookingId, showtime.movieId, 'USE', pointsUsed, 'Points used to convert tickets', now, created);
        if (pointsEarned > 0) await this.#pointHistory(accountId, bookingId, showtime.movieId, 'EARN', pointsEarned, 'Points earned from booking', now, created);
      }
      return { booking, tickets, pointsBalance: profile ? profile.points - pointsUsed + pointsEarned : null };
    } catch (error) {
      for (const [collection, id] of created.reverse()) await this.repository.delete(collection, id).catch(() => {});
      if (profileUpdated) {
        await this.repository.patch(COLLECTIONS.MEMBER_PROFILE.name, profile.id, { points: profile.points }).catch(() => {});
      }
      for (const seat of reserved) await this.repository.patch(COLLECTIONS.SHOWTIME_SEAT.name, seat.id, { status: 'AVAILABLE' }).catch(() => {});
      throw error;
    }
  }

  async #quoteSale(args) {
    const pricing = await this.#priceSale(args);
    return {
      promotionId: pricing.promotion?.promotionId ?? null,
      promotionCode: pricing.promotion?.code ?? null,
      subtotalAmount: pricing.subtotalAmount,
      pointDiscount: pricing.pointDiscount,
      promotionDiscount: pricing.promotionDiscount,
      discountAmount: pricing.discountAmount,
      totalAmount: pricing.totalAmount,
      pointsUsed: pricing.pointsUsed,
    };
  }

  async #priceSale({ showtimeId, showtimeSeatIds, promotionCode, convertedTicketQuantity = 0, accountId, source }) {
    if (!showtimeId || !Array.isArray(showtimeSeatIds) || showtimeSeatIds.length < 1 || showtimeSeatIds.length > 8) {
      throw new ValidationError('A showtime and between 1 and 8 seats are required');
    }
    if (new Set(showtimeSeatIds).size !== showtimeSeatIds.length) throw new ValidationError('Seats must be unique');
    const converted = Number(convertedTicketQuantity || 0);
    if (!Number.isInteger(converted) || converted < 0 || converted > showtimeSeatIds.length) {
      throw new ValidationError('Converted ticket quantity is invalid');
    }

    const showtime = await this.repository.findById(COLLECTIONS.SHOWTIME.name, showtimeId);
    if (!showtime || showtime.status !== 'OPEN') throw new ValidationError('Showtime is not open for booking');
    const seats = [];
    for (const id of showtimeSeatIds) {
      const seat = await this.repository.findById(COLLECTIONS.SHOWTIME_SEAT.name, id);
      if (!seat || seat.showtimeId !== showtime.showtimeId) throw new ValidationError(`Seat ${id} does not belong to this showtime`);
      seats.push(seat);
    }

    let profile = null;
    const pointsUsed = converted * POINTS_PER_TICKET;
    if (accountId) {
      profile = await this.repository.findOne(COLLECTIONS.MEMBER_PROFILE.name, { accountId });
      if (!profile) throw new ValidationError('Member profile not found');
      if (profile.points < pointsUsed) throw new ValidationError('Not enough member points');
    } else if (converted > 0) {
      throw new ValidationError('A member account is required to convert points');
    }

    const subtotalAmount = seats.reduce((sum, seat) => sum + Number(seat.price || showtime.basePrice || 0), 0);
    const pointDiscount = seats.slice(0, converted).reduce((sum, seat) => sum + Number(seat.price || showtime.basePrice || 0), 0);
    const promotion = await this.#resolvePromotion(promotionCode, {
      amount: subtotalAmount - pointDiscount, showtime, seats, accountId, source,
    });
    const promotionDiscount = this.#promotionDiscount(promotion, subtotalAmount - pointDiscount);
    const discountAmount = Math.min(subtotalAmount, pointDiscount + promotionDiscount);
    const totalAmount = Math.max(0, subtotalAmount - discountAmount);
    const pointsEarned = accountId ? Math.floor(totalAmount * POINT_EARN_RATE) : 0;
    return {
      showtime, seats, profile, converted, pointsUsed, promotion, subtotalAmount, pointDiscount,
      promotionDiscount, discountAmount, totalAmount, pointsEarned,
    };
  }

  async convertBooking(bookingId, employeeId, { convertedTicketQuantity = 0 } = {}) {
    const booking = await this.repository.findById(COLLECTIONS.BOOKING.name, bookingId);
    if (!booking) throw new NotFoundError('Booking not found');
    if (['CANCELLED', 'EXPIRED', 'CONVERTED_TO_TICKET', 'CONVERSION_PROCESSING'].includes(booking.bookingStatus)) throw new ConflictError('This booking cannot be converted');
    const bookingSeats = await this.repository.findMany(COLLECTIONS.BOOKING_SEAT.name, { bookingId: booking.bookingId });
    if (bookingSeats.length === 0) throw new ValidationError('This booking has no seats');
    const converted = Number(convertedTicketQuantity || 0);
    if (!Number.isInteger(converted) || converted < 0 || converted > bookingSeats.length) throw new ValidationError('Converted ticket quantity is invalid');
    const requiredPoints = converted * POINTS_PER_TICKET;
    let profile = null;
    if (requiredPoints > 0) {
      if (!booking.accountId) throw new ValidationError('This booking has no member account');
      profile = await this.repository.findOne(COLLECTIONS.MEMBER_PROFILE.name, { accountId: booking.accountId });
      if (!profile || profile.points < requiredPoints) throw new ValidationError('Not enough member points');
    }
    const now = new Date().toISOString();
    const locked = await this.repository.patchWhere(
      COLLECTIONS.BOOKING.name,
      booking.id,
      { bookingStatus: 'CONVERSION_PROCESSING', updatedAt: now },
      { bookingStatus: booking.bookingStatus },
    );
    if (!locked) throw new ConflictError('This booking is being converted by another employee');

    const created = [];
    let profileUpdated = false;
    try {
      const existing = await this.repository.findMany(COLLECTIONS.TICKET.name, { bookingId: booking.bookingId });
      const existingSeatIds = new Set(existing.map((ticket) => ticket.bookingSeatId));
      const tickets = [...existing];
      for (const seat of bookingSeats.filter((item) => !existingSeatIds.has(item.bookingSeatId))) {
        const ticketId = await this.repository.nextBusinessId(COLLECTIONS.TICKET);
        const ticket = await this.repository.insert(COLLECTIONS.TICKET.name, {
          id: ticketId, ticketId, bookingId: booking.bookingId, bookingSeatId: seat.bookingSeatId,
          ticketCode: `QR-${booking.bookingId}-${tickets.length + 1}`, issuedAt: now, isUsed: false,
          usedAt: null, checkedInByEmployeeId: null,
        });
        tickets.push(ticket);
        created.push([COLLECTIONS.TICKET.name, ticket.id]);
      }
      if (profile) {
        await this.repository.patch(COLLECTIONS.MEMBER_PROFILE.name, profile.id, { points: profile.points - requiredPoints });
        profileUpdated = true;
        const showtime = await this.repository.findById(COLLECTIONS.SHOWTIME.name, booking.showtimeId);
        await this.#pointHistory(
          booking.accountId, booking.bookingId, showtime?.movieId, 'USE', requiredPoints,
          'Points used when converting booking', now, created,
        );
      }
      const pointDiscount = bookingSeats.slice(0, converted).reduce((sum, seat) => sum + Number(seat.price || 0), 0);
      const subtotalAmount = Number(booking.subtotalAmount || bookingSeats.reduce((sum, seat) => sum + Number(seat.price || 0), 0));
      const discountAmount = Math.min(subtotalAmount, Number(booking.discountAmount || 0) + pointDiscount);
      const updatedBooking = await this.repository.patch(COLLECTIONS.BOOKING.name, booking.id, {
        bookingStatus: 'CONVERTED_TO_TICKET', convertedTicketQuantity: converted,
        pointsUsed: Number(booking.pointsUsed || 0) + requiredPoints,
        discountAmount, totalAmount: Math.max(0, subtotalAmount - discountAmount),
        confirmedAt: now, confirmedByEmployeeId: employeeId, updatedAt: now,
      });
      return { booking: updatedBooking, tickets, pointsBalance: profile ? profile.points - requiredPoints : null };
    } catch (error) {
      for (const [collection, id] of created.reverse()) await this.repository.delete(collection, id).catch(() => {});
      if (profileUpdated) {
        await this.repository.patch(COLLECTIONS.MEMBER_PROFILE.name, profile.id, { points: profile.points }).catch(() => {});
      }
      await this.repository.patch(COLLECTIONS.BOOKING.name, booking.id, {
        bookingStatus: booking.bookingStatus, updatedAt: booking.updatedAt ?? now,
      }).catch(() => {});
      throw error;
    }
  }

  async checkIn(ticketId, employeeId) {
    let tickets = await this.repository.findMany(COLLECTIONS.TICKET.name, { bookingId: ticketId });
    if (tickets.length === 0) {
      const ticket = await this.repository.findOne(COLLECTIONS.TICKET.name, {
        $or: [{ id: ticketId }, { ticketId }, { ticketCode: ticketId }],
      });
      tickets = ticket ? [ticket] : [];
    }
    if (tickets.length === 0) throw new NotFoundError('Ticket not found');
    if (tickets.every((ticket) => ticket.isUsed)) throw new ConflictError('Ticket has already been used');
    const now = new Date().toISOString();
    const updated = [];
    for (const ticket of tickets.filter((item) => !item.isUsed)) {
      updated.push(await this.repository.patch(COLLECTIONS.TICKET.name, ticket.id, {
        isUsed: true, usedAt: now, checkedInByEmployeeId: employeeId,
      }));
    }
    return { message: 'Ticket checked in successfully', tickets: updated };
  }

  async #resolvePromotion(code, { amount, showtime, seats, accountId, source }) {
    const normalizedCode = String(code ?? '').trim().toUpperCase();
    if (!normalizedCode) return null;
    const promotions = await this.repository.findMany(COLLECTIONS.PROMOTION.name, {});
    const promotion = promotions.find((row) => String(row.code ?? '').trim().toUpperCase() === normalizedCode);
    if (!promotion) throw new ValidationError('Voucher code does not exist');

    const now = Date.now();
    const startAt = promotion.startAt ? Date.parse(promotion.startAt) : null;
    const endAt = promotion.endAt ? Date.parse(promotion.endAt) : null;
    if (String(promotion.status).toUpperCase() !== 'ACTIVE') throw new ValidationError('Voucher is not active');
    if (startAt !== null && (!Number.isFinite(startAt) || startAt > now)) throw new ValidationError('Voucher is not active yet');
    if (endAt !== null && (!Number.isFinite(endAt) || endAt < now)) throw new ValidationError('Voucher has expired');
    if (amount < Number(promotion.minOrderAmount || 0)) {
      throw new ValidationError(`Order must be at least ${Number(promotion.minOrderAmount || 0)} VND for this voucher`);
    }

    const sources = (promotion.applicableSources ?? []).map((value) => String(value).toUpperCase());
    if (sources.length && !sources.includes(String(source).toUpperCase())) {
      throw new ValidationError(`Voucher is only valid for ${sources.join(' or ')} bookings`);
    }
    if (promotion.memberOnly && !accountId) throw new ValidationError('Voucher is only valid for members');
    if (Number(promotion.minTickets || 0) > seats.length) {
      throw new ValidationError(`Voucher requires at least ${promotion.minTickets} tickets`);
    }
    if (promotion.maxTickets != null && seats.length > Number(promotion.maxTickets)) {
      throw new ValidationError(`Voucher is limited to ${promotion.maxTickets} tickets`);
    }

    const formats = (promotion.applicableFormats ?? []).map((value) => String(value).toUpperCase());
    if (formats.length && !formats.some((format) => String(showtime.format).toUpperCase().includes(format))) {
      throw new ValidationError(`Voucher is only valid for ${formats.join(', ')} showtimes`);
    }
    const weekday = new Intl.DateTimeFormat('en-US', {
      timeZone: 'Asia/Ho_Chi_Minh', weekday: 'long',
    }).format(new Date(showtime.startAt)).toUpperCase();
    const days = (promotion.applicableDaysOfWeek ?? []).map((value) => String(value).toUpperCase());
    if (days.length && !days.includes(weekday)) {
      throw new ValidationError(`Voucher is only valid on ${days.join(', ')}`);
    }

    const localHour = Number(new Intl.DateTimeFormat('en-US', {
      timeZone: 'Asia/Ho_Chi_Minh', hour: '2-digit', hourCycle: 'h23',
    }).format(new Date(showtime.startAt)));
    if (promotion.startHour != null && localHour < Number(promotion.startHour)) {
      throw new ValidationError(`Voucher is only valid from ${promotion.startHour}:00`);
    }
    if (promotion.endHour != null && localHour >= Number(promotion.endHour)) {
      throw new ValidationError(`Voucher is only valid before ${promotion.endHour}:00`);
    }
    if (promotion.minimumAdvanceHours != null
      && Date.parse(showtime.startAt) - now < Number(promotion.minimumAdvanceHours) * 60 * 60_000) {
      throw new ValidationError(`Voucher requires booking at least ${promotion.minimumAdvanceHours} hours in advance`);
    }

    if (promotion.firstBookingOnly && accountId) {
      const previousBookings = await this.repository.findMany(COLLECTIONS.BOOKING.name, { accountId });
      if (previousBookings.some((booking) => booking.paymentStatus === 'PAID' && booking.bookingStatus !== 'CANCELLED')) {
        throw new ValidationError('Voucher is only valid for the first booking');
      }
    }
    if (promotion.usageLimit != null) {
      const used = await this.repository.findMany(COLLECTIONS.BOOKING.name, { promotionId: promotion.promotionId });
      if (used.filter((booking) => booking.bookingStatus !== 'CANCELLED').length >= Number(promotion.usageLimit)) {
        throw new ValidationError('Voucher usage limit has been reached');
      }
    }
    if (promotion.perMemberLimit != null && accountId) {
      const used = await this.repository.findMany(COLLECTIONS.BOOKING.name, { promotionId: promotion.promotionId, accountId });
      if (used.filter((booking) => booking.bookingStatus !== 'CANCELLED').length >= Number(promotion.perMemberLimit)) {
        throw new ValidationError('You have reached the usage limit for this voucher');
      }
    }
    return { ...promotion, code: normalizedCode };
  }

  #promotionDiscount(promotion, amount) {
    if (!promotion) return 0;
    const type = String(promotion.discountType).toUpperCase();
    const value = Number(promotion.discountValue);
    if (!Number.isFinite(value) || value <= 0 || !['PERCENT', 'FIXED_AMOUNT'].includes(type)) {
      throw new ValidationError('Voucher discount configuration is invalid');
    }
    if (type === 'PERCENT' && value > 100) throw new ValidationError('Voucher percentage cannot exceed 100%');
    const raw = type === 'PERCENT' ? amount * value / 100 : value;
    const cap = promotion.maxDiscountAmount == null ? raw : Number(promotion.maxDiscountAmount);
    return Math.max(0, Math.floor(Math.min(raw, Number.isFinite(cap) ? cap : raw, amount)));
  }

  async #pointHistory(accountId, bookingId, movieId, type, points, description, createdAt, created = []) {
    const pointHistoryId = await this.repository.nextBusinessId(COLLECTIONS.POINT_HISTORY);
    const row = await this.repository.insert(COLLECTIONS.POINT_HISTORY.name, {
      id: pointHistoryId, pointHistoryId, accountId, bookingId, movieId: movieId ?? null,
      transactionType: type, points, createdAt, description,
    });
    created.push([COLLECTIONS.POINT_HISTORY.name, row.id]);
    return row;
  }
}

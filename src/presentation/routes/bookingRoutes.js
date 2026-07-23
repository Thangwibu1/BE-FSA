import {
  bearerSecurity,
  checkInResponseSchema,
  errorResponses,
  quoteResponseSchema,
  saleBodySchema,
  saleResponseSchema,
} from '../schemas/openApiSchemas.js';

const bookingIdParams = {
  type: 'object', required: ['id'],
  properties: {
    id: { type: 'string', minLength: 1, description: 'Booking public id or bookingId', example: 'BK-8271' },
  },
};

const checkInParams = {
  type: 'object', required: ['id'],
  properties: {
    id: {
      type: 'string', minLength: 1,
      description: 'Booking id (checks in all unused tickets) or a ticket public id, ticketId, or ticketCode',
      example: 'QR-BK-8271-1',
    },
  },
};

/** Register server-authoritative booking, pricing, conversion, and check-in APIs. */
export function registerBookingRoutes(fastify, controller, auth) {
  fastify.post('/bookings/quote', {
    preHandler: auth.authorize('MEMBER'),
    schema: {
      tags: ['Booking'], operationId: 'quoteOnlineBooking', summary: 'Quote an online member booking',
      description: 'MEMBER only. Validates seats, loyalty points, and voucher conditions, then calculates totals without reserving seats.',
      security: bearerSecurity,
      body: saleBodySchema,
      response: { 200: quoteResponseSchema, ...errorResponses(400, 401, 403, 404) },
    },
  }, controller.quoteOnline);

  fastify.post('/counter-sales/quote', {
    preHandler: auth.authorize('EMPLOYEE', 'ADMIN'),
    schema: {
      tags: ['Booking'], operationId: 'quoteCounterSale', summary: 'Quote a counter sale',
      description: 'EMPLOYEE or ADMIN only. Supports a member account or a walk-in customer and returns server-calculated totals without reserving seats.',
      security: bearerSecurity,
      body: saleBodySchema,
      response: { 200: quoteResponseSchema, ...errorResponses(400, 401, 403, 404) },
    },
  }, controller.quoteCounter);

  fastify.post('/bookings', {
    preHandler: auth.authorize('MEMBER'),
    schema: {
      tags: ['Booking'], operationId: 'createOnlineBooking', summary: 'Create an online member booking',
      description: 'MEMBER only. Recalculates prices, atomically reserves available seats, applies points/voucher rules, confirms the booking, and issues tickets.',
      security: bearerSecurity,
      body: saleBodySchema,
      response: { 201: saleResponseSchema, ...errorResponses(400, 401, 403, 404, 409) },
    },
  }, controller.createOnline);

  fastify.post('/counter-sales', {
    preHandler: auth.authorize('EMPLOYEE', 'ADMIN'),
    schema: {
      tags: ['Booking'], operationId: 'createCounterSale', summary: 'Create a counter sale',
      description: 'EMPLOYEE or ADMIN only. Creates a paid counter booking for a member or walk-in customer and issues tickets.',
      security: bearerSecurity,
      body: saleBodySchema,
      response: { 201: saleResponseSchema, ...errorResponses(400, 401, 403, 404, 409) },
    },
  }, controller.createCounter);

  fastify.post('/bookings/:id/convert', {
    preHandler: auth.authorize('EMPLOYEE', 'ADMIN'),
    schema: {
      tags: ['Booking'], operationId: 'convertBookingToTickets', summary: 'Convert a booking to tickets',
      description: 'EMPLOYEE or ADMIN only. Locks the booking against concurrent conversion, optionally spends member points, and issues any missing tickets.',
      security: bearerSecurity,
      params: bookingIdParams,
      body: {
        type: 'object', additionalProperties: false,
        properties: {
          convertedTicketQuantity: {
            type: 'integer', minimum: 0, maximum: 8, default: 0,
            description: 'Number of tickets converted using loyalty points (100 points each)', example: 1,
          },
        },
      },
      response: { 200: saleResponseSchema, ...errorResponses(400, 401, 403, 404, 409) },
    },
  }, controller.convert);

  fastify.post('/tickets/:id/check-in', {
    preHandler: auth.authorize('EMPLOYEE', 'ADMIN'),
    schema: {
      tags: ['Booking'], operationId: 'checkInTicket', summary: 'Check in one ticket or a booking',
      description: 'EMPLOYEE or ADMIN only. Marks one ticket, or all unused tickets belonging to a booking id, as used.',
      security: bearerSecurity,
      params: checkInParams,
      response: { 200: checkInResponseSchema, ...errorResponses(400, 401, 403, 404, 409) },
    },
  }, controller.checkIn);
}

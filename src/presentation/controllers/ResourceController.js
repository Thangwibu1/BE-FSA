import { parseListQuery } from '../../shared/queryParser.js';
import { ForbiddenError } from '../../shared/errors.js';

const MEMBER_DIRECT_RESOURCES = new Set(['ACCOUNT', 'MEMBER_PROFILE', 'BOOKING', 'POINT_HISTORY']);
const MEMBER_BOOKING_CHILD_RESOURCES = new Set(['BOOKING_SEAT', 'TICKET']);

/**
 * HTTP controller for a generic REST resource.
 *
 * Translates Fastify requests into {@link ResourceService} calls and shapes the
 * responses to match json-server exactly (so the existing Android client is a
 * drop-in consumer). Contains no business rules — purely transport glue.
 */
export class ResourceController {
  /** @param {import('../../application/services/ResourceService.js').ResourceService} service */
  constructor(service) {
    this.service = service;

    // Bind so the methods can be used directly as Fastify handlers.
    this.list = this.list.bind(this);
    this.getOne = this.getOne.bind(this);
    this.create = this.create.bind(this);
    this.replace = this.replace.bind(this);
    this.patch = this.patch.bind(this);
    this.remove = this.remove.bind(this);
  }

  async list(request, reply) {
    const query = parseListQuery(request.query);
    if (request.user?.role === 'MEMBER') {
      if (MEMBER_DIRECT_RESOURCES.has(this.service.name)) {
        query.filters = { ...query.filters, accountId: request.user.accountId };
      } else if (MEMBER_BOOKING_CHILD_RESOURCES.has(this.service.name)) {
        const bookings = await this.service.repository.findMany('BOOKING', { accountId: request.user.accountId });
        query.filters = { ...query.filters, bookingId: bookings.map((booking) => booking.bookingId) };
      }
    } else if (request.user?.role === 'EMPLOYEE' && this.service.name === 'ACCOUNT') {
      // Employees use ACCOUNT only for member lookup in POS/booking management.
      query.filters = { ...query.filters, role: 'MEMBER' };
    }
    const { data, total, paginated } = await this.service.list(query);

    // Expose total count the way json-server does (header) for clients that use it.
    reply.header('X-Total-Count', String(total));

    if (paginated) {
      // json-server v1 page-based responses are wrapped with metadata.
      const perPage = query.perPage ?? 10;
      return reply.send({
        first: 1,
        prev: query.page > 1 ? query.page - 1 : null,
        next: query.page * perPage < total ? query.page + 1 : null,
        last: Math.max(1, Math.ceil(total / perPage)),
        pages: Math.max(1, Math.ceil(total / perPage)),
        items: total,
        data,
      });
    }

    // Default: a plain array (what the Android client expects).
    return reply.send(data);
  }

  async getOne(request, reply) {
    const doc = await this.service.getById(request.params.id);
    if (request.user?.role === 'MEMBER') {
      if (MEMBER_DIRECT_RESOURCES.has(this.service.name) && doc.accountId !== request.user.accountId) {
        throw new ForbiddenError('You can only access your own records');
      }
      if (MEMBER_BOOKING_CHILD_RESOURCES.has(this.service.name)) {
        const booking = await this.service.repository.findOne('BOOKING', { bookingId: doc.bookingId });
        if (!booking || booking.accountId !== request.user.accountId) {
          throw new ForbiddenError('You can only access your own records');
        }
      }
    } else if (request.user?.role === 'EMPLOYEE' && this.service.name === 'ACCOUNT' && doc.role !== 'MEMBER') {
      throw new ForbiddenError('Employees can only access member accounts');
    }
    return reply.send(doc);
  }

  async create(request, reply) {
    const created = await this.service.create(request.body ?? {});
    return reply.code(201).send(created);
  }

  async replace(request, reply) {
    const replaced = await this.service.replace(request.params.id, request.body ?? {});
    return reply.send(replaced);
  }

  async patch(request, reply) {
    const patched = await this.service.patch(request.params.id, request.body ?? {});
    return reply.send(patched);
  }

  async remove(request, reply) {
    const deleted = await this.service.remove(request.params.id);
    return reply.send(deleted);
  }
}

export class BookingController {
  constructor(service) {
    this.service = service;
    this.createOnline = this.createOnline.bind(this);
    this.createCounter = this.createCounter.bind(this);
    this.quoteOnline = this.quoteOnline.bind(this);
    this.quoteCounter = this.quoteCounter.bind(this);
    this.convert = this.convert.bind(this);
    this.checkIn = this.checkIn.bind(this);
  }
  async createOnline(request, reply) { return reply.code(201).send(await this.service.createOnline(request.user.accountId, request.body)); }
  async createCounter(request, reply) { return reply.code(201).send(await this.service.createCounter(request.user.accountId, request.body)); }
  async quoteOnline(request, reply) { return reply.send(await this.service.quoteOnline(request.user.accountId, request.body)); }
  async quoteCounter(request, reply) { return reply.send(await this.service.quoteCounter(request.user.accountId, request.body)); }
  async convert(request, reply) { return reply.send(await this.service.convertBooking(request.params.id, request.user.accountId, request.body)); }
  async checkIn(request, reply) { return reply.send(await this.service.checkIn(request.params.id, request.user.accountId)); }
}

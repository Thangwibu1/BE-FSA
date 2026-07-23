import { AppError } from '../../shared/errors.js';

/**
 * Central error handler. Converts thrown {@link AppError}s (and unexpected
 * errors) into consistent JSON responses. Registered via `setErrorHandler`
 * so it captures failures from every route/use-case.
 *
 * @param {Error} error
 * @param {import('fastify').FastifyRequest} request
 * @param {import('fastify').FastifyReply} reply
 */
export function errorHandler(error, request, reply) {
  // Fastify schema validation errors.
  if (error.validation) {
    return reply.code(400).send({
      error: 'Validation failed',
      details: error.validation,
    });
  }

  if (error instanceof AppError) {
    if (error.statusCode >= 500) request.log.error(error);
    return reply.code(error.statusCode).send({
      error: error.message,
      ...(error.details ? { details: error.details } : {}),
    });
  }

  // Duplicate key from MongoDB unique index.
  if (error?.code === 11000) {
    return reply.code(409).send({ error: 'Resource already exists' });
  }

  // Fastify parser/content-type errors already carry a safe 4xx status.
  if (error?.statusCode >= 400 && error.statusCode < 500) {
    return reply.code(error.statusCode).send({ error: error.message });
  }

  request.log.error(error);
  return reply.code(500).send({
    error: 'Internal Server Error',
    message: error.message,
  });
}

import Fastify from 'fastify';
import { mkdir } from 'node:fs/promises';
import cors from '@fastify/cors';
import swagger from '@fastify/swagger';
import swaggerUi from '@fastify/swagger-ui';
import multipart from '@fastify/multipart';
import staticFiles from '@fastify/static';

import { config } from './config/env.js';
import { buildContainer } from './composition/container.js';
import { registerResourceRoutes } from './presentation/routes/resourceRoutes.js';
import { registerAuthRoutes } from './presentation/routes/authRoutes.js';
import { errorHandler } from './presentation/plugins/errorHandler.js';
import { COLLECTION_NAMES } from './domain/collections.js';
import { RESOURCE_SCHEMAS } from './presentation/schemas/resourceSchemas.js';
import { createAuthHooks } from './presentation/plugins/auth.js';
import { registerBookingRoutes } from './presentation/routes/bookingRoutes.js';
import { registerUploadRoutes } from './presentation/routes/uploadRoutes.js';
import { registerPaymentRoutes } from './presentation/routes/paymentRoutes.js';

import { errorResponses } from './presentation/schemas/openApiSchemas.js';

const RESOURCE_TAG_DESCRIPTIONS = Object.freeze({
  ACCOUNT: 'Accounts and role/status administration. Password fields are accepted only on writes and are never returned.',
  MEMBER_PROFILE: 'Member loyalty points, tier, favorite genres, and membership date.',
  CINEMA_ROOM: 'Auditorium configuration, capacity, screen type, and availability.',
  SEAT: 'Physical seats belonging to cinema rooms.',
  MOVIE: 'Movie catalog, descriptive metadata, media URLs, and release windows.',
  SHOWTIME: 'Movie sessions. Writes reject invalid ranges and overlapping sessions in the same room.',
  SHOWTIME_SEAT: 'Per-showtime seat inventory, availability, seat type, and authoritative price.',
  PROMOTION: 'Voucher definitions and eligibility rules for source, format, date/time, member, quantity, and usage limits.',
  BOOKING: 'Persisted booking records. Use the Booking APIs for safe customer/counter transactions.',
  BOOKING_SEAT: 'Seat line items attached to bookings.',
  TICKET: 'Issued tickets, QR codes, and check-in state.',
  POINT_HISTORY: 'Auditable member loyalty point earn/use transactions.',
});

/**
 * Build (but do not start) a fully-wired Fastify application.
 *
 * @param {import('mongodb').Db} db
 * @param {object} [opts] Fastify options (e.g. logger, repository)
 * @returns {Promise<import('fastify').FastifyInstance>}
 */
export async function buildApp(db, opts = {}) {
  const app = Fastify({
    logger: opts.logger ?? { level: config.logger.level },
    // OpenAPI annotations such as `example` are documentation-only keywords.
    // Keep all normal AJV validation while allowing those annotations in the
    // same schemas that drive Swagger.
    ajv: { customOptions: { strictSchema: false } },
    // Accept the exact collection names in the URL without decoding surprises.
    routerOptions: { ignoreTrailingSlash: true },
  });

  app.setErrorHandler(errorHandler);

  // --- CORS (the Android emulator / web client call cross-origin) ---
  await app.register(cors, {
    origin: config.cors.origin === '*' ? '*' : config.cors.origin.split(',').map((value) => value.trim()),
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  });

  // --- OpenAPI / Swagger UI (parity with the legacy /api-docs) ---
  await app.register(swagger, {
    openapi: {
      info: {
        title: 'Movie Theater API',
        description:
          'Complete Fastify + MongoDB API for the Movie Theater Android app. '
          + 'It includes authentication/session management, server-authoritative booking and voucher pricing, image upload, '
          + 'ticket check-in, and json-server compatible CRUD/filtering for all 12 persisted resources. '
          + 'Protected endpoints use the access token returned by POST /login in the Bearer authorization header.',
        version: '1.0.0',
      },
      servers: [{ url: '/', description: 'Current API host' }],
      components: {
        securitySchemes: {
          bearerAuth: {
            type: 'http',
            scheme: 'bearer',
            bearerFormat: 'HMAC',
            description: 'Access token returned by login, refresh, or change-password. Refresh tokens are not accepted here.',
          },
        },
      },
      tags: [
        { name: 'Meta', description: 'Health, metadata and API discovery' },
        { name: 'Auth', description: 'Member registration, login, token refresh/revocation, current account, profile, and password management' },
        { name: 'Booking', description: 'Online/counter quotes and sales, booking conversion, loyalty points, vouchers, and ticket check-in' },
        { name: 'Uploads', description: 'Authenticated image upload and public image URLs' },
        ...COLLECTION_NAMES.map((name) => ({ name, description: RESOURCE_TAG_DESCRIPTIONS[name] })),
      ],
    },
    // Keep multipart runtime parsing stream-based while documenting its file
    // part as an OpenAPI binary request body. A route-level body schema would
    // otherwise run before request.file() has consumed the stream.
    transform: ({ schema, url }) => ({
      url,
      schema: url === '/uploads/images'
        ? {
          ...schema,
          body: {
            type: 'object',
            description: 'Multipart form containing exactly one image file.',
            required: ['file'],
            properties: {
              file: { type: 'string', format: 'binary', description: 'Required JPEG, PNG, WEBP, or GIF image' },
            },
          },
        }
        : schema,
    }),
    transformObject: ({ openapiObject }) => {
      for (const name of COLLECTION_NAMES) {
        const success = openapiObject.paths?.[`/${name}`]?.get?.responses?.['200'];
        if (success) {
          success.headers = {
            'X-Total-Count': {
              description: 'Total records matching the filters before pagination or slicing.',
              schema: { type: 'integer', minimum: 0, example: 20 },
            },
          };
        }
      }
      return openapiObject;
    },
  });
  await app.register(swaggerUi, {
    routePrefix: '/api-docs',
    uiConfig: {
      docExpansion: 'list', deepLinking: true, filter: true,
      displayRequestDuration: true, persistAuthorization: true,
    },
  });
  await app.register(multipart, {
    limits: { files: 1, fileSize: 104857600 },
  });
  await mkdir(config.uploads.directory, { recursive: true });
  await app.register(staticFiles, {
    root: config.uploads.directory,
    prefix: '/uploads/',
    decorateReply: false,
  });

  const { repository, resourceControllers, authController, bookingController, paymentController, tokenService } = buildContainer(db, {
    repository: opts.repository,
  });
  const auth = createAuthHooks(repository, tokenService, opts.authDisabled === true);

  // --- Health / root ---
  app.get('/', {
    schema: {
      tags: ['Meta'], operationId: 'getServiceMetadata', summary: 'Get service metadata and resource counts',
      description: 'Returns service discovery information and the current number of records in every persisted collection.',
      response: {
        200: {
          description: 'The service is running and repository counts were read successfully.',
          type: 'object', additionalProperties: false,
          required: ['name', 'service', 'status', 'documentation', 'resources'],
          properties: {
            name: { type: 'string', example: 'Movie Theater API' },
            service: { type: 'string', example: 'movie-theater-fastify' },
            status: { type: 'string', enum: ['ok'] },
            documentation: { type: 'string', example: '/api-docs' },
            resources: {
              type: 'object', additionalProperties: { type: 'integer', minimum: 0 },
              description: 'Record counts keyed by collection name',
              example: { MOVIE: 20, SHOWTIME: 3000, PROMOTION: 20 },
            },
          },
        },
        ...errorResponses(),
      },
    },
  }, async () => {
    const counts = await Promise.all(
      COLLECTION_NAMES.map(async (name) => [name, await repository.count(name)]),
    );
    return {
      name: 'Movie Theater API',
      service: 'movie-theater-fastify',
      status: 'ok',
      documentation: '/api-docs',
      resources: Object.fromEntries(counts),
    };
  });
  app.get('/health', {
    schema: {
      tags: ['Meta'], operationId: 'getHealth', summary: 'Check API and database health',
      description: 'Pings MongoDB and returns `ok` only when both the API process and database connection are healthy.',
      response: {
        200: {
          description: 'API and MongoDB are healthy.',
          type: 'object', additionalProperties: false, required: ['status'],
          properties: { status: { type: 'string', enum: ['ok'], example: 'ok' } },
        },
        ...errorResponses(),
      },
    },
  }, async () => {
    await db.command({ ping: 1 });
    return { status: 'ok' };
  });

  app.get('/swagger.json', { schema: { hide: true } }, async (_request, reply) => {
    return reply.type('application/json').send(app.swagger());
  });

  // --- Auth routes ---
  registerAuthRoutes(app, authController, auth.authenticate);
  registerBookingRoutes(app, bookingController, auth);
  registerUploadRoutes(app, auth, config.uploads, config.minio);
  registerPaymentRoutes(app, paymentController, auth);

  // --- One CRUD router per collection ---
  for (const [name, controller] of Object.entries(resourceControllers)) {
    const publicRead = new Set(['MOVIE', 'SHOWTIME', 'SHOWTIME_SEAT', 'CINEMA_ROOM', 'SEAT', 'PROMOTION']).has(name);
    registerResourceRoutes(app, controller, name, RESOURCE_SCHEMAS[name], {
      read: publicRead ? undefined : auth.authenticate,
      write: auth.authorize('ADMIN'),
    });
  }

  app.setNotFoundHandler((_request, reply) => {
    return reply.code(404).send({ error: 'Not Found' });
  });

  return app;
}

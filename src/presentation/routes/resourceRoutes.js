import {
  createBodySchema,
  documentSchema,
  idParamsSchema,
  listQuerySchema,
  listResponseSchema,
  patchBodySchema,
} from '../schemas/resourceSchemas.js';
import { bearerSecurity, errorResponses } from '../schemas/openApiSchemas.js';

/**
 * Register the 6 standard REST routes for one resource collection, matching
 * the json-server surface consumed by the Android client:
 *
 *   GET    /{name}          list (with filtering / sorting / pagination)
 *   POST   /{name}          create
 *   GET    /{name}/:id      read one
 *   PUT    /{name}/:id      full replace
 *   PATCH  /{name}/:id      partial update
 *   DELETE /{name}/:id      delete
 *
 * @param {import('fastify').FastifyInstance} fastify
 * @param {import('../controllers/ResourceController.js').ResourceController} controller
 * @param {string} name resource name (URL segment)
 */
export function registerResourceRoutes(fastify, controller, name, resourceSchema, security) {
  const base = `/${name}`;
  const item = `/${name}/:id`;
  const tag = name;
  const typeName = name.toLowerCase().split('_').map((part) => `${part[0].toUpperCase()}${part.slice(1)}`).join('');
  const responseOptions = name === 'ACCOUNT'
    ? { omit: ['passwordHash', 'password'], description: 'Password fields are never returned.' }
    : {};
  const readSecurity = security.read ? bearerSecurity : undefined;

  const document = documentSchema(resourceSchema, responseOptions);

  fastify.get(base, {
    preHandler: security.read,
    schema: {
      tags: [tag],
      operationId: `list${typeName}`,
      summary: `List ${name}`,
      description: 'Returns a plain array by default. Supplying `_page` returns a json-server compatible pagination envelope. The `X-Total-Count` response header always contains the total before slicing. Dynamic filters use `field=value`; supported operator suffixes include `_gte`, `_lte`, `_gt`, `_lt`, `_ne`, and `_like`.',
      ...(readSecurity ? { security: readSecurity } : {}),
      querystring: listQuerySchema(),
      response: { 200: listResponseSchema(resourceSchema, responseOptions), ...errorResponses(...(security.read ? [400, 401] : [400])) },
    },
  }, controller.list);
  fastify.post(base, {
    preHandler: security.write,
    schema: {
      tags: [tag],
      operationId: `create${typeName}`,
      summary: `Create ${name}`,
      description: `ADMIN only. Creates a ${name} document. If public/business ids are omitted, the server allocates them.`,
      security: bearerSecurity,
      body: createBodySchema(resourceSchema),
      response: { 201: document, ...errorResponses(400, 401, 403, 409) },
    },
  }, controller.create);
  fastify.get(item, {
    preHandler: security.read,
    schema: {
      tags: [tag],
      operationId: `get${typeName}`,
      summary: `Get ${name} by public or business id`,
      description: `Returns one ${name} document. Member-facing protected resources are additionally restricted to records owned by the current account.`,
      ...(readSecurity ? { security: readSecurity } : {}),
      params: idParamsSchema,
      response: { 200: document, ...errorResponses(...(security.read ? [401, 403, 404] : [404])) },
    },
  }, controller.getOne);
  fastify.put(item, {
    preHandler: security.write,
    schema: {
      tags: [tag],
      operationId: `replace${typeName}`,
      summary: `Replace ${name}`,
      description: `ADMIN only. Fully replaces an existing ${name} document. A missing record returns 404 and is never created implicitly.`,
      security: bearerSecurity,
      params: idParamsSchema,
      body: createBodySchema(resourceSchema),
      response: { 200: document, ...errorResponses(400, 401, 403, 404, 409) },
    },
  }, controller.replace);
  fastify.patch(item, {
    preHandler: security.write,
    schema: {
      tags: [tag],
      operationId: `update${typeName}`,
      summary: `Update ${name}`,
      description: `ADMIN only. Applies a partial update to an existing ${name} document.`,
      security: bearerSecurity,
      params: idParamsSchema,
      body: patchBodySchema(resourceSchema),
      response: { 200: document, ...errorResponses(400, 401, 403, 404, 409) },
    },
  }, controller.patch);
  fastify.delete(item, {
    preHandler: security.write,
    schema: {
      tags: [tag],
      operationId: `delete${typeName}`,
      summary: `Delete ${name}`,
      description: `ADMIN only. Permanently deletes the ${name} document and returns the deleted representation.`,
      security: bearerSecurity,
      params: idParamsSchema,
      response: { 200: document, ...errorResponses(401, 403, 404) },
    },
  }, controller.remove);
}

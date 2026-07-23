import { errorResponses } from '../schemas/openApiSchemas.js';

export function registerPaymentRoutes(fastify, controller, auth) {
  fastify.post('/vnpay/create-url', {
    preHandler: auth.authorize('MEMBER'),
    schema: {
      tags: ['Payment'],
      operationId: 'createVNPayUrl',
      summary: 'Create VNPay payment URL',
      description: 'Generates a VNPay Sandbox payment URL.',
      body: {
        type: 'object',
        required: ['amount', 'orderId'],
        properties: {
          amount: { type: 'number' },
          orderId: { type: 'string' },
          orderInfo: { type: 'string' }
        }
      },
      response: {
        200: {
          description: 'Successfully created VNPay payment URL',
          type: 'object'
        },
        ...errorResponses(),
      }
    }
  }, controller.createVNPayUrl);

  fastify.get('/vnpay/ipn', {
    schema: {
      tags: ['Payment'],
      operationId: 'vnpayIpn',
      summary: 'VNPay IPN webhook',
      description: 'Handles server-to-server notifications from VNPay.',
      response: {
        200: {
          description: 'Successfully handled IPN webhook',
          type: 'object'
        },
        ...errorResponses(),
      }
    }
  }, controller.vnpayIpn);
}

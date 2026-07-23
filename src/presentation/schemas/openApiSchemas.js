import { RESOURCE_SCHEMAS, documentSchema } from './resourceSchemas.js';

export const bearerSecurity = [{ bearerAuth: [] }];

const errorExamples = {
  400: { error: 'Validation failed', details: [{ instancePath: '/field', message: 'is required' }] },
  401: { error: 'Authentication required' },
  403: { error: 'You do not have permission to perform this action' },
  404: { error: 'Resource not found' },
  409: { error: 'Resource already exists' },
  500: { error: 'Internal Server Error', message: 'Unexpected error' },
};

const errorDescriptions = {
  400: 'The request is malformed or violates a business validation rule.',
  401: 'The access or refresh token is missing, invalid, expired, or revoked.',
  403: 'The authenticated account does not have the required role or ownership.',
  404: 'The requested record does not exist.',
  409: 'The operation conflicts with the current state, such as a duplicate record, occupied seat, or overlapping showtime.',
  500: 'An unexpected server error occurred.',
};

export function errorResponse(statusCode) {
  return {
    description: errorDescriptions[statusCode],
    type: 'object',
    additionalProperties: true,
    required: ['error'],
    properties: {
      error: { type: 'string', description: 'Human-readable error message' },
      message: { type: 'string', description: 'Internal error message when available' },
      details: { description: 'Optional structured validation or conflict details' },
    },
    example: errorExamples[statusCode],
  };
}

export function errorResponses(...statusCodes) {
  return Object.fromEntries([...new Set([...statusCodes, 500])].map((status) => [status, errorResponse(status)]));
}

export const messageResponse = (message, description = 'Operation completed successfully.') => ({
  description,
  type: 'object',
  additionalProperties: false,
  required: ['message'],
  properties: { message: { type: 'string', example: message } },
});

export const safeAccountSchema = documentSchema(RESOURCE_SCHEMAS.ACCOUNT, {
  omit: ['passwordHash', 'password'],
  description: 'Account data safe to return to clients. Password fields are never exposed.',
});

export const memberProfileSchema = {
  ...documentSchema(RESOURCE_SCHEMAS.MEMBER_PROFILE),
  description: 'Movie theater member profile and loyalty balance.',
};

export const tokenPairProperties = {
  accessToken: {
    type: 'string',
    description: 'Short-lived HMAC access token. Send it as `Authorization: Bearer <token>`.',
    example: 'eyJzdWIiOiJhY2NfMDA2IiwidHlwIjoiYWNjZXNzIn0.signature',
  },
  refreshToken: {
    type: 'string',
    description: 'Long-lived HMAC refresh token. Use only with refresh or logout endpoints.',
    example: 'eyJzdWIiOiJhY2NfMDA2IiwidHlwIjoicmVmcmVzaCJ9.signature',
  },
  tokenType: { type: 'string', enum: ['Bearer'], example: 'Bearer' },
  expiresIn: { type: 'integer', minimum: 1, description: 'Access token lifetime in seconds', example: 28800 },
  refreshExpiresIn: { type: 'integer', minimum: 1, description: 'Refresh token lifetime in seconds', example: 2592000 },
};

export const tokenResponseSchema = (message) => ({
  description: 'A newly issued access and refresh token pair.',
  type: 'object',
  additionalProperties: false,
  required: ['message', 'accessToken', 'refreshToken', 'tokenType', 'expiresIn', 'refreshExpiresIn'],
  properties: {
    message: { type: 'string', example: message },
    ...tokenPairProperties,
  },
});

export const sessionResponseSchema = {
  description: 'Authenticated session and profile data.',
  type: 'object',
  additionalProperties: false,
  required: ['message', 'accessToken', 'refreshToken', 'tokenType', 'expiresIn', 'refreshExpiresIn', 'account', 'memberProfile'],
  properties: {
    message: { type: 'string', example: 'Login successful' },
    ...tokenPairProperties,
    account: safeAccountSchema,
    memberProfile: { ...memberProfileSchema, nullable: true },
  },
};

export const currentUserResponseSchema = {
  description: 'The currently authenticated account and its optional member profile.',
  type: 'object',
  additionalProperties: false,
  required: ['account', 'memberProfile'],
  properties: {
    account: safeAccountSchema,
    memberProfile: { ...memberProfileSchema, nullable: true },
  },
};

export const registrationResponseSchema = {
  description: 'The newly created member account and loyalty profile.',
  type: 'object',
  additionalProperties: false,
  required: ['message', 'account', 'memberProfile'],
  properties: {
    message: { type: 'string', example: 'Registration successful' },
    account: safeAccountSchema,
    memberProfile: memberProfileSchema,
  },
};

export const saleBodySchema = {
  description: 'Seat selection and optional voucher/loyalty conversion. Prices are always recalculated by the server.',
  type: 'object',
  additionalProperties: false,
  required: ['showtimeId', 'showtimeSeatIds'],
  properties: {
    showtimeId: { type: 'string', description: 'Public or business id of an OPEN showtime', example: 'show_001' },
    showtimeSeatIds: {
      type: 'array', minItems: 1, maxItems: 8, uniqueItems: true,
      description: 'Between 1 and 8 available SHOWTIME_SEAT ids from the selected showtime',
      items: { type: 'string' }, example: ['sh_st_00001', 'sh_st_00002'],
    },
    promotionCode: { type: 'string', description: 'Optional active voucher code (case-insensitive)', example: 'WELCOME20' },
    convertedTicketQuantity: {
      type: 'integer', minimum: 0, maximum: 8, default: 0,
      description: 'Number of selected tickets paid with loyalty points (100 points per ticket)', example: 0,
    },
    accountId: {
      type: 'string', nullable: true,
      description: 'Counter sales only: member account id. Omit or null for a walk-in customer.', example: 'acc_006',
    },
  },
};

export const quoteResponseSchema = {
  description: 'Server-calculated sale totals. Calling quote does not reserve seats.',
  type: 'object',
  additionalProperties: false,
  required: ['promotionId', 'promotionCode', 'subtotalAmount', 'pointDiscount', 'promotionDiscount', 'discountAmount', 'totalAmount', 'pointsUsed'],
  properties: {
    promotionId: { type: 'string', nullable: true, example: 'promo_001' },
    promotionCode: { type: 'string', nullable: true, example: 'WELCOME20' },
    subtotalAmount: { type: 'number', minimum: 0, example: 180000 },
    pointDiscount: { type: 'number', minimum: 0, example: 0 },
    promotionDiscount: { type: 'number', minimum: 0, example: 36000 },
    discountAmount: { type: 'number', minimum: 0, example: 36000 },
    totalAmount: { type: 'number', minimum: 0, example: 144000 },
    pointsUsed: { type: 'integer', minimum: 0, example: 0 },
  },
};

export const saleResponseSchema = {
  description: 'Confirmed booking, generated tickets, and the member point balance after the sale.',
  type: 'object',
  additionalProperties: false,
  required: ['booking', 'tickets', 'pointsBalance'],
  properties: {
    booking: documentSchema(RESOURCE_SCHEMAS.BOOKING),
    tickets: { type: 'array', items: documentSchema(RESOURCE_SCHEMAS.TICKET) },
    pointsBalance: { type: 'integer', minimum: 0, nullable: true, description: 'Null for walk-in counter sales' },
  },
};

export const checkInResponseSchema = {
  description: 'Tickets marked as used by the authenticated employee.',
  type: 'object',
  additionalProperties: false,
  required: ['message', 'tickets'],
  properties: {
    message: { type: 'string', example: 'Ticket checked in successfully' },
    tickets: { type: 'array', items: documentSchema(RESOURCE_SCHEMAS.TICKET) },
  },
};

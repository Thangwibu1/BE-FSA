import {
  bearerSecurity,
  currentUserResponseSchema,
  errorResponses,
  messageResponse,
  registrationResponseSchema,
  safeAccountSchema,
  sessionResponseSchema,
  tokenResponseSchema,
} from '../schemas/openApiSchemas.js';

const refreshTokenBody = {
  type: 'object',
  additionalProperties: false,
  required: ['refreshToken'],
  properties: {
    refreshToken: {
      type: 'string', minLength: 1,
      description: 'Refresh token previously issued by login, refresh, or change-password',
      example: 'eyJzdWIiOiJhY2NfMDA2IiwidHlwIjoicmVmcmVzaCJ9.signature',
    },
  },
};

/** Register account, session, and self-service authentication routes. */
export function registerAuthRoutes(fastify, controller, authenticate) {
  fastify.post('/register', {
    schema: {
      tags: ['Auth'],
      operationId: 'registerMember',
      summary: 'Register a member account',
      description: 'Creates an ACCOUNT and MEMBER_PROFILE atomically. Public registration always forces role MEMBER and status ACTIVE.',
      body: {
        type: 'object',
        additionalProperties: false,
        required: ['username', 'password', 'fullName', 'email', 'phoneNumber', 'dateOfBirth', 'gender', 'identityCard', 'address'],
        properties: {
          username: { type: 'string', minLength: 1, description: 'Unique, case-insensitive login name', example: 'ngoc_thang' },
          password: { type: 'string', minLength: 7, description: 'Plain-text password sent over HTTPS; it is hashed before storage', example: 'Cinema@123' },
          fullName: { type: 'string', minLength: 1, example: 'Ngoc Thang' },
          email: { type: 'string', minLength: 3, description: 'Unique email address', example: 'thang@example.com' },
          phoneNumber: { type: 'string', minLength: 1, example: '0901234567' },
          dateOfBirth: { type: 'string', description: 'Birth date, normally YYYY-MM-DD', example: '2000-01-15' },
          gender: { type: 'string', example: 'MALE' },
          identityCard: { type: 'string', minLength: 1, example: '012345678901' },
          address: { type: 'string', minLength: 1, example: '123 Nguyen Trai, Ho Chi Minh City' },
          avatarUrl: { type: 'string', nullable: true, description: 'Optional avatar URL', example: 'https://cdn.example.com/avatar.jpg' },
          role: { type: 'string', deprecated: true, description: 'Ignored. Public registration always creates a MEMBER.' },
          status: { type: 'string', deprecated: true, description: 'Ignored. Public registration always creates an ACTIVE account.' },
          favoriteGenres: { type: 'array', uniqueItems: true, items: { type: 'string' }, example: ['ACTION', 'SCI-FI'] },
        },
      },
      response: { 201: registrationResponseSchema, ...errorResponses(400, 409) },
    },
  }, controller.register);

  fastify.post('/login', {
    schema: {
      tags: ['Auth'],
      operationId: 'login',
      summary: 'Log in with username and password',
      description: 'Validates credentials on the server and returns an HMAC access/refresh token pair. Username matching is case-insensitive.',
      body: {
        type: 'object', additionalProperties: false, required: ['username', 'password'],
        properties: {
          username: { type: 'string', minLength: 1, example: 'mem_anhtu' },
          password: { type: 'string', minLength: 1, description: 'Account password', example: 'example123' },
        },
      },
      response: { 200: sessionResponseSchema, ...errorResponses(400, 401) },
    },
  }, controller.login);

  fastify.get('/auth/me', {
    preHandler: authenticate,
    schema: {
      tags: ['Auth'], operationId: 'getCurrentUser', summary: 'Get the current account',
      description: 'Returns the account represented by the Bearer access token and its member profile when one exists.',
      security: bearerSecurity,
      response: { 200: currentUserResponseSchema, ...errorResponses(401, 404) },
    },
  }, controller.me);

  fastify.patch('/me/profile', {
    preHandler: authenticate,
    schema: {
      tags: ['Auth'], operationId: 'updateCurrentProfile', summary: 'Update the current account profile',
      description: 'Updates only the supplied profile fields. Username, role, status, password, and loyalty points cannot be changed here.',
      security: bearerSecurity,
      body: {
        type: 'object', additionalProperties: false, minProperties: 1,
        properties: {
          fullName: { type: 'string', minLength: 1, example: 'Ngoc Thang' },
          email: { type: 'string', minLength: 3, description: 'Unique email address', example: 'thang@example.com' },
          phoneNumber: { type: 'string', minLength: 1, example: '0901234567' },
          dateOfBirth: { type: 'string', nullable: true, description: 'Birth date, normally YYYY-MM-DD', example: '2000-01-15' },
          gender: { type: 'string', nullable: true, example: 'MALE' },
          identityCard: { type: 'string', nullable: true, example: '012345678901' },
          address: { type: 'string', nullable: true, example: '123 Nguyen Trai, Ho Chi Minh City' },
          avatarUrl: { type: 'string', nullable: true, description: 'Optional avatar URL', example: 'https://cdn.example.com/avatar.jpg' },
        },
      },
      response: { 200: safeAccountSchema, ...errorResponses(400, 401, 404, 409) },
    },
  }, controller.updateProfile);

  fastify.post('/auth/refresh', {
    schema: {
      tags: ['Auth'], operationId: 'refreshSession', summary: 'Refresh the authentication session',
      description: 'Exchanges a valid, unrevoked refresh token for a new access/refresh token pair.',
      body: refreshTokenBody,
      response: { 200: tokenResponseSchema('Token refreshed successfully'), ...errorResponses(400, 401) },
    },
  }, controller.refresh);

  fastify.post('/auth/logout', {
    schema: {
      tags: ['Auth'], operationId: 'logout', summary: 'Log out and revoke the account session',
      description: 'Revokes all access and refresh tokens issued under the current account token version. The operation is idempotent for already revoked sessions.',
      body: refreshTokenBody,
      response: { 200: messageResponse('Logout successful'), ...errorResponses(400, 401) },
    },
  }, controller.logout);

  fastify.post('/auth/change-password', {
    preHandler: authenticate,
    schema: {
      tags: ['Auth'], operationId: 'changeCurrentPassword', summary: 'Change the current account password',
      description: 'Verifies the current password, hashes the new password, revokes prior sessions, and returns a new token pair.',
      security: bearerSecurity,
      body: {
        type: 'object', additionalProperties: false, required: ['currentPassword', 'newPassword'],
        properties: {
          currentPassword: { type: 'string', minLength: 1, description: 'Current account password', example: 'example123' },
          newPassword: { type: 'string', minLength: 6, description: 'New account password', example: 'Cinema@456' },
        },
      },
      response: { 200: tokenResponseSchema('Password changed successfully'), ...errorResponses(400, 401, 404) },
    },
  }, controller.changePassword);
}

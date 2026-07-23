import { COLLECTIONS } from '../../domain/collections.js';
import { ForbiddenError, UnauthorizedError } from '../../shared/errors.js';

export function createAuthHooks(repository, tokenService, disabled = false) {
  async function authenticate(request) {
    if (disabled) {
      request.user = { accountId: 'test-admin', role: 'ADMIN', status: 'ACTIVE' };
      return;
    }
    const header = request.headers.authorization;
    if (!header?.startsWith('Bearer ')) throw new UnauthorizedError('Authentication required');
    const claims = tokenService.verifyAccess(header.slice(7));
    const account = await repository.findOne(COLLECTIONS.ACCOUNT.name, { accountId: claims.sub });
    if (!account) throw new UnauthorizedError('Account no longer exists');
    if (account.status !== 'ACTIVE') throw new UnauthorizedError('Account is not active');
    if (Number(claims.ver || 0) !== Number(account.authTokenVersion || 0)) {
      throw new UnauthorizedError('Session has been revoked');
    }
    request.user = { accountId: account.accountId, role: account.role, status: account.status };
  }

  function authorize(...roles) {
    return async function roleGuard(request) {
      await authenticate(request);
      if (!roles.includes(request.user.role)) throw new ForbiddenError('You do not have permission to perform this action');
    };
  }

  return { authenticate, authorize };
}

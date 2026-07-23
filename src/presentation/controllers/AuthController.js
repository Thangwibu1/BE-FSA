/**
 * HTTP controller for authentication endpoints (`/register`, `/login`).
 * Thin transport layer over the register / authenticate use-cases.
 */
export class AuthController {
  /**
   * @param {import('../../application/useCases/RegisterAccountUseCase.js').RegisterAccountUseCase} registerUseCase
   * @param {import('../../application/useCases/AuthenticateUseCase.js').AuthenticateUseCase} authenticateUseCase
   */
  constructor(registerUseCase, authenticateUseCase, accountUseCase) {
    this.registerUseCase = registerUseCase;
    this.authenticateUseCase = authenticateUseCase;
    this.accountUseCase = accountUseCase;

    this.register = this.register.bind(this);
    this.login = this.login.bind(this);
    this.updateProfile = this.updateProfile.bind(this);
    this.changePassword = this.changePassword.bind(this);
    this.me = this.me.bind(this);
    this.refresh = this.refresh.bind(this);
    this.logout = this.logout.bind(this);
  }

  async register(request, reply) {
    const result = await this.registerUseCase.execute(request.body ?? {});
    return reply.code(201).send(result);
  }

  async login(request, reply) {
    const result = await this.authenticateUseCase.execute(request.body ?? {});
    return reply.send(result);
  }

  async updateProfile(request, reply) {
    return reply.send(await this.accountUseCase.updateProfile(request.user.accountId, request.body ?? {}));
  }

  async changePassword(request, reply) {
    return reply.send(await this.accountUseCase.changePassword(request.user.accountId, request.body ?? {}));
  }

  async me(request, reply) {
    return reply.send(await this.accountUseCase.getCurrent(request.user.accountId));
  }

  async refresh(request, reply) {
    return reply.send(await this.accountUseCase.refreshSession(request.body ?? {}));
  }

  async logout(request, reply) {
    return reply.send(await this.accountUseCase.logout(request.body ?? {}));
  }
}

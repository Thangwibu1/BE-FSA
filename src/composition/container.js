import { MongoResourceRepository } from '../infrastructure/repositories/MongoResourceRepository.js';
import { ResourceService } from '../application/services/ResourceService.js';
import { RegisterAccountUseCase } from '../application/useCases/RegisterAccountUseCase.js';
import { AuthenticateUseCase } from '../application/useCases/AuthenticateUseCase.js';
import { ResourceController } from '../presentation/controllers/ResourceController.js';
import { AuthController } from '../presentation/controllers/AuthController.js';
import { COLLECTIONS } from '../domain/collections.js';
import { AuthTokenService } from '../application/services/AuthTokenService.js';
import { config } from '../config/env.js';
import { AccountUseCase } from '../application/useCases/AccountUseCase.js';
import { BookingService } from '../application/services/BookingService.js';
import { BookingController } from '../presentation/controllers/BookingController.js';
import { PaymentController } from '../presentation/controllers/PaymentController.js';

/**
 * Composition root — the single place where concrete implementations are
 * wired to the abstractions they satisfy. Nothing else in the codebase does
 * `new` across layer boundaries, which keeps the dependency graph explicit and
 * the layers independently testable.
 *
 * @param {import('mongodb').Db} db
 * @returns {{
 *   repository: MongoResourceRepository,
 *   resourceControllers: Record<string, ResourceController>,
 *   authController: AuthController,
 * }}
 */
export function buildContainer(db, options = {}) {
  // Infrastructure adapter satisfying the domain port.
  const repository = options.repository ?? new MongoResourceRepository(db);

  // One application service + controller per collection.
  /** @type {Record<string, ResourceController>} */
  const resourceControllers = {};
  for (const definition of Object.values(COLLECTIONS)) {
    const service = new ResourceService(definition, repository);
    resourceControllers[definition.name] = new ResourceController(service);
  }

  // Auth use-cases + controller.
  const registerUseCase = new RegisterAccountUseCase(repository);
  const tokenService = new AuthTokenService(
    config.auth.tokenSecret,
    config.auth.tokenLifetimeSeconds,
    config.auth.refreshTokenLifetimeSeconds,
  );
  const authenticateUseCase = new AuthenticateUseCase(repository, tokenService);
  const accountUseCase = new AccountUseCase(repository, tokenService);
  const authController = new AuthController(registerUseCase, authenticateUseCase, accountUseCase);
  
  const bookingService = new BookingService(repository);
  const bookingController = new BookingController(bookingService);
  const paymentController = new PaymentController(bookingService);
  
  return { repository, resourceControllers, authController, bookingController, paymentController, tokenService };
}

import { buildApp } from './app.js';
import { mongoConnection } from './infrastructure/db/mongoConnection.js';
import { config } from './config/env.js';
import { runMigrations } from './infrastructure/db/migrate.js';

/**
 * Application entry point.
 * Connects to MongoDB, builds the wired Fastify app and starts listening.
 * Handles graceful shutdown on SIGINT / SIGTERM.
 */
async function start() {
  const db = await mongoConnection.connect({ logger: console });
  if (config.database.runMigrations) {
    await runMigrations(db, console);
  }
  const app = await buildApp(db);

  try {
    await app.listen({ port: config.server.port, host: config.server.host });
    app.log.info(`Swagger UI available at http://localhost:${config.server.port}/api-docs`);
  } catch (err) {
    app.log.error(err);
    await mongoConnection.close();
    process.exit(1);
  }

  const shutdown = async (signal) => {
    app.log.info(`Received ${signal}, shutting down...`);
    await app.close();
    await mongoConnection.close();
    process.exit(0);
  };
  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
}

start().catch((err) => {
  console.error('Fatal startup error:', err);
  process.exit(1);
});

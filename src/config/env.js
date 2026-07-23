import { config as loadDotenv } from 'dotenv';
import path from 'node:path';

loadDotenv();

/**
 * Centralised, validated environment configuration.
 * Every other module reads configuration from here rather than from
 * `process.env` directly (Dependency Inversion at the config boundary).
 */
export const config = Object.freeze({
  server: {
    port: Number.parseInt(process.env.PORT ?? '3000', 10),
    host: process.env.HOST ?? '0.0.0.0',
  },
  mongo: {
    // One single connection string. Put the database name at the end of the URI,
    // e.g. mongodb://127.0.0.1:27017/movie_theater (or a full Atlas SRV URI).
    uri: process.env.MONGODB_URI ?? 'mongodb://127.0.0.1:27017/movie_theater',
    // Optional override; normally the db name is taken from the URI itself.
    dbName: process.env.MONGODB_DB_NAME || undefined,
  },
  cors: {
    origin: process.env.CORS_ORIGIN ?? '*',
  },
  logger: {
    level: process.env.LOG_LEVEL ?? 'info',
  },
  auth: {
    tokenSecret: process.env.AUTH_TOKEN_SECRET ?? 'local-development-secret-change-me',
    tokenLifetimeSeconds: Number.parseInt(process.env.AUTH_TOKEN_LIFETIME_SECONDS ?? '28800', 10),
    refreshTokenLifetimeSeconds: Number.parseInt(process.env.AUTH_REFRESH_TOKEN_LIFETIME_SECONDS ?? '2592000', 10),
  },
  uploads: {
    directory: path.resolve(process.env.UPLOAD_DIR ?? './uploads'),
    maxImageBytes: Number.parseInt(process.env.MAX_IMAGE_UPLOAD_BYTES ?? '5242880', 10),
  },
  minio: {
    endpoint: process.env.MINIO_ENDPOINT || '',
    accessKey: process.env.MINIO_ACCESS_KEY || '',
    secretKey: process.env.MINIO_SECRET_KEY || '',
    bucketName: process.env.MINIO_BUCKET_NAME || 'test',
  },
  database: {
    runMigrations: !['false', '0', 'no'].includes(
      String(process.env.RUN_MIGRATIONS ?? 'true').toLowerCase(),
    ),
  },
  vnpay: {
    tmnCode: process.env.VNPAY_TMN_CODE ?? '1CERJLB9',
    hashSecret: process.env.VNPAY_HASH_SECRET ?? 'GR37DXFKTHORYT3919MQHID6CWHTYLLT',
    url: process.env.VNPAY_URL ?? 'https://sandbox.vnpayment.vn/paymentv2/vpcpay.html',
    returnUrl: process.env.VNPAY_RETURN_URL ?? 'cinemahub://payment-return',
  }
});

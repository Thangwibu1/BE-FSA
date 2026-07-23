import { MongoClient } from 'mongodb';
import { config } from '../../config/env.js';

/**
 * Thin singleton wrapper around the MongoDB driver connection.
 *
 * Keeps connection lifecycle in one place so the rest of the infrastructure
 * layer only deals with `Db` / `Collection` handles.
 */
class MongoConnection {
  /** @type {MongoClient | null} */
  #client = null;

  /** @type {import('mongodb').Db | null} */
  #db = null;

  /**
   * Open the connection (idempotent).
   * @param {{ uri?: string, dbName?: string, logger?: object }} [opts]
   * @returns {Promise<import('mongodb').Db>}
   */
  async connect(opts = {}) {
    if (this.#db) return this.#db;

    const uri = opts.uri ?? config.mongo.uri;
    // Prefer the db name embedded in the URI; fall back to an explicit override,
    // then to a sane default. `client.db(undefined)` uses the URI's database.
    const dbName = opts.dbName ?? config.mongo.dbName;

    this.#client = new MongoClient(uri, {
      // Fail fast instead of hanging for 30s if Mongo is down.
      serverSelectionTimeoutMS: 5000,
    });
    await this.#client.connect();
    this.#db = this.#client.db(dbName); // undefined -> database from the URI
    opts.logger?.info?.(`MongoDB connected -> ${this.#db.databaseName}`);
    return this.#db;
  }

  /** @returns {import('mongodb').Db} */
  get db() {
    if (!this.#db) throw new Error('MongoDB not connected. Call connect() first.');
    return this.#db;
  }

  /** @returns {MongoClient} */
  get client() {
    if (!this.#client) throw new Error('MongoDB not connected. Call connect() first.');
    return this.#client;
  }

  /** Close the connection. */
  async close() {
    await this.#client?.close();
    this.#client = null;
    this.#db = null;
  }
}

export const mongoConnection = new MongoConnection();

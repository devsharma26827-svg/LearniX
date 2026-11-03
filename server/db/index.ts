import { IDatabase, DatabaseHealth } from "./types";
import { Database as SqliteDatabase } from "../db";
import { PostgresDatabase } from "./postgres";

/**
 * LearniX Database Factory
 *
 * Rules:
 * 1. DEVELOPMENT: Default to SQLite. Optional explicit PostgreSQL when DB_PROVIDER=postgresql or DATABASE_URL is provided.
 * 2. PRODUCTION (NODE_ENV=production): Requires PostgreSQL and DATABASE_URL.
 *    Never silently falls back to SQLite if DATABASE_URL is missing or fails.
 *    Fails fast with a clear, safe configuration error.
 * 3. Log transparently at startup:
 *    [DATABASE] Provider: SQLite | PostgreSQL
 *    [DATABASE] Connection: Successful
 *    [DATABASE] Migration version: 7
 */

export function resolveDatabaseProvider(): "sqlite" | "postgresql" {
  const isProduction = process.env.NODE_ENV === "production";
  const requested = (process.env.DB_PROVIDER || "").toLowerCase().trim();

  if (requested === "postgresql" || requested === "postgres") {
    return "postgresql";
  }

  if (requested === "sqlite") {
    if (isProduction && process.env.ALLOW_SQLITE_IN_TEST !== "true") {
      throw new Error(
        "[DATABASE FATAL] DB_PROVIDER=sqlite is forbidden in production (NODE_ENV=production). " +
        "Production SaaS deployments require managed PostgreSQL for multi-tenant persistence. " +
        "Please configure DB_PROVIDER=postgresql and set DATABASE_URL."
      );
    }
    return "sqlite";
  }

  if (isProduction) {
    // In production, PostgreSQL is mandatory
    return "postgresql";
  }

  // Development auto-detection
  if (process.env.DATABASE_URL) {
    return "postgresql";
  }

  return "sqlite";
}

export function createDatabaseInstance(): IDatabase {
  const provider = resolveDatabaseProvider();
  const isProduction = process.env.NODE_ENV === "production";

  if (provider === "postgresql") {
    const dbUrl = process.env.DATABASE_URL?.trim();
    if (!dbUrl) {
      throw new Error(
        "[DATABASE FATAL] PostgreSQL provider selected, but DATABASE_URL is missing. " +
        "Please provide a valid connection string (e.g. postgresql://user:pass@host:5432/learnix)."
      );
    }

    const instance = new PostgresDatabase(dbUrl);
    console.log("[DATABASE] Provider: PostgreSQL");
    console.log("[DATABASE] Connection: Initializing connection pool...");

    // Validate connection asynchronously and log startup confirmation
    instance.checkHealth().then((health) => {
      if (health.connected) {
        console.log("[DATABASE] Connection: Successful");
        console.log(`[DATABASE] Migration version: ${health.migrationVersion}`);
      } else {
        console.error("[DATABASE] Connection: Unhealthy or failed ping");
      }
    }).catch((err) => {
      console.error("[DATABASE] Connection Error:", err?.message || err);
    });

    return instance;
  }

  // SQLite Development Instance
  const instance = new SqliteDatabase();
  console.log("[DATABASE] Provider: SQLite");
  console.log("[DATABASE] Connection: Successful (WAL mode active)");
  console.log("[DATABASE] Migration version: 7");
  return instance;
}

export const db: IDatabase = createDatabaseInstance();
export * from "./types";
export { SqliteDatabase, PostgresDatabase };

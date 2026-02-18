import { sql } from 'drizzle-orm';
import { db } from './index.js';
export async function runMigrations(database = db) {
    await database.execute(sql `
    CREATE TABLE IF NOT EXISTS tenants (
      id          TEXT PRIMARY KEY,
      name        TEXT NOT NULL,
      email       TEXT,
      created_at  TIMESTAMPTZ DEFAULT now(),
      updated_at  TIMESTAMPTZ DEFAULT now()
    )
  `);
    await database.execute(sql `
    CREATE TABLE IF NOT EXISTS pods (
      id              TEXT PRIMARY KEY,
      tenant_id       TEXT NOT NULL REFERENCES tenants(id),
      name            TEXT NOT NULL,
      adapter_id      TEXT NOT NULL,
      subdomain       TEXT UNIQUE NOT NULL,
      desired_status  TEXT DEFAULT 'running',
      actual_status   TEXT DEFAULT 'pending',
      container_id    TEXT,
      gateway_token   TEXT NOT NULL,
      data_dir        TEXT NOT NULL,
      created_at      TIMESTAMPTZ DEFAULT now(),
      updated_at      TIMESTAMPTZ DEFAULT now()
    )
  `);
    await database.execute(sql `
    CREATE TABLE IF NOT EXISTS pod_configs (
      pod_id      TEXT PRIMARY KEY REFERENCES pods(id),
      config      JSONB NOT NULL,
      updated_at  TIMESTAMPTZ DEFAULT now()
    )
  `);
    await database.execute(sql `
    CREATE TABLE IF NOT EXISTS pod_status (
      pod_id          TEXT PRIMARY KEY REFERENCES pods(id),
      phase           TEXT NOT NULL,
      ready           BOOLEAN DEFAULT false,
      message         TEXT,
      last_health_at  TIMESTAMPTZ,
      memory_mb       INTEGER,
      cpu_percent     REAL,
      storage_mb      INTEGER,
      updated_at      TIMESTAMPTZ DEFAULT now()
    )
  `);
    await database.execute(sql `
    CREATE TABLE IF NOT EXISTS pod_events (
      id          SERIAL PRIMARY KEY,
      pod_id      TEXT REFERENCES pods(id),
      event_type  TEXT NOT NULL,
      message     TEXT,
      created_at  TIMESTAMPTZ DEFAULT now()
    )
  `);
}
if (import.meta.url === `file://${process.argv[1]}`) {
    runMigrations()
        .then(() => {
        console.log('Migrations completed');
        process.exit(0);
    })
        .catch((error) => {
        console.error('Migration failed', error);
        process.exit(1);
    });
}
//# sourceMappingURL=migrate.js.map
import { sql } from 'drizzle-orm'
import { createDb } from './index.js'
import type { DbClient } from './index.js'

export async function runMigrations(database: DbClient): Promise<void> {
  await database.execute(sql`
    CREATE TABLE IF NOT EXISTS tenants (
      id          TEXT PRIMARY KEY,
      name        TEXT NOT NULL,
      email       TEXT,
      created_at  TIMESTAMPTZ DEFAULT now(),
      updated_at  TIMESTAMPTZ DEFAULT now()
    )
  `)

  await database.execute(sql`
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
  `)

  await database.execute(sql`
    CREATE TABLE IF NOT EXISTS pod_configs (
      pod_id      TEXT PRIMARY KEY REFERENCES pods(id) ON DELETE CASCADE,
      config      JSONB NOT NULL,
      updated_at  TIMESTAMPTZ DEFAULT now()
    )
  `)

  await database.execute(sql`
    CREATE TABLE IF NOT EXISTS pod_status (
      pod_id          TEXT PRIMARY KEY REFERENCES pods(id) ON DELETE CASCADE,
      phase           TEXT NOT NULL,
      ready           BOOLEAN DEFAULT false,
      message         TEXT,
      last_health_at  TIMESTAMPTZ,
      memory_mb       INTEGER,
      cpu_percent     REAL,
      storage_mb      INTEGER,
      updated_at      TIMESTAMPTZ DEFAULT now()
    )
  `)

  await database.execute(sql`
    CREATE TABLE IF NOT EXISTS pod_events (
      id          SERIAL PRIMARY KEY,
      pod_id      TEXT NOT NULL REFERENCES pods(id) ON DELETE CASCADE,
      event_type  TEXT NOT NULL,
      message     TEXT,
      created_at  TIMESTAMPTZ DEFAULT now()
    )
  `)

  await database.execute(sql`
    CREATE INDEX IF NOT EXISTS idx_pods_tenant_id ON pods(tenant_id)
  `)

  await database.execute(sql`
    DO $$
    BEGIN
      IF to_regclass('public.pod_events') IS NOT NULL THEN
        DELETE FROM pod_events WHERE pod_id IS NULL;

        IF EXISTS (
          SELECT 1
          FROM information_schema.columns
          WHERE table_schema = 'public'
            AND table_name = 'pod_events'
            AND column_name = 'pod_id'
            AND is_nullable = 'YES'
        ) THEN
          ALTER TABLE pod_events ALTER COLUMN pod_id SET NOT NULL;
        END IF;
      END IF;

      IF to_regclass('public.pod_configs') IS NOT NULL THEN
        ALTER TABLE pod_configs DROP CONSTRAINT IF EXISTS pod_configs_pod_id_fkey;

        IF NOT EXISTS (
          SELECT 1
          FROM pg_constraint
          WHERE conrelid = 'public.pod_configs'::regclass
            AND conname = 'pod_configs_pod_id_fkey'
        ) THEN
          ALTER TABLE pod_configs
            ADD CONSTRAINT pod_configs_pod_id_fkey
            FOREIGN KEY (pod_id) REFERENCES pods(id) ON DELETE CASCADE;
        END IF;
      END IF;

      IF to_regclass('public.pod_status') IS NOT NULL THEN
        ALTER TABLE pod_status DROP CONSTRAINT IF EXISTS pod_status_pod_id_fkey;

        IF NOT EXISTS (
          SELECT 1
          FROM pg_constraint
          WHERE conrelid = 'public.pod_status'::regclass
            AND conname = 'pod_status_pod_id_fkey'
        ) THEN
          ALTER TABLE pod_status
            ADD CONSTRAINT pod_status_pod_id_fkey
            FOREIGN KEY (pod_id) REFERENCES pods(id) ON DELETE CASCADE;
        END IF;
      END IF;

      IF to_regclass('public.pod_events') IS NOT NULL THEN
        ALTER TABLE pod_events DROP CONSTRAINT IF EXISTS pod_events_pod_id_fkey;

        IF NOT EXISTS (
          SELECT 1
          FROM pg_constraint
          WHERE conrelid = 'public.pod_events'::regclass
            AND conname = 'pod_events_pod_id_fkey'
        ) THEN
          ALTER TABLE pod_events
            ADD CONSTRAINT pod_events_pod_id_fkey
            FOREIGN KEY (pod_id) REFERENCES pods(id) ON DELETE CASCADE;
        END IF;
      END IF;
    END
    $$;
  `)
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const { db, pool } = createDb()

  runMigrations(db)
    .then(async () => {
      console.log('Migrations completed')
      await pool.end()
      process.exit(0)
    })
    .catch(async (error: unknown) => {
      console.error('Migration failed', error)
      await pool.end()
      process.exit(1)
    })
}

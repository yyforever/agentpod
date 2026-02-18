import { drizzle } from 'drizzle-orm/node-postgres'
import type { NodePgDatabase } from 'drizzle-orm/node-postgres'
import { Pool } from 'pg'
import * as schema from './schema.js'

const DEFAULT_DATABASE_URL =
  'postgresql://agentpod:agentpod@localhost:5432/agentpod'

export function createDb(databaseUrl?: string) {
  const pool = new Pool({
    connectionString: databaseUrl ?? process.env.DATABASE_URL ?? DEFAULT_DATABASE_URL,
  })
  const db: DbClient = drizzle(pool, { schema })
  return { db, pool }
}

export type DbClient = NodePgDatabase<typeof schema>

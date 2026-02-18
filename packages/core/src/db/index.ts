import { drizzle } from 'drizzle-orm/node-postgres'
import { Pool } from 'pg'
import * as schema from './schema.js'

const DEFAULT_DATABASE_URL =
  'postgresql://agentpod:agentpod@localhost:5432/agentpod'

export function createDb(databaseUrl?: string) {
  const pool = new Pool({
    connectionString: databaseUrl ?? process.env.DATABASE_URL ?? DEFAULT_DATABASE_URL,
  })
  const db = drizzle(pool, { schema })
  return { db, pool }
}

const defaultClient = createDb()

export const db = defaultClient.db
export const pool = defaultClient.pool
export type DbClient = typeof db

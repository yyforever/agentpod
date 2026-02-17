import { drizzle } from 'drizzle-orm/node-postgres'
import { Pool } from 'pg'
import * as schema from './schema.js'

const DATABASE_URL =
  process.env.DATABASE_URL ??
  'postgresql://agentpod:agentpod@localhost:5432/agentpod'

export const pool = new Pool({ connectionString: DATABASE_URL })

export const db = drizzle(pool, { schema })

export type DbClient = typeof db

import { Pool } from 'pg';
import * as schema from './schema.js';
export declare function createDb(databaseUrl?: string): {
    db: import("drizzle-orm/node-postgres").NodePgDatabase<typeof schema>;
    pool: Pool;
};
export declare const db: import("drizzle-orm/node-postgres").NodePgDatabase<typeof schema>;
export declare const pool: Pool;
export type DbClient = typeof db;
//# sourceMappingURL=index.d.ts.map
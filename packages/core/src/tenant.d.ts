import type { Tenant } from '@agentpod/shared';
import type { DbClient } from './db/index.js';
export declare class TenantService {
    private readonly db;
    constructor(db: DbClient);
    create(input: {
        name: string;
        email?: string;
    }): Promise<Tenant>;
    list(): Promise<Tenant[]>;
    getById(id: string): Promise<Tenant>;
    delete(id: string): Promise<void>;
}
//# sourceMappingURL=tenant.d.ts.map
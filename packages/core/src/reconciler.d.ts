import type { AdapterRegistry } from './adapter.js';
import type { DbClient } from './db/index.js';
import { DockerClient } from './docker.js';
import type { ReconcileResult } from './types.js';
export declare class ReconcileService {
    private readonly db;
    private readonly docker;
    private readonly adapters;
    private readonly options;
    private timer;
    constructor(db: DbClient, docker: DockerClient, adapters: AdapterRegistry, options: {
        domain: string;
        network: string;
    });
    reconcileOnce(): Promise<ReconcileResult>;
    start(intervalMs?: number): void;
    stop(): void;
    private logEvent;
    private writeActualStatus;
    private reconcilePod;
}
//# sourceMappingURL=reconciler.d.ts.map
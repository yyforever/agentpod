import type { PlatformContext, Pod, PodStatus } from '@agentpod/shared';
import type { AdapterRegistry } from './adapter.js';
import type { DbClient } from './db/index.js';
import { DockerClient } from './docker.js';
type PodWithExtras = Pod & {
    status: PodStatus | null;
    config: Record<string, unknown> | null;
};
export declare class PodService {
    private readonly db;
    private readonly docker;
    private readonly adapters;
    private readonly platform;
    private readonly network;
    constructor(db: DbClient, docker: DockerClient, adapters: AdapterRegistry, platform: PlatformContext & {
        network?: string;
    });
    private generateSubdomain;
    create(input: {
        tenantId: string;
        name: string;
        adapterId: string;
        config?: Record<string, unknown>;
    }): Promise<Pod>;
    list(tenantId?: string): Promise<Array<Pod & {
        status: PodStatus | null;
    }>>;
    getById(id: string): Promise<PodWithExtras>;
    start(id: string): Promise<void>;
    stop(id: string): Promise<void>;
    delete(id: string): Promise<void>;
    private setDesiredStatus;
    getRuntimeContext(): {
        network: string;
        domain: string;
    };
    getDockerClient(): DockerClient;
    getAdapterRegistry(): AdapterRegistry;
}
export {};
//# sourceMappingURL=pod.d.ts.map
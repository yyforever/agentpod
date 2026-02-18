import type { AgentAdapter } from '@agentpod/shared';
export declare class AdapterRegistry {
    private readonly adapters;
    register(adapter: AgentAdapter): void;
    get(id: string): AgentAdapter | undefined;
    list(): AgentAdapter[];
}
//# sourceMappingURL=adapter.d.ts.map
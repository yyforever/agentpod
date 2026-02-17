import type { AgentAdapter } from '@agentpod/shared'

export class AdapterRegistry {
  private readonly adapters = new Map<string, AgentAdapter>()

  register(adapter: AgentAdapter): void {
    this.adapters.set(adapter.meta.id, adapter)
  }

  get(id: string): AgentAdapter | undefined {
    return this.adapters.get(id)
  }

  list(): AgentAdapter[] {
    return [...this.adapters.values()]
  }
}

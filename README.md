# AgentPod

> Open-source multi-tenant orchestration for AI agents

**Status: Pre-alpha / Documentation Phase**

---

## What is AgentPod?

AgentPod is an open-source multi-tenant AI agent orchestration framework. It manages N independent agent containers — each with its own subdomain, storage, configuration, and identity — so you don't have to.

**Docker manages containers. Kubernetes manages pods. AgentPod manages AI agents.**

```
              Before                                  Now

  Manual deployment of N agents:            AgentPod:
  docker run agent-1                        agentpod tenant create alice
  docker run agent-2                        agentpod pod create alice/agent --type openclaw
  docker run agent-3                        agentpod tenant create bob
  Manually configure Traefik routes...      agentpod pod create bob/agent --type openclaw
  Manually write health check scripts...    -> Auto subdomain, volume, health, self-healing
  Manually manage each agent's config...    -> Unified dashboard + CLI management
```

## Key Features

| Feature | Description |
|---------|-------------|
| **Agent-Aware Orchestration** | Not a generic PaaS. Understands agent config structure, port rules, channel bindings, and health semantics through the Adapter interface |
| **Pluggable Adapter System** | Support any containerized agent by implementing a single `AgentAdapter` interface. OpenClaw is the first, more planned |
| **Per-Tenant Container Isolation** | Every tenant gets an independent Docker container + volume. No shared filesystem, no noisy neighbors |
| **Reconciliation Engine** | Desired state vs actual state auto-alignment. Container crashed? Auto-rebuilt. Config changed? Auto-restarted |

## Architecture Overview

```
+---------------------------------------------------------+
|           Layer 1: Dashboard (Next.js)                  |
|  App Router + shadcn/ui + NextAuth                      |
|  Tenant CRUD / Config forms / Real-time status          |
+---------------------------------------------------------+
|           Layer 2: Control Plane (Hono)                  |
|  REST API  |  Reconciler (30s)  |  Health Checker       |
|  ---------   ----------------    ----------------       |
|                  PostgreSQL                              |
|                  Docker API                              |
+---------------------------------------------------------+
|           Layer 3: Data Plane                            |
|  Traefik    Pod:alice    Pod:bob      Pod:carol          |
|  :80/:443   OpenClaw     OpenClaw     Open WebUI         |
|             Vol:/data/   Vol:/data/   Vol:/data/          |
|                                                          |
|  Docker Bridge Network: agentpod-net                     |
+---------------------------------------------------------+
```

## Supported Agents

| Agent | Status | Adapter |
|-------|--------|---------|
| [OpenClaw](https://github.com/nicepkg/openclaw) | First-class | `openclaw` |
| [Open WebUI](https://github.com/open-webui/open-webui) | Planned | `open-webui` |
| [LobeChat](https://github.com/lobehub/lobe-chat) | Planned | `lobechat` |
| Custom | Bring your own | Implement `AgentAdapter` |

## Tech Stack

- **Language**: TypeScript (Node.js)
- **Dashboard**: Next.js 15+ (App Router) + shadcn/ui + Tailwind CSS
- **Control Plane**: Hono (long-running Node.js process)
- **Database**: PostgreSQL
- **Reverse Proxy**: Traefik v3.4+ (Docker label auto-discovery, version pinned)
- **Container Runtime**: Docker API (direct, single-node MVP)
- **Auth**: NextAuth v5 (admin only)
- **Real-time**: SSE (Dashboard status push)

## Documentation

| Document | Description |
|----------|-------------|
| [Docs Index](docs/index.md) | Documentation navigation |
| [Architecture](docs/architecture.md) | Technical architecture deep dive (Chinese) |
| [Adapter Spec](docs/adapter-spec.md) | Adapter interface spec + development guide |
| [Roadmap](docs/roadmap.md) | Implementation roadmap |
| [ADR](docs/adr.md) | Technical decision records |
| [PRD](docs/prd/PRD.md) | Product requirements document (Chinese) |
| [Research](docs/research/README.md) | Research hub and reports |

## Quick Start

> Coming soon. AgentPod is currently in the documentation and research phase.

The target deployment experience:

```bash
# One-line install (handles Docker, database, reverse proxy automatically)
curl -fsSL https://get.agentpod.dev | bash

# Create your first tenant and agent
agentpod tenant create acme
agentpod pod create acme/agent --type openclaw

# Open Dashboard
# -> http://your-server:3000
```

## Contributing

AgentPod is in early development. We welcome discussions, ideas, and contributions.

- Open an [Issue](https://github.com/yyforever/agentpod/issues) for bugs or feature requests
- Start a [Discussion](https://github.com/yyforever/agentpod/discussions) for questions or ideas

## License

[MIT](LICENSE)

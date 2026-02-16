# 技术决策记录（ADR）

> 本文档汇总 AgentPod 当前已确认的核心技术决策。

### ADR-001: 编程语言选择 TypeScript

**状态**: 已决定

**上下文**: 需要选择 AgentPod 的主要编程语言。

**决策**: TypeScript (Node.js)

**理由**:
- 与 OpenClaw 生态对齐（OpenClaw 本身是 TypeScript）
- Adapter 天然用 TS 写，贡献者门槛最低
- 开源 AI 助手生态大多是 TypeScript（OpenClaw/n8n/LobeChat/AnythingLLM/LibreChat）
- Next.js Dashboard 同 runtime

**备选**: Go (K8s/Traefik 生态), Rust (Railway CLI)

---

### ADR-002: 前端框架选择 Next.js

**状态**: 已决定

**上下文**: Dashboard 需要一个前端框架。

**决策**: Next.js 15+ (App Router)

**理由**:
- SSR + API Routes 作 BFF
- shadcn/ui + Tailwind 生态成熟
- Server Components 减少客户端 bundle

---

### ADR-003: Control Plane API 框架选择 Hono

**状态**: 已决定

**上下文**: 控制面需要一个独立于 Next.js 的 HTTP 框架。

**决策**: Hono

**理由**:
- 轻量、类型安全
- 与 Next.js 同 runtime
- 长驻进程天然支持调和循环、WebSocket
- 比 Fastify 更轻量

**备选**: Fastify (更成熟但更重)

---

### ADR-004: 数据库选择 PostgreSQL

**状态**: 已决定

**上下文**: 需要持久化租户、Pod、配置等状态。

**决策**: PostgreSQL

**理由**:
- Coolify 验证了 PG 在多租户 PaaS 的可行性 (314 migrations)
- 比 JSON 文件/BoltDB 更适合关系查询
- JSONB 支持灵活的 Pod 配置存储
- 成熟的加密、备份生态

**备选**: SQLite (更轻但并发写有限)

---

### ADR-005: 反向代理选择 Traefik v3.4+

**状态**: 已决定（2026-02-16 经深度调研确认）

**上下文**: 多租户子域名路由需要反向代理，WebSocket 长连接稳定性是核心需求。

**决策**: Traefik v3.4+（锁定版本，避开 v3.2.4/v3.3.0 WebSocket 回归）

**理由**:
- Docker label 自动发现（事件驱动，即时生效），新增/删除 Pod 无需重写配置
- **增量路由更新**：配置变更只影响变更的路由，现有 WebSocket 连接不受影响
- WebSocket 原生支持，v3 修复了 `X-Forwarded-Proto` 非标准值问题
- Let's Encrypt 自动 HTTPS，支持通配符证书
- Coolify (40K+ stars) 使用 Traefik v3.6，验证了多租户可行性

**为什么不选 Caddy**:
Caddy 的 WebSocket 零配置很优秀，但有致命缺陷：**任何容器配置变更触发全量重载，导致所有租户的所有 WebSocket 连接断开**（Coolify GitHub #7942）。对于频繁创建/删除容器的多租户平台，这是不可接受的。

**为什么不选 Nginx**:
nginx-proxy 基于 docker-gen 重新生成配置并 reload，reload 期间会短暂中断连接。且 Safari + HTTPS + WebSocket 有已知兼容性问题。

**版本策略**: 锁定具体版本号，升级前必须在测试环境验证 WebSocket 连接（v3.2.4 曾引入回归 #11405）。

---

### ADR-006: 编排模式选择调和式

**状态**: 已决定

**上下文**: 如何管理容器的创建/启动/停止/删除。

**决策**: 调和式（Reconciliation）

**理由**:
- 从 K8s Controller 学来的成熟模式
- 自动重试、自动恢复
- 控制面崩溃重启后自动对齐状态
- 声明式 API 更简洁（改 DB 即可，调和循环自动执行）

**备选**: 命令式（API 直接调用 docker start/stop，失败需手动重试）

---

### ADR-007: 插件模式选择 TypeScript AgentAdapter

**状态**: 已决定

**上下文**: 如何支持多种 Agent 类型。

**决策**: TypeScript AgentAdapter 接口

**理由**:
- 类型安全
- 可复用 Zod schema 自动生成表单
- 贴近 n8n Node 模式
- 与 OpenClaw ChannelPlugin 一脉相承
- 生命周期钩子支持复杂逻辑

**备选**: YAML 模板 (简单但无钩子逻辑)

---

### ADR-008: Docker 网络选择自定义 Bridge

**状态**: 已决定（2026-02-16 经深度调研确认）

**上下文**: 多租户容器需要网络连通方案。Host 网络在 VPS 实战中可解决 WebSocket pairing，但有端口冲突问题。

**决策**: 自定义 Bridge 网络（`agentpod-net`），MVP 共享单一网络，Phase 2 可演进为每租户独立网络。

**理由**:
- Docker 内置 DNS 解析，容器间可按名称互访
- 每个容器独立网络命名空间，相同内部端口无冲突（多租户核心需求）
- Traefik 通过 Docker label + 内部 IP 路由，无需暴露宿主端口
- 所有生产级平台（Coolify、CapRover、Dokku）均采用此方案

**为什么不选 Host 网络**: 端口冲突致命——50 个 Agent 容器无法共享宿主端口空间。
**为什么不选 Macvlan**: 依赖物理网络配置，多数 VPS 不支持。

**演进路径**: MVP 单一共享网络 → Phase 2 每租户独立 Bridge + Traefik 多网络连接（租户间网络隔离）。

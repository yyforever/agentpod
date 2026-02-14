# 路线图 + 技术决策记录

## 项目结构

```
agentpod/
+-- apps/
|   +-- dashboard/           # Next.js Dashboard (Layer 1)
|   |   +-- app/
|   |   |   +-- dashboard/   # 管理页面
|   |   |   +-- api/         # BFF Route Handlers
|   |   +-- package.json
|   |
|   +-- control-plane/       # Control Plane API (Layer 2)
|       +-- src/
|       |   +-- api/         # REST API routes
|       |   +-- reconciler/  # 调和引擎
|       |   +-- health/      # 健康检查
|       |   +-- docker/      # Docker API 封装
|       |   +-- adapters/    # Agent Adapters
|       |       +-- openclaw.ts
|       |       +-- open-webui.ts
|       |       +-- index.ts
|       +-- package.json
|
+-- packages/
|   +-- shared/              # 共享类型定义
|       +-- src/types.ts
|
+-- docker/
|   +-- docker-compose.yml         # 控制面启动
|   +-- docker-compose.traefik.yml # Traefik 配置
|
+-- templates/
|   +-- agents/              # 社区 Agent 模板 (YAML)
|
+-- turbo.json               # Monorepo 配置
+-- package.json
```

## MVP 计划（6 周）

### Week 1-2: 基础设施 + 核心引擎

- [ ] 搭建 monorepo (Turborepo + pnpm)
- [ ] 定义 AgentAdapter TypeScript 接口 (`packages/shared`)
- [ ] 实现 OpenClaw Adapter (`apps/control-plane/src/adapters/openclaw.ts`)
- [ ] 实现 Docker API 封装 (createContainer / start / stop / rm / inspect)
- [ ] 搭建 PostgreSQL + 执行 schema migration
- [ ] 实现调和引擎 (Reconciliation Loop, 30s 间隔)
- [ ] 实现 REST API: `POST /pods`, `GET /pods`, `DELETE /pods/:id`
- [ ] **验证 Traefik + Bridge 网络 WebSocket pairing**（关键风险点）

**交付物**: CLI 可以 `curl POST /pods` 创建一个 OpenClaw 租户容器，自动分配子域名，通过 Traefik 访问

### Week 3-4: Dashboard

- [ ] Next.js 项目初始化 (App Router + shadcn/ui)
- [ ] 管理员登录 (NextAuth, 单管理员即可)
- [ ] Pod 列表页 (状态、Agent 类型、子域名链接)
- [ ] 创建 Pod 页面 (选 Agent 类型 -> 根据 configSchema 渲染表单)
- [ ] Pod 详情页 (状态、日志、配置编辑、重启/删除按钮)
- [ ] WebSocket 实时状态推送

**交付物**: 通过 Web Dashboard 管理 OpenClaw 租户的完整生命周期

### Week 5-6: 稳定性 + 第二个 Adapter

- [ ] 健康检查 + 自动重启 (容器连续 3 次失败 -> 重启 + 记录事件)
- [ ] 资源监控 (读取 docker stats -> 写入 pod_status)
- [ ] Pod 事件日志 (创建/启动/停止/重启/错误)
- [ ] 实现 Open WebUI Adapter（验证 Adapter 架构通用性）
- [ ] docker-compose.yml 一键部署（控制面 + Traefik + PostgreSQL）
- [ ] README + 快速开始文档

**交付物**: `docker compose up` 一键启动，管理 OpenClaw 和 Open WebUI 两种 Agent 类型

## 后续阶段

### Phase 2: 多节点 + 稳定性

- [ ] SSH 远程执行（学 Coolify: SSH 到远程服务器管容器）
- [ ] Node Agent (Go daemon, WebSocket 连接控制面)
- [ ] 调度器（决定新 Pod 放在哪台机器）
- [ ] 每日自动备份（Volume snapshot -> S3/MinIO）
- [ ] 更多 Adapter: LobeChat, AnythingLLM

### Phase 3: 生态 + 可扩展性

- [ ] Agent 模板市场（社区贡献 Adapter/预置配置）
- [ ] 多管理员 + RBAC
- [ ] Prometheus metrics export
- [ ] Webhook 通知（Pod 状态变更 -> 回调 URL）
- [ ] CLI 工具 (`agentpod create / list / delete / logs`)

---

## 技术决策记录

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

### ADR-005: 反向代理选择 Traefik v3

**状态**: 已决定

**上下文**: 多租户子域名路由需要反向代理。

**决策**: Traefik v3

**理由**:
- Docker label 自动发现，新增 Pod 无需重写配置文件
- WebSocket 原生支持
- Let's Encrypt 自动 HTTPS
- Coolify 也用 Traefik，验证了多租户可行性

**备选**: Caddy (更简单但自动发现弱), Nginx (需要手动配置 reload)

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

# 路线图

> 技术决策记录请见: [adr.md](adr.md)

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
- [ ] CLI 工具 (`agentpod tenant / pod / health / doctor / migrate`)

---

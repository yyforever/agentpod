# 04 - 验证闭环与工程设计

> AgentPod PRD 系列文档 | 分册 4/4
> 依赖：01 ~ 03 文档
> 方法论来源：Peter Steinberger 闭环工程实践

---

## 一、核心原则

### 闭环工程（Closed-Loop Engineering）

> "不是优化 prompt，而是优化闭环设计。"
> —— 让每次交付都能 Write → Run → Test → Fix to Green（自动化/半自动化）

**AgentPod 工程目标**：每个功能模块都具备**自证正确性**的能力 —— Agent（开发者 or AI Agent）不止写代码，还要把系统跑通并能证明"它现在对了"。

### 四层架构

```
┌─────────────────────────────────────────────┐
│  Layer 1: Harness（CLI 诊断入口）              │
│  agentpod tenant / pod / health / doctor       │
│  → Agent 直接验证输出，零 UI 依赖              │
├─────────────────────────────────────────────┤
│  Layer 2: Shell（Dashboard / REST API）        │
│  Next.js Dashboard + Hono API                  │
│  → 用户界面，仅做 I/O 和展示                   │
├─────────────────────────────────────────────┤
│  Layer 3: Core（纯业务逻辑）                    │
│  Reconciler / TenantManager / AdapterEngine   │
│  → 无副作用，纯函数 + 状态机，100% 可测试       │
├─────────────────────────────────────────────┤
│  Layer 4: Services（外部依赖）                  │
│  Docker API / PostgreSQL / Traefik / OpenClaw  │
│  → 通过 interface 抽象，可 mock 可替换          │
└─────────────────────────────────────────────┘
```

**关键约束**：
- **Core 不依赖 Shell**：业务逻辑不需要 Dashboard 也能运行
- **Harness 直接调用 Core**：CLI 命令 = Core 函数 + 格式化输出
- **Services 通过 interface 隔离**：Docker API → `ContainerRuntime` interface，可以 mock 为内存实现

---

## 二、CLI-First 设计

### 为什么 CLI 优先于 Dashboard

| 维度 | CLI | Dashboard |
|------|-----|-----------|
| 验证闭环 | ✅ 输出可 pipe、可 diff、可断言 | ❌ 需要截图/录屏才能验证 |
| AI Agent 友好 | ✅ 命令行工具零上下文成本 | ❌ 需要浏览器自动化 |
| 自动化 | ✅ 可嵌入 CI/CD 脚本 | ❌ 需要额外 API 调用 |
| 可复现 | ✅ 命令 + 参数 = 完整复现路径 | ❌ 点击路径难以描述 |

### CLI 命令设计

```bash
# Tenant 管理
agentpod tenant create <tenant-id>
agentpod tenant delete <tenant-id> [--force]
agentpod tenant list [--format json|table]
agentpod tenant status <tenant-id> [--format json]

# Pod 生命周期
agentpod pod create <tenant-id>/agent [--type openclaw] [--config config.json]
agentpod pod delete <tenant-id>/agent [--force]
agentpod pod list [--tenant <tenant-id>] [--format json|table]
agentpod pod status <tenant-id>/agent [--format json]

# 运维操作
agentpod pod restart <tenant-id>/agent
agentpod pod upgrade <tenant-id>/agent [--image openclaw:2026.2.15]
agentpod pod upgrade --all [--image openclaw:2026.2.15]
agentpod pod logs <tenant-id>/agent [--tail 50] [--follow]

# 迁移（已有 OpenClaw 容器纳入管理）
agentpod migrate discover          # 扫描本机运行的 OpenClaw 容器
agentpod migrate adopt --all       # 全部纳入 AgentPod 管理

# 诊断（Harness 入口）
agentpod doctor                    # 检查系统依赖（Docker、Traefik、DB）
agentpod health [<tenant-id>]      # 健康检查（单个或全部）
agentpod reconcile --dry-run       # 预览调和动作（不执行）
agentpod reconcile                 # 立即执行一次调和

# 配置管理
agentpod config get <tenant-id>/agent
agentpod config set <tenant-id>/agent --key model --value "anthropic/claude-opus-4-6"
```

### CLI 输出规范

每个命令返回**机器可解析**的 JSON（`--format json`），默认人类可读表格：

```bash
$ agentpod pod list
┌──────────────┬──────────┬────────┬───────┬──────────┐
│ Pod          │ Status   │ Health │ CPU   │ Memory   │
├──────────────┼──────────┼────────┼───────┼──────────┤
│ acme/agent   │ running  │ ok     │ 12%   │ 256 MB   │
│ beta/agent   │ running  │ warn   │ 45%   │ 480 MB   │
│ mega/cs      │ running  │ ok     │ 8%    │ 200 MB   │
│ mega/hr      │ stopped  │ -      │ -     │ -        │
└──────────────┴──────────┴────────┴───────┴──────────┘

$ agentpod tenant status mega
┌──────────┬──────────┬────────┐
│ Pod      │ Status   │ Health │
├──────────┼──────────┼────────┤
│ mega/cs  │ running  │ ok     │
│ mega/hr  │ stopped  │ -      │
└──────────┴──────────┴────────┘

$ agentpod pod list --format json
[
  {"pod":"acme/agent","status":"running","health":"ok","cpu":12,"memoryMB":256},
  {"pod":"beta/agent","status":"running","health":"warn","cpu":45,"memoryMB":480},
  {"pod":"mega/cs","status":"running","health":"ok","cpu":8,"memoryMB":200},
  {"pod":"mega/hr","status":"stopped","health":null,"cpu":null,"memoryMB":null}
]
```

---

## 三、假设清单与验证计划

### 技术假设

| ID | 假设 | 置信度 | 阻塞级别 | 验证方法 | 验证时机 |
|----|------|--------|----------|----------|----------|
| **TH-1** | Traefik 能正确转发 WebSocket 到 Bridge 网络中的 OpenClaw 容器 | 🔴 低 | **P0 阻塞** | PoC：1 Traefik + 1 OpenClaw + Bridge 网络 | Week 0 |
| **TH-2** | 单台 4GB VPS 可运行 20 个 OpenClaw 容器 | 🟡 中 | P1 | 压测：逐步增加容器数，监控 RSS/CPU | Week 1 |
| **TH-3** | Reconciliation Loop 30s 周期不会产生性能瓶颈 | 🟢 高 | P2 | 单元测试 + 50 容器压测 | Week 2 |
| **TH-4** | dockerode 库可稳定管理 50+ 容器生命周期 | 🟢 高 | P2 | 集成测试 | Week 2 |
| **TH-5** | PostgreSQL + RLS 对 100 租户的查询延迟 < 10ms | 🟢 高 | P2 | 基准测试 | Week 3 |

### 产品假设

| ID | 假设 | 置信度 | 验证方法 | 验证时机 |
|----|------|--------|----------|----------|
| **PH-1** | SaaS 开发者为客户部署多个 OpenClaw 实例是真实需求 | 🟡 中 | GitHub Stars + 社区反馈 | 发布后 M1 |
| **PH-2** | 开发者愿意从手动脚本迁移到 AgentPod | 🟡 中 | Issue / PR 参与度 | 发布后 M1-M3 |
| **PH-3** | Dashboard 对开发者的吸引力大于纯 CLI | 🟡 中 | 使用数据对比 | 发布后 M2 |
| **PH-4** | 单机方案足以满足 MVP 用户 | 🟢 高 | 用户反馈 | 发布后 M3 |

### 前置验证（Week 0，编码前必须完成）

**TH-1: WebSocket + Traefik + Bridge 网络验证**

```
验证环境:
  - 1 × Traefik v3 容器（Bridge 网络）
  - 1 × OpenClaw 容器（Bridge 网络，同一网络）
  - 配置 Traefik 路由规则（Host header 匹配）

验证步骤:
  1. 启动 Traefik + OpenClaw（Bridge 网络）
  2. 通过 Traefik 发起 WebSocket 连接到 OpenClaw Gateway
  3. 发送 "connect" 帧，验证 Gateway 响应
  4. 验证无 "pairing required" 错误
  5. 保持连接 5 分钟，验证无断开

成功标准:
  ✅ WebSocket 握手成功
  ✅ "connect" 帧收到正常 response
  ✅ 5 分钟无断连
  ✅ Gateway 日志无 pairing 警告

失败应对:
  方案 A: 配置 Traefik X-Forwarded-For / Origin header
  方案 B: 配置 OpenClaw allowedOrigins 白名单
  方案 C: 设置 allowInsecureAuth: true（降级方案）
  方案 D: 如果全部失败 → 重新评估网络架构
```

---

## 四、测试策略

### 测试金字塔

```
                    ┌───────┐
                    │  E2E  │  5-10%
                    │ (Live)│  关键路径：create → health → delete
                   ┌┴───────┴┐
                   │Integration│  15-30%
                   │  测试     │  Reconciler + Docker API mock
                  ┌┴──────────┴┐
                  │   Unit      │  60-80%
                  │   测试       │  Core 层纯逻辑
                  └─────────────┘
```

### 各层测试规范

**Unit 测试（Core 层）：**
- 覆盖率目标：80%+
- 测试对象：Reconciler 状态机、配置生成、端口分配算法、健康评估逻辑
- 无外部依赖（Docker、DB 全部 mock）
- 每次 commit 运行（CI L1）

**Integration 测试（Core + Services mock）：**
- 测试对象：Reconciler + Docker API 交互、DB CRUD + RLS 隔离
- 使用 testcontainers 或 mock Docker API
- 每次 PR 运行（CI L2）

**E2E 测试（全栈 Live）：**
- 测试对象：`agentpod tenant create → pod create → pod status → health → pod delete` 全流程
- 需要真实 Docker 环境
- 每日 nightly 运行（CI L3）
- 可选：需要真实 OpenClaw 镜像（`LIVE=1`）

### Feature 测试模板

每个新功能交付时，必须附带：

```markdown
## Feature: [功能名称]

### 风险点
- [ ] 列出可能出错的地方

### 测试覆盖
- [ ] Unit: [列出核心逻辑测试]
- [ ] Integration: [列出边界测试]
- [ ] E2E: [关键路径]

### 一键执行
```bash
pnpm test:unit -- --filter=<feature>
pnpm test:integration -- --filter=<feature>
pnpm test:e2e -- --filter=<feature>
```

### 最小复现入口
```bash
# 如果测试失败，用这个命令复现
agentpod doctor && agentpod tenant create test && agentpod pod create test/agent --type openclaw && agentpod health test
```
```

---

## 五、Agent 交付契约

### 定义

每次代码交付（无论人工或 AI Agent 生成），必须包含：

| 交付物 | 必需 | 说明 |
|--------|------|------|
| 代码变更 | ✅ | 可 review 的 diff |
| 新增/更新测试 | ✅ | 覆盖哪些风险点 |
| 一键执行命令 | ✅ | 复制粘贴即可运行 + 验证 |
| 最小复现入口 | ✅ | 失败时的 CLI 复现路径 |
| 风险清单 | ✅ | 标注 flaky 点、环境假设 |

### 示例

```markdown
## 交付：实现 Reconciliation Loop

### 代码变更
- `src/core/reconciler.ts` - 核心调和逻辑
- `src/services/docker.ts` - Docker API 封装
- `src/cli/reconcile.ts` - CLI 命令

### 测试
- `test/unit/reconciler.test.ts` - 状态机转换（12 个 case）
- `test/integration/reconciler-docker.test.ts` - 与 mock Docker 交互
- 覆盖率：Core 层 85%

### 一键执行
pnpm test:unit -- --filter=reconciler
pnpm test:integration -- --filter=reconciler

### 最小复现
# 创建一个租户 → 手动 kill 容器 → 等待 30s → 验证自动恢复
agentpod tenant create test && agentpod pod create test/agent --type openclaw
docker kill agentpod-test-agent
sleep 35
agentpod pod status test/agent  # 应显示 status: running

### 风险
- Docker API 连接超时可能导致 reconcile 延迟
- 并发 reconcile 需要加锁（已实现 mutex）
```

---

## 六、CI 分层

```
┌────────────────────────────────────────────────┐
│ L1: 每次 Commit                                 │
│ - lint + format (oxlint + oxfmt)               │
│ - type check (tsc --noEmit)                    │
│ - unit tests (vitest --coverage)               │
│ - 耗时 < 2 分钟                                 │
├────────────────────────────────────────────────┤
│ L2: 每次 PR Merge                               │
│ - L1 全部                                       │
│ - integration tests                             │
│ - build check (tsdown)                         │
│ - 耗时 < 5 分钟                                 │
├────────────────────────────────────────────────┤
│ L3: 每日 Nightly                                │
│ - L2 全部                                       │
│ - E2E tests (需要 Docker)                       │
│ - Live tests (LIVE=1, 需要真实 OpenClaw 镜像)    │
│ - 性能基准测试                                   │
│ - 耗时 < 15 分钟                                │
└────────────────────────────────────────────────┘
```

---

## 七、开发里程碑与闭环验证点

### Phase 0: PoC 验证（Week 0, 2 天）

**目标**：验证 TH-1（WebSocket + Traefik + Bridge 网络）

**闭环验证**：
```bash
# PoC 成功标准
docker compose -f poc/docker-compose.yml up -d
# → Traefik + OpenClaw 在 Bridge 网络中启动
curl -s http://localhost/health
# → 返回 Gateway 健康状态
wscat -c ws://openclaw.localhost
# → WebSocket 连接成功，无 pairing 错误
```

**Gate**：通过 → 进入 Phase 1；失败 → 尝试降级方案 → 重新评估

---

### Phase 1: 核心引擎（Week 1-2）

**交付物**：
1. Monorepo 搭建（Turborepo + pnpm）
2. Core 层：Reconciler 状态机 + TenantManager + 端口分配器
3. Services 层：Docker API 封装 (dockerode) + PostgreSQL schema
4. Harness 层：`agentpod tenant / pod / health / reconcile / migrate`

**闭环验证**：
```bash
agentpod doctor
# → 检查 Docker、PostgreSQL、Traefik 依赖 ✅

agentpod tenant create acme
agentpod pod create acme/agent --type openclaw
# → 自动分配端口、创建 Volume、启动容器 ✅

agentpod pod status acme/agent
# → 显示 running + 健康状态 ✅

docker kill agentpod-acme-agent
sleep 35
agentpod pod status acme/agent
# → 自动恢复，显示 running ✅

agentpod pod delete acme/agent
agentpod tenant delete acme
# → 停止容器、清理 Volume ✅
```

**测试覆盖**：Core 层 Unit 80%+ / Integration 覆盖 Reconciler + Docker 交互

---

### Phase 2: Dashboard（Week 3-4）

**交付物**：
1. Next.js App Router + shadcn/ui
2. 管理员登录（NextAuth v5）
3. 租户列表 / 创建 / 详情页
4. 实时状态更新（SSE）

**闭环验证**：
```bash
# Dashboard 启动
pnpm --filter dashboard dev

# 通过 CLI 创建租户，Dashboard 实时显示
agentpod tenant create demo
agentpod pod create demo/agent --type openclaw
# → Dashboard 自动出现 "demo" Tenant 及其 Pod

# Dashboard 中创建 Tenant + Pod
# → CLI `agentpod pod list` 同步显示
```

---

### Phase 3: 稳定性与运维（Week 5-6）

**交付物**：
1. 健康检查 + 自动重启（含 Gateway heartbeat）
2. 资源监控（docker stats 聚合）
3. 事件日志（create/delete/restart/error 记录）
4. `docker compose` 一键部署

**闭环验证**：
```bash
# 一键部署
docker compose up -d
# → Control Plane + Dashboard + Traefik + PostgreSQL 全部启动

agentpod tenant create client-1 && agentpod pod create client-1/agent --type openclaw
agentpod tenant create client-2 && agentpod pod create client-2/agent --type openclaw
agentpod tenant create client-3 && agentpod pod create client-3/agent --type openclaw

agentpod pod list
# → 3 个 Pod 全部 running

# 模拟故障
docker kill agentpod-client-2-agent
sleep 35
agentpod health
# → client-2/agent 自动恢复 ✅

# 查看事件日志
agentpod events --tail 10
# → 记录 create × 3, crash × 1, restart × 1
```

---

## 八、工作流决策：CLI vs MCP

参照 Peter Steinberger 的 Agent 工作流原则：

| 场景 | 推荐 | 原因 |
|------|------|------|
| Agent 操作 Docker | **CLI**（docker/dockerode） | 零上下文成本，稳定 |
| Agent 查询 PostgreSQL | **CLI**（psql）/ ORM | 标准工具链 |
| Agent 验证部署 | **CLI**（agentpod doctor/health） | 闭环验证入口 |
| Agent 调试 Dashboard | **MCP**（chrome-devtools-mcp） | 浏览器调试唯一闭环 |
| Agent 查看 Traefik 路由 | **CLI**（traefik API curl） | REST API 更直接 |

**原则**：CLI 工具零上下文成本 → 优先使用。MCP 仅在 CLI 无法闭环时引入（如浏览器调试）。

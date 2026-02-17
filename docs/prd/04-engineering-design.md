# 04 - 验证闭环与工程设计

> AgentPod PRD 子文档 04
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

**与部署架构的关系**：

[architecture.md](../architecture.md) 定义的是部署架构（进程怎么分布），本文定义的是代码架构（模块怎么组织）。两者是不同维度：

```
部署架构（进程）                   代码架构（模块）
┌──────────────────────┐
│ Dashboard (Next.js)   │  →  Shell 层（页面 + BFF API Routes）
├──────────────────────┤
│ Control Plane (Hono)  │  →  Harness 层（CLI 命令）
│                       │     Core 层（Reconciler / TenantManager / AdapterEngine）
│                       │     Services 层（Docker API / PostgreSQL 封装）
├──────────────────────┤
│ Data Plane            │  →  被 Services 层调用的外部系统
│ (Traefik + Docker)    │     （不是 AgentPod 的代码，是运行时依赖）
└──────────────────────┘
```

部署架构决定进程边界，代码架构决定依赖方向。Core 层是核心——无论从 CLI（Harness）还是 Dashboard（Shell）调用，最终都走 Core 层逻辑。

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
# TODO: config set 的交互方式需在实现时细化设计
#   Adapter configSchema 是 Zod 嵌套结构，单 key-value 可能不够用
#   候选方案：dot notation（a.b.c）、JSON patch、--config file.json 整体覆盖
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
| **TH-1** | Traefik v3.4+ 能正确转发 WebSocket 到 Bridge 网络中的 Agent 容器 | 🟡 中 | **P0 阻塞** | PoC：1 Traefik + 1 OpenClaw + Bridge 网络 + allowedOrigins 配置 | Week 0 |
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

> 深度调研结论："pairing required" 是 OpenClaw Gateway 应用层的 Origin/Host 校验失败，不是网络层问题。通过配置即可解决，通过概率高。

```
验证环境:
  - 1 × Traefik v3.4+ 容器（自定义 Bridge 网络 agentpod-net）
  - 1 × OpenClaw 容器（同一 Bridge 网络，bind 0.0.0.0）
  - Traefik 配置：passHostHeader（默认开启）、readTimeout=0、writeTimeout=0
  - OpenClaw 配置：gateway.controlUi.allowedOrigins 包含子域名

关键配置:
  - Docker label: traefik.docker.network=agentpod-net（避免多网络时随机选错）
  - Traefik entrypoint: readTimeout=0, writeTimeout=0（支持 WebSocket 长连接）
  - 不挂 gzip/buffering/retry middleware 到 WebSocket 路由（Coolify #4002 教训）
  - 应用层心跳必须实现（Traefik ping/pong 超时检测不可靠）

验证步骤:
  1. 创建自定义 Bridge 网络 agentpod-net
  2. 启动 Traefik v3.4+（配置 Docker provider + 超时参数）
  3. 启动 OpenClaw（bind 0.0.0.0 + allowedOrigins 配置）
  4. 通过 Traefik 子域名发起 WebSocket 连接
  5. 发送 "connect" 帧，验证 Gateway 响应
  6. 验证无 "pairing required" 错误
  7. 保持连接 10 分钟，验证无断开

成功标准:
  ✅ WebSocket 握手成功
  ✅ "connect" 帧收到正常 response
  ✅ 10 分钟无断连
  ✅ Gateway 日志无 pairing 警告
  ✅ 新增/删除其他容器时，现有 WebSocket 连接不受影响

失败应对（按顺序尝试）:
  方案 A: 调整 Traefik Headers middleware 显式设置 X-Forwarded-Proto=https
  方案 B: 扩大 OpenClaw allowedOrigins 白名单范围
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
│ - lint + format (TODO: 选型待定，要求主流且新)   │
│   候选: Biome / ESLint 9 + Prettier             │
│ - type check (tsc --noEmit)                    │
│ - unit tests (vitest --coverage)               │
│ - 耗时 < 2 分钟                                 │
├────────────────────────────────────────────────┤
│ L2: 每次 PR Merge                               │
│ - L1 全部                                       │
│ - integration tests                             │
│ - build check (TODO: 选型待定)                   │
│   候选: tsup / tsdown / unbuild / 纯 tsc        │
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

# 迁移已有容器（用户最常见的入口路径）
# 前提：机器上已有手动部署的 OpenClaw 容器在运行
agentpod migrate discover
# → 发现 2 个未纳管的 OpenClaw 容器 ✅

agentpod migrate adopt --all
# → 容器零中断纳入管理，DB 中创建对应 Tenant + Pod 记录 ✅

agentpod pod list
# → 包含迁移进来的 Pod，状态 running ✅

agentpod pod delete acme/agent
agentpod tenant delete acme
# → 停止容器、清理 Volume ✅
```

**测试覆盖**：Core 层 Unit 80%+ / Integration 覆盖 Reconciler + Docker 交互 + Migrate 发现与接管

---

### Phase 2: Dashboard（Week 3-4）

**交付物**：
1. Next.js App Router + shadcn/ui
2. 管理员登录（NextAuth v5）
3. 租户列表 / 创建 / 详情页
4. 实时状态更新（SSE）

**闭环验证（CLI 闭环）**：
```bash
# Phase 1 的所有 CLI 验证继续通过
agentpod doctor && agentpod tenant create demo && agentpod pod create demo/agent --type openclaw
agentpod pod status demo/agent   # → running ✅
agentpod pod delete demo/agent && agentpod tenant delete demo
```

**闭环验证（Dashboard 闭环）**：
```
1. 访问 Dashboard URL → 显示登录页
2. 管理员登录（NextAuth） → 进入概览页 ✅
3. 点击"创建租户" → 填写表单 → 提交 → 租户出现在列表中 ✅
4. 点击"创建 Pod" → 选择 Agent 类型 → 填写配置（Adapter configSchema 自动渲染） → 提交 ✅
5. Pod 列表实时显示状态变化（pending → creating → running） ✅
6. 进入 Pod 详情页 → 查看状态、配置、日志 ✅
7. 点击"停止" → 状态变为 stopped → 点击"启动" → 状态变为 running ✅
8. 点击"删除" → 确认弹窗 → Pod 从列表消失 ✅
```

**闭环验证（双向同步）**：
```bash
# CLI 创建 → Dashboard 实时显示
agentpod tenant create sync-test && agentpod pod create sync-test/agent --type openclaw
# → Dashboard 自动出现 "sync-test" 及其 Pod ✅

# Dashboard 创建 → CLI 可见
# （在 Dashboard 中创建 Tenant "web-test" + Pod）
agentpod pod list
# → 包含 web-test 的 Pod ✅
```

---

### Phase 3: 稳定性与运维（Week 5-6）

**交付物**：
1. 健康检查 + 自动重启（由 Adapter 定义协议级健康检查方式）
2. 资源监控（docker stats 聚合）
3. 事件日志（create/delete/restart/error 记录）
4. 安装脚本（一行命令自动处理 Docker + 数据库 + 反向代理）

**闭环验证**：
```bash
# 一行安装命令（用户唯一需要执行的步骤）
curl -fsSL https://get.agentpod.dev | bash
# → 安装脚本自动处理 Docker、创建网络、拉起 Control Plane + Dashboard + Traefik + PostgreSQL

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

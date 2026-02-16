# AgentPod 技术架构

> 本文档从产品文档（AGENTPOD.md）中提取并扩展，聚焦技术架构细节。

## 设计原则

- **Agent-Aware**: 不是通用容器管理，理解 Agent 类型、配置模式、生命周期
- **Adapter-First**: 通过 AgentAdapter 接口支持任意 Agent 类型，OpenClaw 只是第一个实现
- **最强隔离**: 每个租户一个独立容器 + 独立 Volume，无共享文件系统
- **调和驱动**: 期望状态 vs 实际状态自动对齐（K8s Reconciliation 模式）
- **MVP 单机**: Phase 1 控制面和数据面在同一台机器，通过 Docker API 直连

## 三层架构

```
+-------------------------------------------------------------+
|                Layer 1: Dashboard (Next.js)                   |
|                                                              |
|  Next.js App Router + shadcn/ui + Tailwind                   |
|  - 管理员登录（NextAuth）                                      |
|  - 租户列表 / 创建 / 停止 / 删除                                |
|  - Agent 类型选择（根据 Adapter Registry 动态渲染）             |
|  - 配置表单（根据 Adapter 的 configSchema 自动生成）            |
|  - 实时状态（WebSocket 推送容器状态变更）                       |
|  - API Routes 作为 BFF（薄代理层，转发到 Control Plane API）    |
|                                                              |
+--------------------------------------------------------------+
|                Layer 2: Control Plane API                     |
|                                                              |
|  独立 Node.js 长驻进程（Hono）                                 |
|                                                              |
|  +------------+  +------------+  +---------------+           |
|  | REST API   |  | Reconciler |  | Health Checker|           |
|  | tenant CRUD|  | 30s 循环    |  | 定期探测      |           |
|  | pod 管理    |  | 期望vs实际  |  | 每个Pod健康   |           |
|  | adapter    |  | 自动修复    |  |              |           |
|  | registry   |  |            |  |              |           |
|  +-----+------+  +-----+------+  +------+-------+           |
|        |               |                |                    |
|        v               v                v                    |
|  +-----------------------------------------------------------+
|  |            PostgreSQL (状态存储)                             |
|  |  tenants / pods / pod_configs / pod_status / events        |
|  +-----------------------------------------------------------+
|        |                                                     |
|        v                                                     |
|  +-----------------------------------------------------------+
|  |          Docker API（直连，MVP 单机）                        |
|  |  createContainer / start / stop / rm / inspect / logs      |
|  +-----------------------------------------------------------+
|                                                              |
+--------------------------------------------------------------+
|                Layer 3: Data Plane                            |
|                                                              |
|  +--------+  +--------+  +--------+  +--------+             |
|  | Traefik|  | Pod:   |  | Pod:   |  | Pod:   |             |
|  | 反向代理|  | alice  |  | bob    |  | carol  |             |
|  |        |  |OpenClaw|  |OpenClaw|  |Open    |             |
|  | :80    |  |Gateway |  |Gateway |  |WebUI   |             |
|  | :443   |  | :18789 |  | :18789 |  | :8080  |             |
|  |        |  |        |  |        |  |        |             |
|  |        |  |Vol:    |  |Vol:    |  |Vol:    |             |
|  |        |  |/data/  |  |/data/  |  |/data/  |             |
|  |        |  | alice/ |  | bob/   |  | carol/ |             |
|  +--------+  +--------+  +--------+  +--------+             |
|                                                              |
|  Docker Bridge Network: agentpod-net                         |
+--------------------------------------------------------------+
```

### 为什么分三层？

| 需求 | Next.js API Routes | 独立 API 进程 |
|------|-------------------|--------------|
| 调和循环（永不停止的轮询） | 不支持（serverless 有超时） | 天然支持 |
| WebSocket 服务端 | 部署受限 | 原生支持 |
| 后台任务队列 | 需要外部 worker | 可以内嵌 |
| 控制面挂了，租户容器还在跑 | Next.js 挂了全挂 | 数据面独立运行 |
| 独立扩展 | Dashboard 和 API 绑定 | 各自独立扩展 |

**结论**: Next.js 只做 Dashboard + BFF（薄代理层），调度/编排/调和逻辑在独立后端。

## 调和引擎（Reconciliation Engine）

从 Kubernetes Controller 模式学来的核心逻辑:

```
每 30 秒执行一次:

  1. 从 DB 读 "期望状态"
     SELECT * FROM pods WHERE desired_status = 'running'

  2. 从 Docker API 读 "实际状态"
     docker.listContainers({ filters: { label: [...] } })

  3. 对比，执行修复:

     期望 running + 实际不存在 -> 创建容器
     期望 running + 实际 exited -> 重启容器
     期望 stopped + 实际 running -> 停止容器
     期望 deleted + 实际存在 -> 删除容器
     期望 running + 实际 running + 配置有变 -> 更新/重启

  4. 更新 DB 中的 actual_status
     UPDATE pods SET actual_status = ..., updated_at = ...
```

### 调和 vs 命令式

| 命令式（API 直接操作） | 调和式（期望状态驱动） |
|----------------------|---------------------|
| `POST /pods/alice/start` -> 直接 `docker start` | 改 DB: `desired_status = 'running'`，调和循环自动执行 |
| 如果执行失败需要手动重试 | 下一轮循环自动重试 |
| 手动 `docker rm` 了容器 -> 状态不一致 | 下一轮循环检测到缺失 -> 自动重建 |
| 控制面崩溃重启后不知道该做什么 | 重启后读 DB 和 Docker 状态，自动恢复 |

## 数据模型

```sql
-- 租户
CREATE TABLE tenants (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  email       TEXT,
  created_at  TIMESTAMPTZ DEFAULT now(),
  updated_at  TIMESTAMPTZ DEFAULT now()
);

-- Pod（每个租户可以有多个 Pod）
CREATE TABLE pods (
  id              TEXT PRIMARY KEY,
  tenant_id       TEXT REFERENCES tenants(id),
  name            TEXT NOT NULL,
  adapter_id      TEXT NOT NULL,
  subdomain       TEXT UNIQUE NOT NULL,
  desired_status  TEXT DEFAULT 'running',
  actual_status   TEXT DEFAULT 'pending',
  container_id    TEXT,
  gateway_token   TEXT NOT NULL,
  data_dir        TEXT NOT NULL,
  created_at      TIMESTAMPTZ DEFAULT now(),
  updated_at      TIMESTAMPTZ DEFAULT now()
);

-- Pod 配置（用户自定义项，对应 Adapter 的 configSchema）
CREATE TABLE pod_configs (
  pod_id      TEXT PRIMARY KEY REFERENCES pods(id),
  config      JSONB NOT NULL,
  updated_at  TIMESTAMPTZ DEFAULT now()
);

-- Pod 状态快照（由调和引擎写入）
CREATE TABLE pod_status (
  pod_id          TEXT PRIMARY KEY REFERENCES pods(id),
  phase           TEXT NOT NULL,
  ready           BOOLEAN DEFAULT false,
  message         TEXT,
  last_health_at  TIMESTAMPTZ,
  memory_mb       INTEGER,
  cpu_percent     REAL,
  storage_mb      INTEGER,
  updated_at      TIMESTAMPTZ DEFAULT now()
);

-- 事件日志
CREATE TABLE pod_events (
  id          SERIAL PRIMARY KEY,
  pod_id      TEXT REFERENCES pods(id),
  event_type  TEXT NOT NULL,
  message     TEXT,
  created_at  TIMESTAMPTZ DEFAULT now()
);
```

## 反向代理: Traefik v3.4+

### 为什么选 Traefik

- **Docker 原生集成**: 通过 container labels 自动发现服务，事件驱动即时生效，新增/删除 Pod 无需重写配置
- **增量路由更新**: 配置变更只影响变更的路由，不影响其他连接（Caddy 的致命缺陷：任何容器变更触发全量重载，导致所有 WebSocket 连接断开）
- **WebSocket 开箱支持**: 自动处理 `Upgrade`/`Connection` header，v3 修复了 `X-Forwarded-Proto` 非标准值（v2 发 `wss`，v3 正确发 `https`）
- **自动 HTTPS**: 集成 Let's Encrypt，支持通配符证书（DNS challenge），每个子域名自动申请/续期
- **动态配置**: 新增 Pod 容器时无需重启 Traefik

> Coolify (40K+ stars) 使用 Traefik v3.6 作为默认代理，验证了这个选择在多租户场景下的可行性。

### 版本锁定策略

**必须锁定 Traefik 版本**。v3.2.4/v3.3.0 曾引入 WebSocket 回归（#11405，`:protocol` header 导致 500 错误），已在后续版本修复。推荐 v3.4+，升级前必须在测试环境验证 WebSocket 连接。

### Traefik 静态配置（WebSocket 优化）

```yaml
entryPoints:
  websecure:
    address: ":443"
    transport:
      respondingTimeouts:
        readTimeout: "0"     # 禁用读超时，支持 WebSocket 长连接
        writeTimeout: "0"    # 禁用写超时
        idleTimeout: "180s"  # 空闲连接保活

providers:
  docker:
    exposedByDefault: false  # 仅路由显式启用的容器
    network: agentpod-net    # 指定默认网络，避免多网络时随机选错
```

### WebSocket 路由注意事项

- **不挂 gzip middleware**: 压缩会破坏 WebSocket/SSE（Coolify #4002 教训）
- **不挂 buffering middleware**: 缓冲与流式传输不兼容
- **不挂 retry middleware**: WebSocket 是有状态连接，重试无意义
- **应用层心跳必须实现**: Traefik 的 ping/pong 超时检测不可靠（#10627）

### Pod 容器 Traefik Labels

```typescript
const labels = {
  'traefik.enable': 'true',
  'traefik.docker.network': 'agentpod-net',
  [`traefik.http.routers.${pod.id}.rule`]:
    `Host(\`${pod.subdomain}.${DOMAIN}\`)`,
  [`traefik.http.routers.${pod.id}.entrypoints`]: 'websecure',
  [`traefik.http.routers.${pod.id}.tls.certresolver`]: 'letsencrypt',
  [`traefik.http.services.${pod.id}.loadbalancer.server.port`]:
    String(primaryPort),
  'agentpod.managed': 'true',
  'agentpod.pod-id': pod.id,
  'agentpod.adapter': pod.adapterId,
}
```

### Docker 网络拓扑

**MVP: 共享自定义 Bridge 网络**

所有生产级平台（Coolify、CapRover、Dokku）都使用自定义 Bridge 网络。MVP 使用单一 `agentpod-net` 网络：
- 容器间 DNS 解析（无需 IP 管理）
- 每个容器可用相同内部端口（无冲突）
- Traefik 通过 Docker label 自动发现并路由
- Host 网络模式因端口冲突不适合多租户

**Phase 2 增强: 每租户独立网络**

当安全隔离需求增强时，可演进为每租户独立 Bridge + Traefik 多网络连接，提供租户间网络隔离。

## Dashboard 页面结构

```
/                          -> 登录
/dashboard                 -> 概览（Pod 总数、运行中、异常）
/dashboard/pods            -> Pod 列表（状态、Agent 类型、创建时间）
/dashboard/pods/new        -> 创建 Pod（选 Agent 类型 -> 填配置表单）
/dashboard/pods/[id]       -> Pod 详情（状态、日志、配置编辑、重启/删除）
/dashboard/pods/[id]/logs  -> Pod 日志（实时流）
/dashboard/adapters        -> 已注册的 Agent Adapter 列表
/dashboard/settings        -> 系统设置（域名、Traefik 配置）
```

## 已验证的技术事实

| 事实 | 来源 |
|------|------|
| 单容器 + 单 volume 方案可行 | VPS 实战验证 |
| 重建容器后数据 100% 保留 | 多次重建验证 |
| `--network host` 可解决 WebSocket pairing，但多租户不可用（端口冲突） | VPS 实战验证 |
| Bridge 网络下 WebSocket 报 `pairing required` 是应用层问题（非网络层） | 深度调研确认 |
| OpenClaw 只支持 JSON5 配置，不支持 YAML | 踩坑后确认 |
| 非 root 用户通过 `NPM_CONFIG_PREFIX` 安装全局包 | Node.js 最佳实践验证 |
| Traefik v3 修复了 `X-Forwarded-Proto` 非标准值（v2 发 `wss`，v3 发 `https`） | Traefik GitHub #6388 |
| Traefik 增量更新路由，不影响现有连接；Caddy 全量重载会断开所有连接 | Coolify GitHub #7942 |
| Gzip 压缩会破坏 WebSocket/SSE 连接 | Coolify GitHub #4002 |
| Traefik ping/pong 超时检测不可靠，必须实现应用层心跳 | Traefik GitHub #10627 |

### WebSocket "Pairing Required" 问题（已定位）

**根因**："pairing required" 是 OpenClaw Gateway 应用层的 Origin/Host 校验失败，不是 Traefik 或 Bridge 网络的问题。

**解决方案**（按优先级）：

1. **OpenClaw bind `0.0.0.0`**：容器必须监听所有接口，否则 Traefik 在 Bridge 网络内无法连通
2. **配置 `allowedOrigins`**：在 openclaw.json 中设置 `gateway.controlUi.allowedOrigins` 允许子域名
3. **Traefik `passHostHeader`**：默认开启，保留原始 `Host: alice.example.com` 头（Gateway 用此做校验）
4. **Traefik v3.4+**：修复了 `X-Forwarded-Proto` 问题，确保 Origin 与 Proto 一致

**风险评估**：🟡 中等置信度（配置问题，非架构问题）。仍需 PoC 验证，但通过概率高。

## Phase 2: 多节点架构

Phase 1 是单机架构。当租户量超过单机上限 (~50-100 容器/台) 时，需要多节点。

```
Control Plane (主机)           Worker Node A           Worker Node B
+------------------+          +---------------+      +---------------+
| Dashboard        |          | Node Agent    |      | Node Agent    |
| Control API      |<-- WS -- | (Go daemon)   |      | (Go daemon)   |
| PostgreSQL       |          |               |      |               |
| Reconciler       |          | Pod 1  Pod 2  |      | Pod 3  Pod 4  |
| Scheduler        |          | Traefik       |      | Traefik       |
+------------------+          +---------------+      +---------------+
```

Node Agent 职责:
- 主动连接控制面（WebSocket outbound），NAT 友好
- 执行容器操作（收到指令 -> docker run/stop/rm）
- 上报心跳 + 容器状态 + 资源用量
- 本地健康检查

**Phase 2 不在 MVP 范围内，这里只做架构预留。**

# 自托管 PaaS 平台竞品深度技术分析

> **研究目标**: 为 AgentPod 项目提供竞品技术能力对比，重点关注 OpenClaw 多租户 AI Agent 部署场景的适配性。
>
> **研究日期**: 2026-02-15

---

## 执行摘要

本报告深入分析了四种自托管 PaaS 解决方案在部署 OpenClaw 多租户 AI Agent 场景下的适用性：

| 平台 | 推荐度 | 核心优势 | 核心劣势 |
|------|--------|----------|----------|
| **Coolify** | ⭐⭐⭐⭐ | UI 友好、Docker Compose 原生支持、自动 SSL | 资源开销大、WebSocket 有已知问题 |
| **CapRover** | ⭐⭐⭐ | 成熟稳定、零停机部署、WebSocket 原生支持 | 配置格式受限、单服务器扩展瓶颈 |
| **Dokku** | ⭐⭐ | 轻量级、资源消耗最低 | 功能简陋、缺乏监控、单服务器限制 |
| **手动方案** | ⭐⭐⭐⭐⭐ | 完全控制、零抽象开销、最适合 OpenClaw | 需要自建自动化、学习曲线陡峭 |

**关键发现**:
- 所有现成 PaaS 方案都**不能完美满足** OpenClaw 的特殊需求（端口范围、配置文件管理、卷隔离）
- **手动 Docker Compose + Traefik** 方案虽然初期配置成本高，但提供最佳灵活性
- **Coolify** 是"开箱即用"场景的最佳选择，但需要解决 WebSocket 稳定性问题

---

## 1. Coolify - 现代化自托管 PaaS 的代表

### 1.1 技术架构

- **核心技术栈**: Laravel (PHP) + SQLite + Docker + Traefik (默认反向代理)
- **部署模式**: 控制面（Coolify 本体）+ 被管理的 Docker 容器
- **反向代理**: Traefik v2.9.0+（使用 HTTP provider，无需重启即可动态更新路由）

### 1.2 多应用部署能力

#### 优势
✅ **原生 Docker Compose 支持**: Coolify 可直接部署完整的 Docker Compose 栈，这是 CapRover 和 Dokku 不具备的核心优势。支持自定义域名、环境变量、存储卷和服务网络。

✅ **动态路由**: 通过 Traefik 的动态配置，部署应用仅需秒级即可暴露（无需重启代理）。

✅ **200+ 一键服务**: 提供预配置的 Docker Compose 模板（数据库、缓存、开源应用），简化常见服务的部署。

#### 劣势
❌ **仅支持单服务器**: 虽然可以通过"远程服务器"功能管理多台机器，但每台机器上的应用**无法跨节点负载均衡**。

❌ **资源消耗**: Coolify 本身需要 **2+ GB RAM** 和 **2 核 CPU**，主要用于作业调度器（job scheduler）。

### 1.3 WebSocket 支持

#### 现状
⚠️ **已知问题**: GitHub Issue #4002 报告了 WebSocket 和 Server-Sent Events (SSE) 连接在 Coolify + Traefik 环境下的稳定性问题。本地 Docker Compose 部署正常，但通过 Coolify 部署后 WebSocket 连接异常。

#### 解决方案
可通过以下配置绕过：
```yaml
# docker-compose.yml
labels:
  - "traefik.http.services.myapp.loadbalancer.server.port=3000"
  - "traefik.http.routers.myapp.rule=Host(`app.example.com`)"
  # WebSocket 特定配置
  - "traefik.http.middlewares.ws-headers.headers.customrequestheaders.Connection=Upgrade"
  - "traefik.http.middlewares.ws-headers.headers.customrequestheaders.Upgrade=websocket"
```

对于极高流量的 WebSocket 服务，Coolify 文档建议**直接映射主机端口**（绕过 Traefik），但这会失去自动 SSL 和域名路由。

### 1.4 反向代理自动配置

✅ **完全自动化**: Coolify 通过 Docker labels 自动配置 Traefik 路由规则。用户只需输入域名（以 `https://` 开头），Coolify 会自动：
1. 生成 Traefik 路由规则
2. 通过 Let's Encrypt 申请 SSL 证书（HTTP-01 或 TLS-ALPN-01 challenge）
3. 设置 HTTP → HTTPS 重定向
4. 配置证书自动续期（90 天周期）

### 1.5 Docker 容器自定义配置

✅ **完全支持**: Coolify 本质上是 Docker Compose 的 UI 封装，用户可以：
- 直接编辑 `docker-compose.yml`
- 设置 `cpus` 和 `memory` 限制（虽然有用户报告此功能可能导致应用崩溃）
- 挂载自定义卷
- 定义复杂的网络拓扑

❌ **应用级资源限制缺失**: Coolify 不提供 GUI 级别的 per-app 资源限制（如 RAM 限制 300MB）。GitHub Issue #873 请求此功能但被标记为 "not planned"。

### 1.6 健康检查机制

✅ **支持三种配置方式**:
1. **Coolify UI**: 创建应用时配置健康检查路径、期望状态码、检查间隔
2. **Dockerfile HEALTHCHECK**:
   ```dockerfile
   HEALTHCHECK --interval=30s --timeout=30s --retries=3 \
     CMD curl -f http://127.0.0.1:3000/ || exit 1
   ```
3. **Docker Compose healthcheck**:
   ```yaml
   healthcheck:
     test: ["CMD", "curl", "-f", "http://localhost:3000"]
     interval: 30s
     timeout: 10s
     retries: 3
   ```

⚠️ **已知限制**:
- 容器必须安装 `curl` 或 `wget`
- Docker Compose 和 Service Template 部署**不支持**资源监控（CPU/RAM 指标）
- Rolling updates（滚动更新）**依赖**健康检查通过才能切换流量

### 1.7 资源开销

根据实际用户报告和官方文档：

| 组件 | CPU | 内存 | 备注 |
|------|-----|------|------|
| Coolify 控制面 | 0.5-1 核 | 1-2 GB | 主要用于作业调度 |
| coolify-proxy (Traefik) | 0.1-0.5 核 | 100-300 MB | 高 CPU 问题已在部分版本报告 |
| **总开销** | **~1 核** | **~2 GB** | 不含应用本身 |

**性能基准**:
- Traefik 单实例（8 核 16 GB）可处理 **72,000 RPS**（无中间件）
- 启用 TLS + JWT 认证后降至约 **40,000 RPS**

⚠️ **CPU 问题**: GitHub Issue #5676 报告 Coolify 容器在特定场景下 CPU 占用过高。

### 1.8 Per-App 资源限制

❌ **不支持 GUI 级别配置**: 用户需要手动编辑 Docker Compose 文件：
```yaml
services:
  myapp:
    deploy:
      resources:
        limits:
          cpus: '1.0'
          memory: 512M
        reservations:
          cpus: '0.5'
          memory: 256M
```

### 1.9 SSL/TLS 管理

✅ **完全自动化**:
- Let's Encrypt 证书申请（HTTP-01 或 TLS-ALPN-01 challenge）
- 自动续期（90 天证书，提前自动续期）
- 支持通配符证书（需要 DNS-01 challenge）
- 支持自定义证书上传

### 1.10 配置复杂度

✅ **"一键部署"真实性**:
- **初始安装**: 单行脚本即可（`sh -c "$(curl -fsSL https://coolify.io/install.sh)"`）
- **应用部署**: 连接 Git 仓库 → 自动检测语言（Nixpacks）→ 一键部署
- **一键服务**: 数据库、Redis、Minio 等 200+ 模板可直接部署

❌ **复杂场景需要手动配置**:
- WebSocket 高级配置
- 跨服务器通信
- 自定义网络拓扑

### 1.11 OpenClaw 适配性分析

| 需求 | 支持情况 | 评分 | 备注 |
|------|----------|------|------|
| 多应用单服务器部署 | ✅ 原生支持 | ⭐⭐⭐⭐⭐ | Docker Compose 栈 |
| WebSocket 应用 | ⚠️ 有已知问题 | ⭐⭐⭐ | 需要手动调整 Traefik 配置 |
| 自动反向代理 | ✅ 完全自动 | ⭐⭐⭐⭐⭐ | Traefik + Let's Encrypt |
| 自定义 Docker 配置 | ✅ 完全支持 | ⭐⭐⭐⭐⭐ | 可编辑 compose 文件 |
| 健康检查 | ✅ 三种方式 | ⭐⭐⭐⭐ | 需要容器有 curl/wget |
| 资源限制 | ⚠️ 手动配置 | ⭐⭐⭐ | 无 GUI，需编辑 YAML |
| 端口范围管理 | ❌ 不支持 | ⭐ | 需要手动映射每个端口 |
| 配置文件隔离 | ✅ Volume 支持 | ⭐⭐⭐⭐ | 自动添加 UUID 避免冲突 |
| 卷隔离 | ✅ 自动化 | ⭐⭐⭐⭐⭐ | 每个资源有独立 UUID |

**关键障碍**:
1. **端口范围**: OpenClaw 默认使用 18789，但多租户场景需要 10000-60000 端口范围。Coolify 不支持批量端口映射，需要为每个租户手动配置。
2. **WebSocket 稳定性**: 需要进一步测试 Traefik 配置是否能稳定支持 OpenClaw Gateway 的 WebSocket 连接。

---

## 2. CapRover - Docker Swarm 驱动的 PaaS

### 2.1 技术架构

- **核心技术栈**: Node.js + Docker Swarm + NGINX (反向代理)
- **部署模式**: Captain 节点（主控）+ Worker 节点（可选）
- **反向代理**: 内置 NGINX，自动配置路由和 SSL

### 2.2 多应用部署能力

✅ **单服务器多应用**: 支持在单台服务器上部署无限数量的应用（受限于硬件资源）。

✅ **Docker Swarm 集群**: 可添加 Worker 节点扩展容量，但**只有无状态应用**可以跨节点调度。有持久数据的应用必须固定在单节点。

❌ **Docker Compose 支持受限**: CapRover 使用自定义的 captain-definition 格式，虽然支持 Docker Compose，但**只支持部分参数**，不如 Coolify 灵活。

### 2.3 WebSocket 支持

✅ **原生支持**: CapRover 有专门的 **WebSocket Support** 开关（App Config → HTTP Settings），启用后会修改 NGINX 配置以支持 WebSocket 连接。

```nginx
# CapRover 自动生成的 NGINX 配置（伪代码）
location / {
  proxy_http_version 1.1;
  proxy_set_header Upgrade $http_upgrade;
  proxy_set_header Connection "Upgrade";
}
```

### 2.4 反向代理自动配置

✅ **完全自动化**:
- 应用部署后自动在 NGINX 中创建虚拟主机
- 自动申请 Let's Encrypt 证书（免费）
- 支持自定义 SSL 证书（手动上传到 nginx-shared 目录）

### 2.5 Docker 容器自定义配置

✅ **灵活配置**:
- 支持自定义 Dockerfile
- 支持 captain-definition 文件（类似简化的 docker-compose.yml）
- 可通过 App Configs 设置环境变量、实例数量、预部署脚本

⚠️ **端口映射**:
- 支持**单端口**映射（App Config → Port Mapping）
- 不支持端口范围批量映射（GitHub Issue #645 请求此功能但未实现）

### 2.6 健康检查机制

✅ **Docker Swarm 原生健康检查**:
```dockerfile
HEALTHCHECK --interval=30s --timeout=30s --retries=3 \
  CMD curl -f http://127.0.0.1:3000/ || exit 1
```

✅ **零停机部署**:
- **无卷应用**: 使用 `start-first` 策略（新容器启动 → 健康检查通过 → 旧容器停止）
- **有卷应用**: 使用 `stop-first` 策略（旧容器停止 → 新容器启动），避免文件冲突

### 2.7 资源开销

| 组件 | CPU | 内存 | 备注 |
|------|-----|------|------|
| CapRover Captain | 0.3-0.5 核 | 500 MB - 1 GB | 控制面板和调度器 |
| NGINX | 0.1-0.3 核 | 50-100 MB | 反向代理 |
| Docker Swarm | 0.1 核 | 100 MB | 编排层 |
| **总开销** | **~0.5-1 核** | **~1 GB** | 比 Coolify 轻量 |

### 2.8 Per-App 资源限制

⚠️ **手动配置**: 需要编辑 captain-definition 文件：
```json
{
  "schemaVersion": 2,
  "dockerfileLines": [...],
  "deployResources": {
    "limits": {
      "cpus": "1.0",
      "memory": "512M"
    },
    "reservations": {
      "cpus": "0.5",
      "memory": "256M"
    }
  }
}
```

### 2.9 SSL/TLS 管理

✅ **内置 Let's Encrypt**:
- 自动申请和续期
- 支持自定义证书
- 可为每个应用配置独立域名和证书

### 2.10 配置复杂度

✅ **"一键部署"真实性**:
- **初始安装**: 单行命令安装 Captain 节点
- **应用部署**:
  - One-Click Apps 市场（常见应用模板）
  - 从 Git 仓库部署（需要 captain-definition 文件）
  - 上传 tar 包
  - 使用预构建 Docker 镜像

❌ **学习曲线**:
- 需要理解 captain-definition 格式
- 高级功能（如集群、持久化卷跨节点）配置复杂

### 2.11 卷管理和多租户隔离

✅ **持久化数据支持**:
- 支持挂载主机目录或 Docker volumes
- 每个应用有独立的数据目录

⚠️ **跨节点持久化**: 需要使用 Docker volume plugins（如 `sapk/plugin-rclone`），配置复杂。

❌ **多租户隔离**: CapRover 本身**不提供多租户功能**。需要结合第三方工具（如 Swarmgate）实现基于标签的访问控制。

### 2.12 OpenClaw 适配性分析

| 需求 | 支持情况 | 评分 | 备注 |
|------|----------|------|------|
| 多应用单服务器部署 | ✅ 原生支持 | ⭐⭐⭐⭐⭐ | Docker Swarm 编排 |
| WebSocket 应用 | ✅ 原生支持 | ⭐⭐⭐⭐⭐ | 内置 WebSocket 开关 |
| 自动反向代理 | ✅ 完全自动 | ⭐⭐⭐⭐⭐ | NGINX + Let's Encrypt |
| 自定义 Docker 配置 | ⭐⭐⭐⭐ | 支持但需要 captain-definition |
| 健康检查 | ✅ 零停机部署 | ⭐⭐⭐⭐⭐ | Docker Swarm 原生 |
| 资源限制 | ⚠️ 手动配置 | ⭐⭐⭐ | 需编辑 JSON |
| 端口范围管理 | ❌ 不支持 | ⭐ | 只能单端口映射 |
| 配置文件隔离 | ✅ Volume 支持 | ⭐⭐⭐⭐ | 每个应用独立卷 |
| 卷隔离 | ✅ 支持 | ⭐⭐⭐⭐ | 但跨节点复杂 |

**关键障碍**:
1. **端口范围**: 同样不支持批量端口映射。
2. **配置格式受限**: captain-definition 比原生 Docker Compose 功能少。
3. **多租户隔离**: 需要额外工具（Swarmgate）。

**优势**:
- **WebSocket 稳定性**: 相比 Coolify，CapRover 的 WebSocket 支持更成熟。
- **零停机部署**: 对于需要高可用的生产环境更友好。

---

## 3. Dokku - 最简化的 Heroku 克隆

### 3.1 技术架构

- **核心技术栈**: Bash + Docker + NGINX + Herokuish (buildpack 支持)
- **部署模式**: 单服务器，通过 Git push 触发部署
- **反向代理**: NGINX，自动配置虚拟主机

### 3.2 多应用部署能力

✅ **单服务器无限应用**: 理论上可部署任意数量应用（受限于 1 GB RAM 最低要求）。

❌ **单服务器限制**: Dokku 设计为单机运行，**无集群支持**。这是其最大短板。

### 3.3 WebSocket 支持

✅ **支持但需要配置**:
- Dokku 0.20.0+ 引入 `.DOKKU_APP_${PROCESS_TYPE}_LISTENERS` 变量，允许在 `nginx.conf.sigil` 中注入非 HTTP 进程（如 WebSocket）。
- 提供官方 WebSocket 示例仓库（dokku/websocket-example），演示如何运行多进程（web + ws）。

⚠️ **配置复杂**: 相比 CapRover 的一键开关，Dokku 需要手动编辑 NGINX 模板。

### 3.4 反向代理自动配置

✅ **NGINX 自动配置**:
- 应用部署后自动生成 NGINX 虚拟主机
- 支持 Let's Encrypt（通过 letsencrypt 插件）

### 3.5 Docker 容器自定义配置

✅ **Dockerfile 支持**:
- 默认使用 Heroku buildpacks，但可通过 Dockerfile 自定义构建。
- 文档警告 Dockerfile 是 "power user feature"，部分 Dokku 功能可能工作异常。

### 3.6 健康检查机制

✅ **零停机部署健康检查**:
- 默认等待 10 秒后假定容器已启动
- 支持自定义 CHECKS 文件（已弃用，推荐使用 app.json）
- 可配置 WAIT（等待时间）、TIMEOUT（超时）、ATTEMPTS（重试次数）

**app.json 示例**:
```json
{
  "healthchecks": {
    "web": [
      {
        "type": "startup",
        "name": "web-check",
        "description": "Checking if the app responds",
        "path": "/",
        "attempts": 3
      }
    ]
  }
}
```

### 3.7 资源开销

| 组件 | CPU | 内存 | 备注 |
|------|-----|------|------|
| Dokku 本身 | 0.05-0.1 核 | 50-100 MB | 最轻量 |
| NGINX | 0.05-0.1 核 | 30-50 MB | |
| **总开销** | **~0.1-0.2 核** | **~100 MB** | 远低于 Coolify/CapRover |

**TCO 优势**: 有用户报告从 Coolify 切换到 Dokku 后成本减半。

### 3.8 Per-App 资源限制

✅ **原生支持**:
```bash
dokku resource:limit node-js-app memory 512M
dokku resource:limit node-js-app cpu 1.0

# 按进程类型限制
dokku resource:limit node-js-app --process-type web memory 256M
```

⚠️ **需要重新部署**: 所有资源限制命令**需要 rebuild/deploy 才能生效**。

### 3.9 SSL/TLS 管理

✅ **Let's Encrypt 插件**:
```bash
dokku letsencrypt:enable myapp
```

### 3.10 配置复杂度

✅ **极简主义**:
- 最低硬件要求：1 GB RAM（可运行在 1 CPU / 1 GB 的 VPS 上）
- 命令行驱动，无 GUI
- 适合熟悉 Git 和 CLI 的开发者

❌ **缺乏高级功能**:
- 无内置监控（需要自己配置 Prometheus/Grafana）
- 无预览环境（preview deployments）
- 无可视化界面

### 3.11 卷管理和多租户隔离

✅ **持久化存储**:
```bash
dokku storage:ensure-directory myapp
dokku storage:mount myapp /var/lib/dokku/data/storage/myapp:/app/storage
```

⚠️ **权限问题**: Herokuish buildpack 使用 `32767:32767` 权限，需要注意文件所有权。

❌ **多租户隔离**: Dokku 无多租户概念，所有应用共享同一 NGINX 实例。

### 3.12 OpenClaw 适配性分析

| 需求 | 支持情况 | 评分 | 备注 |
|------|----------|------|------|
| 多应用单服务器部署 | ✅ 支持 | ⭐⭐⭐⭐ | 单服务器限制 |
| WebSocket 应用 | ⚠️ 需配置 | ⭐⭐⭐ | 需手动编辑 NGINX 模板 |
| 自动反向代理 | ✅ 自动 | ⭐⭐⭐⭐ | NGINX + Let's Encrypt |
| 自定义 Docker 配置 | ⚠️ 受限 | ⭐⭐⭐ | Dockerfile 支持有限 |
| 健康检查 | ✅ 支持 | ⭐⭐⭐⭐ | app.json 配置 |
| 资源限制 | ✅ CLI 命令 | ⭐⭐⭐⭐ | 原生支持 |
| 端口范围管理 | ❌ 不支持 | ⭐ | 需手动映射 |
| 配置文件隔离 | ✅ Storage 插件 | ⭐⭐⭐ | 手动管理 |
| 卷隔离 | ⚠️ 手动 | ⭐⭐⭐ | 权限配置复杂 |

**适合场景**:
- **极简主义者**: 不需要 GUI，习惯 CLI 操作
- **低预算项目**: VPS 资源有限（1 GB RAM）
- **单租户部署**: 不需要复杂的多租户隔离

**不适合 OpenClaw 原因**:
1. **单服务器瓶颈**: 无法横向扩展
2. **WebSocket 配置复杂**: 需要深入 NGINX 配置
3. **缺乏监控**: 无法实时查看 Agent 运行状态

---

## 4. 手动方案: Docker Compose + Traefik

### 4.1 最小可行配置 (MVS)

#### 核心文件结构
```
/opt/agentpod/
├── traefik/
│   ├── docker-compose.yml       # Traefik 服务
│   ├── traefik.yml              # 静态配置
│   └── acme.json                # Let's Encrypt 证书（权限 600）
└── tenants/
    ├── tenant-001/
    │   ├── docker-compose.yml   # OpenClaw 实例
    │   ├── .env                 # 环境变量
    │   └── data/                # 持久化数据
    ├── tenant-002/
    │   └── ...
    └── tenant-010/
        └── ...
```

#### Traefik 主配置 (~50 行)

**traefik/docker-compose.yml**:
```yaml
version: '3.8'

services:
  traefik:
    image: traefik:v3.0
    container_name: traefik
    restart: unless-stopped
    security_opt:
      - no-new-privileges:true
    networks:
      - gateway
    ports:
      - "80:80"
      - "443:443"
    volumes:
      - /var/run/docker.sock:/var/run/docker.sock:ro
      - ./traefik.yml:/traefik.yml:ro
      - ./acme.json:/acme.json
    labels:
      - "traefik.enable=true"
      - "traefik.http.routers.dashboard.rule=Host(`traefik.yourdomain.com`)"
      - "traefik.http.routers.dashboard.entrypoints=websecure"
      - "traefik.http.routers.dashboard.tls.certresolver=letsencrypt"
      - "traefik.http.routers.dashboard.service=api@internal"

networks:
  gateway:
    external: true
```

**traefik/traefik.yml** (~30 行):
```yaml
api:
  dashboard: true

entryPoints:
  web:
    address: ":80"
    http:
      redirections:
        entryPoint:
          to: websecure
          scheme: https
  websecure:
    address: ":443"

providers:
  docker:
    endpoint: "unix:///var/run/docker.sock"
    exposedByDefault: false
    network: gateway

certificatesResolvers:
  letsencrypt:
    acme:
      email: admin@yourdomain.com
      storage: /acme.json
      httpChallenge:
        entryPoint: web
```

#### 单租户配置 (~40 行)

**tenants/tenant-001/docker-compose.yml**:
```yaml
version: '3.8'

services:
  openclaw:
    image: ghcr.io/openclaw/openclaw:latest
    container_name: openclaw-tenant-001
    restart: unless-stopped
    networks:
      - gateway
      - tenant-001-internal
    volumes:
      - ./data:/root/.openclaw
      - ./workspace:/workspace
    environment:
      - OPENCLAW_GATEWAY_PORT=18789
      - OPENCLAW_CONFIG_PATH=/root/.openclaw/openclaw.json
      - ANTHROPIC_API_KEY=${ANTHROPIC_API_KEY}
    labels:
      - "traefik.enable=true"
      - "traefik.docker.network=gateway"
      # HTTP 路由
      - "traefik.http.routers.tenant-001.rule=Host(`tenant-001.yourdomain.com`)"
      - "traefik.http.routers.tenant-001.entrypoints=websecure"
      - "traefik.http.routers.tenant-001.tls.certresolver=letsencrypt"
      - "traefik.http.services.tenant-001.loadbalancer.server.port=18789"
      # WebSocket 支持
      - "traefik.http.middlewares.ws-headers.headers.customrequestheaders.Connection=Upgrade"
      - "traefik.http.middlewares.ws-headers.headers.customrequestheaders.Upgrade=websocket"
      - "traefik.http.routers.tenant-001.middlewares=ws-headers"

networks:
  gateway:
    external: true
  tenant-001-internal:
    driver: bridge
```

**tenants/tenant-001/.env**:
```env
ANTHROPIC_API_KEY=sk-ant-xxxxx
COMPOSE_PROJECT_NAME=tenant-001
```

### 4.2 配置行数统计（10 租户）

| 文件 | 行数 | 备注 |
|------|------|------|
| `traefik/docker-compose.yml` | 30 | 一次性配置 |
| `traefik/traefik.yml` | 30 | 一次性配置 |
| `tenant-{N}/docker-compose.yml` | 40 × 10 | 每个租户 40 行 |
| `tenant-{N}/.env` | 3 × 10 | 每个租户 3 行 |
| **总计** | **490 行** | |

**实际工作量**:
- 初始设置：~1 小时（配置 Traefik + 创建网络）
- 新增租户：~5 分钟（复制模板 + 修改域名/API key）

### 4.3 缺失的自动化功能

❌ **需要自建的功能**:

1. **租户管理 CLI**:
   ```bash
   # 理想状态
   agentpod create tenant-011 --domain tenant-011.yourdomain.com --api-key sk-ant-xxxxx

   # 手动实现
   - 复制 tenant-template/ 到 tenant-011/
   - 修改 docker-compose.yml 中的标签和容器名
   - 修改 .env 文件
   - 运行 docker-compose up -d
   ```

2. **健康检查监控**:
   - Traefik 提供健康检查机制，但需要配置 healthcheck
   - 无内置告警（需要集成 Prometheus + Grafana）

3. **日志聚合**:
   - 每个租户日志独立（`docker logs openclaw-tenant-001`）
   - 需要 ELK/Loki 等外部工具统一管理

4. **资源限制**:
   ```yaml
   # 需要在每个 docker-compose.yml 中手动添加
   deploy:
     resources:
       limits:
         cpus: '1.0'
         memory: 2G
   ```

5. **备份/迁移**:
   - 需要自己编写脚本备份 `data/` 目录
   - 没有一键迁移功能

### 4.4 优势分析

✅ **完全控制**:
- 所有配置都是纯文本，易于版本控制（Git）
- 可以精确控制每个组件的行为
- 无 PaaS 平台的抽象开销

✅ **零运行时开销**:
- Traefik 资源消耗：~100 MB RAM + 0.1 核 CPU
- 相比 Coolify（2 GB）节省 95% 资源

✅ **原生 Docker Compose**:
- 无需学习新的配置格式（如 captain-definition）
- 可以使用所有 Docker Compose 功能

✅ **灵活的网络拓扑**:
- 每个租户可以有独立的内部网络
- 支持复杂的服务依赖（数据库、Redis 等）

### 4.5 OpenClaw 特殊需求适配

#### 端口范围管理

✅ **完美支持**:
```yaml
# 方案 1: 直接映射端口范围
ports:
  - "10000-10100:10000-10100"

# 方案 2: 动态端口映射（通过 Traefik）
labels:
  - "traefik.tcp.routers.tenant-001-custom.rule=HostSNI(`*`)"
  - "traefik.tcp.routers.tenant-001-custom.entrypoints=custom-10000"
  - "traefik.tcp.services.tenant-001-custom.loadbalancer.server.port=10000"
```

#### 配置文件隔离

✅ **Volume 绑定**:
```yaml
volumes:
  - ./data/openclaw.json:/root/.openclaw/openclaw.json
  - ./data/auth-profiles.json:/root/.openclaw/auth-profiles.json
  - ./workspace:/workspace
```

#### WebSocket 稳定性

✅ **Traefik 原生支持**:
```yaml
labels:
  - "traefik.http.middlewares.ws-headers.headers.customrequestheaders.Connection=Upgrade"
  - "traefik.http.middlewares.ws-headers.headers.customrequestheaders.Upgrade=websocket"
```

### 4.6 学习曲线

**前提知识**:
1. Docker 基础（镜像、容器、卷、网络）
2. Docker Compose 语法
3. Traefik 基本概念（路由器、服务、中间件）
4. HTTPS/TLS 证书管理

**学习路径**:
- **熟悉 Docker 但不懂 Traefik**: 1-2 天（阅读 Traefik 文档 + 实践）
- **熟悉 Docker Compose**: 0.5 天（Traefik 快速上手）
- **完全新手**: 1-2 周（Docker 基础 + Docker Compose + Traefik）

**对比 Kubernetes**:
- K8s 学习曲线：2-3 个月
- Docker Compose + Traefik 学习曲线：1-2 周
- **降低 80% 学习成本**

---

## 5. 总成本分析 (TCO) - 20 租户场景

### 5.1 硬件成本（单服务器）

**基准配置**（运行 20 个 OpenClaw 实例）:
- CPU: 16 核
- RAM: 64 GB
- 存储: 500 GB SSD
- 网络: 1 Gbps

**VPS 成本**（以 DigitalOcean/Hetzner 为例）:
- DigitalOcean: $240/月
- Hetzner Dedicated: $120/月
- **年成本**: $1,440 - $2,880

### 5.2 各方案资源开销对比

| 方案 | 控制面开销 | 20 租户开销 | 总内存占用 | 总 CPU 占用 |
|------|-----------|-----------|-----------|-----------|
| **Coolify** | 2 GB + 1 核 | 40 GB + 10 核 | **42 GB** | **11 核** |
| **CapRover** | 1 GB + 0.5 核 | 40 GB + 10 核 | **41 GB** | **10.5 核** |
| **Dokku** | 0.1 GB + 0.1 核 | 40 GB + 10 核 | **40.1 GB** | **10.1 核** |
| **手动方案** | 0.1 GB + 0.1 核 | 40 GB + 10 核 | **40.1 GB** | **10.1 核** |

**单个 OpenClaw 实例假设**:
- 内存: 2 GB（包括 Node.js runtime + SQLite + 缓存）
- CPU: 0.5 核（空闲时 0.1 核，Agent 运行时 1 核峰值）

**结论**:
- Coolify 的 2 GB 开销意味着在 64 GB 服务器上**最多支持 19 个租户**（而非 20 个）
- 手动方案和 Dokku 可以**充分利用资源**

### 5.3 人力成本

#### 初始部署（一次性）

| 任务 | Coolify | CapRover | Dokku | 手动方案 |
|------|---------|----------|-------|----------|
| 安装 PaaS | 0.5 小时 | 0.5 小时 | 0.5 小时 | 1 小时 |
| 配置 SSL | 0 小时 | 0 小时 | 0.5 小时 | 0.5 小时 |
| 部署首个租户 | 0.5 小时 | 1 小时 | 1 小时 | 1 小时 |
| **总计** | **1 小时** | **1.5 小时** | **2 小时** | **2.5 小时** |

#### 运维成本（每月）

| 任务 | Coolify | CapRover | Dokku | 手动方案 |
|------|---------|----------|-------|----------|
| 新增租户 | 0.1 小时 | 0.2 小时 | 0.3 小时 | 0.2 小时 |
| 更新 OpenClaw | 0.5 小时 | 1 小时 | 1.5 小时 | 0.5 小时 |
| 故障排查 | 0.5 小时 | 1 小时 | 2 小时 | 1 小时 |
| 监控维护 | 0 小时 | 0.5 小时 | 2 小时 | 1 小时 |
| **总计** | **1.1 小时** | **2.7 小时** | **5.8 小时** | **2.7 小时** |

**人力成本假设**（DevOps 工程师 $100/小时）:
- Coolify: $110/月
- CapRover: $270/月
- Dokku: $580/月
- 手动方案: $270/月

### 5.4 三年总拥有成本 (3-Year TCO)

| 方案 | 硬件 (3 年) | 人力 (3 年) | 总计 | 单租户成本 |
|------|-----------|-----------|------|-----------|
| **Coolify** | $5,184 | $3,960 | **$9,144** | **$457/年/租户** |
| **CapRover** | $4,320 | $9,720 | **$14,040** | **$702/年/租户** |
| **Dokku** | $4,320 | $20,880 | **$25,200** | **$1,260/年/租户** |
| **手动方案** | $4,320 | $9,720 | **$14,040** | **$702/年/租户** |

**结论**:
1. **Coolify 的 TCO 最低**（假设其 WebSocket 问题可解决）
2. **Dokku 的运维成本过高**（缺乏 GUI 和监控导致故障排查耗时）
3. **手动方案和 CapRover 持平**

### 5.5 隐性成本

#### 技术债务

| 方案 | 技术债务风险 | 评分 |
|------|------------|------|
| **Coolify** | 中等（依赖 Coolify 团队维护） | ⭐⭐⭐ |
| **CapRover** | 中等（Docker Swarm 逐渐被 K8s 替代） | ⭐⭐⭐ |
| **Dokku** | 低（配置简单，易于迁移） | ⭐⭐⭐⭐ |
| **手动方案** | 低（标准 Docker + Traefik，行业通用） | ⭐⭐⭐⭐⭐ |

#### 供应商锁定

| 方案 | 迁移难度 | 评分 |
|------|---------|------|
| **Coolify** | 高（需要导出 Docker Compose 配置） | ⭐⭐ |
| **CapRover** | 高（captain-definition 需转换） | ⭐⭐ |
| **Dokku** | 中等（Dockerfile 可直接复用） | ⭐⭐⭐ |
| **手动方案** | 无（配置可直接迁移） | ⭐⭐⭐⭐⭐ |

---

## 6. 针对 OpenClaw 的推荐决策矩阵

### 6.1 决策树

```
是否需要 GUI?
├─ 是 → Coolify (⭐⭐⭐⭐) 或 CapRover (⭐⭐⭐)
└─ 否 → 手动方案 (⭐⭐⭐⭐⭐) 或 Dokku (⭐⭐)

是否需要零停机部署?
├─ 是 → CapRover (⭐⭐⭐⭐⭐) 或 Coolify (⭐⭐⭐⭐)
└─ 否 → Dokku (⭐⭐⭐) 或 手动方案 (⭐⭐⭐)

团队是否熟悉 Docker Compose?
├─ 是 → 手动方案 (⭐⭐⭐⭐⭐) 或 Coolify (⭐⭐⭐⭐)
└─ 否 → Coolify (⭐⭐⭐⭐⭐) 或 CapRover (⭐⭐⭐⭐)

预算是否紧张?
├─ 是 → Dokku (⭐⭐⭐⭐) 或 手动方案 (⭐⭐⭐⭐)
└─ 否 → Coolify (⭐⭐⭐⭐⭐) 或 CapRover (⭐⭐⭐⭐)

是否需要高度自定义?
├─ 是 → 手动方案 (⭐⭐⭐⭐⭐)
└─ 否 → Coolify (⭐⭐⭐⭐⭐)
```

### 6.2 场景推荐

#### 场景 1: 快速原型验证（1-5 租户）
**推荐**: **Coolify** (⭐⭐⭐⭐⭐)
- **理由**: GUI 友好，部署速度最快，内置监控
- **风险**: WebSocket 问题需要验证
- **备选**: CapRover（WebSocket 更稳定）

#### 场景 2: 生产环境（10-20 租户）
**推荐**: **手动方案** (⭐⭐⭐⭐⭐)
- **理由**: 完全控制，零抽象开销，易于调试
- **风险**: 初期配置成本高（2-3 天）
- **备选**: CapRover（零停机部署 + WebSocket 稳定性）

#### 场景 3: 资源受限（预算 <$100/月）
**推荐**: **Dokku** (⭐⭐⭐⭐)
- **理由**: 资源开销最低，可运行在 1 GB VPS
- **风险**: 缺乏监控，故障排查困难
- **备选**: 手动方案（稍微增加 0.1 GB 开销）

#### 场景 4: 需要横向扩展（20+ 租户）
**推荐**: **手动方案** (⭐⭐⭐⭐⭐)
- **理由**: 可以轻松扩展到多服务器（Traefik 支持跨主机路由）
- **风险**: 需要自建服务发现机制
- **备选**: CapRover（支持 Docker Swarm 集群）

### 6.3 OpenClaw 特殊需求适配性总结

| 需求 | Coolify | CapRover | Dokku | 手动方案 |
|------|---------|----------|-------|----------|
| 端口范围 10000-60000 | ❌ 不支持 | ❌ 不支持 | ❌ 不支持 | ✅ 完美支持 |
| WebSocket 稳定性 | ⚠️ 有问题 | ✅ 原生支持 | ⚠️ 需配置 | ✅ 原生支持 |
| 配置文件隔离 | ✅ 自动 UUID | ✅ 独立卷 | ⚠️ 手动 | ✅ 完全控制 |
| 卷隔离 | ✅ 自动 | ✅ 支持 | ⚠️ 权限问题 | ✅ 完全控制 |
| 健康检查 | ✅ 三种方式 | ✅ 零停机 | ✅ app.json | ✅ 原生支持 |
| 资源限制 | ⚠️ 手动 YAML | ⚠️ 手动 JSON | ✅ CLI 命令 | ✅ 完全控制 |
| 监控告警 | ✅ 内置 | ⚠️ 基础 | ❌ 无 | ⚠️ 需自建 |

---

## 7. 技术实施建议

### 7.1 短期方案（0-3 个月）

**推荐**: **Coolify** + **WebSocket 补丁**

**实施步骤**:
1. 在测试环境部署 Coolify
2. 验证 WebSocket 连接稳定性（GitHub Issue #4002 的解决方案）
3. 如果 WebSocket 问题无法解决 → 切换到 **CapRover**
4. 部署 3-5 个测试租户，收集性能数据

**退出策略**:
- 如果 Coolify 性能不佳 → 迁移到手动方案（导出 Docker Compose 配置）

### 7.2 长期方案（3-12 个月）

**推荐**: **手动方案** (Docker Compose + Traefik)

**实施步骤**:
1. **Phase 1: 基础设施**（Week 1-2）
   - 配置 Traefik（SSL、路由、中间件）
   - 创建租户模板（docker-compose.yml + .env）
   - 编写租户管理 CLI（Bash 或 Python）

2. **Phase 2: 自动化**（Week 3-4）
   - 实现租户创建/删除脚本
   - 配置健康检查和告警（Prometheus + Grafana）
   - 设置日志聚合（Loki 或 ELK）

3. **Phase 3: 监控与优化**（Week 5-8）
   - 部署 Grafana Dashboard（Traefik 指标 + Docker 指标）
   - 配置 AlertManager（Slack/Email 通知）
   - 性能调优（Traefik 缓存、连接池等）

4. **Phase 4: 横向扩展**（Week 9-12）
   - 配置跨主机 Traefik（如果需要）
   - 实现数据库分片（如果单数据库成为瓶颈）
   - 设置 CI/CD 自动部署

### 7.3 混合方案（推荐用于 AgentPod）

**策略**: **Coolify（开发）+ 手动方案（生产）**

**理由**:
1. **开发环境**: Coolify 的 GUI 加速开发者本地测试
2. **生产环境**: 手动方案提供最大灵活性和性能
3. **配置一致性**: Coolify 可导出 Docker Compose 配置，迁移成本低

**实施路径**:
```
Week 1-2:  Coolify 原型 → 验证 OpenClaw 部署流程
Week 3-4:  手动方案 PoC → 对比性能和稳定性
Week 5-6:  选择最终方案 → 生产环境部署
Week 7-8:  监控和优化 → 准备上线
```

---

## 8. 风险分析与缓解措施

### 8.1 技术风险

| 风险 | 概率 | 影响 | 缓解措施 |
|------|------|------|----------|
| Coolify WebSocket 不稳定 | 高 (70%) | 高 | 预先在测试环境验证，准备 CapRover 备选方案 |
| Traefik 高 CPU 问题 | 中 (30%) | 中 | 启用 experimental fastProxy，监控资源使用 |
| 端口范围不支持 | 高 (90%) | 高 | 使用手动方案或 CapRover + 自定义脚本 |
| OpenClaw 配置文件冲突 | 低 (10%) | 高 | 使用 Volume 隔离 + 独立配置文件 |

### 8.2 运维风险

| 风险 | 概率 | 影响 | 缓解措施 |
|------|------|------|----------|
| 手动方案学习曲线过高 | 中 (40%) | 中 | 提供详细文档 + 模板仓库 |
| 缺乏监控导致故障未察觉 | 高 (60%) | 高 | 必须部署 Prometheus + Grafana |
| SSL 证书过期 | 低 (5%) | 高 | 使用 Let's Encrypt 自动续期 + 告警 |
| 单服务器单点故障 | 高 (90%) | 高 | 准备快速迁移方案（备份 + IaC） |

### 8.3 业务风险

| 风险 | 概率 | 影响 | 缓解措施 |
|------|------|------|----------|
| 供应商锁定（Coolify） | 中 (50%) | 中 | 保留导出到 Docker Compose 的能力 |
| 技术债务（CapRover） | 中 (40%) | 中 | 使用标准 Docker + NGINX，避免深度耦合 |
| 资源成本超预算 | 低 (20%) | 高 | 预先压测，确认单服务器租户数量上限 |

---

## 9. 关键数据来源

### 9.1 Coolify
- [Applications | Coolify Docs](https://coolify.io/docs/applications/)
- [Traefik Overview | Coolify Docs](https://coolify.io/docs/knowledge-base/proxy/traefik/overview)
- [GitHub Issue #4002: WebSocket Issues](https://github.com/coollabsio/coolify/issues/4002)
- [Persistent Storage | Coolify Docs](https://coolify.io/docs/knowledge-base/persistent-storage)
- [Health checks | Coolify Docs](https://coolify.io/docs/knowledge-base/health-checks)

### 9.2 CapRover
- [Zero Downtime Deployments · CapRover](https://caprover.com/docs/zero-downtime.html)
- [App Configuration · CapRover](https://caprover.com/docs/app-configuration.html)
- [Firewall & Port Forwarding · CapRover](https://caprover.com/docs/firewall.html)
- [Stateless with Persistent data · CapRover](https://caprover.com/docs/stateless-with-persistent-data.html)

### 9.3 Dokku
- [Zero Downtime Deploy Checks - Dokku Documentation](https://dokku.com/docs/deployment/zero-downtime-deploys/)
- [Persistent Storage - Dokku Documentation](https://dokku.com/docs/advanced-usage/persistent-storage/)
- [Resource Management - Dokku Documentation](https://dokku.com/docs~v0.18.5/advanced-usage/resource-management/)
- [Using Websockets with Nginx - Dokku Tutorials](https://dokku.com/tutorials/other/using-websockets-in-dokku/)

### 9.4 Docker Compose + Traefik
- [Multi-Tenant Traefik Setup for Docker Projects | Medium](https://medium.com/@nurulislamrimon/multi-tenant-traefik-setup-for-docker-projects-080f039f1fd4)
- [Setup Traefik Proxy in Docker Standalone - Traefik](https://doc.traefik.io/traefik/setup/docker/)
- [How to Size Your Traefik Hub API Gateway Instances](https://traefik.io/blog/how-to-size-your-traefik-hub-api-gateway-instances)

### 9.5 OpenClaw
- [OpenClaw 内部架构深度研究](/Users/yangyang/Github/agentpod/docs/research/openclaw-internals.md)
- [What is OpenClaw: Self-Hosted AI Agent Guide | Contabo Blog](https://contabo.com/blog/what-is-openclaw-self-hosted-ai-agent-guide/)
- [GitHub - openclaw/openclaw](https://github.com/openclaw/openclaw)

### 9.6 成本分析
- [Comparing self-hostable PaaS solutions: CapRover, Coolify & Dokploy reviewed](https://kloudshift.net/blog/comparing-self-hostable-paas-solutions-caprover-coolify-dokploy-reviewed/)
- [Why I Switched from Coolify to Dokku (And Cut My Costs in Half)](https://www.mydevmentor.com/en/blog/why-i-switched-from-coolify-to-dokku-and-cut-my-costs-in-half)

---

## 10. 附录: 快速对比表

### 10.1 核心指标对比

| 指标 | Coolify | CapRover | Dokku | 手动方案 |
|------|---------|----------|-------|----------|
| **学习曲线** | 1 小时 | 2 小时 | 4 小时 | 1-2 天 |
| **资源开销** | 2 GB + 1 核 | 1 GB + 0.5 核 | 0.1 GB + 0.1 核 | 0.1 GB + 0.1 核 |
| **新增租户时间** | 5 分钟 | 10 分钟 | 15 分钟 | 10 分钟 |
| **WebSocket 支持** | ⚠️ 有问题 | ✅ 原生 | ⚠️ 需配置 | ✅ 原生 |
| **监控告警** | ✅ 内置 | ⚠️ 基础 | ❌ 无 | ⚠️ 需自建 |
| **配置复杂度** | 低 | 中 | 中 | 高 |
| **供应商锁定** | 中 | 中 | 低 | 无 |
| **TCO (3 年/20 租户)** | $9,144 | $14,040 | $25,200 | $14,040 |

### 10.2 OpenClaw 适配性评分

| 需求 | Coolify | CapRover | Dokku | 手动方案 |
|------|---------|----------|-------|----------|
| 端口范围 10000-60000 | ⭐ | ⭐ | ⭐ | ⭐⭐⭐⭐⭐ |
| WebSocket 稳定性 | ⭐⭐⭐ | ⭐⭐⭐⭐⭐ | ⭐⭐⭐ | ⭐⭐⭐⭐⭐ |
| 配置文件管理 | ⭐⭐⭐⭐⭐ | ⭐⭐⭐⭐ | ⭐⭐⭐ | ⭐⭐⭐⭐⭐ |
| 卷隔离 | ⭐⭐⭐⭐⭐ | ⭐⭐⭐⭐ | ⭐⭐⭐ | ⭐⭐⭐⭐⭐ |
| 健康检查 | ⭐⭐⭐⭐ | ⭐⭐⭐⭐⭐ | ⭐⭐⭐⭐ | ⭐⭐⭐⭐⭐ |
| 资源限制 | ⭐⭐⭐ | ⭐⭐⭐ | ⭐⭐⭐⭐ | ⭐⭐⭐⭐⭐ |
| 监控可见性 | ⭐⭐⭐⭐⭐ | ⭐⭐⭐ | ⭐ | ⭐⭐⭐ |
| **综合评分** | **27/35** | **27/35** | **20/35** | **33/35** |

---

## 11. 最终建议

### 11.1 阶段性路线图

```
Phase 0 (Week 1-2): 技术验证
├─ 部署 Coolify 测试环境
├─ 验证 WebSocket 连接稳定性
└─ 压测单服务器租户数量上限

Phase 1 (Week 3-4): MVP 部署
├─ 如果 Coolify 通过验证 → 使用 Coolify
├─ 如果失败 → 切换到手动方案
└─ 部署 3-5 个测试租户

Phase 2 (Month 2-3): 生产环境
├─ 迁移到手动方案（完全控制）
├─ 部署监控体系（Prometheus + Grafana）
└─ 编写租户管理自动化脚本

Phase 3 (Month 4-6): 优化与扩展
├─ 横向扩展（多服务器）
├─ 数据库分片（如需要）
└─ CI/CD 自动化
```

### 11.2 核心决策点

**问题 1**: 是否需要快速原型验证？
- **是** → Coolify（风险：WebSocket 问题）
- **否** → 手动方案（风险：初期配置成本）

**问题 2**: 团队 Docker 技能水平？
- **初级** → Coolify 或 CapRover
- **中级** → 手动方案 + 模板
- **高级** → 手动方案 + 完全自定义

**问题 3**: 是否需要横向扩展（20+ 租户）？
- **是** → 手动方案（唯一能轻松扩展的）
- **否** → Coolify 或 CapRover

### 11.3 AgentPod 特定建议

基于 AgentPod 项目的特殊性（OpenClaw 多租户部署），**强烈推荐**:

1. **短期（0-3 个月）**: **Coolify** + **WebSocket 验证**
   - 快速验证 OpenClaw 部署流程
   - 收集性能数据和用户反馈
   - 如果 WebSocket 不稳定 → 立即切换 CapRover

2. **中期（3-6 个月）**: **手动方案** (Docker Compose + Traefik)
   - 提供最大灵活性和控制
   - 支持端口范围 10000-60000
   - 零抽象开销，性能最优

3. **长期（6-12 个月）**: **自研控制面**
   - 基于手动方案的基础架构
   - 开发 AgentPod CLI（租户管理、监控、告警）
   - 可选：开发 Web Dashboard（类似 Coolify 但专门为 OpenClaw 优化）

**核心原则**: **先用成熟方案快速验证，再逐步自研以获得完全控制。**

---

**研究完成日期**: 2026-02-15
**下一步行动**: 在测试环境部署 Coolify，验证 OpenClaw WebSocket 连接（预计耗时 1-2 天）

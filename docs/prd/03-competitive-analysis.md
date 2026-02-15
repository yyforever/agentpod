# 03 - 竞品深度分析与差异化定位

> AgentPod PRD 系列文档 | Step 3/5
> 依赖：01-user-personas-and-scenarios.md, 02-pain-points-validation.md

---

## 一、竞品全景

AgentPod 面临三类替代方案的竞争：

```
替代方案层次:

Layer 1: 手动方案（Docker Compose + Traefik + Shell 脚本）
         ↓ "够用但累"
Layer 2: 通用 PaaS（Coolify / CapRover / Dokku）
         ↓ "通用但不懂 Agent"
Layer 3: AI 平台（Dify / Coze / 白标平台）
         ↓ "懂 AI 但不是同代 Agent"

AgentPod 定位: Layer 1.5 —— Agent-Aware 的编排层
```

---

## 二、Layer 1: 手动方案（Docker Compose + Traefik）

### 能力描述

开发者自己写 `docker-compose.yml` + Traefik 配置 + Shell 脚本管理多租户。

### 典型配置量

| 租户数 | docker-compose 行数 | Traefik 配置 | Shell 脚本 | 总计 |
|--------|---------------------|-------------|-----------|------|
| 1 | ~40 行 | ~20 行 | ~30 行 | ~90 行 |
| 10 | ~400 行 | ~200 行 | ~100 行 | ~700 行 |
| 50 | ~2,000 行 | ~1,000 行 | ~300 行 | ~3,300 行 |

### 优势

- **完全控制**：端口范围、Volume 路径、网络模式全部可定制
- **零抽象税**：无中间层，资源开销 ~100MB RAM
- **端口范围支持**：唯一能支持 OpenClaw 10000-60000 端口范围的方案
- **无供应商锁定**：标准 Docker 生态，随时可迁移

### 劣势

- **无自动化**：每个租户手动配置，30-60 分钟
- **无状态管理**：期望状态没有持久化，容器崩溃靠 restart policy
- **无监控聚合**：`docker ps` + `docker logs` 逐个查看
- **无声明式调和**：配置变更需手动重建容器
- **脚本碎片化**：每个团队自己写脚本，不可复用

### 关键问题：为什么不直接用手动方案？

**回答**：手动方案在 5 个租户内是最优解。但超过 10 个租户后：

| 问题 | 5 租户 | 20 租户 | 50 租户 |
|------|--------|---------|---------|
| 新增租户耗时 | 30 分钟（可接受） | 30 分钟（累但能忍） | 30 分钟 ×（不可持续） |
| 故障发现延迟 | 分钟级 | 小时级 | 天级 |
| 配置错误率 | ~10% | ~30% | ~50% |
| 版本升级耗时 | 15 分钟 | 1 小时 | 半天 |

**AgentPod 的增量价值**：从 30 分钟/租户 → 3 分钟/租户，从被动发现故障 → 30 秒自动恢复。

---

## 三、Layer 2: 通用 PaaS

### Coolify

| 维度 | 评估 |
|------|------|
| **定位** | 开源 Heroku/Vercel 替代品，通用 PaaS |
| **Stars** | 40,000+ |
| **技术栈** | Laravel + Docker + Traefik |
| **优势** | 200+ 一键模板；自动 SSL；精美 Dashboard；支持 Docker Compose |
| **资源开销** | 2 GB RAM + 1 CPU（平台自身） |
| **TCO (20 租户/3 年)** | ~$9,144 |

**OpenClaw 适配性分析**：

| 需求 | 支持 | 说明 |
|------|------|------|
| WebSocket | ⚠️ | 已知稳定性问题（GitHub #4002），长连接可能断开 |
| 端口范围 10000-60000 | ❌ | 不支持批量端口映射，OpenClaw 需要 base+2, base+9~108 |
| Volume 隔离 | ✅ | UUID 自动命名 |
| 健康检查 | ✅ | 基于 Docker healthcheck |
| 配置文件管理 | ⚠️ | 环境变量支持，但不理解 openclaw.json 结构 |
| 资源限制 | ⚠️ | 无 GUI，需手动编辑 Docker Compose |

**结论**：Coolify 能覆盖通用需求，但**不理解 OpenClaw 的端口派生规则、配置文件结构和 WebSocket 配对机制**，这些都需要额外适配。

---

### CapRover

| 维度 | 评估 |
|------|------|
| **定位** | 基于 Docker Swarm 的 PaaS |
| **Stars** | 14,000+ |
| **技术栈** | Node.js + Nginx + Docker Swarm |
| **优势** | WebSocket 原生支持（内置开关）；零停机部署；集群扩展 |
| **资源开销** | 1 GB RAM + 0.5 CPU |
| **TCO (20 租户/3 年)** | ~$14,040 |

**OpenClaw 适配性**：WebSocket 支持好于 Coolify，但同样不支持端口范围映射、不理解 Agent 配置。

---

### Dokku

| 维度 | 评估 |
|------|------|
| **定位** | 极简 Heroku 替代品（纯 CLI） |
| **Stars** | 30,000+ |
| **优势** | 资源开销最低（100MB）；原生资源限制命令 |
| **劣势** | 无 GUI；无集群；WebSocket 配置复杂；单服务器限制 |
| **TCO (20 租户/3 年)** | ~$25,200（运维成本高） |

**结论**：Dokku 太轻量，缺少 AgentPod 核心场景所需的监控、自动恢复和多租户管理能力。

---

### 通用 PaaS 的根本局限

**它们不理解 "Agent"**：

```
通用 PaaS 眼中的应用:
  App = Container + Port + Volume + Env

AgentPod 眼中的 Agent:
  Agent = Container + Port Range(100+)
        + Config File (openclaw.json, SOUL.md, MEMORY.md)
        + Auth Profiles (per-tenant API keys)
        + Channel Bindings (WhatsApp session, Telegram token)
        + Identity (agent ID, workspace)
        + Health (WebSocket heartbeat, not just HTTP 200)
```

通用 PaaS 无法做到的：
1. **端口派生**：自动计算 base, base+2, base+9~108
2. **配置生成**：根据租户参数生成 openclaw.json
3. **通道管理**：理解 WhatsApp session、Telegram bot token 的生命周期
4. **Agent 健康检查**：通过 WebSocket 协议检查 Gateway 心跳，而非简单 HTTP ping
5. **声明式调和**：配置变更 → 自动重建容器 → 验证 Agent 正常运行

---

## 四、Layer 3: AI 平台

### Dify / Coze / n8n

| 平台 | 定位 | 与 AgentPod 的本质差异 |
|------|------|------------------------|
| **Dify** | AI 工作流编排平台 | 提供 Agent 构建能力，不是 Agent 运行时编排 |
| **Coze** | 字节跳动 AI Bot 平台 | SaaS 模式，无法自托管，不支持自定义 Agent |
| **n8n** | 工作流自动化 | 不是 Agent 平台，是任务编排 |

**核心区别**：

```
Dify/Coze: "用我们的平台构建你的 Agent"
AgentPod:  "用你自己的 Agent（OpenClaw），我帮你管理多个实例"
```

这两者不是直接竞争关系，而是上下游：
- Dify 的用户可能不需要 AgentPod（Dify 自己管理多租户）
- OpenClaw 的用户需要 AgentPod（OpenClaw 不管理多租户）

---

### 白标 AI Agent 平台（Stammer.ai / Lety.ai / ConvoCore）

| 平台 | 能力 | 限制 |
|------|------|------|
| **Stammer.ai** | 完整白标 SaaS：多租户、计费、品牌定制 | 闭源 SaaS，无法自托管，锁定供应商 |
| **Lety.ai** | 构建并销售 AI Agent | 同上 |
| **ConvoCore** | 对话式 AI Agent 管理 | 同上 |

**与 AgentPod 的关系**：
- 白标平台 = **SaaS 模式**（你的 Agent 跑在他们的服务器上）
- AgentPod = **自托管模式**（你的 Agent 跑在你自己的服务器上）

**选择白标平台的用户**：非技术代理商，不关心基础设施，愿意付月费
**选择 AgentPod 的用户**：技术开发者，要求数据控制权，愿意自己运维

---

## 五、为什么不用 X？

### Q1: 为什么不直接用 Docker Compose + Traefik？

**答**：5 个租户内应该直接用。AgentPod 解决的是 **10+ 租户的规模化管理**问题：

| 能力 | Docker Compose | AgentPod |
|------|---------------|----------|
| 新增租户 | 30-60 分钟手动配置 | 3 分钟（一条命令或 Dashboard 表单） |
| 故障恢复 | restart policy（仅进程退出） | Reconciliation Loop（含僵死检测） |
| 状态管理 | 无（状态在文件系统） | PostgreSQL 持久化 + 声明式调和 |
| 监控 | docker ps / logs 逐个查看 | 统一 Dashboard |
| 版本升级 | 逐个手动重建 | 一键滚动升级 |

**简言之**：AgentPod = Docker Compose + Traefik + 状态管理 + 自动化 + 监控

---

### Q2: 为什么不用 Coolify？

**答**：Coolify 是通用 PaaS，不理解 Agent 的特殊需求：

1. **不支持端口范围映射** → OpenClaw 每实例需要 100+ 端口
2. **WebSocket 已知问题** → OpenClaw Gateway 依赖长连接稳定性
3. **不理解配置结构** → 无法生成 openclaw.json、管理 auth profiles
4. **无 Agent 健康语义** → 不知道什么是 "Gateway heartbeat"

**Coolify 适合**：部署 Web 应用、数据库、静态站点
**AgentPod 适合**：部署需要深度配置管理的 AI Agent 实例

---

### Q3: 为什么不用 Kubernetes？

**答**：K8s 是正确的终极方案，但对 AgentPod 的目标用户来说：

| 维度 | Kubernetes | AgentPod |
|------|-----------|----------|
| 学习曲线 | 6-12 个月 | 1-2 天 |
| 最低资源 | 3 节点 × 2GB | 1 VPS × 4GB |
| 运维复杂度 | 需要专职 DevOps | 开发者自运维 |
| 目标用户 | 企业 IT 团队（50+ 人） | SaaS 创业者（3-15 人） |
| 月成本（最低） | ~$150（3 节点云服务器） | ~$20（1 台 VPS） |

**K8s 是大炮打蚊子**：我们的 Persona（赵明、王鹏）不会也不应该为 10-50 个 Agent 搭建 K8s 集群。

---

### Q4: 为什么不用白标平台（Stammer.ai 等）？

**答**：白标平台和 AgentPod 面向不同用户群：

| 维度 | 白标平台 | AgentPod |
|------|---------|----------|
| 部署模式 | SaaS（他们的服务器） | 自托管（你的服务器） |
| 数据控制 | 无（数据在供应商处） | 完全控制 |
| Agent 类型 | 供应商预设 | OpenClaw（自定义能力强） |
| 技术要求 | 零代码 | Docker 基础 |
| 月成本 | $99-999/月 + 按量计费 | VPS 成本（$20-100/月） |
| 定制深度 | UI 白标 + 提示词 | 完全自定义（SOUL.md、工具、通道） |

**选 AgentPod 而非白标平台的理由**：当你需要 OpenClaw 的完整能力（自定义工具、浏览器控制、记忆系统、多通道），且要求数据留在自己的服务器上。

---

## 六、差异化定位

### AgentPod 是什么

> **Agent-Aware 的多租户容器编排平台**
>
> 为 SaaS 开发者提供 OpenClaw 实例的声明式管理：
> 一条命令创建租户，30 秒自动恢复故障，Dashboard 统一监控。

### AgentPod 不是什么

| 不是 | 原因 |
|------|------|
| 通用 PaaS | 只做 Agent 编排，不替代 Coolify |
| AI 工作流平台 | 不替代 Dify/n8n，不构建 Agent |
| 白标 SaaS | 不提供托管服务，只提供管理工具 |
| Kubernetes | 不做通用容器编排 |

### 核心差异化能力

| 能力 | 手动方案 | 通用 PaaS | AgentPod |
|------|---------|-----------|----------|
| Agent 配置生成 | ❌ | ❌ | ✅ 根据租户参数生成 openclaw.json |
| 端口自动派生 | ❌ | ❌ | ✅ base → base+2, base+9~108 |
| Agent 健康语义 | ❌ | ❌ | ✅ WebSocket heartbeat 检测 |
| 声明式调和 | ❌ | ❌ | ✅ 期望状态 vs 实际状态自动同步 |
| 通道生命周期 | ❌ | ❌ | ✅ 理解 WhatsApp session 等状态 |
| 一键创建租户 | ❌ | ⚠️（通用） | ✅（Agent-Aware） |
| 统一 Dashboard | ❌ | ✅（通用） | ✅（Agent 语义） |

### 一句话差异

**Coolify 知道你跑了一个容器；AgentPod 知道你跑了一个会说话的数字员工。**

---

## 七、竞品能力矩阵（总览）

| 能力 | Docker Compose | Coolify | CapRover | Dokku | AgentPod |
|------|---------------|---------|----------|-------|----------|
| 一键部署租户 | ❌ | ✅ | ✅ | ⚠️ | ✅ |
| WebSocket 稳定性 | ✅ | ⚠️ | ✅ | ⚠️ | ✅（目标） |
| 端口范围支持 | ✅ | ❌ | ❌ | ❌ | ✅ |
| Agent 配置管理 | ❌ | ❌ | ❌ | ❌ | ✅ |
| 声明式调和 | ❌ | ❌ | ❌ | ❌ | ✅ |
| 统一 Dashboard | ❌ | ✅ | ✅ | ❌ | ✅ |
| 自动故障恢复 | ⚠️ | ⚠️ | ✅ | ⚠️ | ✅ |
| 资源限制 | ⚠️ | ⚠️ | ✅ | ✅ | ✅ |
| SSL 自动化 | ⚠️ | ✅ | ✅ | ✅ | ✅ |
| 滚动升级 | ❌ | ✅ | ✅ | ⚠️ | ✅ |
| 学习曲线 | 低 | 低 | 中 | 中 | **低** |
| Agent-Aware | ❌ | ❌ | ❌ | ❌ | ✅ |
| 开源 | ✅ | ✅ | ✅ | ✅ | ✅ |

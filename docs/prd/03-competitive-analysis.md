# 03 - 竞品深度分析与差异化定位

> AgentPod PRD 子文档 03
> 依赖：[01-user-and-market-research.md](./01-user-and-market-research.md)

---

## 一、竞品全景

AgentPod 面临三类替代方案的竞争：

```
替代方案:

A. 手动方案（Docker Compose + Traefik + Shell 脚本）
   "够用但累"

B. 通用 PaaS（Coolify / CapRover / Dokku）
   "通用但不懂 Agent"

C. AI 平台（Dify / Coze / 白标平台）
   "懂 AI 但不是自主 Agent 运行时"
```

AgentPod 不在这三者之间，而是走了一条**垂直路线**：

**通用 PaaS 做宽度（什么应用都能部署），AgentPod 做深度（只做 Agent，但做到极致）。**

对标 Coolify 的部署体验和 Dashboard 品质，但在 Agent 领域提供 Coolify 无法触达的能力：理解 Agent 的配置结构、端口规则、通道生命周期和健康语义。

---

## 二、手动方案（Docker Compose + Traefik）

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
- **端口范围支持**：唯一能支持 Agent 复杂端口需求的方案
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

## 三、通用 PaaS（对标 Coolify）

### Coolify —— AgentPod 的基准线

Coolify 是 AgentPod 最值得学习的对标对象。我们要达到 Coolify 的部署体验和 Dashboard 品质，然后在 Agent 领域超越它。

| 维度 | 评估 |
|------|------|
| **定位** | 开源 Heroku/Vercel 替代品，通用 PaaS |
| **Stars** | 40,000+ |
| **技术栈** | Laravel + Docker + Traefik |
| **优势** | 200+ 一键模板；自动 SSL；精美 Dashboard；支持 Docker Compose |
| **资源开销** | 2 GB RAM + 1 CPU（平台自身） |

**AgentPod 向 Coolify 学什么**：

- 一键部署体验（`docker compose up` 即完成安装）
- Dashboard 设计品质（简洁、直觉、信息密度合理）
- Docker + Traefik 的成熟集成模式
- 开源社区运营

**AgentPod 在 Agent 领域的超越**：

| 维度 | Coolify | AgentPod |
|------|---------|----------|
| **配置理解** | 只知道环境变量 | 理解 Agent 的配置文件结构，根据租户参数自动生成 |
| **端口管理** | 单端口映射 | 理解 Agent 的端口派生规则（一个实例可能需要多个关联端口） |
| **健康检查** | HTTP 200 | Agent 协议级健康检测（WebSocket heartbeat、Gateway 状态） |
| **创建流程** | 通用容器部署 | Agent-Aware 流程（自动初始化身份、密钥、通道配置） |
| **生命周期** | 容器生命周期 | Agent 生命周期（通道绑定状态、记忆持久化、配置热更新） |

---

### CapRover

| 维度 | 评估 |
|------|------|
| **定位** | 基于 Docker Swarm 的 PaaS |
| **Stars** | 14,000+ |
| **技术栈** | Node.js + Nginx + Docker Swarm |
| **优势** | WebSocket 原生支持（内置开关）；零停机部署；集群扩展 |
| **资源开销** | 1 GB RAM + 0.5 CPU |

**Agent 适配性**：WebSocket 支持好于 Coolify，但同样不支持 Agent 特有的端口规则和配置管理。

---

### Dokku

| 维度 | 评估 |
|------|------|
| **定位** | 极简 Heroku 替代品（纯 CLI） |
| **Stars** | 30,000+ |
| **优势** | 资源开销最低（100MB）；原生资源限制命令 |
| **劣势** | 无 GUI；无集群；WebSocket 配置复杂；单服务器限制 |

**结论**：Dokku 太轻量，缺少 AgentPod 核心场景所需的监控、自动恢复和多租户管理能力。

---

### 通用 PaaS 的根本局限

**它们不理解 "Agent"**：

```
通用 PaaS 眼中的应用:
  App = Container + Port + Volume + Env

AgentPod 眼中的 Agent:
  Agent = Container
        + Port Rules (每种 Agent 有自己的端口派生逻辑)
        + Config Files (结构化配置，非简单 key-value)
        + Auth & Secrets (per-tenant API keys, tokens)
        + Channel Bindings (消息通道的连接状态)
        + Identity (agent ID, workspace, persona)
        + Health (协议级心跳，非简单 HTTP ping)
```

**这不是某一种 Agent 的特殊问题，而是所有 AI Agent 的共性**。每种 Agent（OpenClaw、Open WebUI、LobeChat、自定义 Agent）都有自己的配置结构、端口需求、健康检查方式。通用 PaaS 只能把它们当作"又一个容器"来管理。

**AgentPod 的 Adapter 架构**正是为此设计的：

```
AgentAdapter 接口:
  ┌─────────────────────────────────┐
  │ meta         → Agent 是谁       │
  │ containerSpec → 怎么跑          │
  │ configSchema  → 怎么配置        │  ← Zod schema，Dashboard 自动渲染表单
  │ lifecycle     → 生命周期钩子     │  ← 创建前/后、配置变更、删除前
  │ resolveSpec   → 模板 → 实际参数  │
  └─────────────────────────────────┘

  Day 1: OpenClaw Adapter（验证架构）
  Day N: Open WebUI / LobeChat / 自定义 Adapter
```

每个 Adapter 封装一种 Agent 的领域知识。AgentPod 框架是通用的，Adapter 是专用的。这是 Coolify 的模板系统做不到的事——Coolify 的模板只定义"怎么启动容器"，AgentPod 的 Adapter 定义"怎么理解和管理这个 Agent"。

---

## 四、AI 平台

### Dify / Coze / n8n

| 平台 | 定位 | 与 AgentPod 的本质差异 |
|------|------|------------------------|
| **Dify** | AI 工作流编排平台 | 提供 Agent 构建能力，不是 Agent 运行时编排 |
| **Coze** | 字节跳动 AI Bot 平台 | SaaS 模式，无法自托管，不支持自定义 Agent |
| **n8n** | 工作流自动化 | 不是 Agent 平台，是任务编排 |

**核心区别**：

```
Dify/Coze: "用我们的平台构建你的 Agent"
AgentPod:  "你已经有了好的 Agent，我帮你把它交付给 N 个客户"
```

这是完全不同的设计理念。AI 平台关注的是 Agent 的**构建**（提示词、工具链、知识库）；AgentPod 关注的是 Agent 的**交付**（多租户隔离、批量部署、运行时管理）。两者是上下游关系，不是竞争。

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

**答**：Coolify 是优秀的通用 PaaS，AgentPod 在通用部署能力上以 Coolify 为基准线。差异在于 Agent 领域的深度：

**Coolify 做得好的（我们要追平）**：
- 一键安装体验
- 精美 Dashboard
- 自动 SSL
- Docker Compose 支持

**Coolify 做不到的（我们的差异化）**：
1. **Agent 配置管理** → Coolify 只有环境变量；AgentPod 理解 Agent 的结构化配置文件，能根据租户参数自动生成
2. **端口派生** → Coolify 单端口映射；AgentPod 理解 Agent 特有的端口组规则
3. **Agent 健康语义** → Coolify 检查 HTTP 200；AgentPod 通过 Agent 自身协议（如 WebSocket heartbeat）检测健康
4. **Adapter 生态** → Coolify 的模板 = 启动参数；AgentPod 的 Adapter = 完整的 Agent 领域知识（配置结构、生命周期钩子、健康检查方式）

**一句话**：Coolify 是 Agent 的"房东"（提供一个容器跑着就行）；AgentPod 是 Agent 的"经纪人"（理解 Agent 是谁、需要什么、状态如何）。

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
| Agent 类型 | 供应商预设 | 任意自托管 Agent（通过 Adapter 扩展） |
| 技术要求 | 零代码 | Docker 基础 |
| 定制深度 | UI 白标 + 提示词 | 完全自定义（配置、工具、通道、记忆） |

**选 AgentPod 而非白标平台的理由**：当你需要 Agent 的完整能力（自定义工具、记忆系统、多通道），且要求数据留在自己的服务器上。

---

## 六、差异化定位

### AgentPod 是什么

> **垂直于 AI Agent 的编排与交付平台**
>
> 对标 Coolify 的部署体验，超越 Coolify 的 Agent 理解力。
> 让开发者像开通 SaaS 账号一样为客户部署即开即用的数字员工。

### 核心差异化能力

| 能力 | 手动方案 | 通用 PaaS | AgentPod |
|------|---------|-----------|----------|
| Agent 配置生成 | ❌ | ❌ | ✅ Adapter 根据租户参数生成 Agent 配置 |
| 端口自动派生 | ❌ | ❌ | ✅ Adapter 定义端口规则，框架自动分配 |
| Agent 健康语义 | ❌ | ❌ | ✅ Adapter 定义协议级健康检查 |
| 声明式调和 | ❌ | ❌ | ✅ 期望状态 vs 实际状态自动同步 |
| 通道生命周期 | ❌ | ❌ | ✅ Adapter 管理消息通道连接状态 |
| 一键创建租户 | ❌ | ⚠️（通用） | ✅（Agent-Aware） |
| 统一 Dashboard | ❌ | ✅（通用） | ✅（Agent 语义） |

### 一句话差异

**Coolify 知道你跑了一个容器；AgentPod 知道你跑了一个会说话的数字员工。**

### Adapter 架构的意义

AgentPod 不是 "OpenClaw 托管工具"。Adapter 接口意味着：

- **对框架来说**：所有 Agent 都是统一的 Tenant → Pod 模型，统一调和、统一监控、统一 Dashboard
- **对 Adapter 来说**：每种 Agent 的领域知识被封装在各自的 Adapter 中，互不干扰
- **对社区来说**：贡献一个新的 Adapter = 让 AgentPod 支持一种新的 Agent 类型，门槛低（实现一个 TypeScript 接口）

MVP 从 OpenClaw Adapter 开始，是因为 OpenClaw 的多租户部署痛点最强烈、最紧迫。但架构从第一天就为多 Agent 类型设计。

---

## 七、AgentPod 坚决不做什么

| 坚决不做 | 原因 |
|----------|------|
| **不做通用 PaaS** | Coolify 已经做得足够好。部署 MySQL？用 Coolify。部署 Agent？用 AgentPod。 |
| **不构建 Agent** | 那是 OpenClaw / Dify / Coze 的事。AgentPod 只管"部署和运行"，不管"创建和训练"。 |
| **不做 SaaS 托管** | AgentPod 是工具，不是服务。你装在自己服务器上，数据归你。 |
| **不做计费系统** | AgentPod 管 Agent 的生命周期，不管你怎么收客户的钱。 |
| **不做 Kubernetes** | 不模仿 K8s 的概念和复杂度。单机 Docker 是我们的运行时，够用就好。 |
| **不做终端客户界面** | AgentPod 的用户是开发者/运营方，终端客户直接使用 Agent 本身。 |

这些"不做"定义了 AgentPod 的边界。每一条都是在说：**这件事已经有人做好了，我们不重复。**

---

## 八、竞品能力矩阵（总览）

| 能力 | Docker Compose | Coolify | CapRover | Dokku | AgentPod |
|------|---------------|---------|----------|-------|----------|
| 一键部署租户 | ❌ | ✅ | ✅ | ⚠️ | ✅ |
| WebSocket 稳定性 | ✅ | ⚠️ | ✅ | ⚠️ | ✅ |
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

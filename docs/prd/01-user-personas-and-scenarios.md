# 01 - 用户画像与场景分析

> AgentPod PRD 系列文档 | 分册 1/4

---

## 一、定位

### 一句话定位

**AgentPod 是 AI Agent 的产品化交付平台，让开发者像开通 SaaS 账号一样为客户部署即开即用的数字员工。**

### 市场判断

AI Agent 正在改变 SaaS 的交付方式。未来 SaaS 不再是"提供一个网站让客户登录使用"，而是"为客户部署一个能直接工作的数字员工"。当每个 SaaS 厂商都需要为客户交付独立的 Agent 实例时，它们需要一个产品化交付平台。AgentPod 赌的就是这个趋势。

### 品类定义

- **不是**通用 PaaS（Coolify、CapRover 做的事）
- **不是** AI 工作流编排（Dify、Coze、n8n 做的事）
- **是** Agent 产品化交付平台 —— 把定制化的 OpenClaw 实例作为产品交付给终端客户，客户拿到的是即开即用的数字员工

### 类比参考

| 类比 | 说明 |
|------|------|
| Shopify for Digital Employees | 开发者"开店"（搭建 AgentPod），终端客户"下单"（获得自己的 Agent） |
| Vercel for AI Agents | 开发者 push 配置，平台自动部署、路由、监控 |
| Docker Compose → Kubernetes | 从手动编排到声明式管理 |

### 交付模型

```
开发者（AgentPod 运营方）
  │
  │  通过 AgentPod 管理
  ▼
终端客户 A ← 收到即开即用的 Agent（定制化 OpenClaw 实例）
  │             ├── 通过 WhatsApp / 飞书 / Telegram 和 Agent 对话
  │             └── 通过 Web 管理面板（OpenClaw controlUI）查看 Agent 状态
  │
终端客户 B ← 收到自己的 Agent
终端客户 C ← 收到自己的 Agent
```

终端客户**不需要知道** OpenClaw、Docker、AgentPod 的存在。他们看到的是"我的数字员工上线了"。

---

## 二、目标用户

### 核心用户：SaaS 开发者 / AI 解决方案商

使用 AgentPod 将 AI Agent（数字员工）作为产品交付给企业客户的团队或个人。

### 使用门槛

AgentPod 屏蔽了 Docker 网络、Traefik 配置、端口派生等基础设施复杂度。用户只需要：
- 能在 VPS / 云服务器上运行 `docker compose up`
- 能在 Dashboard 中填写表单、点击按钮
- 不需要懂 Docker 网络、反向代理、端口管理

### 不服务的用户

| 排除对象 | 原因 |
|----------|------|
| 个人 AI 玩家 | 单实例 Docker Compose 已足够 |
| 大型企业 IT 部门 | 有能力自建 K8s 集群 |

---

## 三、核心概念：Tenant 与 Pod

AgentPod 采用 **Tenant → Pod** 两层模型：

```
Tenant（租户 = 客户）
  └── Pod 1（数字员工实例，如：客服 Agent）
  └── Pod 2（数字员工实例，如：HR Agent）
  └── Pod 3（数字员工实例，如：财务 Agent）
```

| 概念 | 含义 | 示例 |
|------|------|------|
| **Tenant** | 一个客户/组织 | "ACME 公司" |
| **Pod** | 一个独立的 Agent 容器实例 | "acme/cs-agent"（ACME 的客服 Agent） |

**为什么需要两层**：
- 赵明的客户：1 Tenant = 1 Pod（客服 SaaS，每客户一个 Agent）
- 李娜的客户：1 Tenant = 2-5 Pods（数字化服务商，每客户多个数字员工）
- 两层模型兼容两种场景，且支持按 Tenant 维度聚合操作（批量升级、统一监控）

**CLI 体现**：
```bash
# 赵明的场景：1 Tenant = 1 Pod
agentpod tenant create acme
agentpod pod create acme/agent --type openclaw

# 李娜的场景：1 Tenant = N Pods
agentpod tenant create megacorp
agentpod pod create megacorp/cs-agent --type openclaw
agentpod pod create megacorp/hr-agent --type openclaw
agentpod pod create megacorp/fin-agent --type openclaw

# 按 Tenant 聚合操作
agentpod tenant status megacorp          # 查看该客户所有 Pod 状态
agentpod pod upgrade --tenant megacorp   # 批量升级该客户的所有 Pod
```

---

## 四、用户画像

### Persona 1：垂直 SaaS 创业者 —— 赵明

| 维度 | 描述 |
|------|------|
| **角色** | AI 客服 SaaS 创始人兼 CTO |
| **团队** | 3-5 人技术团队 |
| **技术栈** | TypeScript / Docker / 1-2 台 VPS |
| **客户** | 10-50 家中小企业，每家 1 个 Pod（AI 客服 Agent） |
| **收入模式** | 按客户按月收费（￥500-2000/月/客户） |
| **日常** | 花 40% 时间在运维上：部署新客户、处理容器崩溃、更新版本 |

**核心痛点：**
1. 每接一个新客户，要手动执行 12+ 步部署流程（端口分配、Volume 创建、Traefik 配置、HTTPS 证书、Token 生成……），无法标准化为产品交付
2. 客户 A 的容器崩溃不会自动恢复，要等自己发现才能 `docker restart`
3. 没有统一视图看所有客户的运行状态，靠 `docker ps` + 逐个 `docker logs`

**期望：**
> "我想要一个控制面板，添加客户时填个表单，后台自动把 OpenClaw 实例跑起来，配好域名和通道。客户出问题我能一眼看到。"

---

### Persona 2：数字化服务商技术负责人 —— 李娜

| 维度 | 描述 |
|------|------|
| **角色** | 企业数字化转型服务商的技术总监 |
| **团队** | 8-15 人，含前后端和交付 |
| **技术栈** | Java / Python / Docker / 云服务器 |
| **客户** | 5-20 家中大型企业，每家需要 2-5 个 Pod（客服、HR、财务等数字员工） |
| **收入模式** | 项目制 + 年度运维费（￥5-20万/客户/年） |
| **日常** | 交付压力大，同时维护多个客户环境 |

**核心痛点：**
1. 每个客户要求独立部署（数据隔离、合规要求），导致环境碎片化
2. 客户的 LLM 提供商不同 —— A 用 Claude，B 用 GPT，C 用国产模型 —— 配置管理混乱
3. 版本升级是噩梦：20 个客户 × 3 个 Pod = 60 个容器要逐个更新
4. 客户要求 SLA（99.5% 可用性），但没有自动健康检查和故障恢复

**期望：**
> "我需要能批量管理客户环境的工具。最好是声明式的 —— 我定义好配置，平台帮我保证实际状态和期望一致。"

---

### Persona 3：独立开发者 / AI 代理商 —— 王鹏

| 维度 | 描述 |
|------|------|
| **角色** | 独立开发者，兼职做 AI Agent 代理 |
| **团队** | 1 人 |
| **技术栈** | 熟悉 Docker，会写脚本，不想深入运维 |
| **客户** | 3-10 个小客户，每个 1 个 Pod（WhatsApp/Telegram Agent） |
| **收入模式** | 按月收费（￥200-800/月/客户） |
| **日常** | 白天做其他工作，晚上抽空维护 |

**核心痛点：**
1. 没时间写和维护部署脚本 —— 每次加客户都要翻笔记找上次的操作步骤
2. 一台 4GB VPS 跑 5 个 OpenClaw 实例，端口和内存经常冲突
3. Bridge 网络 + WebSocket 配对问题搞了两天才解决，现在不敢碰网络配置
4. 客户问 "为什么我的 Agent 没回复"，自己也不知道是容器挂了还是 API 额度用完了

**期望：**
> "给我一个 `agentpod pod create` 命令，什么都帮我搞定。我只想关注客户的业务配置，不想碰 Docker 网络和 Traefik。"

---

## 五、核心用户场景

### 场景矩阵（按优先级）

| 优先级 | 场景 | 频率 | 重要度 | 对应 Persona | 对应痛点 |
|--------|------|------|--------|-------------|----------|
| **P0** | S1: 为新客户创建 Tenant 和 Pod | 每周 1-3 次 | ★★★★★ | 全部 | PP-04, PP-01, PP-02 |
| **P0** | S2: 查看所有客户和 Pod 运行状态 | 每天多次 | ★★★★☆ | 全部 | PP-05 |
| **P0** | S3: 容器崩溃自动恢复 | 事件触发 | ★★★★★ | 全部 | PP-06 |
| **P1** | S4: 迁移已有 OpenClaw 实例到 AgentPod | 一次性 | ★★★★☆ | 全部（首次使用） | — (上手场景，非操作痛点) |
| **P1** | S5: 批量升级 Pod 版本 | 每月 1-2 次 | ★★★★☆ | 李娜 | PP-10 |
| **P1** | S6: 按客户配置不同的 LLM 和通道 | 创建时 | ★★★☆☆ | 李娜、赵明 | PP-11 |
| **P1** | S7: 为 Pod 设置资源上限 | 创建时 | ★★★☆☆ | 赵明、王鹏 | PP-09 |
| **P2** | S8: 查看客户级的 API 用量和成本 | 每周/每月 | ★★☆☆☆ | 赵明 | — (未验证痛点) |
| **P2** | S9: 备份和恢复客户数据 | 每月 | ★★☆☆☆ | 李娜 | — |

> **说明**：
> - "重要度"衡量场景对用户的价值，不等于"痛点强度"。S4（迁移）重要度高是因为它决定了用户的第一印象，但它本身不是当前操作中的痛点（参见 02 文档痛点清单的范围定义）。
> - S3（故障恢复）影响全部 Persona：赵明和王鹏缺少运维带宽，李娜有客户 SLA 要求。
> - S8（API 用量）在 02 文档中无对应已验证痛点，列为 P2 待后续用户访谈验证。

---

### S1: 为新客户创建 Tenant 和 Pod（P0）

**核心价值：让开发者可以将 Agent 作为产品交付给非技术客户。**

没有 AgentPod 时，每接一个客户意味着开发者要亲自执行 12 步基础设施操作。这不仅低效，更关键的是——开发者无法将这个流程标准化为"产品交付"，因为每次都是手工作坊式的一次性操作。

**当前流程（无 AgentPod）：**

```
1. SSH 到 VPS
2. 计算可用端口（上一个客户用了 18789，这个用 19789）
3. 创建目录：mkdir -p /data/tenants/acme/.openclaw
4. 生成 Gateway Token：openssl rand -hex 32
5. 编写 openclaw.json（端口、workspace、agent ID）
6. 编写 docker run 命令（端口映射、Volume 绑定、环境变量）
7. 配置 Traefik 标签（或 Nginx location block）
8. 申请 DNS 子域名：acme.myagents.com → VPS IP
9. 等待 Let's Encrypt 证书签发
10. 启动容器，验证 WebSocket 连通性
11. 配置消息通道（WhatsApp QR 扫码 / Telegram Bot Token）
12. 通知客户可以开始使用
```

**问题不只是耗时**（30-60 分钟/次），更在于：
- 这个流程**无法产品化** —— 不能交给非技术人员操作
- 每次都是手工操作 —— 出错率约 30%
- DNS / HTTPS / 通道配置是一次性操作但不可跳过 —— 新手 2-4 小时

**期望流程（有 AgentPod）：**

```
1. agentpod tenant create acme
2. agentpod pod create acme/agent --type openclaw --channel whatsapp
   → 自动分配端口、创建 Volume、注册 Traefik 路由、签发证书
3. 在 Dashboard 配置客户的 LLM API Key 和通道凭证
4. 客户收到即开即用的 Agent
```

**对开发者**：3-5 分钟，出错率 < 5%，可复制的标准化流程
**对终端客户**：完全无感 —— 收到的是一个"上线了的数字员工"，不是一堆技术配置

---

### S2: 查看所有客户和 Pod 运行状态（P0）

**当前流程：**

```bash
# 逐个检查
docker ps --filter "name=openclaw"
docker logs openclaw-acme --tail 20
docker logs openclaw-beta --tail 20
docker stats --no-stream
# 没有统一视图，没有告警
```

**期望：**

Dashboard 按 Tenant 分组显示所有 Pod 状态：
- 运行状态（运行中 / 已停止 / 错误）
- 上次心跳时间
- CPU / 内存用量
- 已连接的消息通道
- 最近错误日志摘要

CLI 同时支持两个维度：
```bash
agentpod pod list                     # 所有 Pod 平铺
agentpod tenant status megacorp       # 按 Tenant 聚合
```

异常时自动告警（Webhook / 邮件）。

---

### S3: 容器崩溃自动恢复（P0）

**当前状态：**
- Docker `--restart=unless-stopped` 只能处理进程退出
- 如果 OpenClaw Gateway 进程挂起（不退出但不响应），Docker 不会重启
- 如果配置变更导致启动失败，Docker 会无限重启循环
- **没有人知道容器挂了，直到客户反馈 "Agent 没回复了"**

**期望（Reconciliation Loop）：**
- 每 30 秒对比期望状态（DB）和实际状态（Docker）
- 容器不在运行 → 自动拉起
- 健康检查失败（Gateway 不响应 `/health`）→ 自动重启
- 重启超过 3 次 → 标记异常 + 告警
- 配置变更 → 自动 recreate 容器

---

### S4: 迁移已有 OpenClaw 实例（P1）

**场景描述：**

用户已有 3-5 个手动部署的 OpenClaw 容器在运行，想迁移到 AgentPod 管理而不中断服务。

**当前痛点：**
- 手动重新创建 = 停服 + 重新配置，客户无法接受
- 已有的 Volume 数据（MEMORY.md、会话记录、WhatsApp Session）不能丢
- 每个实例的配置散落在 docker run 命令行参数、环境变量、openclaw.json 中

**期望流程：**

```bash
agentpod migrate discover
# → 自动扫描本机运行的 OpenClaw 容器（docker ps + docker inspect）
# → 读取每个容器的：
#    - Volume 挂载路径（找到 ~/.openclaw 在宿主机的位置）
#    - 端口映射（Gateway port, Bridge port）
#    - 环境变量（OPENCLAW_GATEWAY_TOKEN, 路径覆盖）
#    - openclaw.json 配置（agent 列表、通道绑定、LLM 配置）
# → 输出发现结果：

  发现 3 个 OpenClaw 实例:
  ┌───────────────────┬──────────┬───────┬──────────────────────────────┐
  │ Container         │ Port     │ Agents│ Data Path                    │
  ├───────────────────┼──────────┼───────┼──────────────────────────────┤
  │ openclaw-acme     │ 18789    │ main  │ /data/acme/.openclaw         │
  │ openclaw-beta     │ 19789    │ main  │ /data/beta/.openclaw         │
  │ openclaw-gamma    │ 20789    │ 2     │ /data/gamma/.openclaw        │
  └───────────────────┴──────────┴───────┴──────────────────────────────┘

agentpod migrate adopt --all
# → 为每个容器创建 Tenant + Pod 记录（写入 DB）
# → 保留原有 Volume 路径（不移动数据）
# → 保留原有端口映射
# → 注册到 Traefik 路由
# → 将容器纳入 Reconciliation Loop 监控
# → 标记 Pod 状态为 "adopted"（区别于 "created"）
# → 全程不停止原容器，零中断迁移
```

**关键实现细节：**
- `docker inspect` 提取 Volume Mounts、Port Bindings、Env Vars
- 从宿主机 Volume 路径读取 `openclaw.json`，解析 agents/channels/bindings
- 敏感信息（auth-profiles.json、WhatsApp creds.json）只检测存在性，不读取内容
- 迁移后原容器继续运行，AgentPod 接管监控和生命周期管理

---

### S5: 批量升级 Pod 版本（P1）

**当前流程：**
```bash
# 对每个客户重复以下步骤：
docker pull openclaw:latest
docker stop openclaw-acme
docker rm openclaw-acme
docker run ... # 重新粘贴完整的 docker run 命令
# 验证启动成功
# 重复 N 次
```

**期望：**
```bash
agentpod pod upgrade --all --image openclaw:2026.2.15
# 或按 Tenant 升级
agentpod pod upgrade --tenant megacorp --image openclaw:2026.2.15
# 或通过 Dashboard 一键滚动升级
# 自动：逐个停止 → 拉新镜像 → 重建容器 → 健康检查通过后继续下一个
```

---

### S6: 按客户配置不同的 LLM 和通道（P1）

**场景描述：**
- 客户 A（外企）要求用 Claude，通过 Slack 对接
- 客户 B（国企）要求用通义千问，通过飞书对接
- 客户 C（电商）要求用 GPT-4，通过 WhatsApp 对接

**当前痛点：**
- 每个客户的 `openclaw.json` 完全不同
- LLM API Key 分散在各个容器的环境变量中
- 通道凭证（Slack Token、飞书 App ID、WhatsApp Session）管理混乱

**期望：**
- Dashboard 中每个 Pod 有独立的配置页面
- LLM Provider + API Key 作为 Pod 配置项
- 通道绑定可视化管理
- 敏感信息加密存储

---

## 六、用户旅程

### 从安装到稳定运营的完整旅程

```
阶段 1: 发现与评估（Day 0）
  ├── 开发者搜索 "OpenClaw 多租户部署" / "AI Agent 批量管理"
  ├── 找到 AgentPod GitHub / 文档站
  ├── 阅读 README，理解价值主张
  └── 决定试用
       摩擦点: 是否值得从现有脚本迁移？ROI 不明确

阶段 1.5: 迁移已有实例（Day 0-1，可选）
  ├── docker compose up -d（启动 AgentPod）
  ├── agentpod migrate discover（扫描已有 OpenClaw 容器）
  ├── 确认发现结果，agentpod migrate adopt --all
  └── 已有容器零中断纳入管理
       摩擦点: 迁移是否真的零中断？配置是否完整识别？
       ★ 迁移体验是用户第一印象 —— 必须顺滑

阶段 2: 首次新建（Day 1）
  ├── agentpod tenant create <name>
  ├── agentpod pod create <name>/agent --type openclaw
  ├── 配置 LLM API Key 和消息通道
  └── 验证 Agent 可正常通信
       摩擦点: WebSocket + Traefik 配对是否顺畅？
       ★ 这是验证闭环的关键 Gate

阶段 3: 规模扩展（Week 1-4）
  ├── 逐步添加更多客户（5 → 10 → 20）
  ├── 发现并使用：批量升级、资源监控、自动恢复
  ├── 遇到资源瓶颈：单 VPS 内存/CPU 不足
  └── 决定是否继续使用 AgentPod
       摩擦点: 单机扩展上限？是否需要多节点？

阶段 4: 稳定运营（Month 2+）
  ├── 日常：Dashboard 看板监控
  ├── 每周：查看资源用量趋势
  ├── 每月：升级 Agent 版本
  └── 持续：响应客户配置变更需求
       摩擦点: 长期运维的自动化程度
```

---

## 七、终端客户体验

AgentPod 的最终价值通过终端客户的体验体现。开发者是 AgentPod 的用户，但终端客户是最终价值的受益者。

### 终端客户看到什么

```
终端客户视角：
  ├── 收到通知："您的数字员工已上线"
  ├── 通过熟悉的渠道与 Agent 对话
  │   ├── WhatsApp（扫码添加联系人）
  │   ├── 飞书（添加 Bot 到群组）
  │   ├── Telegram（/start 开始对话）
  │   └── Slack（安装 App 到 Workspace）
  ├── 通过 Web 管理面板（OpenClaw 自带的 controlUI，AgentPod 自动配置其访问路由）
  │   ├── 查看 Agent 工作状态
  │   ├── 查看会话记录
  │   └── 调整简单配置（如工作时间、回复风格）
  └── 不需要接触任何技术细节
```

### 终端客户不需要知道的

- OpenClaw 是什么
- Docker 容器在哪里运行
- AgentPod 的存在
- API Key 如何配置
- 消息通道的技术实现

### 对开发者的意义

这种体验分离意味着开发者可以：
1. **标准化交付** —— 每个客户获得一致的上线体验
2. **规模化运营** —— 50 个客户的运维复杂度不应比 5 个高 10 倍
3. **专注业务定制** —— 把时间花在 Agent 的 Prompt / Skill / 知识库配置上，而不是基础设施

---

## 八、关键假设

| 编号 | 假设 | 置信度 | 验证方法 |
|------|------|--------|----------|
| H1 | SaaS 开发者为客户部署多个 OpenClaw 实例是真实且增长的需求 | 🟡 中 | 社区调研：OpenClaw 40,000+ 暴露实例中有多少是多租户场景 |
| H2 | 手动部署流程无法标准化为产品交付，是开发者采用 AgentPod 的核心驱动力 | 🟡 中 | 用户访谈 + DEPLOY.md 踩坑记录 |
| H3 | WebSocket + Traefik Bridge 网络可以正常工作 | 🔴 低 | **必须编码前 PoC 验证（阻塞项）** |
| H4 | 开发者愿意从手动脚本迁移到 AgentPod | 🟡 中 | 发布后观察 GitHub Stars 和 Issue |
| H5 | 单机可支撑 50 个 Pod 容器 | 🟡 中 | 资源压测（每容器 ~200MB RAM，50 Pod ≈ 10GB） |
| H6 | Reconciliation Loop 能在 30s 内检测并恢复故障容器 | 🟢 高 | 单元测试 + 集成测试 |
| H7 | 自动迁移工具能正确识别 90%+ 的已有 OpenClaw 配置 | 🟡 中 | 基于 OpenClaw config TypeScript 类型定义验证 |

### 前置验证项（必须开工前完成）

- **H3**: Bridge 网络 + Traefik + OpenClaw WebSocket 配对验证
  - 验证方法：搭建最小 PoC（1 个 Traefik + 1 个 OpenClaw 容器 + Bridge 网络）
  - 成功标准：WebSocket 握手成功，无 "pairing required" 错误
  - 如果失败：回退到 host 网络 + 端口映射方案（降级但可行）

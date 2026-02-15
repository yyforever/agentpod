# 01 - 用户画像与场景分析

> AgentPod PRD 系列文档 | Step 1/5

---

## 一、定位

### 一句话定位

**AgentPod 是面向 SaaS 开发者的 AI Agent 多租户编排平台，让开发者用一条命令为每个客户部署独立的数字员工实例。**

### 品类定义

- **不是**通用 PaaS（Coolify、CapRover 做的事）
- **不是** AI 工作流编排（Dify、Coze、n8n 做的事）
- **是** Agent-Aware 的多租户容器编排层 —— 理解 Agent 的身份（SOUL.md）、记忆（MEMORY.md）、消息通道和 API 密钥

### 类比参考

| 类比 | 说明 |
|------|------|
| Docker Compose → Kubernetes | 从手动编排到声明式管理 |
| Vercel for AI Agents | 开发者 push 配置，平台自动部署、路由、监控 |
| Shopify for Digital Employees | SaaS 厂商开店（创建租户），客户开箱即用 |

---

## 二、目标用户

### 核心用户：SaaS 开发者 / AI 解决方案商

为企业客户部署产品化 AI Agent（数字员工）的技术团队。

### 不服务的用户

| 排除对象 | 原因 |
|----------|------|
| 个人 AI 玩家 | 单实例 Docker Compose 已足够 |
| 大型企业 IT 部门 | 有能力自建 K8s 集群 |
| 非技术代理商 | 需要零代码白标平台（Stammer.ai 等已满足） |

---

## 三、用户画像

### Persona 1：垂直 SaaS 创业者 —— 赵明

| 维度 | 描述 |
|------|------|
| **角色** | AI 客服 SaaS 创始人兼 CTO |
| **团队** | 3-5 人技术团队 |
| **技术栈** | TypeScript / Docker / 1-2 台 VPS |
| **客户** | 10-50 家中小企业，每家需要独立的 AI 客服 Agent |
| **收入模式** | 按客户按月收费（￥500-2000/月/客户） |
| **日常** | 花 40% 时间在运维上：部署新客户、处理容器崩溃、更新版本 |

**核心痛点：**
1. 每接一个新客户，要手动执行 12+ 步部署流程（端口分配、Volume 创建、Traefik 配置、HTTPS 证书、Token 生成……）
2. 客户 A 的容器崩溃不会自动恢复，要等自己发现才能 `docker restart`
3. 没有统一视图看所有客户的运行状态，靠 `docker ps` + 逐个 `docker logs`
4. API 成本按客户拆分困难 —— 月底算账全靠手动

**期望：**
> "我想要一个控制面板，添加客户时填个表单，后台自动把 OpenClaw 实例跑起来，配好域名和通道。客户出问题我能一眼看到。"

---

### Persona 2：数字化服务商技术负责人 —— 李娜

| 维度 | 描述 |
|------|------|
| **角色** | 企业数字化转型服务商的技术总监 |
| **团队** | 8-15 人，含前后端和交付 |
| **技术栈** | Java / Python / Docker / 云服务器 |
| **客户** | 5-20 家中大型企业，每家需要 2-5 个数字员工（客服、HR、财务等） |
| **收入模式** | 项目制 + 年度运维费（￥5-20万/客户/年） |
| **日常** | 交付压力大，同时维护多个客户环境 |

**核心痛点：**
1. 每个客户要求独立部署（数据隔离、合规要求），导致环境碎片化
2. 客户的 LLM 提供商不同 —— A 用 Claude，B 用 GPT，C 用国产模型 —— 配置管理混乱
3. 版本升级是噩梦：20 个客户 × 3 个 Agent = 60 个容器要逐个更新
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
| **客户** | 3-10 个小客户，每个需要一个 WhatsApp/Telegram Agent |
| **收入模式** | 按月收费（￥200-800/月/客户） |
| **日常** | 白天做其他工作，晚上抽空维护 |

**核心痛点：**
1. 没时间写和维护部署脚本 —— 每次加客户都要翻笔记找上次的操作步骤
2. 一台 4GB VPS 跑 5 个 OpenClaw 实例，端口和内存经常冲突
3. Bridge 网络 + WebSocket 配对问题搞了两天才解决，现在不敢碰网络配置
4. 客户问 "为什么我的 Agent 没回复"，自己也不知道是容器挂了还是 API 额度用完了

**期望：**
> "给我一个 `agentpod create` 命令，什么都帮我搞定。我只想关注客户的业务配置，不想碰 Docker 网络和 Traefik。"

---

## 四、核心用户场景

### 场景矩阵（按优先级）

| 优先级 | 场景 | 频率 | 痛点强度 | 对应 Persona |
|--------|------|------|----------|-------------|
| **P0** | 为新客户创建 Agent 实例 | 每周 1-3 次 | ★★★★★ | 全部 |
| **P0** | 查看所有客户实例运行状态 | 每天多次 | ★★★★☆ | 全部 |
| **P0** | 容器崩溃自动恢复 | 事件触发 | ★★★★★ | 赵明、王鹏 |
| **P1** | 批量升级 Agent 版本 | 每月 1-2 次 | ★★★★☆ | 李娜 |
| **P1** | 按客户配置不同的 LLM 和通道 | 创建时 | ★★★☆☆ | 李娜 |
| **P1** | 为客户设置资源上限 | 创建时 | ★★★☆☆ | 赵明、王鹏 |
| **P2** | 查看客户级的 API 用量和成本 | 每周/每月 | ★★★☆☆ | 赵明 |
| **P2** | 备份和恢复客户数据 | 每月 | ★★☆☆☆ | 李娜 |

---

### S1: 为新客户创建 Agent 实例（P0）

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

**耗时**：30-60 分钟（熟练）/ 2-4 小时（新手）
**出错率**：约 30%（端口冲突、Volume 路径错误、网络配置）

**期望流程（有 AgentPod）：**

```
1. agentpod create acme --type openclaw --channel whatsapp
   → 自动分配端口、创建 Volume、注册 Traefik 路由、签发证书
2. 在 Dashboard 配置客户的 LLM API Key 和通道凭证
3. 通知客户
```

**耗时**：3-5 分钟
**出错率**：< 5%

---

### S2: 查看所有客户实例运行状态（P0）

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

Dashboard 显示所有租户状态列表：
- 运行状态（运行中 / 已停止 / 错误）
- 上次心跳时间
- CPU / 内存用量
- 已连接的消息通道
- 最近错误日志摘要

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

### S4: 批量升级 Agent 版本（P1）

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
agentpod upgrade --all --image openclaw:2026.2.15
# 或通过 Dashboard 一键滚动升级
# 自动：逐个停止 → 拉新镜像 → 重建容器 → 健康检查通过后继续下一个
```

---

### S5: 按客户配置不同的 LLM 和通道（P1）

**场景描述：**
- 客户 A（外企）要求用 Claude，通过 Slack 对接
- 客户 B（国企）要求用通义千问，通过飞书对接
- 客户 C（电商）要求用 GPT-4，通过 WhatsApp 对接

**当前痛点：**
- 每个客户的 `openclaw.json` 完全不同
- LLM API Key 分散在各个容器的环境变量中
- 通道凭证（Slack Token、飞书 App ID、WhatsApp Session）管理混乱

**期望：**
- Dashboard 中每个租户有独立的配置页面
- LLM Provider + API Key 作为租户配置项
- 通道绑定可视化管理
- 敏感信息加密存储

---

## 五、用户旅程

### 从注册到稳定运营的完整旅程

```
阶段 1: 发现与评估（Day 0）
  ├── 开发者搜索 "OpenClaw 多租户部署" / "AI Agent 批量管理"
  ├── 找到 AgentPod GitHub / 文档站
  ├── 阅读 README，理解价值主张
  └── 决定试用
       摩擦点: 是否值得从现有脚本迁移？ROI 不明确

阶段 2: 首次部署（Day 1）
  ├── docker compose up -d（启动 AgentPod 控制面板 + Traefik）
  ├── 打开 Dashboard，登录
  ├── 创建第一个租户（填写客户名、选择 Agent 类型）
  ├── 配置 LLM API Key 和消息通道
  └── 验证 Agent 可正常通信
       摩擦点: WebSocket + Traefik 配对是否顺畅？
       ★ 这是验证闭环的关键 Gate —— 必须在此刻"跑通"

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

## 六、关键假设

| 编号 | 假设 | 置信度 | 验证方法 |
|------|------|--------|----------|
| H1 | SaaS 开发者为客户部署多个 OpenClaw 实例是真实且增长的需求 | 🟡 中 | 社区调研：OpenClaw 40,000+ 暴露实例中有多少是多租户场景 |
| H2 | 手动部署流程（12 步 / 30-60 分钟）是付费意愿的核心驱动力 | 🟡 中 | 用户访谈 + DEPLOY.md 踩坑记录 |
| H3 | WebSocket + Traefik Bridge 网络可以正常工作 | 🔴 低 | **必须编码前 PoC 验证（阻塞项）** |
| H4 | 开发者愿意从手动脚本迁移到 AgentPod | 🟡 中 | 发布后观察 GitHub Stars 和 Issue |
| H5 | 单机可支撑 50-100 个租户容器 | 🟡 中 | 资源压测（每容器 ~200MB RAM） |
| H6 | Reconciliation Loop 能在 30s 内检测并恢复故障容器 | 🟢 高 | 单元测试 + 集成测试 |
| H7 | Dashboard 对开发者的吸引力大于纯 CLI | 🟡 中 | 发布后 A/B 使用数据 |

### 前置验证项（必须开工前完成）

- **H3**: Bridge 网络 + Traefik + OpenClaw WebSocket 配对验证
  - 验证方法：搭建最小 PoC（1 个 Traefik + 1 个 OpenClaw 容器 + Bridge 网络）
  - 成功标准：WebSocket 握手成功，无 "pairing required" 错误
  - 如果失败：回退到 host 网络 + 端口映射方案（降级但可行）

---

## 七、成功标准

### M3（3 个月）

| 指标 | 目标 |
|------|------|
| GitHub Stars | 500+ |
| 活跃部署 | 20+ 个独立安装 |
| 管理的租户总数 | 100+ 个 Agent 实例 |
| 核心功能完成 | 创建/删除/监控/自动恢复 |

### M12（12 个月）

| 指标 | 目标 |
|------|------|
| GitHub Stars | 3,000+ |
| 活跃部署 | 200+ |
| 管理的租户总数 | 2,000+ |
| 支持的 Agent 类型 | 3+（OpenClaw + 其他） |
| 社区贡献者 | 10+ |

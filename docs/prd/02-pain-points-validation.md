# 02 - 痛点验证与优先级排序

> AgentPod PRD 系列文档 | 分册 2/4
> 依赖：01-user-personas-and-scenarios.md

---

## 一、痛点来源与验证方法

### 证据来源

| 来源 | 类型 | 可信度 |
|------|------|--------|
| OpenClaw `DEPLOY.md` 踩坑记录 | 第一手实操记录 | ★★★★★ |
| OpenClaw `docs/gateway/multiple-gateways.md` | 官方文档 | ★★★★★ |
| OpenClaw `docker-compose.yml` / `Dockerfile` | 源码实证 | ★★★★★ |
| 安全研究报告（40,000+ 暴露实例） | 第三方审计 | ★★★★☆ |
| HackerNews / Reddit 社区讨论 | 用户反馈 | ★★★☆☆ |
| AI Agent 多租户市场报告 | 行业分析 | ★★★☆☆ |

### 验证框架

每个痛点按以下维度评估：

- **真实性**：是否有实证（代码/文档/用户反馈）支撑？
- **普遍性**：影响哪些 Persona？影响面多大？
- **严重度**：不解决会怎样？（阻塞 vs 不便 vs 可忍受）
- **频率**：多久遇到一次？

---

## 二、痛点清单与验证

### PP-01: 端口分配与冲突

| 维度 | 评估 |
|------|------|
| **描述** | OpenClaw 使用基础端口 + 派生端口（base+2 浏览器控制, base+9~108 CDP），每个实例需要 100+ 端口范围，手动计算易出错 |
| **实证** | `docs/gateway/multiple-gateways.md` 明确要求 "20+ port gap between instances"；DEPLOY.md 记录端口冲突导致 Gateway 启动失败 |
| **影响 Persona** | 全部（尤其王鹏 —— 单机多实例） |
| **严重度** | **阻塞** —— 端口冲突 = 容器无法启动 |
| **频率** | 每次新增客户 |
| **当前解法** | 手动维护端口映射表，人工计算下一个可用端口段 |
| **验证状态** | ✅ 已验证（源码 + 文档双重确认） |

---

### PP-02: 状态目录隔离

| 维度 | 评估 |
|------|------|
| **描述** | 多实例共享 `~/.openclaw` 导致配置竞争、会话冲突、WhatsApp session 损坏 |
| **实证** | `docs/gateway/multiple-gateways.md` 列出 4 项必须手动隔离的路径：CONFIG_PATH, STATE_DIR, workspace, port。遗漏任一项 = 数据损坏 |
| **影响 Persona** | 全部 |
| **严重度** | **数据损坏** —— 静默错误，难以排查 |
| **频率** | 每次新增客户（配置时）；运行中（如果隔离不完整） |
| **当前解法** | 环境变量 `OPENCLAW_CONFIG_PATH` + `OPENCLAW_STATE_DIR` 手动设置 |
| **验证状态** | ✅ 已验证（官方文档明确警告 "silent data corruption risk"） |

---

### PP-03: Bridge 网络 WebSocket 死锁

| 维度 | 评估 |
|------|------|
| **描述** | Docker Bridge 网络下，OpenClaw Gateway 将来自 172.18.0.x 的连接视为不可信，触发 "pairing required" 错误。但 Host 网络模式无法支持多容器（端口冲突） |
| **实证** | DEPLOY.md 踩坑记录 #1：`disconnected (1008): pairing required`。当前唯一解法是 `--network host`，与多租户互斥 |
| **影响 Persona** | 全部（这是多租户的技术前提） |
| **严重度** | **阻塞** —— 不解决 = 多租户不可行 |
| **频率** | 架构层面问题，一旦遇到则全局阻塞 |
| **当前解法** | 1) `--network host`（放弃多租户）；2) Traefik 反代 + header 转发（未验证）；3) `allowInsecureAuth: true`（安全妥协） |
| **验证状态** | ⚠️ 部分验证 —— 已确认问题存在，**解决方案未验证（H3 阻塞项）** |

---

### PP-04: 手动 Docker 编排

| 维度 | 评估 |
|------|------|
| **描述** | 每个客户需要手动执行 docker run（端口映射、Volume 绑定、环境变量、Traefik 标签），12+ 步骤，30-60 分钟 |
| **实证** | DEPLOY.md 完整记录了单实例部署流程；`docker-compose.yml` 只有单服务定义，无多租户模板 |
| **影响 Persona** | 全部 |
| **严重度** | **高** —— 不是不能做，但极其低效且易出错（约 30% 出错率） |
| **频率** | 每次新增客户 |
| **当前解法** | 手写 Shell 脚本（每人的脚本不同，不可复用） |
| **验证状态** | ✅ 已验证 |

---

### PP-05: 无统一监控视图

| 维度 | 评估 |
|------|------|
| **描述** | N 个容器的运行状态、健康状况、资源使用、错误日志分散在各自的 docker logs 中，没有聚合视图 |
| **实证** | OpenClaw 无内置多实例监控；社区反馈 "until the client complains, I don't know it's down" |
| **影响 Persona** | 全部（赵明每天多次查看，王鹏发现问题时已晚了） |
| **严重度** | **高** —— 直接影响 SLA 和客户满意度 |
| **频率** | 持续 |
| **当前解法** | `docker ps` + `docker logs` + `docker stats` 逐个查看 |
| **验证状态** | ✅ 已验证 |

---

### PP-06: 无自动故障恢复

| 维度 | 评估 |
|------|------|
| **描述** | Docker restart policy 只处理进程退出；Gateway 挂起（僵死）、配置错误导致的启动循环、资源耗尽等场景无法自动恢复 |
| **实证** | OpenClaw Gateway 进程可能因 OOM、未捕获异常、或 LLM API 超时而挂起但不退出 |
| **影响 Persona** | 赵明（客户 SLA）、王鹏（没时间盯） |
| **严重度** | **高** —— Agent 停服 = 客户业务中断 |
| **频率** | 事件驱动（每周 1-3 次，取决于稳定性） |
| **当前解法** | 无（依赖人工发现 + 手动重启） |
| **验证状态** | ✅ 已验证 |

---

### PP-07: HTTPS 证书管理

| 维度 | 评估 |
|------|------|
| **描述** | 每个租户子域名需要独立的 TLS 证书，手动 certbot 或配置 Traefik Let's Encrypt |
| **实证** | DEPLOY.md 记录 Tailscale HTTPS 配置；无 HTTPS 会导致 `crypto.subtle` 不可用（设备身份功能失效） |
| **影响 Persona** | 赵明、李娜 |
| **严重度** | **中** —— Traefik 内置 ACME 可自动化，但需要正确配置 |
| **频率** | 每次新增客户 + 每 90 天续期 |
| **当前解法** | 手动 certbot 或 Traefik ACME（需配置） |
| **验证状态** | ✅ 已验证 |

---

### PP-08: Gateway Token 管理

| 维度 | 评估 |
|------|------|
| **描述** | 每个实例需要唯一的 Gateway Token，手动生成并注入环境变量 |
| **实证** | `openssl rand -hex 32` 手动生成；DEPLOY.md 记录 token 配置流程 |
| **影响 Persona** | 全部 |
| **严重度** | **低** —— 简单但繁琐 |
| **频率** | 每次新增客户 |
| **当前解法** | 手动生成 + 环境变量注入 |
| **验证状态** | ✅ 已验证 |

---

### PP-09: 资源限制缺失

| 维度 | 评估 |
|------|------|
| **描述** | 容器默认无 CPU/内存/磁盘限制，一个客户的 Agent 失控可耗尽整台服务器资源，影响所有客户 |
| **实证** | `docker-compose.yml` 和 `Dockerfile` 中无 resource limits 配置；"noisy neighbor" 问题在多租户场景频繁出现 |
| **影响 Persona** | 赵明（10-50 客户共享 VPS）、王鹏（4GB VPS） |
| **严重度** | **高** —— 连锁故障风险 |
| **频率** | 不定期（一旦发生影响全局） |
| **当前解法** | 手动 `--memory=512m --cpus=1`（大多数人不加） |
| **验证状态** | ✅ 已验证 |

---

### PP-10: 版本升级困难

| 维度 | 评估 |
|------|------|
| **描述** | 升级 N 个客户容器需要逐个停止/删除/重建，无滚动升级、无回滚机制 |
| **实证** | 无官方多实例升级工具；DEPLOY.md 升级流程是 git pull → rebuild → restart |
| **影响 Persona** | 李娜（60 个容器） |
| **严重度** | **中** —— 可以做，但非常耗时 |
| **频率** | 每月 1-2 次 |
| **当前解法** | 手动逐个升级 or 自写脚本 |
| **验证状态** | ✅ 已验证 |

---

### PP-11: 配置管理混乱

| 维度 | 评估 |
|------|------|
| **描述** | 每个客户的 openclaw.json 独立维护，LLM Provider / 通道凭证 / Agent 参数分散在不同位置，无集中管理 |
| **实证** | OpenClaw 配置为单文件 JSON5，不支持多租户配置继承或覆盖 |
| **影响 Persona** | 李娜（多客户多配置）、赵明 |
| **严重度** | **中** —— 可以工作，但随客户数增长越来越混乱 |
| **频率** | 持续 |
| **当前解法** | 文件系统目录隔离 + 手动编辑 |
| **验证状态** | ✅ 已验证 |

---

## 三、ICE 优先级评分

### 评分标准

- **Impact（影响力）**：解决后对用户价值的提升程度（1-10）
- **Confidence（置信度）**：我们对该痛点真实性和解决方案可行性的信心（1-10）
- **Ease（容易度）**：实现难度的倒数（10=最容易，1=最难）

### 评分结果

| 排名 | 痛点 | Impact | Confidence | Ease | ICE 分 | MVP 纳入 |
|------|------|--------|------------|------|--------|----------|
| 1 | PP-04 手动 Docker 编排 | 10 | 9 | 7 | 630 | ✅ Must |
| 2 | PP-06 无自动故障恢复 | 9 | 8 | 7 | 504 | ✅ Must |
| 3 | PP-01 端口分配与冲突 | 8 | 10 | 8 | 640 | ✅ Must |
| 4 | PP-05 无统一监控视图 | 8 | 8 | 6 | 384 | ✅ Must |
| 5 | PP-02 状态目录隔离 | 8 | 10 | 8 | 640 | ✅ Must |
| 6 | PP-03 Bridge 网络死锁 | 10 | 5 | 3 | 150 | ✅ Must（前置 PoC） |
| 7 | PP-09 资源限制缺失 | 7 | 8 | 9 | 504 | ✅ Should |
| 8 | PP-08 Token 管理 | 5 | 10 | 10 | 500 | ✅ Must（自动化） |
| 9 | PP-11 配置管理混乱 | 7 | 7 | 5 | 245 | ✅ Should |
| 10 | PP-07 HTTPS 证书管理 | 6 | 8 | 7 | 336 | ✅ Should（Traefik 内置） |
| 11 | PP-10 版本升级困难 | 6 | 7 | 5 | 210 | ⬜ Could |

---

## 四、最小可用门槛（Minimum Viable Pain Relief）

### 用户至少需要解决以下痛点才会使用 AgentPod

**Must Have（不解决 = 用户不会用）：**

1. **PP-04 手动编排 → 自动化创建/销毁**
   - `agentpod create <tenant>` 一条命令完成全部 12 步
   - 这是 AgentPod 的核心价值命题

2. **PP-01 + PP-02 端口/状态隔离 → 自动分配**
   - 控制面自动管理端口段和目录结构
   - 用户完全不需要关心隔离细节

3. **PP-03 网络配对 → Traefik 正确转发**
   - Bridge 网络 + WebSocket 必须可工作
   - **这是技术前提，必须 PoC 验证**

4. **PP-06 故障恢复 → Reconciliation Loop**
   - 期望状态 vs 实际状态的自动调和
   - 容器崩溃 30s 内自动恢复

5. **PP-05 统一监控 → Dashboard 状态概览**
   - 至少提供所有租户的运行状态列表
   - 比 `docker ps` 更有用才行

### Should Have（解决后提升满意度）：

6. PP-09 资源限制（防止 noisy neighbor）
7. PP-07 HTTPS 自动化（Traefik ACME）
8. PP-11 配置管理（Dashboard 中编辑租户配置）

### Could Have（后续迭代）：

9. PP-10 批量版本升级
10. PP-08 Token 自动轮换

---

## 五、风险评估

### 最大风险：PP-03 Bridge 网络 WebSocket 死锁

这是整个项目的 **技术前提假设（H3）**：

```
如果 Traefik 无法正确转发 WebSocket 握手 headers，
导致 OpenClaw Gateway 始终返回 "pairing required"，
那么基于 Bridge 网络的多租户方案不可行。
```

**缓解策略（按优先级）：**

| 方案 | 可行性 | 代价 |
|------|--------|------|
| A: Traefik 配置 `Host` / `Origin` / `X-Forwarded-For` header 转发 | 🟢 高 | 低（配置层面） |
| B: OpenClaw `gateway.controlUi.allowedOrigins` 配置白名单 | 🟢 高 | 低（配置层面） |
| C: OpenClaw `allowInsecureAuth: true` | 🟡 中 | 中（安全妥协） |
| D: Host 网络 + iptables 端口映射 | 🟡 中 | 高（复杂度提升） |
| E: 每个租户独立 macvlan 网络 | 🔴 低 | 极高（运维复杂） |

**验证计划：**
- Week 0 Day 1-2：搭建最小 PoC（1 Traefik + 1 OpenClaw + Bridge 网络）
- 依次尝试方案 A → B → C
- 成功标准：WebSocket 握手成功 + 消息收发正常
- 如果 A+B+C 全部失败：重新评估架构（可能需要 OpenClaw 上游适配）

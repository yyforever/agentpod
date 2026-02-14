# 竞品调研 + PaaS 架构对比

> 基于 2026-02-15 五路并行 Agent 深度调研，覆盖 40+ 竞品。

## 市场概览

AI Agent 市场 2025 年达 $7.6B，预计年增长率 49.6%，到 2030 年达 $52.6B。赛道分五层:

```
+----------------------------------------------------------+
|  Layer 5: 企业 AI 平台                                     |
|  Salesforce Agentforce | Sierra | OpenAI Frontier         |
|  AWS Bedrock | Azure AI | Google Vertex                   |
+----------------------------------------------------------+
|  Layer 4: AI 编码 Agent                                    |
|  Devin | Replit Agent | GitHub Copilot | Entire           |
+----------------------------------------------------------+
|  Layer 3: LLM 工作流/编排                                   |
|  n8n ($2.5B) | Dify (100K stars) | Coze | CrewAI          |
|  LangGraph | Flowise | FastGPT                            |
+----------------------------------------------------------+
|  Layer 2: Agent 沙箱/Runtime                               |
|  E2B (88% Fortune100) | Modal ($2.5B)                     |
|  Fly.io/Sprites | Daytona | Blaxel | Castari              |
+----------------------------------------------------------+
|  Layer 1: 自托管 AI 助手                                    |
|  OpenClaw (180K stars) | Open WebUI (124K stars)          |
|  LobeChat (72K stars) | AnythingLLM | LibreChat           |
+----------------------------------------------------------+
              ^
         AgentPod 定位: Layer 1.5
         = Layer 1 的 Agent 能力 + 多租户编排框架层
```

## 关键竞品

### 第一梯队: 直接竞争

| 竞品 | 融资 | 与 AgentPod 关系 | 威胁等级 |
|------|------|-----------------|---------|
| **OpenClaw 第三方托管** (MyClaw, ClawFast, xCloud) | 无 | 最直接竞争: 同样托管 OpenClaw，但无开源框架 | 极高 |
| **Coze** (字节跳动) | ByteDance 背书 | Apache 2.0 开源，原生消息渠道，但无多租户隔离 | 高 |
| **Dify** | $11.5M | 有消息渠道插件，有云版，但逻辑多租户非容器隔离 | 高 |
| **LettaBot** | Felicis 领投 | 多渠道消息 + 持久记忆，但 traction 极小 | 中高 |

### 第二梯队: 间接竞争

| 竞品 | 估值 | 核心差异 | 威胁等级 |
|------|------|---------|---------|
| **n8n** | $2.5B | 工作流优先，非 agent 优先 | 中 |
| **OpenAI Frontier** | OpenAI 背书 | 邀请制，Fortune 500 only | 中(潜在极高) |
| **E2B** | $35-43M | 代码执行沙箱，非 AI 助手托管 | 低 |
| **Modal** | $2.5B | Serverless 计算平台，非 agent 场景 | 低 |

## 开源 PaaS 架构对比

| 维度 | Coolify | CapRover | Dokku | Portainer |
|------|---------|----------|-------|-----------|
| **定位** | 自托管 PaaS | 自托管 PaaS | Heroku 替代 | 容器管理 UI |
| **语言** | PHP 8.4 / Laravel 11 | TypeScript / Node.js | Bash + Go | Go |
| **前端** | Livewire + Alpine.js | React | 无 (CLI only) | Angular -> React |
| **数据库** | PostgreSQL (314 migrations) | JSON 文件 | 文件系统 + Docker labels | BoltDB |
| **多节点通信** | SSH (OpenSSH) | Docker Swarm | k3s | Agent (Go, gRPC) |
| **反向代理** | Traefik v3 / Caddy | Nginx | 可插拔 | 不管 |
| **插件系统** | 服务模板 (JSON) | One-Click App (YAML) | plugn (Go) | 多 runtime |
| **Stars** | ~35K | ~13K | ~30K | ~32K |

## AgentPod 从每个参考项目学什么

| 参考项目 | 学什么 | 不学什么 |
|----------|--------|---------|
| **Coolify** | SSH 管远程服务器; Traefik label 自动路由; Sentinel agent 轻量 push | PHP/Laravel; 过于通用的 PaaS 功能 |
| **CapRover** | TypeScript/Node.js 生态; Docker Swarm 多节点方案 | Nginx 自定义模板; JSON 文件存状态 |
| **Dokku** | plugn 插件系统设计; 可插拔代理/调度器 | Bash 为主的技术栈; 无 Web UI |
| **Portainer** | Server-Agent 模型; REST API 设计 | Angular 前端; 过于通用 |
| **K8s** | Reconciliation Loop; Spec/Status 分离 | 整个 K8s——太重了 |

## AgentPod 核心差异化

| # | 差异化 | 说明 |
|---|-------|------|
| 1 | **Agent-Aware 编排** | 不是通用 PaaS，理解 Agent 的身份/记忆/配置 |
| 2 | **可插拔 Adapter** | 写一个 AgentAdapter 就能支持新 Agent 类型 |
| 3 | **Per-Tenant 容器硬隔离** | 每租户独立 Docker 容器 + Volume |
| 4 | **开源多租户** | 纯开源，任何人可以部署自己的多租户 Agent 平台 |

## 战略建议

1. **不要做通用 PaaS** -- Coolify/CapRover/Dokku 已经做得很好
2. **做 Agent 编排的垂直框架** -- 只做 AI Agent 多租户，做到极致
3. **OpenClaw 优先但不锁定** -- 架构允许 Open WebUI / LobeChat / 任意容器化 Agent
4. **紧盯 Coze 和 Dify** -- 它们是最可能加多租户隔离的竞品

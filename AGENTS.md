# AGENTS.md — AgentPod 项目指南

> 给 AI coding agent (CC/CX) 读的项目上下文。

## 项目简介
AgentPod 是一个开源的多租户 AI Agent 编排框架。通过 Adapter 模式支持任意 Agent 类型（OpenClaw、Open WebUI 等），每个租户独立容器 + 独立 Volume，调和引擎自动对齐期望状态与实际状态。

## 架构

```
packages/
  shared/          ← Zod schemas + TypeScript 类型定义
  core/            ← 纯业务逻辑（零 HTTP 依赖）
    src/
      tenant.ts         TenantService
      pod.ts            PodService（生命周期管理）
      reconciler.ts     ReconcileService（调和引擎）
      adapter.ts        AdapterRegistry
      docker.ts         DockerClient
      errors.ts         CoreError（统一错误类型）
      db/               Drizzle schema + migration + createDb 工厂
      adapters/         Adapter 实现（openclaw.ts）
      __tests__/        集成测试（真 PostgreSQL）

apps/
  control-plane/   ← 薄 HTTP 层（Hono），只做路由→服务转发
  cli/             ← 命令行工具（commander.js）

docs/              ← 设计文档 + 开发日志
```

## 工作规范

### Git
- 只 commit 自己改的文件，显式列出路径：`git add path/file1 path/file2 && git commit -m "type: message" -- path/file1 path/file2`
- commit 前先 `git status` 确认
- Conventional Commits（`feat|fix|refactor|build|docs|test|chore`）
- 绝对不跑 `git reset --hard`、`git restore`、`git clean` 等破坏性操作
- 不改 .env 文件

### 验证闭环
- 每次改动后必须运行：`pnpm build`（tsc 编译）+ 相关测试
- 全部通过才算完成，不能跳过
- 如果有 lint 配置，也要跑 lint

### 文件规模
- 单文件不超过 500 行，超了就拆分/重构
- 拆分时保持接口不变，不引入 breaking change

### 可用 CLI 工具
- `pnpm` — 包管理 + monorepo
- `node --import tsx` — 运行 TypeScript
- `sudo docker` — 容器操作
- `psql` — 直连 PostgreSQL（DATABASE_URL 环境变量）
- `curl` — HTTP 调试
- `gh` — GitHub CLI

## 核心规则

### 分层
- **core 层**：零 HTTP 依赖，纯函数 + 类，DB 和 Docker 通过构造函数注入
- **API 层**：解析请求 → 调 service → 返回 JSON，不含业务逻辑
- **CLI 层**：直接调 core service，不走 HTTP

### 代码风格
- TypeScript strict，零 `any`
- ESM（`"type": "module"`）
- `tsc --noEmit` 必须零错误
- 测试用 `node:test` + `node:assert`（不用 vitest/jest）

### 数据库
- PostgreSQL，Drizzle ORM
- 5 表：tenants, pods, pod_configs, pod_status, pod_events
- Migration 在 `packages/core/src/db/migrate.ts`，纯 SQL，幂等
- FK 带 ON DELETE CASCADE（pod_configs, pod_status, pod_events → pods）
- 不用 Drizzle Kit，不用 migration 文件夹

### 调和引擎
- 期望状态驱动（K8s Reconciliation 模式）
- 只查 desired_status ≠ actual_status 的 Pod
- desired=deleted 时：停容器 → 删容器 → 删 DB 行
- 文件系统操作在 DB 事务提交之后

### Adapter 模式
- `AgentAdapter` 接口定义在 `packages/shared`
- 每个 Adapter 提供：containerSpec（静态）+ resolveContainerSpec（动态）+ lifecycle hooks
- 当前实现：OpenClaw Adapter

## 环境变量
- `DATABASE_URL` — PostgreSQL 连接串
- `AGENTPOD_DATA_DIR` — Pod 数据目录（默认 `/data/pods`）
- `AGENTPOD_NETWORK` — Docker 网络名（默认 `agentpod-net`）
- `AGENTPOD_DOMAIN` — 子域名根域（默认 `localhost`）
- `AGENTPOD_OPENCLAW_IMAGE` — OpenClaw 镜像（默认 `openclaw:production`）

## 测试策略
- **实现和测试在同一个 agent session 完成，不分步**
- 任务 prompt 里直接写"实现完后写测试并运行验证"
- 同 context 里写测试质量更高——agent 对刚写的代码记忆最清楚
- 大改动必须带测试，小修 bug 可选

### 测试位置与运行
- Core: `packages/core/src/__tests__/` — `cd packages/core && DATABASE_URL="..." node --import tsx --test src/__tests__/*.test.ts`
- API: `apps/control-plane/src/__tests__/` — `cd apps/control-plane && DATABASE_URL="..." node --import tsx --test src/__tests__/api.test.ts`
- CLI: `apps/cli/src/__tests__/` — `DATABASE_URL="..." node --import tsx --test apps/cli/src/__tests__/cli.test.ts`（从 repo 根跑）
- 测试跑真 PostgreSQL，before hook 做 TRUNCATE
- Mock：DockerClient（不依赖真 Docker daemon）

## 构建
- `pnpm build`（turbo 编排，5 packages）
- 从 repo 根 `pnpm install` 安装依赖

## 常见陷阱
- `CREATE TABLE IF NOT EXISTS` 不更新已有表的约束 — 加 CASCADE 必须用 ALTER
- `packages/core/src/db/index.ts` 只导出 `createDb` 工厂，无模块级单例
- 测试必须从 `packages/core` 目录运行（pnpm node_modules 解析）
- CoreError.statusCode 类型是 `400 | 404 | 409 | 500`，不是 number

# 开发日志

## 2026-02-18 — Week 1-2 完成

### 开发模式
- **编排**：知行（OpenClaw agent）负责任务拆分、质量验证、流程控制
- **执行**：CC（Claude Code CLI）和 CX（Codex CLI）负责写代码，知行不直接写代码
- CC 擅长：脚手架、快速小改、代码 review
- CX 擅长：大规模实现、全局理解后一次做对

### Step 1: Monorepo 脚手架
- **工具**：CC，~30s，$0.48
- 产出：12 文件，Turborepo + pnpm workspace + packages/shared 类型定义
- 手动修：dockerode 移到 deps，补 @hono/node-server

### Step 2: 控制面 MVP
- **工具**：CX (gpt-5.3-codex)，~15min
- 产出：10 源文件，3213 行
- 含：REST API (Hono)、调和引擎、Docker 封装、OpenClaw Adapter、PostgreSQL migration
- tsc 零错误，端到端验证通过（PostgreSQL → 控制面 → 创建租户 → 创建 Pod → 调和）
- commit `b0e821a`

### Step 3: 架构重构（core/api/cli 分层）
- **工具**：CX (gpt-5.3-codex)，~15min
- 原因：业务逻辑混在 API routes 里，不可测试、不可复用
- 产出：34 文件，+1760/-1206
  - `packages/core/` — TenantService, PodService, ReconcileService, AdapterRegistry, DockerClient
  - `apps/control-plane/` — 薄 Hono routes（4 文件）
  - `apps/cli/` — commander.js CLI
- 3 个核心测试（tenant/pod/reconciler）全部通过
- commit `06e8dc1`

### Step 4: 代码 Review + 修复

#### CC Review
- CC 审查全部代码，发现 24 个问题：4×P0, 7×P1, 6×P2, 7×P3
- P0-3（auth）和 P0-4（secrets 加密）为设计决策，暂缓

#### 第一轮修复（CC，已回退）
- CC 分两批修复 13 个问题，但需要人工干预（CASCADE migration、测试适配）
- 大哥要求回退，改用 CX 重做

#### 第二轮修复（CX，最终版）
- **工具**：CX (gpt-5.3-codex, reasoning=high)，~12min，111K tokens
- 一次性修复全部 13 个问题，零手动干预：
  - **P0-1**: 调和器删除 Pod 时清理 DB 行 + ON DELETE CASCADE
  - **P0-2**: 文件系统写入移到 DB 事务提交之后
  - **P1-2**: 移除 db 模块级单例，只导出 createDb 工厂
  - **P1-3**: 调和器只查询 desired≠actual 的 Pod
  - **P1-4**: containerId 类型收紧为 `string | null`
  - **P1-5**: TenantService.delete 事务 + SELECT FOR UPDATE
  - **P1-6**: OpenClaw adapter 静态 containerSpec 不含未解析模板
  - **P1-7**: status CLI 命令加 try/catch
  - **P2-2**: CoreError.statusCode 收紧为 `400 | 404 | 409 | 500`
  - **P2-4**: pod_events.pod_id 加 NOT NULL
  - **P2-5**: 路由层加 Zod 输入验证
  - **P3-1**: pods.tenant_id 加索引
  - **P3-4**: Docker 日志解析去除 8 字节复用头
- tsc 零错误 + 3/3 测试通过
- commit `14be14f`

### 教训
1. **CX 不要手动指定 `-m`** — config.toml 已配好默认模型（gpt-5.3-codex + high reasoning），手动加 `-m o4-mini` 导致失败
2. **`CREATE TABLE IF NOT EXISTS` 不更新已有表的约束** — 加 CASCADE 必须用 ALTER TABLE
3. **全局理解型任务给 CX，快速小改给 CC** — 同样 13 个修复，CX 一次通过，CC 需要人工兜底
4. **CX 大任务用 tmux 或 `codex exec -o`** — 裸 pty 输出全是 ANSI 转义，没法读

### Week 1-2 完成度

| Roadmap 项目 | 状态 |
|---|---|
| Monorepo (Turborepo + pnpm) | ✅ |
| AgentAdapter 接口 | ✅ |
| OpenClaw Adapter | ✅ |
| Docker API 封装 | ✅ |
| PostgreSQL + Migration | ✅ |
| 调和引擎 | ✅ |
| REST API | ✅ |
| Traefik WebSocket 验证 | ❌ 未开始 |

**额外完成**：core 纯逻辑层分离、CLI 工具、3 个集成测试、13 个 review 问题修复

### 待办
- [ ] Traefik WebSocket 验证（Week 1-2 遗留）
- [ ] P0-3: API 认证方案设计
- [ ] P0-4: Secrets 加密方案设计
- [ ] .gitignore 排除 dist/
- [ ] Dashboard (Week 3-4)

# AgentPod Dashboard

AgentPod Dashboard 是管理多租户 Agent Pod 的 Web 控制台（Next.js App Router）。

## 作用

- 展示租户和 Pod 状态
- 基于 Adapter schema 渲染创建/编辑表单
- 触发 Pod 生命周期操作（创建、重启、删除）
- 通过 Control Plane API 获取与更新数据

## 开发

在仓库根目录执行：

```bash
pnpm --filter @agentpod/dashboard dev
```

默认访问：`http://localhost:3000`

## 构建与启动

```bash
pnpm --filter @agentpod/dashboard build
pnpm --filter @agentpod/dashboard start
```

## 相关目录

- `apps/dashboard/src/app`：页面与路由
- `apps/dashboard/src/components`：UI 组件
- `apps/dashboard/src/lib`：通用工具

## 依赖关系

Dashboard 作为前端管理层，不直接访问数据库和 Docker；所有业务操作通过 `apps/control-plane` 暴露的 API 完成。

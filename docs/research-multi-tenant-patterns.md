# AgentPod 多租户编排研究：技术模式与实现指南

> 本文档系统性地研究了构建 AgentPod（开源多租户 AI Agent 编排框架）所需的核心技术模式，涵盖 Docker 容器管理、调和循环、反向代理路由和数据库多租户设计。所有代码示例均面向 TypeScript 实现。

---

## 目录

1. [Docker API (dockerode) 使用指南](#1-docker-api-dockerode-使用指南)
2. [调和循环（Reconciliation Loop）实现模式](#2-调和循环reconciliation-loop实现模式)
3. [Traefik Docker Provider 配置详解](#3-traefik-docker-provider-配置详解)
4. [PostgreSQL 多租户 Schema 设计](#4-postgresql-多租户-schema-设计)
5. [综合建议：AgentPod 的最佳实践组合](#5-综合建议agentpod-的最佳实践组合)

---

## 1. Docker API (dockerode) 使用指南

### 1.1 概述

[dockerode](https://github.com/apocas/dockerode) 是 Node.js 生态中最成熟的 Docker Remote API 客户端库。它直接映射 Docker Engine API，支持 Promise 和 callback 两种风格，并且不破坏原始 stream，适合生产级容器编排场景。

安装：

```bash
npm install dockerode
npm install -D @types/dockerode
```

### 1.2 初始化连接

```typescript
import Docker from 'dockerode'

// 方式一：Unix Socket（本地 Docker）
const docker = new Docker({ socketPath: '/var/run/docker.sock' })

// 方式二：TCP 远程连接（带 TLS）
const dockerRemote = new Docker({
  host: '192.168.1.100',
  port: 2376,
  ca: fs.readFileSync('ca.pem'),
  cert: fs.readFileSync('cert.pem'),
  key: fs.readFileSync('key.pem'),
})

// 方式三：SSH 连接
const dockerSSH = new Docker({
  protocol: 'ssh',
  host: '192.168.1.100',
  port: 22,
  username: 'deploy',
  sshOptions: { privateKey: fs.readFileSync('id_rsa') },
})
```

### 1.3 容器生命周期管理

#### 创建容器（含资源限制与健康检查）

这是 AgentPod 的核心操作——为每个租户创建隔离的 Agent 容器：

```typescript
interface TenantContainerConfig {
  readonly tenantId: string
  readonly agentImage: string
  readonly memoryLimitMB: number
  readonly cpuLimit: number // 核数，如 0.5 = 半核
  readonly envVars: Record<string, string>
}

async function createTenantContainer(
  docker: Docker,
  config: TenantContainerConfig
): Promise<Docker.Container> {
  const containerName = `agentpod-${config.tenantId}`
  const networkName = `agentpod-net-${config.tenantId}`

  const container = await docker.createContainer({
    Image: config.agentImage,
    name: containerName,
    Env: Object.entries(config.envVars).map(
      ([k, v]) => `${k}=${v}`
    ),

    // 标签：用于服务发现与 Traefik 路由
    Labels: {
      'agentpod.tenant-id': config.tenantId,
      'agentpod.managed': 'true',
      'agentpod.created-at': new Date().toISOString(),
      // Traefik 路由标签（后续章节详述）
      'traefik.enable': 'true',
      [`traefik.http.routers.${containerName}.rule`]:
        `Host(\`${config.tenantId}.agents.example.com\`)`,
      [`traefik.http.routers.${containerName}.entrypoints`]: 'websecure',
      [`traefik.http.routers.${containerName}.tls.certresolver`]: 'letsencrypt',
      [`traefik.http.services.${containerName}.loadbalancer.server.port`]: '3000',
    },

    // 健康检查配置（时间单位：纳秒）
    Healthcheck: {
      Test: ['CMD', 'curl', '-f', 'http://localhost:3000/health'],
      Interval: 30_000_000_000,    // 30 秒
      Timeout: 10_000_000_000,     // 10 秒
      Retries: 3,
      StartPeriod: 15_000_000_000, // 15 秒启动宽限
    },

    // 资源限制
    HostConfig: {
      Memory: config.memoryLimitMB * 1024 * 1024,        // 字节
      MemorySwap: config.memoryLimitMB * 1024 * 1024 * 2, // 交换空间上限
      NanoCpus: config.cpuLimit * 1_000_000_000,          // 纳 CPU
      PidsLimit: 256,                                       // 进程数限制
      RestartPolicy: { Name: 'unless-stopped', MaximumRetryCount: 0 },

      // 网络隔离
      NetworkMode: networkName,

      // 卷挂载（租户数据隔离）
      Binds: [
        `agentpod-data-${config.tenantId}:/app/data:rw`,
        `agentpod-logs-${config.tenantId}:/app/logs:rw`,
      ],

      // 安全加固
      ReadonlyRootfs: true,
      CapDrop: ['ALL'],
      CapAdd: ['NET_BIND_SERVICE'],
      SecurityOpt: ['no-new-privileges:true'],
    },
  })

  return container
}
```

#### 容器启动、停止、删除

```typescript
async function startContainer(
  docker: Docker,
  containerId: string
): Promise<void> {
  const container = docker.getContainer(containerId)
  await container.start()
}

async function stopContainer(
  docker: Docker,
  containerId: string,
  timeoutSeconds: number = 30
): Promise<void> {
  const container = docker.getContainer(containerId)
  await container.stop({ t: timeoutSeconds })
}

async function removeContainer(
  docker: Docker,
  containerId: string,
  forceRemove: boolean = false
): Promise<void> {
  const container = docker.getContainer(containerId)
  await container.remove({ force: forceRemove, v: true }) // v: true 删除匿名卷
}
```

#### 容器状态检查

```typescript
interface ContainerState {
  readonly id: string
  readonly name: string
  readonly status: string
  readonly running: boolean
  readonly health: string | undefined
  readonly startedAt: string
  readonly tenantId: string
}

async function inspectContainer(
  docker: Docker,
  containerId: string
): Promise<ContainerState> {
  const container = docker.getContainer(containerId)
  const info = await container.inspect()

  return {
    id: info.Id,
    name: info.Name.replace(/^\//, ''),
    status: info.State.Status,
    running: info.State.Running,
    health: info.State.Health?.Status,
    startedAt: info.State.StartedAt,
    tenantId: info.Config.Labels['agentpod.tenant-id'] ?? '',
  }
}
```

### 1.4 标签过滤与服务发现

通过标签发现和管理所有 AgentPod 管理的容器：

```typescript
async function listManagedContainers(
  docker: Docker
): Promise<ReadonlyArray<Docker.ContainerInfo>> {
  const containers = await docker.listContainers({
    all: true, // 包含已停止的容器
    filters: {
      label: ['agentpod.managed=true'],
    },
  })

  return containers
}

async function findContainerByTenant(
  docker: Docker,
  tenantId: string
): Promise<Docker.ContainerInfo | undefined> {
  const containers = await docker.listContainers({
    all: true,
    filters: {
      label: [`agentpod.tenant-id=${tenantId}`],
    },
  })

  return containers[0]
}

async function listContainersByStatus(
  docker: Docker,
  status: 'running' | 'exited' | 'paused'
): Promise<ReadonlyArray<Docker.ContainerInfo>> {
  const containers = await docker.listContainers({
    all: true,
    filters: {
      label: ['agentpod.managed=true'],
      status: [status],
    },
  })

  return containers
}
```

### 1.5 卷管理（租户数据隔离）

```typescript
async function createTenantVolumes(
  docker: Docker,
  tenantId: string
): Promise<void> {
  const volumeNames = [
    `agentpod-data-${tenantId}`,
    `agentpod-logs-${tenantId}`,
  ]

  for (const name of volumeNames) {
    await docker.createVolume({
      Name: name,
      Labels: {
        'agentpod.tenant-id': tenantId,
        'agentpod.managed': 'true',
      },
    })
  }
}

async function removeTenantVolumes(
  docker: Docker,
  tenantId: string
): Promise<void> {
  const volumeNames = [
    `agentpod-data-${tenantId}`,
    `agentpod-logs-${tenantId}`,
  ]

  for (const name of volumeNames) {
    const volume = docker.getVolume(name)
    await volume.remove()
  }
}

async function listTenantVolumes(
  docker: Docker,
  tenantId: string
): Promise<ReadonlyArray<Docker.VolumeInspectInfo>> {
  const result = await docker.listVolumes({
    filters: {
      label: [`agentpod.tenant-id=${tenantId}`],
    },
  })

  return result.Volumes ?? []
}
```

### 1.6 网络管理（Bridge 网络隔离）

每个租户拥有独立的 bridge 网络，防止跨租户通信：

```typescript
async function createTenantNetwork(
  docker: Docker,
  tenantId: string
): Promise<Docker.Network> {
  const networkName = `agentpod-net-${tenantId}`

  const network = await docker.createNetwork({
    Name: networkName,
    Driver: 'bridge',
    Internal: false, // 允许外部访问（通过 Traefik）
    EnableIPv6: false,
    Labels: {
      'agentpod.tenant-id': tenantId,
      'agentpod.managed': 'true',
    },
    Options: {
      'com.docker.network.bridge.enable_icc': 'true',      // 同网络内容器互通
      'com.docker.network.bridge.enable_ip_masquerade': 'true',
    },
  })

  // 将 Traefik 容器接入此网络（让 Traefik 能路由到此租户的容器）
  const traefikContainers = await docker.listContainers({
    filters: { label: ['agentpod.role=traefik'] },
  })

  if (traefikContainers.length > 0) {
    const traefikContainer = docker.getContainer(traefikContainers[0].Id)
    await network.connect({ Container: traefikContainer.id })
  }

  return network
}

async function removeTenantNetwork(
  docker: Docker,
  tenantId: string
): Promise<void> {
  const networkName = `agentpod-net-${tenantId}`
  const network = docker.getNetwork(networkName)

  // 先断开所有连接的容器
  const info = await network.inspect()
  const containerIds = Object.keys(info.Containers ?? {})

  for (const containerId of containerIds) {
    await network.disconnect({ Container: containerId, Force: true })
  }

  await network.remove()
}
```

### 1.7 Docker 事件监听

用于响应式地感知容器状态变化（与调和循环配合）：

```typescript
async function watchDockerEvents(
  docker: Docker,
  onEvent: (event: Docker.DockerEvent) => void
): Promise<void> {
  const stream = await docker.getEvents({
    filters: {
      label: ['agentpod.managed=true'],
      type: ['container'],
      event: ['start', 'stop', 'die', 'health_status', 'destroy'],
    },
  })

  stream.on('data', (chunk: Buffer) => {
    try {
      const event = JSON.parse(chunk.toString())
      onEvent(event)
    } catch (error) {
      console.error('Failed to parse Docker event:', error)
    }
  })

  stream.on('error', (error: Error) => {
    console.error('Docker event stream error:', error)
  })
}
```

---

## 2. 调和循环（Reconciliation Loop）实现模式

### 2.1 核心概念

调和循环源自 Kubernetes 控制器模式，其核心思想是：

- **声明式**：用户定义「期望状态」（Desired State），系统自动驱向该状态
- **幂等性**：同一输入多次执行产生相同结果，无副作用
- **最终一致性**：系统持续努力使「实际状态」（Actual State）逼近「期望状态」
- **自愈能力**：即使外部干扰导致偏离，系统也会自动修复

在 AgentPod 场景中：
- **期望状态**：数据库中记录的租户配置（需要哪些容器、什么资源限制、什么镜像版本）
- **实际状态**：Docker 引擎中实际运行的容器状态
- **调和动作**：创建缺失容器、删除多余容器、更新配置不一致的容器

### 2.2 类型定义

```typescript
// 期望状态：来自数据库
interface DesiredTenantState {
  readonly tenantId: string
  readonly enabled: boolean
  readonly agentImage: string
  readonly agentImageTag: string
  readonly memoryLimitMB: number
  readonly cpuLimit: number
  readonly envVars: Record<string, string>
  readonly customDomain: string | undefined
  readonly updatedAt: Date
}

// 实际状态：来自 Docker 引擎
interface ActualTenantState {
  readonly tenantId: string
  readonly containerId: string | undefined
  readonly containerStatus: 'running' | 'stopped' | 'not_found' | 'unhealthy'
  readonly currentImage: string | undefined
  readonly currentMemoryLimit: number | undefined
  readonly networkExists: boolean
  readonly volumesExist: boolean
}

// 调和动作
type ReconcileAction =
  | { readonly type: 'create'; readonly tenantId: string }
  | { readonly type: 'start'; readonly tenantId: string; readonly containerId: string }
  | { readonly type: 'stop'; readonly tenantId: string; readonly containerId: string }
  | { readonly type: 'recreate'; readonly tenantId: string; readonly reason: string }
  | { readonly type: 'remove'; readonly tenantId: string }
  | { readonly type: 'noop'; readonly tenantId: string }

// 调和结果
interface ReconcileResult {
  readonly tenantId: string
  readonly action: ReconcileAction['type']
  readonly success: boolean
  readonly error: string | undefined
  readonly durationMs: number
}
```

### 2.3 状态比较器

```typescript
function computeReconcileAction(
  desired: DesiredTenantState | undefined,
  actual: ActualTenantState
): ReconcileAction {
  const tenantId = actual.tenantId ?? desired?.tenantId ?? ''

  // 情况 1：期望不存在但实际存在 → 删除
  if (desired === undefined || !desired.enabled) {
    if (actual.containerStatus !== 'not_found') {
      return { type: 'remove', tenantId }
    }
    return { type: 'noop', tenantId }
  }

  // 情况 2：期望存在但实际不存在 → 创建
  if (actual.containerStatus === 'not_found') {
    return { type: 'create', tenantId }
  }

  // 情况 3：容器已停止 → 启动
  if (actual.containerStatus === 'stopped') {
    return { type: 'start', tenantId, containerId: actual.containerId! }
  }

  // 情况 4：镜像版本不一致 → 重建
  const desiredImage = `${desired.agentImage}:${desired.agentImageTag}`
  if (actual.currentImage !== desiredImage) {
    return {
      type: 'recreate',
      tenantId,
      reason: `image mismatch: ${actual.currentImage} → ${desiredImage}`,
    }
  }

  // 情况 5：资源限制不一致 → 重建
  const desiredMemory = desired.memoryLimitMB * 1024 * 1024
  if (actual.currentMemoryLimit !== desiredMemory) {
    return {
      type: 'recreate',
      tenantId,
      reason: `memory limit mismatch: ${actual.currentMemoryLimit} → ${desiredMemory}`,
    }
  }

  // 情况 6：容器不健康 → 重建
  if (actual.containerStatus === 'unhealthy') {
    return {
      type: 'recreate',
      tenantId,
      reason: 'container unhealthy',
    }
  }

  // 情况 7：状态一致 → 无操作
  return { type: 'noop', tenantId }
}
```

### 2.4 调和器实现

```typescript
class TenantReconciler {
  private readonly docker: Docker
  private readonly db: TenantRepository
  private readonly logger: Logger
  private reconcileTimer: NodeJS.Timeout | undefined
  private isReconciling: boolean = false

  constructor(docker: Docker, db: TenantRepository, logger: Logger) {
    this.docker = docker
    this.db = db
    this.logger = logger
  }

  // 启动调和循环（混合模式：定时 + 事件驱动）
  async start(intervalMs: number = 60_000): Promise<void> {
    // 1. 启动定时调和（兜底机制，确保最终一致）
    this.reconcileTimer = setInterval(() => {
      this.triggerReconcile('timer')
    }, intervalMs)

    // 2. 启动事件驱动调和（快速响应变化）
    await watchDockerEvents(this.docker, (event) => {
      this.logger.info('Docker event received', {
        action: event.Action,
        actor: event.Actor?.Attributes?.name,
      })
      this.triggerReconcile('event')
    })

    // 3. 立即执行一次初始调和
    await this.triggerReconcile('startup')

    this.logger.info('Reconciler started', { intervalMs })
  }

  stop(): void {
    if (this.reconcileTimer !== undefined) {
      clearInterval(this.reconcileTimer)
      this.reconcileTimer = undefined
    }
  }

  // 防止并发调和
  private async triggerReconcile(
    trigger: 'timer' | 'event' | 'startup' | 'manual'
  ): Promise<void> {
    if (this.isReconciling) {
      this.logger.debug('Reconcile already in progress, skipping', { trigger })
      return
    }

    this.isReconciling = true
    const startTime = Date.now()

    try {
      const results = await this.reconcileAll()
      const duration = Date.now() - startTime

      const summary = {
        trigger,
        duration,
        total: results.length,
        actions: results.reduce(
          (acc, r) => ({ ...acc, [r.action]: (acc[r.action] ?? 0) + 1 }),
          {} as Record<string, number>
        ),
        errors: results.filter((r) => !r.success).length,
      }

      this.logger.info('Reconcile cycle complete', summary)
    } catch (error) {
      this.logger.error('Reconcile cycle failed', { trigger, error })
    } finally {
      this.isReconciling = false
    }
  }

  // 全量调和
  private async reconcileAll(): Promise<ReadonlyArray<ReconcileResult>> {
    // 1. 获取期望状态（来自数据库）
    const desiredStates = await this.db.listAllTenants()
    const desiredMap = new Map(
      desiredStates.map((d) => [d.tenantId, d])
    )

    // 2. 获取实际状态（来自 Docker）
    const actualStates = await this.getActualStates()
    const actualMap = new Map(
      actualStates.map((a) => [a.tenantId, a])
    )

    // 3. 合并所有需要处理的租户 ID
    const allTenantIds = new Set([
      ...desiredMap.keys(),
      ...actualMap.keys(),
    ])

    // 4. 逐租户调和
    const results: ReconcileResult[] = []

    for (const tenantId of allTenantIds) {
      const desired = desiredMap.get(tenantId)
      const actual = actualMap.get(tenantId) ?? {
        tenantId,
        containerId: undefined,
        containerStatus: 'not_found' as const,
        currentImage: undefined,
        currentMemoryLimit: undefined,
        networkExists: false,
        volumesExist: false,
      }

      const result = await this.reconcileTenant(desired, actual)
      results.push(result)
    }

    return results
  }

  // 单租户调和
  private async reconcileTenant(
    desired: DesiredTenantState | undefined,
    actual: ActualTenantState
  ): Promise<ReconcileResult> {
    const action = computeReconcileAction(desired, actual)
    const startTime = Date.now()

    try {
      await this.executeAction(action, desired, actual)

      return {
        tenantId: action.tenantId,
        action: action.type,
        success: true,
        error: undefined,
        durationMs: Date.now() - startTime,
      }
    } catch (error) {
      const errorMessage = error instanceof Error
        ? error.message
        : String(error)

      this.logger.error('Reconcile action failed', {
        tenantId: action.tenantId,
        action: action.type,
        error: errorMessage,
      })

      return {
        tenantId: action.tenantId,
        action: action.type,
        success: false,
        error: errorMessage,
        durationMs: Date.now() - startTime,
      }
    }
  }

  // 执行调和动作
  private async executeAction(
    action: ReconcileAction,
    desired: DesiredTenantState | undefined,
    actual: ActualTenantState
  ): Promise<void> {
    switch (action.type) {
      case 'create': {
        if (desired === undefined) {
          throw new Error('Cannot create without desired state')
        }
        // 确保网络和卷存在
        if (!actual.networkExists) {
          await createTenantNetwork(this.docker, desired.tenantId)
        }
        if (!actual.volumesExist) {
          await createTenantVolumes(this.docker, desired.tenantId)
        }
        // 创建并启动容器
        const container = await createTenantContainer(this.docker, {
          tenantId: desired.tenantId,
          agentImage: `${desired.agentImage}:${desired.agentImageTag}`,
          memoryLimitMB: desired.memoryLimitMB,
          cpuLimit: desired.cpuLimit,
          envVars: desired.envVars,
        })
        await container.start()
        break
      }

      case 'start': {
        await startContainer(this.docker, action.containerId)
        break
      }

      case 'stop': {
        await stopContainer(this.docker, action.containerId)
        break
      }

      case 'recreate': {
        // 先停止并删除旧容器
        if (actual.containerId !== undefined) {
          await stopContainer(this.docker, actual.containerId)
          await removeContainer(this.docker, actual.containerId)
        }
        // 再创建新容器
        if (desired !== undefined) {
          const container = await createTenantContainer(this.docker, {
            tenantId: desired.tenantId,
            agentImage: `${desired.agentImage}:${desired.agentImageTag}`,
            memoryLimitMB: desired.memoryLimitMB,
            cpuLimit: desired.cpuLimit,
            envVars: desired.envVars,
          })
          await container.start()
        }
        break
      }

      case 'remove': {
        if (actual.containerId !== undefined) {
          await stopContainer(this.docker, actual.containerId)
          await removeContainer(this.docker, actual.containerId)
        }
        await removeTenantNetwork(this.docker, action.tenantId)
        await removeTenantVolumes(this.docker, action.tenantId)
        break
      }

      case 'noop':
        break
    }
  }

  // 获取所有 AgentPod 管理容器的实际状态
  private async getActualStates(): Promise<ReadonlyArray<ActualTenantState>> {
    const containers = await listManagedContainers(this.docker)

    const states: ActualTenantState[] = []

    for (const containerInfo of containers) {
      const tenantId = containerInfo.Labels['agentpod.tenant-id']
      if (tenantId === undefined) continue

      const container = this.docker.getContainer(containerInfo.Id)
      const inspection = await container.inspect()

      const healthStatus = inspection.State.Health?.Status
      let containerStatus: ActualTenantState['containerStatus']

      if (!inspection.State.Running) {
        containerStatus = 'stopped'
      } else if (healthStatus === 'unhealthy') {
        containerStatus = 'unhealthy'
      } else {
        containerStatus = 'running'
      }

      // 检查网络和卷是否存在
      const networkExists = await this.networkExists(tenantId)
      const volumesExist = await this.volumesExist(tenantId)

      states.push({
        tenantId,
        containerId: containerInfo.Id,
        containerStatus,
        currentImage: inspection.Config.Image,
        currentMemoryLimit: inspection.HostConfig.Memory ?? undefined,
        networkExists,
        volumesExist,
      })
    }

    return states
  }

  private async networkExists(tenantId: string): Promise<boolean> {
    try {
      const network = this.docker.getNetwork(`agentpod-net-${tenantId}`)
      await network.inspect()
      return true
    } catch {
      return false
    }
  }

  private async volumesExist(tenantId: string): Promise<boolean> {
    try {
      const dataVol = this.docker.getVolume(`agentpod-data-${tenantId}`)
      await dataVol.inspect()
      return true
    } catch {
      return false
    }
  }
}
```

### 2.5 重试策略与指数退避

```typescript
interface RetryConfig {
  readonly maxRetries: number
  readonly baseDelayMs: number
  readonly maxDelayMs: number
  readonly backoffMultiplier: number
}

const DEFAULT_RETRY_CONFIG: RetryConfig = {
  maxRetries: 5,
  baseDelayMs: 1_000,
  maxDelayMs: 60_000,
  backoffMultiplier: 2,
}

async function withRetry<T>(
  operation: () => Promise<T>,
  config: RetryConfig = DEFAULT_RETRY_CONFIG,
  logger: Logger
): Promise<T> {
  let lastError: Error | undefined
  let delay = config.baseDelayMs

  for (let attempt = 0; attempt <= config.maxRetries; attempt++) {
    try {
      return await operation()
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error))

      if (attempt === config.maxRetries) {
        break
      }

      // 添加抖动（jitter）防止雷群效应
      const jitter = Math.random() * delay * 0.3
      const actualDelay = Math.min(delay + jitter, config.maxDelayMs)

      logger.warn('Operation failed, retrying', {
        attempt: attempt + 1,
        maxRetries: config.maxRetries,
        nextRetryMs: actualDelay,
        error: lastError.message,
      })

      await new Promise((resolve) => setTimeout(resolve, actualDelay))
      delay = delay * config.backoffMultiplier
    }
  }

  throw new Error(
    `Operation failed after ${config.maxRetries} retries: ${lastError?.message}`
  )
}
```

### 2.6 定时 vs 事件驱动：何时使用哪种

| 维度 | 定时调和（Timer-based） | 事件驱动（Event-driven） |
|------|------------------------|-------------------------|
| **延迟** | 受轮询间隔限制（秒~分钟级） | 近实时响应（毫秒级） |
| **可靠性** | 高：即使事件丢失也能最终收敛 | 中：事件可能丢失或乱序 |
| **资源消耗** | 每次全量扫描，负载可预测 | 按需触发，空闲时无消耗 |
| **适用场景** | 兜底保障、数据一致性审计 | 用户操作即时反馈 |
| **AgentPod 建议** | 每 60 秒一次 | 监听 Docker 事件 + API 触发 |

**最佳实践：混合模式**——事件驱动提供即时响应，定时调和提供最终一致性保障。

---

## 3. Traefik Docker Provider 配置详解

### 3.1 概述

[Traefik](https://doc.traefik.io/traefik/) 是 AgentPod 推荐的反向代理和负载均衡器。通过 Docker Provider，Traefik 能自动发现带有特定标签的容器并动态配置路由，无需重启或手动更新配置文件。

核心优势：
- **零配置路由**：容器标签即路由规则，新租户容器启动后自动可访问
- **自动 HTTPS**：内置 Let's Encrypt 集成，支持通配符证书
- **WebSocket 透传**：无需额外配置，自动处理 WebSocket 升级
- **Docker 原生**：监听 Docker socket 事件，实时更新路由

### 3.2 Traefik 静态配置

`traefik.yml`（静态配置文件）：

```yaml
# API 和 Dashboard
api:
  dashboard: true
  insecure: false  # 生产环境禁用不安全的 Dashboard

# 入口点定义
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
    http:
      tls:
        certResolver: letsencrypt
        domains:
          - main: "agents.example.com"
            sans:
              - "*.agents.example.com"

# Let's Encrypt 证书解析器
certificatesResolvers:
  letsencrypt:
    acme:
      email: admin@example.com
      storage: /letsencrypt/acme.json
      # DNS-01 挑战（通配符证书必须使用 DNS 挑战）
      dnsChallenge:
        provider: cloudflare
        delayBeforeCheck: 10
        resolvers:
          - "1.1.1.1:53"
          - "8.8.8.8:53"

# Docker Provider 配置
providers:
  docker:
    endpoint: "unix:///var/run/docker.sock"
    exposedByDefault: false          # 只暴露有 traefik.enable=true 标签的容器
    watch: true                       # 监听 Docker 事件
    network: agentpod-proxy          # Traefik 默认使用的网络

# 日志
log:
  level: INFO
  filePath: /var/log/traefik/traefik.log

accessLog:
  filePath: /var/log/traefik/access.log
  bufferingSize: 100

# 健康检查
ping:
  entryPoint: web
```

### 3.3 Traefik Docker Compose 部署

```yaml
version: "3.9"

services:
  traefik:
    image: traefik:v3.3
    container_name: agentpod-traefik
    restart: unless-stopped
    ports:
      - "80:80"
      - "443:443"
    volumes:
      - /var/run/docker.sock:/var/run/docker.sock:ro   # Docker socket（只读）
      - ./traefik.yml:/etc/traefik/traefik.yml:ro      # 静态配置
      - traefik-letsencrypt:/letsencrypt                # 证书持久化
      - traefik-logs:/var/log/traefik                   # 日志持久化
    environment:
      - CF_API_EMAIL=${CLOUDFLARE_EMAIL}
      - CF_DNS_API_TOKEN=${CLOUDFLARE_API_TOKEN}
    labels:
      - "agentpod.role=traefik"
      - "agentpod.managed=true"
      # Dashboard 路由（仅管理员访问）
      - "traefik.enable=true"
      - "traefik.http.routers.dashboard.rule=Host(`traefik.agents.example.com`)"
      - "traefik.http.routers.dashboard.entrypoints=websecure"
      - "traefik.http.routers.dashboard.tls.certresolver=letsencrypt"
      - "traefik.http.routers.dashboard.service=api@internal"
      - "traefik.http.routers.dashboard.middlewares=auth"
      # BasicAuth 中间件
      - "traefik.http.middlewares.auth.basicauth.users=${TRAEFIK_DASHBOARD_AUTH}"
    networks:
      - agentpod-proxy

networks:
  agentpod-proxy:
    name: agentpod-proxy
    driver: bridge

volumes:
  traefik-letsencrypt:
  traefik-logs:
```

### 3.4 租户容器的动态路由标签

以下是 AgentPod 为每个租户容器设置的 Traefik 标签模板：

```typescript
function buildTraefikLabels(
  tenantId: string,
  config: {
    readonly domain: string        // 如 "agents.example.com"
    readonly servicePort: number   // Agent 容器内部端口
    readonly customDomain: string | undefined
    readonly rateLimitAvg: number  // 每秒平均请求数
    readonly rateLimitBurst: number
  }
): Record<string, string> {
  const routerName = `agent-${tenantId}`
  const serviceName = `agent-${tenantId}`
  const subdomain = `${tenantId}.${config.domain}`

  // 路由规则：支持子域名 + 可选自定义域名
  const hostRules = config.customDomain !== undefined
    ? `Host(\`${subdomain}\`) || Host(\`${config.customDomain}\`)`
    : `Host(\`${subdomain}\`)`

  return {
    'traefik.enable': 'true',

    // HTTP 路由器
    [`traefik.http.routers.${routerName}.rule`]: hostRules,
    [`traefik.http.routers.${routerName}.entrypoints`]: 'websecure',
    [`traefik.http.routers.${routerName}.tls.certresolver`]: 'letsencrypt',
    [`traefik.http.routers.${routerName}.middlewares`]:
      `ratelimit-${tenantId}@docker,headers-${tenantId}@docker`,

    // 服务端口
    [`traefik.http.services.${serviceName}.loadbalancer.server.port`]:
      String(config.servicePort),

    // 健康检查（Traefik 级别）
    [`traefik.http.services.${serviceName}.loadbalancer.healthcheck.path`]:
      '/health',
    [`traefik.http.services.${serviceName}.loadbalancer.healthcheck.interval`]:
      '10s',
    [`traefik.http.services.${serviceName}.loadbalancer.healthcheck.timeout`]:
      '3s',

    // 速率限制中间件
    [`traefik.http.middlewares.ratelimit-${tenantId}.ratelimit.average`]:
      String(config.rateLimitAvg),
    [`traefik.http.middlewares.ratelimit-${tenantId}.ratelimit.burst`]:
      String(config.rateLimitBurst),
    [`traefik.http.middlewares.ratelimit-${tenantId}.ratelimit.period`]: '1s',

    // 安全头中间件
    [`traefik.http.middlewares.headers-${tenantId}.headers.frameDeny`]: 'true',
    [`traefik.http.middlewares.headers-${tenantId}.headers.browserXssFilter`]: 'true',
    [`traefik.http.middlewares.headers-${tenantId}.headers.contentTypeNosniff`]: 'true',
    [`traefik.http.middlewares.headers-${tenantId}.headers.customResponseHeaders.X-Tenant-Id`]:
      tenantId,

    // Docker 网络指定
    'traefik.docker.network': 'agentpod-proxy',
  }
}
```

### 3.5 WebSocket 支持

Traefik v3 原生支持 WebSocket，**无需额外配置**。当客户端发送带有 `Upgrade: websocket` 头的请求时，Traefik 自动处理协议升级。

关键要点：

1. **自动检测**：Traefik 识别 WebSocket 升级请求并透传
2. **头部保留**：`Origin`、`Sec-WebSocket-Key`、`Sec-WebSocket-Version` 等关键头部自动保留
3. **TLS 终结**：客户端使用 `wss://`，Traefik 终结 TLS 后以 `ws://` 连接后端

唯一需要注意的是超时配置。WebSocket 连接通常是长连接，需调整 transport 超时：

```yaml
# 在 traefik.yml 中配置
serversTransport:
  forwardingTimeouts:
    dialTimeout: 30s
    responseHeaderTimeout: 0s      # 0 = 无超时（WebSocket 长连接需要）
    idleConnTimeout: 90s
```

或者通过容器标签为特定服务配置：

```
traefik.http.services.agent-xxx.loadbalancer.server.scheme=http
traefik.http.services.agent-xxx.loadbalancer.passhostheader=true
```

### 3.6 通配符子域名路由

AgentPod 采用 `{tenantId}.agents.example.com` 模式为每个租户分配子域名。

DNS 配置：

```
*.agents.example.com.  IN  A     <SERVER_IP>
*.agents.example.com.  IN  AAAA  <SERVER_IPv6>
```

通配符证书需要 DNS-01 挑战。支持的 DNS 提供商包括 Cloudflare、Route53、Google Cloud DNS 等。示例（Cloudflare）：

```yaml
certificatesResolvers:
  letsencrypt:
    acme:
      email: admin@example.com
      storage: /letsencrypt/acme.json
      dnsChallenge:
        provider: cloudflare
```

环境变量：

```bash
CF_API_EMAIL=admin@example.com
CF_DNS_API_TOKEN=xxxxxxxxxxxxxxxxxxxx
```

---

## 4. PostgreSQL 多租户 Schema 设计

### 4.1 架构选型

| 模式 | 隔离级别 | 运维复杂度 | 扩展性 | AgentPod 适用性 |
|------|---------|-----------|--------|----------------|
| 数据库级隔离 | 最高 | 最高（每租户一个DB） | 差 | 不推荐 |
| Schema 级隔离 | 高 | 中等（每租户一个schema） | 一般 | 中小规模可考虑 |
| **共享表 + RLS** | **中** | **最低** | **最好** | **推荐** |

AgentPod 推荐「共享表 + Row-Level Security（行级安全）」模式：

- 所有租户数据在同一组表中，通过 `tenant_id` 列区分
- PostgreSQL RLS 在数据库层强制执行租户隔离
- 应用代码无需手动添加 `WHERE tenant_id = ?`，数据库自动过滤
- 即使应用层出现 bug，数据也不会跨租户泄露

### 4.2 核心 Schema 定义

```sql
-- ============================================
-- 基础设施
-- ============================================

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ============================================
-- 租户表（不受 RLS 保护，由管理员操作）
-- ============================================

CREATE TABLE tenants (
    id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name        TEXT NOT NULL,
    slug        TEXT NOT NULL UNIQUE,  -- 用作子域名
    plan        TEXT NOT NULL DEFAULT 'free'
                CHECK (plan IN ('free', 'pro', 'enterprise')),
    status      TEXT NOT NULL DEFAULT 'active'
                CHECK (status IN ('active', 'suspended', 'deleted')),
    settings    JSONB NOT NULL DEFAULT '{}',
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_tenants_slug ON tenants(slug);
CREATE INDEX idx_tenants_status ON tenants(status);

-- ============================================
-- Agent 配置表（受 RLS 保护）
-- ============================================

CREATE TABLE agent_configs (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id       UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    name            TEXT NOT NULL,
    agent_image     TEXT NOT NULL DEFAULT 'agentpod/default-agent',
    agent_image_tag TEXT NOT NULL DEFAULT 'latest',
    memory_limit_mb INTEGER NOT NULL DEFAULT 512,
    cpu_limit       NUMERIC(4,2) NOT NULL DEFAULT 0.50,
    enabled         BOOLEAN NOT NULL DEFAULT true,

    -- JSONB 灵活存储：环境变量、自定义配置等
    env_vars        JSONB NOT NULL DEFAULT '{}',
    custom_config   JSONB NOT NULL DEFAULT '{}',

    -- 自定义域名
    custom_domain   TEXT,

    -- 速率限制
    rate_limit_avg   INTEGER NOT NULL DEFAULT 100,
    rate_limit_burst INTEGER NOT NULL DEFAULT 200,

    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT unique_tenant_agent_name UNIQUE (tenant_id, name)
);

-- tenant_id 作为索引前缀，优化 RLS 查询性能
CREATE INDEX idx_agent_configs_tenant ON agent_configs(tenant_id);

-- ============================================
-- API 密钥表（加密存储）
-- ============================================

CREATE TABLE api_keys (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id       UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    name            TEXT NOT NULL,
    -- 存储前缀用于展示（如 "sk-...abc"）
    key_prefix      TEXT NOT NULL,
    -- 密钥哈希（用于验证）
    key_hash        TEXT NOT NULL,
    -- 加密的完整密钥（仅在需要代理调用时解密）
    encrypted_key   BYTEA,
    scopes          JSONB NOT NULL DEFAULT '["agent:invoke"]',
    expires_at      TIMESTAMPTZ,
    last_used_at    TIMESTAMPTZ,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT unique_tenant_key_name UNIQUE (tenant_id, name)
);

CREATE INDEX idx_api_keys_tenant ON api_keys(tenant_id);
CREATE INDEX idx_api_keys_hash ON api_keys(key_hash);

-- ============================================
-- 敏感凭据表（对称加密存储）
-- ============================================

CREATE TABLE tenant_secrets (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id       UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    secret_name     TEXT NOT NULL,
    -- 使用 pgcrypto 对称加密存储
    encrypted_value BYTEA NOT NULL,
    metadata        JSONB NOT NULL DEFAULT '{}',
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT unique_tenant_secret UNIQUE (tenant_id, secret_name)
);

CREATE INDEX idx_tenant_secrets_tenant ON tenant_secrets(tenant_id);

-- ============================================
-- Agent 运行日志表
-- ============================================

CREATE TABLE agent_runs (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id       UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    agent_config_id UUID NOT NULL REFERENCES agent_configs(id) ON DELETE CASCADE,
    status          TEXT NOT NULL DEFAULT 'pending'
                    CHECK (status IN ('pending', 'running', 'completed', 'failed', 'cancelled')),
    input           JSONB,
    output          JSONB,
    error_message   TEXT,
    tokens_used     INTEGER DEFAULT 0,
    duration_ms     INTEGER,
    started_at      TIMESTAMPTZ,
    completed_at    TIMESTAMPTZ,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_agent_runs_tenant ON agent_runs(tenant_id);
CREATE INDEX idx_agent_runs_agent ON agent_runs(agent_config_id);
CREATE INDEX idx_agent_runs_status ON agent_runs(tenant_id, status);
CREATE INDEX idx_agent_runs_created ON agent_runs(tenant_id, created_at DESC);

-- ============================================
-- 使用量计量表
-- ============================================

CREATE TABLE usage_metrics (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id       UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    metric_type     TEXT NOT NULL
                    CHECK (metric_type IN ('api_calls', 'tokens', 'compute_seconds', 'storage_bytes')),
    metric_value    BIGINT NOT NULL DEFAULT 0,
    period_start    TIMESTAMPTZ NOT NULL,
    period_end      TIMESTAMPTZ NOT NULL,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT unique_tenant_metric_period
        UNIQUE (tenant_id, metric_type, period_start)
);

CREATE INDEX idx_usage_metrics_tenant_period
    ON usage_metrics(tenant_id, period_start DESC);
```

### 4.3 Row-Level Security 配置

```sql
-- ============================================
-- 创建应用角色
-- ============================================

CREATE ROLE agentpod_app LOGIN PASSWORD 'CHANGE_ME_USE_ENV_VAR';
GRANT CONNECT ON DATABASE agentpod TO agentpod_app;
GRANT USAGE ON SCHEMA public TO agentpod_app;

-- 授予对受保护表的操作权限
GRANT SELECT, INSERT, UPDATE, DELETE ON
    agent_configs, api_keys, tenant_secrets,
    agent_runs, usage_metrics
TO agentpod_app;

-- 授予序列使用权限
GRANT USAGE ON ALL SEQUENCES IN SCHEMA public TO agentpod_app;

-- tenants 表：应用角色只能读取自己的租户信息
GRANT SELECT ON tenants TO agentpod_app;

-- ============================================
-- 启用 RLS
-- ============================================

ALTER TABLE agent_configs ENABLE ROW LEVEL SECURITY;
ALTER TABLE api_keys ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenant_secrets ENABLE ROW LEVEL SECURITY;
ALTER TABLE agent_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE usage_metrics ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenants ENABLE ROW LEVEL SECURITY;

-- ============================================
-- 定义 RLS 策略
-- ============================================

-- 通用策略模板：使用 app.current_tenant 会话变量
-- USING：控制 SELECT/UPDATE/DELETE 可见的行
-- WITH CHECK：控制 INSERT/UPDATE 可写入的行

CREATE POLICY tenant_isolation ON agent_configs
    FOR ALL
    TO agentpod_app
    USING (tenant_id = current_setting('app.current_tenant')::UUID)
    WITH CHECK (tenant_id = current_setting('app.current_tenant')::UUID);

CREATE POLICY tenant_isolation ON api_keys
    FOR ALL
    TO agentpod_app
    USING (tenant_id = current_setting('app.current_tenant')::UUID)
    WITH CHECK (tenant_id = current_setting('app.current_tenant')::UUID);

CREATE POLICY tenant_isolation ON tenant_secrets
    FOR ALL
    TO agentpod_app
    USING (tenant_id = current_setting('app.current_tenant')::UUID)
    WITH CHECK (tenant_id = current_setting('app.current_tenant')::UUID);

CREATE POLICY tenant_isolation ON agent_runs
    FOR ALL
    TO agentpod_app
    USING (tenant_id = current_setting('app.current_tenant')::UUID)
    WITH CHECK (tenant_id = current_setting('app.current_tenant')::UUID);

CREATE POLICY tenant_isolation ON usage_metrics
    FOR ALL
    TO agentpod_app
    USING (tenant_id = current_setting('app.current_tenant')::UUID)
    WITH CHECK (tenant_id = current_setting('app.current_tenant')::UUID);

CREATE POLICY tenant_isolation ON tenants
    FOR SELECT
    TO agentpod_app
    USING (id = current_setting('app.current_tenant')::UUID);
```

### 4.4 加密存储敏感数据

使用 `pgcrypto` 对 API 密钥和令牌进行对称加密存储：

```sql
-- ============================================
-- 加密/解密辅助函数
-- ============================================

-- 加密密钥不应硬编码，应通过会话变量传入
-- 应用层在每次连接时设置: SET app.encryption_key = '...'

-- 存储加密后的 secret
CREATE OR REPLACE FUNCTION store_tenant_secret(
    p_tenant_id UUID,
    p_secret_name TEXT,
    p_secret_value TEXT,
    p_metadata JSONB DEFAULT '{}'
) RETURNS UUID AS $$
DECLARE
    v_id UUID;
    v_key TEXT;
BEGIN
    v_key := current_setting('app.encryption_key');

    INSERT INTO tenant_secrets (tenant_id, secret_name, encrypted_value, metadata)
    VALUES (
        p_tenant_id,
        p_secret_name,
        pgp_sym_encrypt(p_secret_value, v_key, 'cipher-algo=aes256'),
        p_metadata
    )
    ON CONFLICT (tenant_id, secret_name)
    DO UPDATE SET
        encrypted_value = pgp_sym_encrypt(p_secret_value, v_key, 'cipher-algo=aes256'),
        metadata = p_metadata,
        updated_at = NOW()
    RETURNING id INTO v_id;

    RETURN v_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 读取解密后的 secret
CREATE OR REPLACE FUNCTION read_tenant_secret(
    p_tenant_id UUID,
    p_secret_name TEXT
) RETURNS TEXT AS $$
DECLARE
    v_encrypted BYTEA;
    v_key TEXT;
BEGIN
    v_key := current_setting('app.encryption_key');

    SELECT encrypted_value INTO v_encrypted
    FROM tenant_secrets
    WHERE tenant_id = p_tenant_id
      AND secret_name = p_secret_name;

    IF v_encrypted IS NULL THEN
        RETURN NULL;
    END IF;

    RETURN pgp_sym_decrypt(v_encrypted, v_key);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
```

### 4.5 应用层集成（TypeScript）

```typescript
import { Pool, PoolClient } from 'pg'

interface DatabaseConfig {
  readonly connectionString: string
  readonly maxConnections: number
  readonly encryptionKey: string
}

class TenantDatabase {
  private readonly pool: Pool
  private readonly encryptionKey: string

  constructor(config: DatabaseConfig) {
    this.pool = new Pool({
      connectionString: config.connectionString,
      max: config.maxConnections,
    })
    this.encryptionKey = config.encryptionKey
  }

  // 核心方法：获取带租户上下文的数据库连接
  async withTenantContext<T>(
    tenantId: string,
    operation: (client: PoolClient) => Promise<T>
  ): Promise<T> {
    const client = await this.pool.connect()

    try {
      // 设置租户上下文——RLS 策略依赖此变量
      await client.query('SET app.current_tenant = $1', [tenantId])
      // 设置加密密钥——用于 secret 加解密
      await client.query('SET app.encryption_key = $1', [this.encryptionKey])

      const result = await operation(client)
      return result
    } finally {
      // 释放连接前重置上下文，防止跨租户泄露
      await client.query('RESET app.current_tenant')
      await client.query('RESET app.encryption_key')
      client.release()
    }
  }

  // 管理操作（不受 RLS 约束，使用超级用户连接）
  async withAdminContext<T>(
    operation: (client: PoolClient) => Promise<T>
  ): Promise<T> {
    const client = await this.pool.connect()

    try {
      // 管理员连接不设置 app.current_tenant
      // 确保使用的数据库角色是表的 owner（不受 RLS 限制）
      const result = await operation(client)
      return result
    } finally {
      client.release()
    }
  }
}

// 使用示例
async function getAgentConfigs(
  db: TenantDatabase,
  tenantId: string
): Promise<ReadonlyArray<AgentConfig>> {
  return db.withTenantContext(tenantId, async (client) => {
    // 无需 WHERE tenant_id = ? —— RLS 自动过滤
    const { rows } = await client.query(`
      SELECT id, name, agent_image, agent_image_tag,
             memory_limit_mb, cpu_limit, enabled,
             env_vars, custom_config, custom_domain,
             rate_limit_avg, rate_limit_burst
      FROM agent_configs
      ORDER BY name
    `)
    return rows
  })
}

// 存储 secret 示例
async function storeTenantApiKey(
  db: TenantDatabase,
  tenantId: string,
  secretName: string,
  secretValue: string
): Promise<string> {
  return db.withTenantContext(tenantId, async (client) => {
    const { rows } = await client.query(
      `SELECT store_tenant_secret($1, $2, $3) AS id`,
      [tenantId, secretName, secretValue]
    )
    return rows[0].id
  })
}
```

### 4.6 JSONB 灵活配置存储

JSONB 列非常适合存储每租户的可变配置：

```sql
-- 查询 JSONB 内的特定字段
SELECT id, name,
       env_vars->>'OPENAI_API_MODEL' AS model,
       custom_config->'features'->>'streaming' AS streaming_enabled
FROM agent_configs
WHERE custom_config @> '{"features": {"streaming": true}}';

-- 更新 JSONB 中的特定字段（不可变式更新）
UPDATE agent_configs
SET custom_config = jsonb_set(
    custom_config,
    '{features,maxTokens}',
    '4096'::jsonb
),
    updated_at = NOW()
WHERE id = $1;

-- 为 JSONB 查询创建 GIN 索引
CREATE INDEX idx_agent_configs_custom_config
    ON agent_configs USING GIN (custom_config jsonb_path_ops);

CREATE INDEX idx_agent_configs_env_vars
    ON agent_configs USING GIN (env_vars);
```

### 4.7 自动更新时间戳

```sql
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_tenants_updated_at
    BEFORE UPDATE ON tenants
    FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER trigger_agent_configs_updated_at
    BEFORE UPDATE ON agent_configs
    FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER trigger_tenant_secrets_updated_at
    BEFORE UPDATE ON tenant_secrets
    FOR EACH ROW EXECUTE FUNCTION update_updated_at();
```

---

## 5. 综合建议：AgentPod 的最佳实践组合

### 5.1 整体架构

```
                      ┌─────────────────────────────────┐
                      │           用户请求               │
                      │  tenant-a.agents.example.com     │
                      └──────────────┬──────────────────┘
                                     │
                      ┌──────────────▼──────────────────┐
                      │         Traefik v3               │
                      │   (自动路由 + TLS 终结 +         │
                      │    WebSocket 透传 + 速率限制)     │
                      └──────────────┬──────────────────┘
                                     │ 根据容器标签路由
                    ┌────────────────┼────────────────┐
                    │                │                │
           ┌────────▼──────┐ ┌──────▼────────┐ ┌────▼──────────┐
           │  Agent 容器 A  │ │ Agent 容器 B  │ │ Agent 容器 C  │
           │  (tenant-a)   │ │ (tenant-b)   │ │ (tenant-c)   │
           │  bridge-net-a │ │ bridge-net-b │ │ bridge-net-c │
           │  vol-data-a   │ │ vol-data-b   │ │ vol-data-c   │
           └───────────────┘ └──────────────┘ └──────────────┘
                    │                │                │
           ┌────────▼────────────────▼────────────────▼────┐
           │              AgentPod 控制平面                  │
           │  ┌──────────────────────────────────────┐     │
           │  │     Reconciliation Loop              │     │
           │  │  (期望状态 vs 实际状态 → 调和动作)      │     │
           │  └──────────────────────────────────────┘     │
           │  ┌──────────────────────────────────────┐     │
           │  │     Docker API (dockerode)            │     │
           │  │  (容器/网络/卷 CRUD + 事件监听)        │     │
           │  └──────────────────────────────────────┘     │
           └──────────────────────┬────────────────────────┘
                                  │
           ┌──────────────────────▼────────────────────────┐
           │          PostgreSQL (共享表 + RLS)             │
           │  ┌─────────┐ ┌──────────┐ ┌──────────────┐   │
           │  │ tenants  │ │ configs  │ │ secrets      │   │
           │  │          │ │ (RLS)    │ │ (加密+RLS)    │   │
           │  └─────────┘ └──────────┘ └──────────────┘   │
           └───────────────────────────────────────────────┘
```

### 5.2 核心设计原则

1. **声明式优于命令式**
   - 用户通过 API 修改数据库中的期望状态
   - 调和循环自动驱动系统趋近期望状态
   - 永远不要直接操作 Docker（除了通过调和器）

2. **数据库即真相源（Single Source of Truth）**
   - PostgreSQL 存储所有租户配置和期望状态
   - Docker 是执行层，不是数据层
   - 即使 Docker 容器全部丢失，也能从数据库重建

3. **深度防御（Defense in Depth）**
   - **网络层**：每租户独立 bridge 网络
   - **容器层**：资源限制、只读根文件系统、能力降权
   - **数据库层**：RLS 强制行级隔离
   - **应用层**：会话级租户上下文
   - **代理层**：Traefik 速率限制和安全头

4. **幂等与可重试**
   - 所有操作设计为幂等：创建前检查是否存在，更新前比较状态
   - 失败后自动重试（指数退避 + 抖动）
   - 调和循环每周期全量比对，自愈任何漂移

5. **零信任容器标签**
   - 标签既是元数据也是配置（Traefik 路由）
   - 标签驱动服务发现和管理
   - 所有 AgentPod 管理的资源打上 `agentpod.managed=true`

### 5.3 租户生命周期流程

```
创建租户 → DB 写入 → 调和器检测 → 创建网络 → 创建卷 → 创建容器 → Traefik 自动路由 → 租户可访问
    │
暂停租户 → DB 更新 enabled=false → 调和器检测 → 停止容器 → Traefik 自动移除路由
    │
恢复租户 → DB 更新 enabled=true → 调和器检测 → 启动容器 → Traefik 自动恢复路由
    │
升级配置 → DB 更新配置 → 调和器检测 diff → 重建容器 → 无缝切换
    │
删除租户 → DB 标记 deleted → 调和器检测 → 停止容器 → 删除容器 → 删除网络 → 删除卷
```

### 5.4 性能与扩展考量

| 维度 | 当前方案（单机） | 未来扩展方向 |
|------|-----------------|-------------|
| 容器编排 | dockerode 直连 Docker | Docker Swarm 或 K8s |
| 反向代理 | Traefik Docker Provider | Traefik + Consul/etcd |
| 数据库 | 单 PostgreSQL + RLS | PgBouncer 连接池 + 只读副本 |
| 调和循环 | 单进程 setInterval | 分布式锁 + 多实例调和 |
| 密钥管理 | pgcrypto 会话密钥 | HashiCorp Vault / AWS KMS |
| 租户上限 | 约 50-200 容器/单机 | 多节点调度 |

### 5.5 安全检查清单

- [ ] Docker socket 只读挂载到 Traefik
- [ ] 容器以非 root 用户运行
- [ ] 容器启用 ReadonlyRootfs
- [ ] 容器 CapDrop ALL，仅添加必要能力
- [ ] RLS 策略覆盖所有租户表
- [ ] 连接释放前重置租户上下文
- [ ] 加密密钥不存入数据库，通过 KMS 或环境变量管理
- [ ] Traefik Dashboard 需要认证
- [ ] 每租户设置 API 速率限制
- [ ] 容器间不可跨网络通信（独立 bridge）
- [ ] 敏感数据（API key、token）使用 AES-256 加密存储
- [ ] PidsLimit 防止 fork bomb
- [ ] MemorySwap 限制防止 OOM 影响宿主机

---

## 参考资料

### Docker & dockerode
- [dockerode GitHub](https://github.com/apocas/dockerode)
- [dockerode npm](https://www.npmjs.com/package/dockerode)
- [Docker Resource Constraints](https://docs.docker.com/engine/containers/resource_constraints/)
- [Docker Bridge Network](https://docs.docker.com/engine/network/drivers/bridge/)
- [dockerode TypeScript Types](https://github.com/DefinitelyTyped/DefinitelyTyped/blob/master/types/dockerode/index.d.ts)
- [Container Lifecycle Management](https://last9.io/blog/docker-container-lifecycle/)

### Reconciliation Loop
- [Understanding the Reconciliation Loop Pattern](https://oneuptime.com/blog/post/2026-02-09-operator-reconciliation-loop/view)
- [Kubernetes Reconciliation Patterns](https://hkassaei.com/posts/kubernetes-and-reconciliation-patterns/)
- [Desired State Systems](https://branislavjenco.github.io/desired-state-systems/)
- [Achieving Robust Control with Desired/Actual State Pattern](https://klarciel.net/wiki/designpattern/designpattern-desired-actual/)
- [Making Retries Safe with Idempotent APIs](https://aws.amazon.com/builders-library/making-retries-safe-with-idempotent-APIs/)
- [Kubernetes Controllers](https://kubernetes.io/docs/concepts/architecture/controller/)

### Traefik
- [Traefik v3 Docker Provider](https://doc.traefik.io/traefik/v3.3/providers/docker/)
- [Traefik Docker Quick Start](https://doc.traefik.io/traefik/getting-started/docker/)
- [Traefik WebSocket Documentation](https://doc.traefik.io/traefik/expose/overview/)
- [Traefik 3 and Wildcard Certificates](https://technotim.com/posts/traefik-3-docker-certificates/)
- [Wildcard LetsEncrypt with Traefik and Cloudflare](https://major.io/p/wildcard-letsencrypt-certificates-traefik-cloudflare/)
- [Traefik Docker Routing Labels Reference](https://doc.traefik.io/traefik/reference/routing-configuration/other-providers/docker/)

### PostgreSQL Multi-Tenant
- [Row-Level Security for Multi-Tenant Applications](https://www.simplyblock.io/blog/underated-postgres-multi-tenancy-with-row-level-security/)
- [Shipping Multi-Tenant SaaS using Postgres RLS](https://www.thenile.dev/blog/multi-tenant-rls)
- [PostgreSQL RLS for Multi-Tenant SaaS](https://www.techbuddies.io/2026/01/01/how-to-implement-postgresql-row-level-security-for-multi-tenant-saas/)
- [Multi-Tenant Data Isolation with PostgreSQL RLS (AWS)](https://aws.amazon.com/blogs/database/multi-tenant-data-isolation-with-postgresql-row-level-security/)
- [Row Level Security for Tenants (Crunchy Data)](https://www.crunchydata.com/blog/row-level-security-for-tenants-in-postgres)
- [pgcrypto Documentation](https://www.postgresql.org/docs/current/pgcrypto.html)
- [Practical Guide to pgcrypto Encryption](https://www.sahaj.ai/a-practical-guide-to-implementing-sensitive-data-encryption-using-postgres-pgcrypto/)
- [PostgreSQL Encryption Options](https://www.postgresql.org/docs/current/encryption-options.html)

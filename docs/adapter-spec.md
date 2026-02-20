# Agent Adapter 接口规范

> Adapter 是 AgentPod 支持多种 Agent 类型的核心机制。每种 Agent 实现一个 `AgentAdapter` 接口，AgentPod 就能管理它的完整生命周期。

## 设计参考

| 参考 | 学到什么 |
|------|---------|
| Terraform Provider | Schema 驱动的 CRUD，声明式接口 |
| K8s Operator (CRD) | Spec/Status 分离，调和循环 |
| Coolify 服务模板 | 模板即数据（JSON/YAML），魔法变量注入 |
| n8n Node | description 驱动 UI 自动生成 |
| Dokku plugn | 100+ 生命周期 Hook |
| OpenClaw ChannelPlugin | 已验证的 TypeScript Adapter 模式 |

## 核心接口定义

```typescript
type AgentAdapter = {
  // === 元数据 ===
  meta: {
    id: string                 // "openclaw", "open-webui", "lobechat"
    label: string              // "OpenClaw Gateway"
    description: string        // 一句话描述
    version: string            // Adapter 版本
    category: 'ai-assistant' | 'ai-workflow' | 'custom'
    tags: string[]             // 搜索标签
    logo?: string              // SVG 路径
  }

  // === 容器规格（映射到 Docker 参数）===
  containerSpec: {
    image: string              // "openclaw:production"
    command?: string[]         // CMD 覆盖
    environment: Record<string, string>
    volumes: Array<{
      containerPath: string    // "/home/node"
      source: string           // "{{pod.dataDir}}" (平台变量模板)
      persistent: boolean
    }>
    ports: Array<{
      container: number        // 18789
      protocol: 'tcp' | 'udp'
      primary?: boolean        // 主端口（Traefik 路由目标）
      websocket?: boolean      // 需要 WebSocket 升级
    }>
    healthCheck: {
      command: string[]
      intervalSeconds: number
      timeoutSeconds: number
      retries: number
      startPeriodSeconds: number
    }
    resources: {
      memoryMb: number
      cpus: number
    }
    restartPolicy: 'no' | 'always' | 'on-failure' | 'unless-stopped'
    user?: string              // "node" (非 root)
  }

  // === 用户可配置项（Zod schema -> 自动生成 Dashboard 表单）===
  configSchema: {
    schema: z.ZodObject<any>   // 运行时验证
    uiHints: Record<string, {
      label: string
      help?: string
      sensitive?: boolean      // 密码/Token 掩码
      group?: string           // UI 分组
    }>
    defaults: Record<string, unknown>
    envMapping: Record<string, string>  // config field -> 容器环境变量
  }

  // === 生命周期钩子（全部可选）===
  lifecycle: {
    onBeforeCreate?: (ctx: LifecycleContext) => Promise<{
      initialFiles?: Array<{ path: string; content: string }>
    }>
    onAfterCreate?: (ctx: LifecycleContext) => Promise<void>
    onConfigChange?: (ctx: ConfigChangeContext) => Promise<{
      action: 'none' | 'hot-reload' | 'restart' | 'recreate'
    }>
    onBeforeDelete?: (ctx: LifecycleContext) => Promise<void>
  }

  // === Agent 级健康探测（可选，补充 Docker healthcheck）===
  healthProbe?: {
    // Docker healthcheck 只检测容器存活（进程在跑）
    // healthProbe 检测 Agent 是否真正可用（协议级语义）
    probe: (ctx: HealthProbeContext) => Promise<{
      healthy: boolean
      message?: string         // "WebSocket connected" / "Gateway not responding"
    }>
    intervalSeconds: number    // 探测间隔
  }

  // === 核心方法：模板 + 用户配置 -> 最终 Docker 参数 ===
  resolveContainerSpec: (
    config: Record<string, unknown>,
    platform: PlatformContext
  ) => ContainerSpec
}
```

## 开发指南：实现一个 Adapter

### 第一步：定义元数据

```typescript
export const myAgentAdapter: AgentAdapter = {
  meta: {
    id: 'my-agent',
    label: 'My Custom Agent',
    description: 'A brief description of what this agent does',
    version: '1.0.0',
    category: 'ai-assistant',
    tags: ['ai', 'chatbot'],
  },
  // ...
}
```

### 第二步：定义容器规格

指定 Docker 镜像、端口、健康检查等:

```typescript
containerSpec: {
  image: 'my-agent:latest',
  environment: {
    NODE_ENV: 'production',
  },
  volumes: [{
    containerPath: '/data',
    source: '{{pod.dataDir}}',
    persistent: true,
  }],
  ports: [{
    container: 8080,
    protocol: 'tcp',
    primary: true,
  }],
  healthCheck: {
    command: ['CMD', 'curl', '-f', 'http://localhost:8080/health'],
    intervalSeconds: 30,
    timeoutSeconds: 10,
    retries: 3,
    startPeriodSeconds: 15,
  },
  resources: { memoryMb: 256, cpus: 0.5 },
  restartPolicy: 'unless-stopped',
},
```

### 第三步：定义配置 Schema

使用 Zod schema 定义用户可配置项。Dashboard 会根据此 schema 自动生成表单:

```typescript
configSchema: {
  schema: z.object({
    apiKey: z.string().min(1),
    modelName: z.string().default('gpt-4'),
    maxTokens: z.number().int().min(100).max(100000).default(4096),
  }),
  uiHints: {
    apiKey: {
      label: 'API Key',
      sensitive: true,
      group: 'AI Provider',
    },
    modelName: {
      label: 'Model Name',
      help: 'The LLM model to use',
      group: 'AI Provider',
    },
    maxTokens: {
      label: 'Max Tokens',
      group: 'AI Provider',
    },
  },
  defaults: {
    modelName: 'gpt-4',
    maxTokens: 4096,
  },
  envMapping: {
    apiKey: 'OPENAI_API_KEY',
    modelName: 'MODEL_NAME',
  },
},
```

### 第四步：实现生命周期钩子（可选）

```typescript
lifecycle: {
  onBeforeCreate: async (ctx) => ({
    initialFiles: [
      {
        path: 'config.json',
        content: JSON.stringify({
          model: ctx.config.modelName,
          maxTokens: ctx.config.maxTokens,
        }, null, 2),
      },
    ],
  }),

  onConfigChange: async (ctx) => {
    const needsRestart = ctx.changedFields.some(
      f => ['apiKey'].includes(f)
    )
    return { action: needsRestart ? 'restart' : 'none' }
  },
},
```

### 第五步：实现 resolveContainerSpec

将基础模板和用户配置合并为最终的 Docker 参数:

```typescript
resolveContainerSpec: (config, platform) => ({
  image: 'my-agent:latest',
  environment: {
    NODE_ENV: 'production',
    OPENAI_API_KEY: config.apiKey as string,
    MODEL_NAME: config.modelName as string,
  },
  // ... merged with containerSpec
}),
```

## OpenClaw Adapter 完整示例

```typescript
export const openclawAdapter: AgentAdapter = {
  meta: {
    id: 'openclaw',
    label: 'OpenClaw Gateway',
    description: 'Multi-channel AI assistant supporting 8+ messaging platforms',
    version: '1.0.0',
    category: 'ai-assistant',
    tags: ['ai', 'chatbot', 'telegram', 'discord', 'whatsapp', 'feishu'],
  },

  containerSpec: {
    image: 'openclaw:production',
    command: [
      'node', 'dist/index.js', 'gateway',
      '--bind', 'lan', '--port', '18789',
      '--allow-unconfigured',
    ],
    environment: {
      HOME: '/home/node',
      TERM: 'xterm-256color',
      NODE_ENV: 'production',
      NPM_CONFIG_PREFIX: '/home/node/.npm-global',
      PATH: '/home/node/.npm-global/bin:/usr/local/bin:/usr/bin:/bin',
    },
    volumes: [{
      containerPath: '/home/node',
      source: '{{pod.dataDir}}',
      persistent: true,
    }],
    ports: [{
      container: 18789,
      protocol: 'tcp',
      primary: true,
      websocket: true,
    }],
    healthCheck: {
      command: ['CMD', 'wget', '-qO-', 'http://127.0.0.1:18789/health'],
      intervalSeconds: 30,
      timeoutSeconds: 10,
      retries: 3,
      startPeriodSeconds: 15,
    },
    resources: { memoryMb: 512, cpus: 1 },
    restartPolicy: 'unless-stopped',
    user: 'node',
  },

  configSchema: {
    schema: z.object({
      agentName: z.string().min(1).max(50).default('Assistant'),
      personality: z.string().max(2000).optional(),
      claudeSessionKey: z.string().optional(),
      telegramBotToken: z.string().optional(),
      discordBotToken: z.string().optional(),
    }),
    uiHints: {
      agentName: { label: 'Agent Name', group: 'Identity' },
      personality: { label: 'Personality (SOUL.md)', group: 'Identity' },
      claudeSessionKey: {
        label: 'Claude Session Key',
        sensitive: true,
        group: 'AI Model',
      },
      telegramBotToken: {
        label: 'Telegram Bot Token',
        sensitive: true,
        group: 'Messaging',
      },
      discordBotToken: {
        label: 'Discord Bot Token',
        sensitive: true,
        group: 'Messaging',
      },
    },
    defaults: { agentName: 'Assistant' },
    envMapping: { claudeSessionKey: 'CLAUDE_AI_SESSION_KEY' },
  },

  lifecycle: {
    onBeforeCreate: async (ctx) => ({
      initialFiles: [
        {
          path: '.openclaw/openclaw.json',
          content: JSON.stringify({
            gateway: { port: 18789 },
            ...(ctx.config.telegramBotToken
              ? { telegram: { default: { botToken: ctx.config.telegramBotToken } } }
              : {}),
          }, null, 2),
        },
        ...(ctx.config.personality
          ? [{ path: '.openclaw/workspace/SOUL.md', content: ctx.config.personality }]
          : []),
      ],
    }),

    onConfigChange: async (ctx) => {
      if (ctx.changedFields.some(f => ['claudeSessionKey'].includes(f))) {
        return { action: 'restart' }
      }
      if (ctx.changedFields.includes('personality')) {
        return { action: 'none' } // Write file directly, no restart needed
      }
      return { action: 'none' }
    },
  },

  resolveContainerSpec: (config, platform) => ({
    // Merge base containerSpec + user config + platform variables
    // Implementation details TBD
  }),
}
```

## Adapter 注册与存储

| 存储位置 | 内容 | 说明 |
|----------|------|------|
| `packages/core/src/adapters/openclaw.ts` | 内置 Adapter | TypeScript 代码，完整生命周期钩子 |
| `packages/core/src/adapters/open-webui.ts` | 内置 Adapter | 同上 |
| PostgreSQL `pod_configs` | 用户配置 | 每租户的自定义配置，运行时验证 |
| PostgreSQL `pod_status` | Pod 状态 | 由调和引擎写入，Dashboard 读取 |

## 平台变量模板

在 Adapter 配置中可以使用以下模板变量:

| 变量 | 说明 | 示例 |
|------|------|------|
| `{{pod.id}}` | Pod UUID | `a1b2c3d4-...` |
| `{{pod.name}}` | Pod 名称 | `alice` |
| `{{pod.subdomain}}` | 子域名 | `alice` |
| `{{pod.dataDir}}` | 数据目录 | `/data/pods/a1b2c3d4` |
| `{{pod.gatewayToken}}` | 自动生成的 Token | `hex string` |
| `{{platform.domain}}` | 平台域名 | `agentpod.example.com` |

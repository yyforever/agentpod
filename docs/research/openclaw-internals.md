# OpenClaw 内部架构深度研究

> 本文档基于 OpenClaw v2026.2.13 源码分析，旨在为 AgentPod Adapter 设计提供可操作的技术参考。

---

## 1. Gateway 启动流程

### 1.1 入口链路

OpenClaw 的启动经历三个阶段：

**阶段一：CLI 入口 (`openclaw.mjs`)**

```
openclaw.mjs → dist/entry.js → src/entry.ts
```

`openclaw.mjs` 是 npm bin 入口，它启用 Node.js compile cache，然后加载 `dist/entry.js`。

关键文件：`/Users/yangyang/Github/openclaw/openclaw.mjs`

**阶段二：进程管理 (`src/entry.ts`)**

`entry.ts` 负责：
1. 设置 `process.title = "openclaw"`
2. 调用 `normalizeEnv()` 统一环境变量
3. 检测是否需要 respawn（添加 `--disable-warning=ExperimentalWarning` 标志）
4. 解析 CLI profile 参数（`--profile`）
5. 最终调用 `import("./cli/run-main.js").then(({ runCli }) => runCli(process.argv))`

关键文件：`/Users/yangyang/Github/openclaw/src/entry.ts`

**阶段三：CLI 路由 (`src/cli/run-main.ts`)**

`runCli()` 函数：
1. 加载 `.env` 文件（`loadDotEnv()`）
2. 标准化环境变量
3. 尝试快速路由（`tryRouteCli()`）
4. 构建 Commander program（`buildProgram()`）
5. 按需注册核心 CLI 命令和插件 CLI 命令
6. 解析并执行命令

关键文件：`/Users/yangyang/Github/openclaw/src/cli/run-main.ts`

### 1.2 Gateway Server 启动 (`startGatewayServer`)

这是核心启动函数，位于 `src/gateway/server.impl.ts`。默认端口 **18789**。

```typescript
export async function startGatewayServer(
  port = 18789,
  opts: GatewayServerOptions = {},
): Promise<GatewayServer>
```

启动步骤详解：

1. **配置加载与校验**
   - 读取 config snapshot（JSON5 格式）
   - 检测并自动迁移 legacy 配置
   - 校验配置有效性
   - 自动启用检测到的插件（`applyPluginAutoEnable`）

2. **核心初始化**
   - 启动诊断心跳（可选）
   - 设置 SIGUSR1 重启策略
   - 初始化 subagent 注册表
   - 解析默认 agent ID 和工作目录

3. **插件系统加载**
   - `loadGatewayPlugins()` 加载所有插件（工具、hooks、channels、providers）
   - 创建每个 channel 的日志器

4. **运行时配置解析**
   - 绑定地址策略（loopback / lan / tailnet / custom）
   - Control UI 配置
   - Auth 配置
   - TLS 配置

5. **HTTP/WS 服务器创建**
   - `createGatewayRuntimeState()` 创建 HTTP server + WebSocket server
   - 绑定到指定的 host:port
   - 设置 Control UI 静态资源服务

6. **Channel 管理器创建**
   ```typescript
   const channelManager = createChannelManager({
     loadConfig,
     channelLogs,
     channelRuntimeEnvs,
   });
   ```

7. **旁路服务启动 (`startGatewaySidecars`)**
   - Browser control server
   - Gmail watcher
   - Internal hooks
   - **Channel 启动**（核心！）
   - Plugin services
   - Memory backend
   - Restart sentinel

8. **WebSocket 处理器绑定**
   - `attachGatewayWsHandlers()` 注册所有 gateway 方法
   - 包括核心方法、插件方法、channel 方法

9. **其他**
   - 服务发现（mDNS/Bonjour）
   - Tailscale 暴露
   - Cron 服务
   - 配置热重载监听

关键文件：`/Users/yangyang/Github/openclaw/src/gateway/server.impl.ts`

### 1.3 端口绑定机制

```typescript
// 绑定策略类型
type GatewayBindMode = "auto" | "lan" | "loopback" | "custom" | "tailnet";

// 默认端口
const DEFAULT_GATEWAY_PORT = 18789;
```

端口解析优先级：
1. 环境变量 `OPENCLAW_GATEWAY_PORT`
2. 配置文件 `gateway.port`
3. 默认值 `18789`

绑定地址解析（`src/gateway/net.ts`）：
- `loopback` → `127.0.0.1`
- `lan` → `0.0.0.0`
- `tailnet` → Tailscale IPv4 (100.64.0.0/10)
- `auto` → 尝试 loopback，失败回退 LAN

关键文件：
- `/Users/yangyang/Github/openclaw/src/config/paths.ts`（`resolveGatewayPort()`）
- `/Users/yangyang/Github/openclaw/src/gateway/net.ts`（地址解析）
- `/Users/yangyang/Github/openclaw/src/gateway/server-runtime-state.ts`（HTTP server 创建）

---

## 2. Channel Plugin 架构

### 2.1 核心概念

OpenClaw 的 Channel 系统是一个完整的插件架构，每个消息通道（Telegram、Discord、WhatsApp 等）都是一个独立的 `ChannelPlugin` 实现。

**内置通道注册顺序：**

```typescript
// src/channels/registry.ts
export const CHAT_CHANNEL_ORDER = [
  "telegram", "whatsapp", "discord", "irc",
  "googlechat", "slack", "signal", "imessage",
] as const;
```

**扩展通道（extensions/ 目录）：**
```
feishu, line, matrix, mattermost, msteams, nostr,
nextcloud-talk, twitch, tlon, zalo, bluebubbles, lobster
```

### 2.2 ChannelPlugin 接口

这是整个 channel 系统的核心类型，定义在 `src/channels/plugins/types.plugin.ts`：

```typescript
export type ChannelPlugin<ResolvedAccount = any, Probe = unknown, Audit = unknown> = {
  id: ChannelId;                        // 唯一标识符
  meta: ChannelMeta;                    // 元数据（label, blurb, docsPath 等）
  capabilities: ChannelCapabilities;    // 支持的能力
  defaults?: { queue?: { debounceMs?: number } };
  reload?: { configPrefixes: string[]; noopPrefixes?: string[] };

  // 核心 adapters
  config: ChannelConfigAdapter<ResolvedAccount>;     // 配置管理（必需）
  gateway?: ChannelGatewayAdapter<ResolvedAccount>;  // 网关生命周期
  outbound?: ChannelOutboundAdapter;                 // 出站消息
  security?: ChannelSecurityAdapter<ResolvedAccount>;// 安全策略
  status?: ChannelStatusAdapter;                     // 运行状态

  // 可选 adapters
  setup?: ChannelSetupAdapter;           // 安装/配置向导
  pairing?: ChannelPairingAdapter;       // 设备配对
  auth?: ChannelAuthAdapter;             // 认证流程
  onboarding?: ChannelOnboardingAdapter; // CLI 引导
  groups?: ChannelGroupAdapter;          // 群组策略
  mentions?: ChannelMentionAdapter;      // @提及处理
  streaming?: ChannelStreamingAdapter;   // 流式输出
  threading?: ChannelThreadingAdapter;   // 线程/回复
  messaging?: ChannelMessagingAdapter;   // 消息格式化
  agentPrompt?: ChannelAgentPromptAdapter; // Agent 提示词增强
  directory?: ChannelDirectoryAdapter;   // 联系人/群组目录
  resolver?: ChannelResolverAdapter;     // 目标解析
  actions?: ChannelMessageActionAdapter; // 消息动作（反应、投票等）
  elevated?: ChannelElevatedAdapter;     // 提权操作
  commands?: ChannelCommandAdapter;      // 命令权限
  heartbeat?: ChannelHeartbeatAdapter;   // 心跳检查
  agentTools?: ChannelAgentToolFactory | ChannelAgentTool[]; // Agent 工具
};
```

关键文件：`/Users/yangyang/Github/openclaw/src/channels/plugins/types.plugin.ts`

### 2.3 关键 Adapter 详解

#### ChannelConfigAdapter（配置管理 — 必需）

```typescript
export type ChannelConfigAdapter<ResolvedAccount> = {
  listAccountIds: (cfg: OpenClawConfig) => string[];
  resolveAccount: (cfg: OpenClawConfig, accountId?: string | null) => ResolvedAccount;
  defaultAccountId?: (cfg: OpenClawConfig) => string;
  isEnabled?: (account: ResolvedAccount, cfg: OpenClawConfig) => boolean;
  isConfigured?: (account: ResolvedAccount, cfg: OpenClawConfig) => boolean | Promise<boolean>;
  // ... 更多方法
};
```

每个 channel 必须能从 `openclaw.json` 中提取自己的配置段，并解析为强类型的 `ResolvedAccount` 对象。

#### ChannelGatewayAdapter（网关生命周期）

```typescript
export type ChannelGatewayAdapter<ResolvedAccount = unknown> = {
  startAccount?: (ctx: ChannelGatewayContext<ResolvedAccount>) => Promise<unknown>;
  stopAccount?: (ctx: ChannelGatewayContext<ResolvedAccount>) => Promise<void>;
  loginWithQrStart?: (...) => Promise<ChannelLoginWithQrStartResult>;
  loginWithQrWait?: (...) => Promise<ChannelLoginWithQrWaitResult>;
  logoutAccount?: (...) => Promise<ChannelLogoutResult>;
};
```

`startAccount` 是 channel 启动的核心入口，接收 `ChannelGatewayContext`：

```typescript
export type ChannelGatewayContext<ResolvedAccount = unknown> = {
  cfg: OpenClawConfig;
  accountId: string;
  account: ResolvedAccount;
  runtime: RuntimeEnv;
  abortSignal: AbortSignal;
  log?: ChannelLogSink;
  getStatus: () => ChannelAccountSnapshot;
  setStatus: (next: ChannelAccountSnapshot) => void;
};
```

关键文件：`/Users/yangyang/Github/openclaw/src/channels/plugins/types.adapters.ts`

#### ChannelOutboundAdapter（出站消息）

```typescript
export type ChannelOutboundAdapter = {
  deliveryMode: "direct" | "gateway" | "hybrid";
  chunker?: ((text: string, limit: number) => string[]) | null;
  textChunkLimit?: number;
  sendText?: (ctx: ChannelOutboundContext) => Promise<OutboundDeliveryResult>;
  sendMedia?: (ctx: ChannelOutboundContext) => Promise<OutboundDeliveryResult>;
  sendPoll?: (ctx: ChannelPollContext) => Promise<ChannelPollResult>;
  sendPayload?: (ctx: ChannelOutboundPayloadContext) => Promise<OutboundDeliveryResult>;
};
```

### 2.4 Channel Manager（运行时管理）

`createChannelManager()`（位于 `src/gateway/server-channels.ts`）管理所有 channel 的生命周期：

```typescript
export type ChannelManager = {
  getRuntimeSnapshot: () => ChannelRuntimeSnapshot;
  startChannels: () => Promise<void>;
  startChannel: (channel: ChannelId, accountId?: string) => Promise<void>;
  stopChannel: (channel: ChannelId, accountId?: string) => Promise<void>;
  markChannelLoggedOut: (channelId: ChannelId, cleared: boolean, accountId?: string) => void;
};
```

启动流程：
1. 遍历所有注册的 channel plugins
2. 对每个 channel，列出其 account IDs
3. 检查 account 是否 enabled 和 configured
4. 创建 AbortController
5. 调用 `plugin.gateway.startAccount()` 启动
6. 跟踪运行状态

关键文件：`/Users/yangyang/Github/openclaw/src/gateway/server-channels.ts`

### 2.5 Plugin Registry（注册表）

所有插件通过 `PluginRegistry` 统一管理：

```typescript
export type PluginRegistry = {
  plugins: PluginRecord[];
  tools: PluginToolRegistration[];
  hooks: PluginHookRegistration[];
  typedHooks: TypedPluginHookRegistration[];
  channels: PluginChannelRegistration[];
  providers: PluginProviderRegistration[];
  gatewayHandlers: GatewayRequestHandlers;
  httpHandlers: PluginHttpRegistration[];
  httpRoutes: PluginHttpRouteRegistration[];
  cliRegistrars: PluginCliRegistration[];
  services: PluginServiceRegistration[];
  commands: PluginCommandRegistration[];
  diagnostics: PluginDiagnostic[];
};
```

插件注册 API（`OpenClawPluginApi`）：
```typescript
api.registerChannel(channelPlugin)   // 注册 channel
api.registerTool(tool, opts)         // 注册 agent tool
api.registerHook(events, handler)    // 注册 hook
api.registerGatewayMethod(name, handler) // 注册 gateway WS 方法
api.registerHttpHandler(handler)     // 注册 HTTP handler
api.registerHttpRoute({ path, handler }) // 注册 HTTP 路由
api.registerProvider(provider)       // 注册 LLM provider
api.registerService(service)         // 注册后台服务
api.registerCommand(command)         // 注册 CLI 命令
api.on(hookName, handler)            // 注册类型化 hook
```

关键文件：`/Users/yangyang/Github/openclaw/src/plugins/registry.ts`

### 2.6 Extension 示例：Feishu

Feishu（飞书）作为 extension 插件的实现范例：

```typescript
// extensions/feishu/index.ts
const plugin = {
  id: "feishu",
  name: "Feishu",
  description: "Feishu/Lark channel plugin",
  configSchema: emptyPluginConfigSchema(),
  register(api: OpenClawPluginApi) {
    setFeishuRuntime(api.runtime);
    api.registerChannel({ plugin: feishuPlugin });
    registerFeishuDocTools(api);
    registerFeishuWikiTools(api);
    registerFeishuDriveTools(api);
    registerFeishuPermTools(api);
    registerFeishuBitableTools(api);
  },
};
```

Extension 结构：
```
extensions/feishu/
├── index.ts                 # 入口，register() 函数
├── openclaw.plugin.json     # 插件元数据
├── package.json
├── skills/                  # 内置 skills
└── src/
    ├── channel.ts           # ChannelPlugin 定义
    ├── bot.ts               # Bot 消息处理
    ├── monitor.ts           # 消息轮询/webhook
    ├── send.ts              # 发送消息
    ├── media.ts             # 媒体处理
    ├── accounts.ts          # 账号配置解析
    ├── client.ts            # API client
    ├── directory.ts         # 联系人目录
    ├── onboarding.ts        # CLI 引导
    ├── outbound.ts          # 出站逻辑
    ├── streaming-card.ts    # 流式卡片
    └── ...
```

`openclaw.plugin.json` 声明插件元数据：
```json
{
  "id": "feishu",
  "channels": ["feishu"],
  "skills": ["./skills"],
  "configSchema": { "type": "object", "additionalProperties": false, "properties": {} }
}
```

关键文件：
- `/Users/yangyang/Github/openclaw/extensions/feishu/index.ts`
- `/Users/yangyang/Github/openclaw/extensions/feishu/src/channel.ts`

### 2.7 Plugin SDK

OpenClaw 导出 `openclaw/plugin-sdk` 供外部插件使用，包含所有 channel 类型定义、工具类型和辅助函数。

```typescript
import type { OpenClawPluginApi } from "openclaw/plugin-sdk";
```

关键文件：`/Users/yangyang/Github/openclaw/src/plugin-sdk/index.ts`

---

## 3. Agent Scope 与会话管理

### 3.1 Agent 体系

OpenClaw 支持多 Agent 架构。每个 Agent 有独立的：
- **ID**：唯一标识符（默认 agent ID 为 `"default"`）
- **工作目录**：agent 的文件系统根目录
- **Agent 目录**：agent 的状态/配置目录
- **模型配置**：可覆盖全局模型
- **Skills 过滤**：每个 agent 可有不同的 skills
- **身份信息**：name, emoji, identity 等

### 3.2 Agent Scope 解析

`src/agents/agent-scope.ts` 提供核心的 agent 解析逻辑：

```typescript
// 解析默认 agent ID
export function resolveDefaultAgentId(cfg: OpenClawConfig): string

// 从 session key 解析 agent IDs
export function resolveSessionAgentIds(params: {
  sessionKey?: string;
  config?: OpenClawConfig;
}): { defaultAgentId: string; sessionAgentId: string }

// 解析 agent 工作目录
export function resolveAgentWorkspaceDir(cfg: OpenClawConfig, agentId: string): string

// 解析 agent 状态目录
export function resolveAgentDir(cfg: OpenClawConfig, agentId: string): string

// 解析 agent 配置
export function resolveAgentConfig(cfg: OpenClawConfig, agentId: string): ResolvedAgentConfig | undefined
```

关键文件：`/Users/yangyang/Github/openclaw/src/agents/agent-scope.ts`

### 3.3 Session Key 体系

Session key 是消息路由的核心概念，格式为 `channel:accountId:peerId` 或包含 agent 前缀的 `agent:agentId:channel:accountId:peerId`。

子 agent session key 可通过 `isSubagentSessionKey()` 检测。

关键文件：`/Users/yangyang/Github/openclaw/src/routing/session-key.ts`

### 3.4 Agent Binding（路由绑定）

配置中的 `bindings` 数组定义了消息到 agent 的路由规则：

```typescript
export type AgentBinding = {
  agentId: string;
  match: {
    channel: string;
    accountId?: string;
    peer?: { kind: ChatType; id: string };
    guildId?: string;
    teamId?: string;
    roles?: string[];
  };
};
```

这允许将特定 channel + 特定联系人 路由到不同的 agent。

### 3.5 工作目录结构

每个 Agent 的工作目录包含以下 bootstrap 文件：

```
~/.openclaw/workspace/         # 默认 agent 工作目录
├── AGENTS.md                  # 多 agent 配置说明
├── SOUL.md                    # 人格/灵魂文件
├── TOOLS.md                   # 工具使用指南
├── IDENTITY.md                # 身份信息（name, emoji, creature, vibe）
├── USER.md                    # 用户信息
├── HEARTBEAT.md               # 心跳轮询提示
├── BOOTSTRAP.md               # 引导脚本
├── MEMORY.md                  # 记忆文件
└── memory/                    # 附加记忆目录
    └── *.md
```

### 3.6 子 Agent（Subagent）机制

OpenClaw 支持在运行时动态生成子 agent，通过 `sessions_spawn` 工具：

```typescript
subagents?: {
  allowAgents?: string[];  // 允许 spawn 的 agent IDs（"*" = 任意）
  model?: string | { primary?: string; fallbacks?: string[] };
};
```

子 agent 的 bootstrap 文件只包含 `AGENTS.md` 和 `TOOLS.md`（不包括 SOUL.md 等人格文件）。

---

## 4. 配置系统 (openclaw.json)

### 4.1 配置文件位置

配置文件路径解析优先级：
1. 环境变量 `OPENCLAW_CONFIG_PATH`
2. `$OPENCLAW_STATE_DIR/openclaw.json`
3. `~/.openclaw/openclaw.json`
4. Legacy 路径：`~/.clawdbot/clawdbot.json` 等

文件格式：**JSON5**（支持注释、尾逗号等）

关键文件：`/Users/yangyang/Github/openclaw/src/config/paths.ts`

### 4.2 完整配置 Schema

`OpenClawConfig` 是顶层配置类型，定义在 `src/config/types.openclaw.ts`：

```typescript
export type OpenClawConfig = {
  meta?: {
    lastTouchedVersion?: string;
    lastTouchedAt?: string;
  };
  auth?: AuthConfig;                     // 认证配置
  env?: {                                // 环境变量
    shellEnv?: { enabled?: boolean; timeoutMs?: number };
    vars?: Record<string, string>;
  };
  wizard?: { ... };                      // 向导状态
  diagnostics?: DiagnosticsConfig;       // 诊断
  logging?: LoggingConfig;               // 日志
  update?: {                             // 更新
    channel?: "stable" | "beta" | "dev";
    checkOnStart?: boolean;
  };
  browser?: BrowserConfig;               // 浏览器控制
  ui?: {                                 // UI 配置
    seamColor?: string;
    assistant?: { name?: string; avatar?: string };
  };
  skills?: SkillsConfig;                 // Skills 配置
  plugins?: PluginsConfig;               // 插件配置
  models?: ModelsConfig;                 // 模型配置
  nodeHost?: NodeHostConfig;             // 节点主机
  agents?: AgentsConfig;                 // Agent 配置（核心）
  tools?: ToolsConfig;                   // 工具策略
  bindings?: AgentBinding[];             // Agent 路由绑定
  broadcast?: BroadcastConfig;           // 广播配置
  audio?: AudioConfig;                   // 音频/TTS
  messages?: MessagesConfig;             // 消息格式化
  commands?: CommandsConfig;             // 命令配置
  approvals?: ApprovalsConfig;           // 审批配置
  session?: SessionConfig;               // 会话配置
  web?: WebConfig;                       // Web 配置
  channels?: ChannelsConfig;             // Channel 特定配置
  cron?: CronConfig;                     // Cron 定时任务
  hooks?: HooksConfig;                   // Hook 配置
  discovery?: DiscoveryConfig;           // 服务发现
  canvasHost?: CanvasHostConfig;         // Canvas 主机
  talk?: TalkConfig;                     // 语音对话
  gateway?: GatewayConfig;               // Gateway 服务器配置
  memory?: MemoryConfig;                 // 记忆系统配置
};
```

关键文件：`/Users/yangyang/Github/openclaw/src/config/types.openclaw.ts`

### 4.3 Gateway 配置详解

```typescript
export type GatewayConfig = {
  port?: number;                         // 端口（默认 18789）
  mode?: "local" | "remote";             // 运行模式
  bind?: GatewayBindMode;                // 绑定策略
  customBindHost?: string;               // 自定义绑定地址
  controlUi?: GatewayControlUiConfig;    // Control UI
  auth?: GatewayAuthConfig;              // 认证
  tailscale?: GatewayTailscaleConfig;    // Tailscale
  remote?: GatewayRemoteConfig;          // 远程连接
  reload?: GatewayReloadConfig;          // 热重载策略
  tls?: GatewayTlsConfig;               // TLS
  http?: GatewayHttpConfig;              // HTTP 端点（/v1/chat/completions 等）
  nodes?: GatewayNodesConfig;            // 节点管理
  trustedProxies?: string[];             // 反向代理 IP
  tools?: GatewayToolsConfig;            // 工具访问控制
};
```

关键文件：`/Users/yangyang/Github/openclaw/src/config/types.gateway.ts`

### 4.4 Agent 配置详解

```typescript
export type AgentsConfig = {
  defaults?: AgentDefaultsConfig;        // 全局默认值
  list?: AgentConfig[];                  // Agent 列表
};

export type AgentConfig = {
  id: string;                            // Agent ID
  default?: boolean;                     // 是否为默认 agent
  name?: string;                         // 显示名
  workspace?: string;                    // 工作目录
  agentDir?: string;                     // Agent 状态目录
  model?: AgentModelConfig;              // 模型配置
  skills?: string[];                     // Skills 白名单
  memorySearch?: MemorySearchConfig;     // 记忆搜索配置
  humanDelay?: HumanDelayConfig;         // 人类式延迟
  heartbeat?: ...;                       // 心跳配置
  identity?: IdentityConfig;             // 身份配置
  groupChat?: GroupChatConfig;           // 群聊配置
  subagents?: {                          // 子 agent 配置
    allowAgents?: string[];
    model?: string | { primary?: string; fallbacks?: string[] };
  };
  sandbox?: { ... };                     // 沙箱配置
  tools?: AgentToolsConfig;              // 工具配置
};
```

关键文件：`/Users/yangyang/Github/openclaw/src/config/types.agents.ts`

### 4.5 Memory 配置

```typescript
export type MemoryConfig = {
  backend?: "builtin" | "qmd";           // 记忆后端
  citations?: "auto" | "on" | "off";     // 引用模式
  qmd?: {                                // QMD 高级记忆
    command?: string;
    searchMode?: "query" | "search" | "vsearch";
    includeDefaultMemory?: boolean;
    paths?: MemoryQmdIndexPath[];
    sessions?: { enabled?: boolean; exportDir?: string; retentionDays?: number };
    update?: { interval?: string; debounceMs?: number; onBoot?: boolean; ... };
    limits?: { maxResults?: number; maxSnippetChars?: number; ... };
  };
};
```

关键文件：`/Users/yangyang/Github/openclaw/src/config/types.memory.ts`

### 4.6 配置加载与处理链

配置加载经过以下处理管线（`src/config/io.ts`）：

1. **读取原始文件**（JSON5 解析）
2. **环境变量替换**（`${ENV_VAR}` 语法）
3. **`$include` 解析**（支持引入外部配置片段）
4. **Merge patch 应用**
5. **路径标准化**
6. **Zod schema 校验**
7. **运行时默认值注入**（模型默认值、session 默认值等）
8. **Legacy 兼容性检查**

关键文件：`/Users/yangyang/Github/openclaw/src/config/io.ts`

### 4.7 配置热重载

Gateway 支持三种重载模式：
- `off`：不自动重载
- `restart`：配置变化触发 gateway 重启
- `hot`：热重载（不重启进程）
- `hybrid`（默认）：小变更热重载，大变更重启

监听 `CONFIG_PATH` 文件变化，通过 `startGatewayConfigReloader()` 实现。

---

## 5. 身份与认证 (auth-profiles.json)

### 5.1 Auth Profile Store

Auth profiles 是 OpenClaw 管理 LLM provider API 密钥的机制。存储在 `auth-profiles.json` 文件中。

```typescript
export type AuthProfileStore = {
  version: number;
  profiles: Record<string, AuthProfileCredential>;
  order?: Record<string, string[]>;         // 每个 agent 的 profile 顺序
  lastGood?: Record<string, string>;        // 最后成功的 profile
  usageStats?: Record<string, ProfileUsageStats>; // 使用统计
};
```

### 5.2 凭证类型

支持三种凭证类型：

```typescript
// API Key
export type ApiKeyCredential = {
  type: "api_key";
  provider: string;
  key?: string;
  email?: string;
  metadata?: Record<string, string>;
};

// 静态 Token
export type TokenCredential = {
  type: "token";
  provider: string;
  token: string;
  expires?: number;
  email?: string;
};

// OAuth
export type OAuthCredential = OAuthCredentials & {
  type: "oauth";
  provider: string;
  clientId?: string;
  email?: string;
};
```

### 5.3 Profile 管理逻辑

**存储路径解析：** `resolveAuthStorePath(agentDir?)` — 位于 agent 状态目录下。

**加载流程（`ensureAuthProfileStore()`）：**
1. 尝试从当前 agent 目录加载 `auth-profiles.json`
2. 如果不存在，尝试从主 agent 继承
3. 如果存在 legacy `oauth.json`，合并入 store
4. 同步外部 CLI 工具凭证（如 Claude CLI）
5. 如果是子 agent，merge 主 agent 的 profiles

**轮转机制：**
- 支持 round-robin 轮转多个 profile
- 有 cooldown 机制（失败后暂停使用）
- 按 agent 可配置 profile 优先级（`order` 字段）
- 跟踪每个 profile 的使用统计

```typescript
export type ProfileUsageStats = {
  lastUsed?: number;
  cooldownUntil?: number;
  disabledUntil?: number;
  disabledReason?: AuthProfileFailureReason;
  errorCount?: number;
  failureCounts?: Partial<Record<AuthProfileFailureReason, number>>;
  lastFailureAt?: number;
};
```

### 5.4 Gateway 认证

Gateway 服务器本身支持多种认证模式：

```typescript
export type GatewayAuthMode = "token" | "password" | "trusted-proxy";

export type GatewayAuthConfig = {
  mode?: GatewayAuthMode;
  token?: string;
  password?: string;
  allowTailscale?: boolean;
  rateLimit?: GatewayAuthRateLimitConfig;
  trustedProxy?: GatewayTrustedProxyConfig;
};
```

认证结果：
```typescript
export type GatewayAuthResult = {
  ok: boolean;
  method?: "none" | "token" | "password" | "tailscale" | "device-token" | "trusted-proxy";
  user?: string;
  reason?: string;
  rateLimited?: boolean;
  retryAfterMs?: number;
};
```

关键文件：
- `/Users/yangyang/Github/openclaw/src/agents/auth-profiles/store.ts`
- `/Users/yangyang/Github/openclaw/src/agents/auth-profiles/types.ts`
- `/Users/yangyang/Github/openclaw/src/gateway/auth.ts`

---

## 6. 个性与记忆 (SOUL.md / MEMORY.md)

### 6.1 Bootstrap 文件系统

OpenClaw 的 "个性" 机制基于 workspace 中的 markdown 文件。这些文件在 agent 运行启动时被读取，并注入到 system prompt 中。

**Bootstrap 文件列表（按加载顺序）：**

| 文件 | 用途 | 必须 |
|------|------|------|
| `AGENTS.md` | 多 agent 说明/委派指南 | 否 |
| `SOUL.md` | 人格/语气/风格定义 | 否 |
| `TOOLS.md` | 工具使用指南 | 否 |
| `IDENTITY.md` | 结构化身份信息 | 否 |
| `USER.md` | 用户信息 | 否 |
| `HEARTBEAT.md` | 心跳轮询提示 | 否 |
| `BOOTSTRAP.md` | 启动脚本 | 否 |
| `MEMORY.md` / `memory.md` | 记忆文件 | 否 |

### 6.2 文件加载流程

```
loadWorkspaceBootstrapFiles(dir)
    ↓
filterBootstrapFilesForSession(files, sessionKey)
    ↓ （子 agent 只保留 AGENTS.md + TOOLS.md）
applyBootstrapHookOverrides(files, ...)
    ↓ （插件 hook 可修改）
buildBootstrapContextFiles(files, { maxChars })
    ↓ （截断过大文件）
注入到 system prompt 的 "# Project Context" 段落
```

关键函数调用链：`resolveBootstrapContextForRun()` → `resolveBootstrapFilesForRun()` → `loadWorkspaceBootstrapFiles()`

关键文件：
- `/Users/yangyang/Github/openclaw/src/agents/workspace.ts`（加载 bootstrap 文件）
- `/Users/yangyang/Github/openclaw/src/agents/bootstrap-files.ts`（解析上下文）

### 6.3 SOUL.md 的处理

在 system prompt 构建时（`src/agents/system-prompt.ts`），SOUL.md 有特殊处理：

```typescript
const hasSoulFile = validContextFiles.some((file) => {
  const baseName = normalizedPath.split("/").pop() ?? normalizedPath;
  return baseName.toLowerCase() === "soul.md";
});

if (hasSoulFile) {
  lines.push(
    "If SOUL.md is present, embody its persona and tone. " +
    "Avoid stiff, generic replies; follow its guidance " +
    "unless higher-priority instructions override it.",
  );
}
```

SOUL.md 的内容作为 "Project Context" 的一部分被注入，agent 被明确指示要 "体现其人格和语调"。

关键文件：`/Users/yangyang/Github/openclaw/src/agents/system-prompt.ts`

### 6.4 IDENTITY.md 的解析

IDENTITY.md 使用结构化 markdown 格式：

```markdown
- Name: MyBot
- Emoji: 🤖
- Creature: AI assistant
- Vibe: friendly and helpful
- Theme: cyberpunk
- Avatar: https://example.com/avatar.png
```

解析函数 `parseIdentityMarkdown()` 提取 key-value 对：

```typescript
export type AgentIdentityFile = {
  name?: string;
  emoji?: string;
  theme?: string;
  creature?: string;
  vibe?: string;
  avatar?: string;
};
```

占位符值（如 "pick something you like"）会被自动忽略。

关键文件：`/Users/yangyang/Github/openclaw/src/agents/identity-file.ts`

### 6.5 MEMORY.md 与记忆搜索

**MEMORY.md** 是用户可编辑的持久记忆文件。Agent 被指示在回答关于历史工作、决策、偏好等问题前，先搜索 MEMORY.md。

System prompt 中的记忆搜索指令：
```
Before answering anything about prior work, decisions, dates, people,
preferences, or todos: run memory_search on MEMORY.md + memory/*.md;
then use memory_get to pull only the needed lines.
```

**记忆后端：**
- `builtin`：基于文件的简单搜索（memory_search + memory_get 工具）
- `qmd`：高级记忆系统，支持向量搜索、嵌入索引
  - 支持 OpenAI / Gemini / Voyage / Local 嵌入模型
  - SQLite + sqlite-vec 向量存储
  - 混合搜索（向量 + 文本）
  - 自动同步和增量更新

关键文件：
- `/Users/yangyang/Github/openclaw/src/memory/index.ts`
- `/Users/yangyang/Github/openclaw/src/agents/memory-search.ts`
- `/Users/yangyang/Github/openclaw/src/memory/manager.ts`

### 6.6 BOOT.md（启动时执行）

除了 bootstrap 文件，还有 `BOOT.md` 机制（`src/gateway/boot.ts`）。Gateway 启动时会检查工作目录中的 `BOOT.md`，如果存在则作为 prompt 执行一次 agent run。

用途：启动时自动发送通知、执行检查等。

关键文件：`/Users/yangyang/Github/openclaw/src/gateway/boot.ts`

---

## 7. System Prompt 构建

### 7.1 构建过程

`buildAgentSystemPrompt()` 是系统提示词的核心构建函数，输出包含以下段落：

1. **基本身份**："You are a personal assistant running inside OpenClaw."
2. **Tooling**：列出所有可用工具及简要说明
3. **Tool Call Style**：工具调用风格指导
4. **Safety**：安全约束
5. **CLI Quick Reference**：OpenClaw CLI 参考
6. **Skills**：技能系统说明
7. **Memory Recall**：记忆搜索指令
8. **Self-Update**：自更新说明
9. **Model Aliases**：模型别名
10. **Workspace**：工作目录
11. **Documentation**：文档链接
12. **Sandbox**：沙箱信息（如适用）
13. **User Identity**：用户信息
14. **Time**：时区信息
15. **Workspace Files (injected)**：bootstrap 文件内容
16. **Reply Tags**：回复标签系统
17. **Messaging**：消息工具使用说明
18. **Voice**：TTS 提示
19. **Reactions**：反应指导
20. **Reasoning Format**：推理格式
21. **Project Context**：所有 bootstrap 文件内容（包括 SOUL.md）
22. **Silent Replies**：静默回复机制
23. **Heartbeats**：心跳机制
24. **Runtime**：运行时信息行

支持三种 prompt 模式：
- `full`：完整 prompt（主 agent）
- `minimal`：精简 prompt（子 agent）
- `none`：仅基本身份行

关键文件：`/Users/yangyang/Github/openclaw/src/agents/system-prompt.ts`

---

## 8. 对 AgentPod Adapter 设计的启示

### 8.1 Channel Adapter 接口映射

OpenClaw 的 `ChannelPlugin` 接口非常成熟，AgentPod Adapter 应该复用其核心设计：

| OpenClaw 概念 | AgentPod 映射建议 |
|---|---|
| `ChannelPlugin` | `AgentPodChannelAdapter` |
| `ChannelConfigAdapter` | 配置解析层 |
| `ChannelGatewayAdapter.startAccount` | Adapter 生命周期管理 |
| `ChannelOutboundAdapter.sendText` | 出站消息接口 |
| `ChannelPlugin.capabilities` | 能力声明 |
| `PluginRegistry` | AgentPod 的插件注册中心 |

### 8.2 需要适配的关键入口

1. **消息入站路径**：
   - OpenClaw 中，每个 channel 的 `bot.ts` / `monitor.ts` 负责监听消息
   - 消息通过 auto-reply 系统路由到 agent
   - AgentPod 需要拦截这条路径，将消息转发到 pod 内的 agent

2. **消息出站路径**：
   - Agent 通过 `message` 工具或直接回复发送消息
   - 经过 outbound delivery queue 最终到达 channel 的 `send.ts`
   - AgentPod 需要提供出站接口供 pod 内 agent 调用

3. **配置注入**：
   - `openclaw.json` 是配置中心
   - AgentPod 需要能注入/覆盖配置
   - 特别关注 `channels.*`, `agents.*`, `models.*` 段落

### 8.3 Plugin 注册模式

AgentPod 作为 OpenClaw 插件时，应通过标准 plugin API 注册：

```typescript
// agentpod-adapter/index.ts
const plugin = {
  id: "agentpod",
  name: "AgentPod",
  description: "AgentPod integration adapter",
  register(api: OpenClawPluginApi) {
    // 注册 channel（如果 AgentPod 作为消息通道）
    api.registerChannel({ plugin: agentPodChannelPlugin });

    // 注册 tools（暴露 AgentPod 能力给 agent）
    api.registerTool(agentPodTool, { name: "agentpod" });

    // 注册 hook（拦截消息流）
    api.registerHook("message.inbound", handleInbound);

    // 注册 HTTP 路由（AgentPod webhook）
    api.registerHttpRoute({
      path: "/agentpod/webhook",
      handler: webhookHandler,
    });

    // 注册后台服务
    api.registerService({
      id: "agentpod-bridge",
      start: () => startBridge(),
      stop: () => stopBridge(),
    });
  },
};
```

### 8.4 认证集成

Auth profile 系统需要桥接：
- OpenClaw 管理 LLM API keys（auth-profiles.json）
- AgentPod 可能有自己的 API key 管理
- Adapter 需要决定从哪一侧获取凭证

### 8.5 记忆系统集成

OpenClaw 的记忆系统（MEMORY.md + 向量搜索）可以：
1. 直接复用（AgentPod agent 访问 OpenClaw workspace）
2. 桥接（AgentPod 提供记忆 API，Adapter 转换为 OpenClaw 格式）
3. 替换（AgentPod 有自己的记忆系统时，通过 hook 覆盖）

### 8.6 Bootstrap 文件集成

AgentPod 需要决定如何处理 SOUL.md 等文件：
- **方案一**：AgentPod 生成自己的 bootstrap 文件到 workspace
- **方案二**：通过 `bootstrap-hooks` 在加载时动态注入内容
- **方案三**：通过 system prompt override 完全替换

### 8.7 关键代码路径总结

| 功能 | 关键文件 | 关键函数 |
|---|---|---|
| 启动入口 | `src/entry.ts` | `runCli()` |
| Gateway 服务器 | `src/gateway/server.impl.ts` | `startGatewayServer()` |
| Channel 管理 | `src/gateway/server-channels.ts` | `createChannelManager()` |
| Channel 插件类型 | `src/channels/plugins/types.plugin.ts` | `ChannelPlugin` 类型 |
| Channel 注册表 | `src/channels/plugins/index.ts` | `listChannelPlugins()` |
| Plugin 注册 | `src/plugins/registry.ts` | `createPluginRegistry()` |
| Agent 作用域 | `src/agents/agent-scope.ts` | `resolveAgentWorkspaceDir()` |
| System Prompt | `src/agents/system-prompt.ts` | `buildAgentSystemPrompt()` |
| Bootstrap 文件 | `src/agents/workspace.ts` | `loadWorkspaceBootstrapFiles()` |
| Identity 解析 | `src/agents/identity-file.ts` | `parseIdentityMarkdown()` |
| Auth Profiles | `src/agents/auth-profiles/store.ts` | `ensureAuthProfileStore()` |
| 配置加载 | `src/config/io.ts` | `loadConfig()` |
| 配置类型 | `src/config/types.openclaw.ts` | `OpenClawConfig` 类型 |
| 配置路径 | `src/config/paths.ts` | `resolveConfigPath()` |
| 记忆系统 | `src/memory/manager.ts` | `MemoryIndexManager` |
| 记忆搜索 | `src/agents/memory-search.ts` | 配置解析 |
| Plugin SDK | `src/plugin-sdk/index.ts` | 导出汇总 |
| Extension 示例 | `extensions/feishu/index.ts` | `register()` |

### 8.8 技术约束与注意事项

1. **Node.js >= 22.12.0** 是硬性要求
2. **ESM only** — 项目使用 `"type": "module"`
3. **依赖 pi-agent-core** — agent 运行时基于 `@mariozechner/pi-agent-core`
4. **TypeBox schema** — 工具 schema 使用 `@sinclair/typebox`
5. **Zod v4** — 配置校验使用 `zod@4.3.6`
6. **Channel 热重载** — channel 可以在运行时 start/stop，不需要重启 gateway
7. **多账号支持** — 每个 channel 支持多账号（accountId 系统）
8. **AbortController** — channel 生命周期通过 AbortSignal 控制

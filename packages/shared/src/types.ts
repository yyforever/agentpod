import { z } from 'zod'

// ============================================================
// Database row types (match SQL schema in architecture.md)
// ============================================================

export type Tenant = {
  id: string
  name: string
  email: string | null
  created_at: Date
  updated_at: Date
}

export type Pod = {
  id: string
  tenant_id: string
  name: string
  adapter_id: string
  subdomain: string
  desired_status: PodDesiredStatus
  actual_status: PodActualStatus
  container_id: string | null
  gateway_token: string
  data_dir: string
  created_at: Date
  updated_at: Date
}

export type PodConfig = {
  pod_id: string
  config: Record<string, unknown>
  updated_at: Date
}

export type PodStatus = {
  pod_id: string
  phase: string
  ready: boolean
  message: string | null
  last_health_at: Date | null
  memory_mb: number | null
  cpu_percent: number | null
  storage_mb: number | null
  updated_at: Date
}

export type PodEvent = {
  id: number
  pod_id: string
  event_type: PodEventType
  message: string | null
  created_at: Date
}

// ============================================================
// Status enums
// ============================================================

export type PodDesiredStatus = 'running' | 'stopped' | 'deleted'

export type PodActualStatus =
  | 'pending'
  | 'running'
  | 'stopped'
  | 'exited'
  | 'error'
  | 'unknown'

export type PodEventType =
  | 'created'
  | 'started'
  | 'stopped'
  | 'restarted'
  | 'deleted'
  | 'error'
  | 'health_check_failed'
  | 'config_changed'

// ============================================================
// AgentAdapter interface (matches adapter-spec.md exactly)
// ============================================================

export type AdapterCategory = 'ai-assistant' | 'ai-workflow' | 'custom'

export type AdapterMeta = {
  id: string
  label: string
  description: string
  version: string
  category: AdapterCategory
  tags: string[]
  logo?: string
}

export type VolumeSpec = {
  containerPath: string
  source: string
  persistent: boolean
}

export type PortSpec = {
  container: number
  protocol: 'tcp' | 'udp'
  primary?: boolean
  websocket?: boolean
}

export type HealthCheckSpec = {
  command: string[]
  intervalSeconds: number
  timeoutSeconds: number
  retries: number
  startPeriodSeconds: number
}

export type ResourceSpec = {
  memoryMb: number
  cpus: number
}

export type ContainerSpec = {
  image: string
  command?: string[]
  environment: Record<string, string>
  volumes: VolumeSpec[]
  ports: PortSpec[]
  healthCheck: HealthCheckSpec
  resources: ResourceSpec
  restartPolicy: 'no' | 'always' | 'on-failure' | 'unless-stopped'
  user?: string
}

export type UiHint = {
  label: string
  help?: string
  sensitive?: boolean
  group?: string
}

export type ConfigSchema = {
  schema: z.ZodObject<z.ZodRawShape>
  uiHints: Record<string, UiHint>
  defaults: Record<string, unknown>
  envMapping: Record<string, string>
}

// ============================================================
// Lifecycle hook contexts
// ============================================================

export type LifecycleContext = {
  pod: Pod
  config: Record<string, unknown>
  platform: PlatformContext
}

export type ConfigChangeContext = {
  pod: Pod
  config: Record<string, unknown>
  previousConfig: Record<string, unknown>
  changedFields: string[]
  platform: PlatformContext
}

export type HealthProbeContext = {
  pod: Pod
  platform: PlatformContext
}

export type PlatformContext = {
  domain: string
  dataDir: string
}

// ============================================================
// AgentAdapter interface
// ============================================================

export type AgentAdapter = {
  meta: AdapterMeta

  containerSpec: ContainerSpec

  configSchema: ConfigSchema

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

  healthProbe?: {
    probe: (ctx: HealthProbeContext) => Promise<{
      healthy: boolean
      message?: string
    }>
    intervalSeconds: number
  }

  resolveContainerSpec: (
    config: Record<string, unknown>,
    platform: PlatformContext
  ) => ContainerSpec
}

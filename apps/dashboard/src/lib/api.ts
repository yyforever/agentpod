import 'server-only'

import { z } from 'zod'
import type {
  Pod,
  PodActualStatus,
  PodDesiredStatus,
  PodEvent,
  PodStatus,
  Tenant,
} from '@agentpod/shared'

const controlPlaneBaseUrl = process.env.CONTROL_PLANE_URL ?? 'http://localhost:4000'

type ApiFetchOptions = RequestInit & {
  next?: RequestInit['next']
}

type ErrorPayload = {
  error?: string
  message?: string
}

const statusSchema = z.object({
  pod_id: z.string(),
  phase: z.string(),
  ready: z.boolean(),
  message: z.string().nullable(),
  last_health_at: z.string().nullable(),
  memory_mb: z.number().nullable(),
  cpu_percent: z.number().nullable(),
  storage_mb: z.number().nullable(),
  updated_at: z.string(),
})

const tenantSchema = z.object({
  id: z.string(),
  name: z.string(),
  email: z.string().nullable(),
  created_at: z.string(),
  updated_at: z.string(),
})

const podSchema = z.object({
  id: z.string(),
  tenant_id: z.string(),
  name: z.string(),
  adapter_id: z.string(),
  subdomain: z.string(),
  desired_status: z.enum(['running', 'stopped', 'deleted']),
  actual_status: z.enum(['pending', 'running', 'stopped', 'exited', 'error', 'unknown']),
  container_id: z.string().nullable(),
  gateway_token: z.string(),
  data_dir: z.string(),
  created_at: z.string(),
  updated_at: z.string(),
})

const podWithStatusSchema = podSchema.extend({
  status: statusSchema.nullable(),
})

const podDetailSchema = podSchema.extend({
  status: statusSchema.nullable(),
  config: z.record(z.unknown()).nullable(),
})

const podEventSchema = z.object({
  id: z.number(),
  pod_id: z.string(),
  event_type: z.string(),
  message: z.string().nullable(),
  created_at: z.string(),
})

export type PodWithStatus = Pod & { status: PodStatus | null }

export type PodDetails = PodWithStatus & {
  config: Record<string, unknown> | null
}

export type PodTimelineEvent = PodEvent

function toDate(value: string): Date {
  const parsed = new Date(value)
  if (Number.isNaN(parsed.getTime())) {
    throw new Error(`Invalid date value from control-plane: ${value}`)
  }
  return parsed
}

function mapTenant(raw: z.infer<typeof tenantSchema>): Tenant {
  return {
    id: raw.id,
    name: raw.name,
    email: raw.email,
    created_at: toDate(raw.created_at),
    updated_at: toDate(raw.updated_at),
  }
}

function mapStatus(raw: z.infer<typeof statusSchema>): PodStatus {
  return {
    pod_id: raw.pod_id,
    phase: raw.phase,
    ready: raw.ready,
    message: raw.message,
    last_health_at: raw.last_health_at ? toDate(raw.last_health_at) : null,
    memory_mb: raw.memory_mb,
    cpu_percent: raw.cpu_percent,
    storage_mb: raw.storage_mb,
    updated_at: toDate(raw.updated_at),
  }
}

function mapPod(raw: z.infer<typeof podSchema>): Pod {
  return {
    id: raw.id,
    tenant_id: raw.tenant_id,
    name: raw.name,
    adapter_id: raw.adapter_id,
    subdomain: raw.subdomain,
    desired_status: raw.desired_status as PodDesiredStatus,
    actual_status: raw.actual_status as PodActualStatus,
    container_id: raw.container_id,
    gateway_token: raw.gateway_token,
    data_dir: raw.data_dir,
    created_at: toDate(raw.created_at),
    updated_at: toDate(raw.updated_at),
  }
}

async function apiFetch<T>(path: string, init?: ApiFetchOptions): Promise<T> {
  const headers = new Headers(init?.headers)
  headers.set('accept', 'application/json')

  if (process.env.AGENTPOD_API_KEY) {
    headers.set('authorization', `Bearer ${process.env.AGENTPOD_API_KEY}`)
  }

  const response = await fetch(new URL(path, controlPlaneBaseUrl), {
    ...init,
    headers,
    cache: 'no-store',
  })

  if (!response.ok) {
    let message = `Control-plane request failed (${response.status})`
    try {
      const errorPayload = (await response.json()) as ErrorPayload
      message = errorPayload.error ?? errorPayload.message ?? message
    } catch {
      // keep fallback message
    }
    throw new Error(message)
  }

  return (await response.json()) as T
}

export async function getTenants(): Promise<Tenant[]> {
  const raw = await apiFetch<unknown>('/api/tenants')
  const parsed = z.array(tenantSchema).parse(raw)
  return parsed.map(mapTenant)
}

export async function createTenant(input: { name: string; email?: string }): Promise<Tenant> {
  const raw = await apiFetch<unknown>('/api/tenants', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      name: input.name,
      email: input.email,
    }),
  })
  return mapTenant(tenantSchema.parse(raw))
}

export async function getPods(tenantId?: string): Promise<PodWithStatus[]> {
  const params = new URLSearchParams()
  if (tenantId) {
    params.set('tenant_id', tenantId)
  }

  const suffix = params.size > 0 ? `?${params.toString()}` : ''
  const raw = await apiFetch<unknown>(`/api/pods${suffix}`)
  const parsed = z.array(podWithStatusSchema).parse(raw)

  return parsed.map((row) => ({
    ...mapPod(row),
    status: row.status ? mapStatus(row.status) : null,
  }))
}

export async function getPod(id: string): Promise<PodDetails> {
  const raw = await apiFetch<unknown>(`/api/pods/${id}`)
  const parsed = podDetailSchema.parse(raw)

  return {
    ...mapPod(parsed),
    status: parsed.status ? mapStatus(parsed.status) : null,
    config: parsed.config,
  }
}

export async function createPod(input: {
  tenantId: string
  name: string
  adapterId: string
  config?: Record<string, unknown>
}): Promise<Pod> {
  const raw = await apiFetch<unknown>('/api/pods', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      tenant_id: input.tenantId,
      name: input.name,
      adapter_id: input.adapterId,
      config: input.config,
    }),
  })

  return mapPod(podSchema.parse(raw))
}

export async function startPod(id: string): Promise<void> {
  await apiFetch(`/api/pods/${id}/start`, { method: 'POST' })
}

export async function stopPod(id: string): Promise<void> {
  await apiFetch(`/api/pods/${id}/stop`, { method: 'POST' })
}

export async function deletePod(id: string): Promise<void> {
  await apiFetch(`/api/pods/${id}`, { method: 'DELETE' })
}

export async function getPodEvents(id: string): Promise<PodTimelineEvent[]> {
  const raw = await apiFetch<unknown>(`/api/pods/${id}/events`)
  const parsed = z.array(podEventSchema).parse(raw)
  return parsed.map((event) => ({
    id: event.id,
    pod_id: event.pod_id,
    event_type: event.event_type as PodEvent['event_type'],
    message: event.message,
    created_at: toDate(event.created_at),
  }))
}

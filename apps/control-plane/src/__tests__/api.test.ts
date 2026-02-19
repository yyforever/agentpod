import { after, before, beforeEach, test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { z } from 'zod'
import type { Hono } from 'hono'
import type { AgentAdapter, ContainerSpec, Pod } from '@agentpod/shared'
import {
  AdapterRegistry,
  DockerClient,
  PodService,
  TenantService,
  createDb,
  runMigrations,
} from '@agentpod/core'
import { createApp } from '../index.js'

const databaseUrl = process.env.DATABASE_URL

if (!databaseUrl) {
  test('control-plane API routes', { skip: true }, () => {})
} else {
  const client = createDb(databaseUrl)
  const tenantService = new TenantService(client.db)
  const originalApiKey = process.env.AGENTPOD_API_KEY

  let dataRoot = ''
  let podService: PodService
  let app: Hono
  let mockDocker: MockDockerClient

  const testAdapter: AgentAdapter = {
    meta: {
      id: 'test',
      label: 'Test Adapter',
      description: 'Adapter for tests',
      version: '1.0.0',
      category: 'custom',
      tags: ['test'],
    },
    containerSpec: {
      image: 'busybox:latest',
      command: ['sleep', '3600'],
      environment: {},
      volumes: [],
      ports: [{ container: 8080, protocol: 'tcp', primary: true }],
      healthCheck: {
        command: ['CMD', 'true'],
        intervalSeconds: 30,
        timeoutSeconds: 10,
        retries: 3,
        startPeriodSeconds: 1,
      },
      resources: { memoryMb: 128, cpus: 0.1 },
      restartPolicy: 'unless-stopped',
    },
    configSchema: {
      schema: z.object({ greeting: z.string().default('hello') }),
      uiHints: {},
      defaults: { greeting: 'hello' },
      envMapping: {},
    },
    lifecycle: {},
    resolveContainerSpec(_config: Record<string, unknown>, _platform): ContainerSpec {
      return this.containerSpec
    },
  }

  class MockDockerClient {
    lastLogOptions: { tail?: number; stdout?: boolean; stderr?: boolean } | null = null

    async createContainer(_pod: Pod): Promise<{ id: string }> {
      return { id: 'container-test' }
    }

    async startContainer(_id: string): Promise<void> {}

    async stopContainer(_id: string): Promise<void> {}

    async removeContainer(_id: string): Promise<void> {}

    async inspectContainer(): Promise<{ State: { Status: string; Running: boolean } }> {
      return { State: { Status: 'exited', Running: false } }
    }

    async getContainerByPodId(): Promise<{ Id: string }> {
      return { Id: 'container-test' }
    }

    async getContainerLogs(
      _id: string,
      options?: { tail?: number; stdout?: boolean; stderr?: boolean },
    ): Promise<string> {
      this.lastLogOptions = options ?? null
      return 'line-1\nline-2'
    }
  }

  async function resetDatabase(): Promise<void> {
    await client.pool.query(
      'TRUNCATE TABLE pod_events, pod_status, pod_configs, pods, tenants RESTART IDENTITY CASCADE',
    )
  }

  before(async () => {
    delete process.env.AGENTPOD_API_KEY
    await runMigrations(client.db)
    dataRoot = await mkdtemp(path.join(tmpdir(), 'agentpod-control-plane-api-'))

    const adapters = new AdapterRegistry()
    adapters.register(testAdapter)

    mockDocker = new MockDockerClient()
    podService = new PodService(
      client.db,
      mockDocker as unknown as DockerClient,
      adapters,
      {
        domain: 'localhost',
        dataDir: dataRoot,
        network: 'agentpod-net',
      },
    )

    app = createApp({ tenantService, podService })
  })

  beforeEach(async () => {
    await resetDatabase()
  })

  after(async () => {
    if (originalApiKey) {
      process.env.AGENTPOD_API_KEY = originalApiKey
    } else {
      delete process.env.AGENTPOD_API_KEY
    }

    if (dataRoot) {
      await rm(dataRoot, { recursive: true, force: true })
    }
    await client.pool.end()
  })

  test('POST /tenants creates tenant and returns 201', async () => {
    const response = await app.request('/api/tenants', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'Acme', email: 'owner@acme.test' }),
    })

    assert.equal(response.status, 201)
    const body = (await response.json()) as {
      id: string
      name: string
      email: string | null
    }
    assert.ok(body.id.length > 0)
    assert.equal(body.name, 'Acme')
    assert.equal(body.email, 'owner@acme.test')
  })

  test('POST /tenants with invalid body returns 400', async () => {
    const response = await app.request('/api/tenants', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: '' }),
    })

    assert.equal(response.status, 400)
    const body = (await response.json()) as { code?: string }
    assert.equal(body.code, 'VALIDATION_ERROR')
  })

  test('GET /tenants returns array', async () => {
    const tenantA = await tenantService.create({ name: 'Tenant A' })
    const tenantB = await tenantService.create({ name: 'Tenant B' })

    const response = await app.request('/api/tenants')
    assert.equal(response.status, 200)

    const rows = (await response.json()) as Array<{ id: string }>
    assert.equal(rows.length, 2)
    const ids = new Set(rows.map((row) => row.id))
    assert.ok(ids.has(tenantA.id))
    assert.ok(ids.has(tenantB.id))
  })

  test('GET /tenants/:id returns tenant', async () => {
    const tenant = await tenantService.create({ name: 'Tenant Detail' })

    const response = await app.request(`/api/tenants/${tenant.id}`)
    assert.equal(response.status, 200)

    const body = (await response.json()) as { id: string; name: string }
    assert.equal(body.id, tenant.id)
    assert.equal(body.name, 'Tenant Detail')
  })

  test('GET /tenants/:id with bad id returns 404', async () => {
    const response = await app.request('/api/tenants/non-existent')
    assert.equal(response.status, 404)

    const body = (await response.json()) as { code?: string }
    assert.equal(body.code, 'NOT_FOUND')
  })

  test('PUT /tenants/:id updates tenant and returns row', async () => {
    const tenant = await tenantService.create({ name: 'Tenant Before', email: 'before@test.dev' })

    const response = await app.request(`/api/tenants/${tenant.id}`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        name: 'Tenant After',
        email: 'after@test.dev',
      }),
    })

    assert.equal(response.status, 200)
    const body = (await response.json()) as { id: string; name: string; email: string | null }
    assert.equal(body.id, tenant.id)
    assert.equal(body.name, 'Tenant After')
    assert.equal(body.email, 'after@test.dev')
  })

  test('DELETE /tenants/:id deletes tenant without pods', async () => {
    const tenant = await tenantService.create({ name: 'Tenant Delete' })
    const response = await app.request(`/api/tenants/${tenant.id}`, { method: 'DELETE' })

    assert.equal(response.status, 200)
    const body = (await response.json()) as { id: string; deleted: boolean }
    assert.equal(body.id, tenant.id)
    assert.equal(body.deleted, true)
  })

  test('DELETE /tenants/:id returns 409 when tenant has pods', async () => {
    const tenant = await tenantService.create({ name: 'Tenant Conflict' })
    await podService.create({
      tenantId: tenant.id,
      name: 'Tenant Conflict Pod',
      adapterId: 'test',
    })

    const response = await app.request(`/api/tenants/${tenant.id}`, { method: 'DELETE' })
    assert.equal(response.status, 409)
    const body = (await response.json()) as { code?: string }
    assert.equal(body.code, 'CONFLICT')
  })

  test('GET /adapters returns registered adapters', async () => {
    const response = await app.request('/api/adapters')
    assert.equal(response.status, 200)

    const body = (await response.json()) as Array<{ id: string; label: string }>
    assert.equal(body.length, 1)
    assert.equal(body[0]?.id, 'test')
    assert.equal(body[0]?.label, 'Test Adapter')
  })

  test('GET /adapters/:id/config-schema returns dynamic schema', async () => {
    const response = await app.request('/api/adapters/test/config-schema')
    assert.equal(response.status, 200)

    const body = (await response.json()) as {
      adapter_id: string
      schema: {
        type: string
        properties: Record<string, { type: string; default?: unknown }>
        required: string[]
      }
      defaults: Record<string, unknown>
    }

    assert.equal(body.adapter_id, 'test')
    assert.equal(body.schema.type, 'object')
    assert.equal(body.schema.properties.greeting?.type, 'string')
    assert.equal(body.schema.properties.greeting?.default, 'hello')
    assert.equal(body.defaults.greeting, 'hello')
    assert.deepEqual(body.schema.required, [])
  })

  test('POST /pods creates pod and returns 201', async () => {
    const tenant = await tenantService.create({ name: 'Tenant Pod Create' })

    const response = await app.request('/api/pods', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        tenant_id: tenant.id,
        name: 'Pod A',
        adapter_id: 'test',
        config: { greeting: 'hi' },
      }),
    })

    assert.equal(response.status, 201)
    const body = (await response.json()) as {
      id: string
      tenant_id: string
      name: string
      desired_status: string
    }
    assert.ok(body.id.length > 0)
    assert.equal(body.tenant_id, tenant.id)
    assert.equal(body.name, 'Pod A')
    assert.equal(body.desired_status, 'running')
  })

  test('POST /pods with invalid body returns 400', async () => {
    const response = await app.request('/api/pods', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ tenant_id: 'x', adapter_id: 'test' }),
    })

    assert.equal(response.status, 400)
    const body = (await response.json()) as { code?: string }
    assert.equal(body.code, 'VALIDATION_ERROR')
  })

  test('POST /pods with invalid tenant_id returns 404', async () => {
    const response = await app.request('/api/pods', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        tenant_id: 'missing-tenant',
        name: 'Pod Missing Tenant',
        adapter_id: 'test',
      }),
    })

    assert.equal(response.status, 404)
    const body = (await response.json()) as { code?: string }
    assert.equal(body.code, 'NOT_FOUND')
  })

  test('GET /pods returns array', async () => {
    const tenant = await tenantService.create({ name: 'Tenant Pods List' })
    await podService.create({
      tenantId: tenant.id,
      name: 'Pod List A',
      adapterId: 'test',
    })
    await podService.create({
      tenantId: tenant.id,
      name: 'Pod List B',
      adapterId: 'test',
    })

    const response = await app.request('/api/pods')
    assert.equal(response.status, 200)

    const rows = (await response.json()) as Array<{ id: string }>
    assert.equal(rows.length, 2)
  })

  test('GET /pods?tenant_id=xxx filters by tenant', async () => {
    const tenantA = await tenantService.create({ name: 'Tenant Filter A' })
    const tenantB = await tenantService.create({ name: 'Tenant Filter B' })

    await podService.create({
      tenantId: tenantA.id,
      name: 'Pod Tenant A',
      adapterId: 'test',
    })
    await podService.create({
      tenantId: tenantB.id,
      name: 'Pod Tenant B',
      adapterId: 'test',
    })

    const response = await app.request(`/api/pods?tenant_id=${tenantA.id}`)
    assert.equal(response.status, 200)

    const rows = (await response.json()) as Array<{ tenant_id: string }>
    assert.equal(rows.length, 1)
    assert.equal(rows[0]?.tenant_id, tenantA.id)
  })

  test('GET /pods/:id returns pod with status and config', async () => {
    const tenant = await tenantService.create({ name: 'Tenant Pod Detail' })
    const pod = await podService.create({
      tenantId: tenant.id,
      name: 'Pod Detail',
      adapterId: 'test',
      config: { greeting: 'hello-detail' },
    })

    const response = await app.request(`/api/pods/${pod.id}`)
    assert.equal(response.status, 200)

    const body = (await response.json()) as {
      id: string
      status: { phase: string } | null
      config: Record<string, unknown> | null
    }

    assert.equal(body.id, pod.id)
    assert.equal(body.status?.phase, 'pending')
    assert.deepEqual(body.config, { greeting: 'hello-detail' })
  })

  test('POST /pods/:id/stop returns desired_status=stopped', async () => {
    const tenant = await tenantService.create({ name: 'Tenant Pod Stop' })
    const pod = await podService.create({
      tenantId: tenant.id,
      name: 'Pod Stop',
      adapterId: 'test',
    })

    const response = await app.request(`/api/pods/${pod.id}/stop`, { method: 'POST' })
    assert.equal(response.status, 200)

    const body = (await response.json()) as { id: string; desired_status: string }
    assert.equal(body.id, pod.id)
    assert.equal(body.desired_status, 'stopped')

    const updated = await podService.getById(pod.id)
    assert.equal(updated.desired_status, 'stopped')
  })

  test('POST /pods/:id/start returns desired_status=running', async () => {
    const tenant = await tenantService.create({ name: 'Tenant Pod Start' })
    const pod = await podService.create({
      tenantId: tenant.id,
      name: 'Pod Start',
      adapterId: 'test',
    })
    await podService.stop(pod.id)

    const response = await app.request(`/api/pods/${pod.id}/start`, { method: 'POST' })
    assert.equal(response.status, 200)

    const body = (await response.json()) as { id: string; desired_status: string }
    assert.equal(body.id, pod.id)
    assert.equal(body.desired_status, 'running')

    const updated = await podService.getById(pod.id)
    assert.equal(updated.desired_status, 'running')
  })

  test('DELETE /pods/:id returns desired_status=deleted', async () => {
    const tenant = await tenantService.create({ name: 'Tenant Pod Delete' })
    const pod = await podService.create({
      tenantId: tenant.id,
      name: 'Pod Delete',
      adapterId: 'test',
    })

    const response = await app.request(`/api/pods/${pod.id}`, { method: 'DELETE' })
    assert.equal(response.status, 200)

    const body = (await response.json()) as { id: string; desired_status: string }
    assert.equal(body.id, pod.id)
    assert.equal(body.desired_status, 'deleted')

    const updated = await podService.getById(pod.id)
    assert.equal(updated.desired_status, 'deleted')
  })

  test('GET /pods/events returns text/event-stream payload', async () => {
    const response = await app.request('/api/pods/events')
    assert.equal(response.status, 200)
    assert.equal(response.headers.get('content-type'), 'text/event-stream')

    const reader = response.body?.getReader()
    assert.ok(reader)

    const firstChunk = await reader.read()
    assert.equal(firstChunk.done, false)

    const text = new TextDecoder().decode(firstChunk.value)
    assert.match(text, /event: connected/)

    await reader.cancel()
  })

  test('GET /pods/events deduplicates matching timestamp updates across polls', async () => {
    const repeatedUpdateAt = new Date('2025-01-01T00:00:00.000Z')
    const originalListStatusChangesSince = podService.listStatusChangesSince.bind(podService)
    let reader: ReadableStreamDefaultReader<Uint8Array> | undefined

    podService.listStatusChangesSince = async (_since: Date) => {
      return [
        {
          pod_id: 'dedupe-pod',
          actual_status: 'running',
          desired_status: 'running',
          phase: 'running',
          message: null,
          updated_at: repeatedUpdateAt,
        },
      ]
    }

    const response = await app.request('/api/pods/events')
    assert.equal(response.status, 200)

    reader = response.body?.getReader()
    assert.ok(reader)

    try {
      const decoder = new TextDecoder()
      let firstPollText = ''
      while (!firstPollText.includes('event: pod.status')) {
        const chunk = await reader.read()
        if (chunk.done) {
          break
        }
        firstPollText += decoder.decode(chunk.value)
      }
      assert.match(firstPollText, /event: pod.status/)

      await new Promise((resolve) => setTimeout(resolve, 2_200))

      const secondPollChunk = await reader.read()
      assert.equal(secondPollChunk.done, false)
      const secondPollText = decoder.decode(secondPollChunk.value)
      assert.doesNotMatch(secondPollText, /event: pod.status/)
      assert.match(secondPollText, /: keepalive/)
    } finally {
      await reader.cancel()
      podService.listStatusChangesSince = originalListStatusChangesSince
    }
  })

  test('GET /pods/:id/logs returns logs content', async () => {
    const tenant = await tenantService.create({ name: 'Tenant Pod Logs' })
    const pod = await podService.create({
      tenantId: tenant.id,
      name: 'Pod Logs',
      adapterId: 'test',
    })

    const response = await app.request(`/api/pods/${pod.id}/logs`)
    assert.equal(response.status, 200)

    const body = (await response.json()) as {
      pod_id: string
      container_id: string
      logs: string
    }
    assert.equal(body.pod_id, pod.id)
    assert.equal(body.container_id, 'container-test')
    assert.equal(body.logs, 'line-1\nline-2')
    assert.equal(mockDocker.lastLogOptions?.tail, 200)
    assert.equal(mockDocker.lastLogOptions?.stdout, true)
    assert.equal(mockDocker.lastLogOptions?.stderr, true)
  })

  test('GET /pods/:id/logs caps tail query at 10000', async () => {
    const tenant = await tenantService.create({ name: 'Tenant Pod Logs Tail Cap' })
    const pod = await podService.create({
      tenantId: tenant.id,
      name: 'Pod Logs Tail Cap',
      adapterId: 'test',
    })

    const response = await app.request(`/api/pods/${pod.id}/logs?tail=20000`)
    assert.equal(response.status, 200)
    assert.equal(mockDocker.lastLogOptions?.tail, 10_000)
  })

  test('GET /pods/:id/events returns pod event timeline', async () => {
    const tenant = await tenantService.create({ name: 'Tenant Pod Events' })
    const pod = await podService.create({
      tenantId: tenant.id,
      name: 'Pod Events',
      adapterId: 'test',
    })
    await podService.stop(pod.id)

    const response = await app.request(`/api/pods/${pod.id}/events`)
    assert.equal(response.status, 200)

    const events = (await response.json()) as Array<{
      pod_id: string
      event_type: string
      message: string | null
      created_at: string
    }>

    assert.ok(events.length >= 2)
    assert.equal(events[0]?.pod_id, pod.id)
    assert.equal(events[0]?.event_type, 'stopped')
    assert.equal(events[1]?.event_type, 'created')
  })
}

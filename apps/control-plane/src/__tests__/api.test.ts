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

  let dataRoot = ''
  let podService: PodService
  let app: Hono

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
    async createContainer(_pod: Pod): Promise<{ id: string }> {
      return { id: 'container-test' }
    }

    async startContainer(_id: string): Promise<void> {}

    async stopContainer(_id: string): Promise<void> {}

    async removeContainer(_id: string): Promise<void> {}

    async inspectContainer(): Promise<{ State: { Status: string; Running: boolean } }> {
      return { State: { Status: 'exited', Running: false } }
    }

    async getContainerByPodId(): Promise<null> {
      return null
    }
  }

  async function resetDatabase(): Promise<void> {
    await client.pool.query(
      'TRUNCATE TABLE pod_events, pod_status, pod_configs, pods, tenants RESTART IDENTITY CASCADE',
    )
  }

  before(async () => {
    await runMigrations(client.db)
    dataRoot = await mkdtemp(path.join(tmpdir(), 'agentpod-control-plane-api-'))

    const adapters = new AdapterRegistry()
    adapters.register(testAdapter)

    const docker = new MockDockerClient()
    podService = new PodService(
      client.db,
      docker as unknown as DockerClient,
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
}

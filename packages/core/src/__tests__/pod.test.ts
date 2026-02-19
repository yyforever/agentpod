import { after, before, test } from 'node:test'
import assert from 'node:assert/strict'
import { randomBytes } from 'node:crypto'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { eq, sql } from 'drizzle-orm'
import { z } from 'zod'
import type { AgentAdapter, ContainerSpec } from '@agentpod/shared'
import {
  AdapterRegistry,
  DockerClient,
  PodService,
  TenantService,
  createDb,
  isEncrypted,
  runMigrations,
} from '../index.js'
import { pods, podStatus } from '../db/schema.js'

const databaseUrl = process.env.DATABASE_URL

if (!databaseUrl) {
  test('PodService lifecycle operations', { skip: true }, () => {})
} else {
  const client = createDb(databaseUrl)
  let dataRoot = ''

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

  async function resetDatabase(): Promise<void> {
    await client.db.execute(sql`
      TRUNCATE TABLE pod_events, pod_status, pod_configs, pods, tenants RESTART IDENTITY CASCADE
    `)
  }

  before(async () => {
    await runMigrations(client.db)
    await resetDatabase()
    dataRoot = await mkdtemp(path.join(tmpdir(), 'agentpod-core-pod-'))
  })

  after(async () => {
    if (dataRoot) {
      await rm(dataRoot, { recursive: true, force: true })
    }
    await client.pool.end()
  })

  test('PodService lifecycle operations', async () => {
    const tenantService = new TenantService(client.db)
    const tenant = await tenantService.create({ name: 'Tenant A' })

    const adapters = new AdapterRegistry()
    adapters.register(testAdapter)

    const podService = new PodService(client.db, new DockerClient(), adapters, {
      domain: 'localhost',
      dataDir: dataRoot,
      network: 'agentpod-net',
    })

    const pod = await podService.create({
      tenantId: tenant.id,
      name: 'First Pod',
      adapterId: 'test',
      config: { greeting: 'hi' },
    })

    assert.equal(pod.tenant_id, tenant.id)
    assert.equal(pod.desired_status, 'running')
    assert.equal(pod.actual_status, 'pending')

    const list = await podService.list(tenant.id)
    assert.equal(list.length, 1)
    assert.equal(list[0]?.id, pod.id)

    const detail = await podService.getById(pod.id)
    assert.equal(detail.id, pod.id)
    assert.deepEqual(detail.config, { greeting: 'hi' })
    assert.equal(detail.status?.phase, 'pending')

    await podService.stop(pod.id)
    const stopped = await podService.getById(pod.id)
    assert.equal(stopped.desired_status, 'stopped')

    await podService.start(pod.id)
    const restarted = await podService.getById(pod.id)
    assert.equal(restarted.desired_status, 'running')

    await podService.delete(pod.id)
    const deleted = await podService.getById(pod.id)
    assert.equal(deleted.desired_status, 'deleted')
  })

  test('PodService encrypts gateway_token at rest and decrypts on reads', async () => {
    const tenantService = new TenantService(client.db)
    const tenant = await tenantService.create({ name: 'Tenant Encrypted Token' })

    const adapters = new AdapterRegistry()
    adapters.register(testAdapter)

    const encryptionKey = randomBytes(32).toString('hex')
    const podService = new PodService(client.db, new DockerClient(), adapters, {
      domain: 'localhost',
      dataDir: dataRoot,
      network: 'agentpod-net',
      encryptionKey,
    })

    const created = await podService.create({
      tenantId: tenant.id,
      name: 'Encrypted Pod',
      adapterId: 'test',
    })

    const [stored] = await client.db
      .select({ gatewayToken: pods.gateway_token })
      .from(pods)
      .where(eq(pods.id, created.id))
      .limit(1)

    assert.ok(stored)
    assert.notEqual(stored.gatewayToken, created.gateway_token)
    assert.equal(isEncrypted(stored.gatewayToken), true)

    const fetched = await podService.getById(created.id)
    assert.equal(fetched.gateway_token, created.gateway_token)

    const listed = await podService.list(tenant.id)
    assert.equal(listed[0]?.gateway_token, created.gateway_token)
  })

  test('PodService listStatusChangesSince includes rows with matching timestamp', async () => {
    const tenantService = new TenantService(client.db)
    const tenant = await tenantService.create({ name: 'Tenant Status Boundary' })

    const adapters = new AdapterRegistry()
    adapters.register(testAdapter)

    const podService = new PodService(client.db, new DockerClient(), adapters, {
      domain: 'localhost',
      dataDir: dataRoot,
      network: 'agentpod-net',
    })

    const pod = await podService.create({
      tenantId: tenant.id,
      name: 'Status Boundary Pod',
      adapterId: 'test',
    })

    const boundary = new Date('2100-01-01T00:00:00.000Z')
    await client.db
      .update(podStatus)
      .set({ updated_at: boundary })
      .where(eq(podStatus.pod_id, pod.id))

    const changes = await podService.listStatusChangesSince(boundary)
    assert.equal(changes.length, 1)
    assert.equal(changes[0]?.pod_id, pod.id)
    assert.equal(changes[0]?.updated_at.toISOString(), boundary.toISOString())
  })
}

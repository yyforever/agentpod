import { after, before, test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { sql } from 'drizzle-orm'
import { z } from 'zod'
import type { AgentAdapter, ContainerSpec, Pod } from '@agentpod/shared'
import {
  AdapterRegistry,
  PodService,
  ReconcileService,
  TenantService,
  createDb,
  runMigrations,
} from '../index.js'
import { DockerClient } from '../docker.js'

const databaseUrl = process.env.DATABASE_URL

if (!databaseUrl) {
  test('ReconcileService aligns desired and actual states', { skip: true }, () => {})
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

  type ContainerState = {
    id: string
    running: boolean
    removed: boolean
  }

  class MockDockerClient {
    private readonly byPod = new Map<string, ContainerState>()

    async createContainer(pod: Pod): Promise<{ id: string }> {
      const id = `container-${pod.id}`
      this.byPod.set(pod.id, { id, running: false, removed: false })
      return { id }
    }

    async startContainer(id: string): Promise<void> {
      for (const state of this.byPod.values()) {
        if (state.id === id && !state.removed) {
          state.running = true
        }
      }
    }

    async stopContainer(id: string): Promise<void> {
      for (const state of this.byPod.values()) {
        if (state.id === id && !state.removed) {
          state.running = false
        }
      }
    }

    async removeContainer(id: string): Promise<void> {
      for (const [podId, state] of this.byPod.entries()) {
        if (state.id === id) {
          state.removed = true
          state.running = false
          this.byPod.delete(podId)
        }
      }
    }

    async inspectContainer(id: string): Promise<{ State: { Status: string; Running: boolean } }> {
      for (const state of this.byPod.values()) {
        if (state.id === id && !state.removed) {
          return {
            State: {
              Status: state.running ? 'running' : 'exited',
              Running: state.running,
            },
          }
        }
      }

      return { State: { Status: 'exited', Running: false } }
    }

    async getContainerByPodId(podId: string): Promise<{ Id: string } | null> {
      const state = this.byPod.get(podId)
      if (!state || state.removed) {
        return null
      }

      return { Id: state.id }
    }
  }

  async function resetDatabase(): Promise<void> {
    await client.db.execute(sql`
      TRUNCATE TABLE pod_events, pod_status, pod_configs, pods, tenants RESTART IDENTITY CASCADE
    `)
  }

  before(async () => {
    await runMigrations(client.db)
    await resetDatabase()
    dataRoot = await mkdtemp(path.join(tmpdir(), 'agentpod-core-reconcile-'))
  })

  after(async () => {
    if (dataRoot) {
      await rm(dataRoot, { recursive: true, force: true })
    }
    await client.pool.end()
  })

  test('ReconcileService aligns desired and actual states', async () => {
    const tenantService = new TenantService(client.db)
    const tenant = await tenantService.create({ name: 'Tenant R' })

    const adapters = new AdapterRegistry()
    adapters.register(testAdapter)

    const docker = new MockDockerClient()

    const podService = new PodService(
      client.db,
      docker as unknown as DockerClient,
      adapters,
      {
        domain: 'localhost',
        dataDir: dataRoot,
        network: 'agentpod-net',
      },
    )

    const pod = await podService.create({
      tenantId: tenant.id,
      name: 'Reconcile Pod',
      adapterId: 'test',
    })

    const reconciler = new ReconcileService(
      client.db,
      docker as unknown as DockerClient,
      adapters,
      { domain: 'localhost', network: 'agentpod-net' },
    )

    const first = await reconciler.reconcileOnce()
    assert.equal(first.total, 1)
    assert.equal(first.failed, 0)

    let updated = await podService.getById(pod.id)
    assert.equal(updated.actual_status, 'running')

    await podService.stop(pod.id)
    await reconciler.reconcileOnce()
    updated = await podService.getById(pod.id)
    assert.equal(updated.actual_status, 'stopped')

    await podService.delete(pod.id)
    await reconciler.reconcileOnce()
    updated = await podService.getById(pod.id)
    assert.equal(updated.actual_status, 'stopped')
    assert.equal(updated.container_id, null)
  })
}

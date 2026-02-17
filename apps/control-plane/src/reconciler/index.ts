import type { Pod, PodActualStatus, PodEventType } from '@agentpod/shared'
import { eq, inArray } from 'drizzle-orm'
import type { DbClient } from '../db/index.js'
import { podConfigs, podEvents, pods, podStatus } from '../db/schema.js'
import type { AdapterRegistry } from '../adapters/registry.js'
import { DockerClient } from '../docker/client.js'

const RECONCILE_INTERVAL_MS = 30_000

let timer: NodeJS.Timeout | null = null

function normalizePod(row: typeof pods.$inferSelect): Pod {
  const now = new Date()
  return {
    ...row,
    desired_status: row.desired_status as Pod['desired_status'],
    actual_status: row.actual_status as PodActualStatus,
    created_at: row.created_at ?? now,
    updated_at: row.updated_at ?? now,
  }
}

async function logEvent(
  db: DbClient,
  podId: string,
  eventType: PodEventType,
  message: string | null,
): Promise<void> {
  await db.insert(podEvents).values({
    pod_id: podId,
    event_type: eventType,
    message,
    created_at: new Date(),
  })
}

async function writeActualStatus(
  db: DbClient,
  podId: string,
  actualStatus: PodActualStatus,
  containerId?: string | null,
  message?: string,
): Promise<void> {
  const now = new Date()

  await db
    .update(pods)
    .set({
      actual_status: actualStatus,
      ...(containerId !== undefined ? { container_id: containerId } : {}),
      updated_at: now,
    })
    .where(eq(pods.id, podId))

  await db
    .insert(podStatus)
    .values({
      pod_id: podId,
      phase: actualStatus,
      ready: actualStatus === 'running',
      message: message ?? null,
      updated_at: now,
    })
    .onConflictDoUpdate({
      target: podStatus.pod_id,
      set: {
        phase: actualStatus,
        ready: actualStatus === 'running',
        message: message ?? null,
        updated_at: now,
      },
    })
}

async function reconcilePod(
  db: DbClient,
  dockerClient: DockerClient,
  adapterRegistry: AdapterRegistry,
  podRow: typeof pods.$inferSelect,
  config: Record<string, unknown>,
): Promise<void> {
  const pod = normalizePod(podRow)
  const adapter = adapterRegistry.get(pod.adapter_id)

  if (!adapter) {
    await writeActualStatus(db, pod.id, 'error', pod.container_id, 'Adapter not found')
    await logEvent(db, pod.id, 'error', `Adapter not found: ${pod.adapter_id}`)
    return
  }

  const container = await dockerClient.getContainerByPodId(pod.id)
  const hasContainer = container !== null
  const containerId = container?.Id

  if (pod.desired_status === 'running') {
    if (!hasContainer) {
      const spec = adapter.resolveContainerSpec(config, {
        domain: process.env.AGENTPOD_DOMAIN ?? 'localhost',
        dataDir: pod.data_dir,
      })
      const created = await dockerClient.createContainer(
        pod,
        spec,
        process.env.AGENTPOD_NETWORK ?? 'agentpod-net',
      )
      await dockerClient.startContainer(created.id)

      await writeActualStatus(db, pod.id, 'running', created.id)
      await logEvent(db, pod.id, 'created', `Container created: ${created.id}`)
      await logEvent(db, pod.id, 'started', 'Container started')
      return
    }

    if (!containerId) {
      await writeActualStatus(db, pod.id, 'error', null, 'Container id missing')
      await logEvent(db, pod.id, 'error', 'Container id missing')
      return
    }

    const inspect = await dockerClient.inspectContainer(containerId)
    const dockerStatus = inspect.State?.Status

    if (dockerStatus === 'running') {
      await writeActualStatus(db, pod.id, 'running', containerId)
      return
    }

    await dockerClient.startContainer(containerId)
    await writeActualStatus(db, pod.id, 'running', containerId)
    await logEvent(
      db,
      pod.id,
      dockerStatus === 'exited' ? 'restarted' : 'started',
      `Container transitioned from ${dockerStatus ?? 'unknown'} to running`,
    )
    return
  }

  if (pod.desired_status === 'stopped') {
    if (!hasContainer) {
      await writeActualStatus(db, pod.id, 'stopped', null)
      return
    }

    if (!containerId) {
      await writeActualStatus(db, pod.id, 'error', null, 'Container id missing')
      await logEvent(db, pod.id, 'error', 'Container id missing')
      return
    }

    const inspect = await dockerClient.inspectContainer(containerId)
    const isRunning = inspect.State?.Running === true

    if (isRunning) {
      await dockerClient.stopContainer(containerId)
      await logEvent(db, pod.id, 'stopped', 'Container stopped by reconciler')
    }

    await writeActualStatus(db, pod.id, 'stopped', containerId)
    return
  }

  if (pod.desired_status === 'deleted') {
    if (!hasContainer) {
      await writeActualStatus(db, pod.id, 'stopped', null)
      return
    }

    if (!containerId) {
      await writeActualStatus(db, pod.id, 'error', null, 'Container id missing')
      await logEvent(db, pod.id, 'error', 'Container id missing')
      return
    }

    if (adapter.lifecycle.onBeforeDelete) {
      await adapter.lifecycle.onBeforeDelete({
        pod,
        config,
        platform: {
          domain: process.env.AGENTPOD_DOMAIN ?? 'localhost',
          dataDir: pod.data_dir,
        },
      })
    }

    const inspect = await dockerClient.inspectContainer(containerId)
    if (inspect.State?.Running) {
      await dockerClient.stopContainer(containerId)
    }

    await dockerClient.removeContainer(containerId)
    await writeActualStatus(db, pod.id, 'stopped', null)
    await logEvent(db, pod.id, 'deleted', 'Container removed by reconciler')
  }
}

async function reconcile(
  db: DbClient,
  dockerClient: DockerClient,
  adapterRegistry: AdapterRegistry,
): Promise<void> {
  const rows = await db
    .select({
      pod: pods,
      config: podConfigs.config,
    })
    .from(pods)
    .leftJoin(podConfigs, eq(podConfigs.pod_id, pods.id))
    .where(inArray(pods.desired_status, ['running', 'stopped', 'deleted']))

  for (const row of rows) {
    try {
      await reconcilePod(db, dockerClient, adapterRegistry, row.pod, row.config ?? {})
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      await writeActualStatus(db, row.pod.id, 'error', row.pod.container_id, message)
      await logEvent(db, row.pod.id, 'error', message)
    }
  }
}

export function start(
  db: DbClient,
  dockerClient: DockerClient,
  adapterRegistry: AdapterRegistry,
): void {
  if (timer) {
    return
  }

  const run = async () => {
    try {
      await reconcile(db, dockerClient, adapterRegistry)
    } catch (error) {
      console.error('Reconciler loop failed', error)
    }
  }

  void run()
  timer = setInterval(() => {
    void run()
  }, RECONCILE_INTERVAL_MS)
}

export function stop(): void {
  if (!timer) {
    return
  }

  clearInterval(timer)
  timer = null
}

import { randomBytes, randomUUID } from 'node:crypto'
import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { Hono } from 'hono'
import { and, eq } from 'drizzle-orm'
import { ZodError } from 'zod'
import type { Pod, PodDesiredStatus } from '@agentpod/shared'
import type { DbClient } from '../db/index.js'
import { podConfigs, podEvents, pods, podStatus, tenants } from '../db/schema.js'
import type { AdapterRegistry } from '../adapters/registry.js'

function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 32)
}

async function generateSubdomain(db: DbClient, name: string): Promise<string> {
  const base = slugify(name) || 'pod'

  for (let i = 0; i < 10; i += 1) {
    const suffix = randomBytes(3).toString('hex')
    const candidate = `${base}-${suffix}`
    const [existing] = await db
      .select({ id: pods.id })
      .from(pods)
      .where(eq(pods.subdomain, candidate))
      .limit(1)

    if (!existing) {
      return candidate
    }
  }

  return `${base}-${randomUUID().slice(0, 8)}`
}

function toPod(row: typeof pods.$inferSelect): Pod {
  const now = new Date()
  return {
    ...row,
    desired_status: row.desired_status as PodDesiredStatus,
    actual_status: row.actual_status as Pod['actual_status'],
    created_at: row.created_at ?? now,
    updated_at: row.updated_at ?? now,
  }
}

async function writeInitialFiles(
  dataDir: string,
  files: Array<{ path: string; content: string }>,
): Promise<void> {
  for (const file of files) {
    const target = path.resolve(dataDir, file.path)
    const relative = path.relative(dataDir, target)

    if (relative.startsWith('..') || path.isAbsolute(relative)) {
      throw new Error(`initial file path escapes data dir: ${file.path}`)
    }

    await mkdir(path.dirname(target), { recursive: true })
    await writeFile(target, file.content, 'utf8')
  }
}

export function createPodRoutes(db: DbClient, adapterRegistry: AdapterRegistry): Hono {
  const app = new Hono()

  app.post('/pods', async (c) => {
    const body = (await c.req.json()) as {
      tenant_id?: string
      name?: string
      adapter_id?: string
      config?: Record<string, unknown>
    }

    if (!body.tenant_id || !body.name || !body.adapter_id) {
      return c.json(
        { error: 'tenant_id, name, and adapter_id are required' },
        400,
      )
    }

    const adapter = adapterRegistry.get(body.adapter_id)
    if (!adapter) {
      return c.json({ error: `adapter not found: ${body.adapter_id}` }, 400)
    }

    const [tenant] = await db
      .select({ id: tenants.id })
      .from(tenants)
      .where(eq(tenants.id, body.tenant_id))
      .limit(1)

    if (!tenant) {
      return c.json({ error: 'tenant not found' }, 404)
    }

    let config: Record<string, unknown>
    try {
      config = adapter.configSchema.schema.parse({
        ...adapter.configSchema.defaults,
        ...(body.config ?? {}),
      })
    } catch (error) {
      if (error instanceof ZodError) {
        return c.json({ error: 'invalid config', details: error.issues }, 400)
      }
      throw error
    }

    const now = new Date()
    const id = randomUUID()
    const subdomain = await generateSubdomain(db, body.name)
    const gatewayToken = randomBytes(32).toString('hex')
    const dataDirBase = process.env.AGENTPOD_DATA_DIR ?? '/data/pods'
    const dataDir = path.join(dataDirBase, id)

    const pod: Pod = {
      id,
      tenant_id: body.tenant_id,
      name: body.name,
      adapter_id: body.adapter_id,
      subdomain,
      desired_status: 'running',
      actual_status: 'pending',
      container_id: null,
      gateway_token: gatewayToken,
      data_dir: dataDir,
      created_at: now,
      updated_at: now,
    }

    await mkdir(dataDir, { recursive: true })

    if (adapter.lifecycle.onBeforeCreate) {
      const result = await adapter.lifecycle.onBeforeCreate({
        pod,
        config,
        platform: {
          domain: process.env.AGENTPOD_DOMAIN ?? 'localhost',
          dataDir,
        },
      })

      if (result.initialFiles && result.initialFiles.length > 0) {
        await writeInitialFiles(dataDir, result.initialFiles)
      }
    }

    await db.transaction(async (tx) => {
      await tx.insert(pods).values(pod)

      await tx.insert(podConfigs).values({
        pod_id: pod.id,
        config,
        updated_at: now,
      })

      await tx
        .insert(podStatus)
        .values({
          pod_id: pod.id,
          phase: 'pending',
          ready: false,
          message: 'Awaiting reconciler',
          updated_at: now,
        })
        .onConflictDoUpdate({
          target: podStatus.pod_id,
          set: {
            phase: 'pending',
            ready: false,
            message: 'Awaiting reconciler',
            updated_at: now,
          },
        })

      await tx.insert(podEvents).values({
        pod_id: pod.id,
        event_type: 'created',
        message: 'Pod created',
        created_at: now,
      })
    })

    return c.json(pod, 201)
  })

  app.get('/pods', async (c) => {
    const rows = await db
      .select({
        pod: pods,
        status: podStatus,
      })
      .from(pods)
      .leftJoin(podStatus, eq(podStatus.pod_id, pods.id))

    return c.json(
      rows.map((row) => ({
        ...toPod(row.pod),
        status: row.status,
      })),
    )
  })

  app.get('/pods/:id', async (c) => {
    const id = c.req.param('id')

    const [row] = await db
      .select({
        pod: pods,
        status: podStatus,
        config: podConfigs,
      })
      .from(pods)
      .leftJoin(podStatus, eq(podStatus.pod_id, pods.id))
      .leftJoin(podConfigs, eq(podConfigs.pod_id, pods.id))
      .where(eq(pods.id, id))
      .limit(1)

    if (!row) {
      return c.json({ error: 'pod not found' }, 404)
    }

    return c.json({
      ...toPod(row.pod),
      status: row.status,
      config: row.config?.config ?? null,
    })
  })

  app.delete('/pods/:id', async (c) => {
    const id = c.req.param('id')

    const [updated] = await db
      .update(pods)
      .set({ desired_status: 'deleted', updated_at: new Date() })
      .where(eq(pods.id, id))
      .returning({ id: pods.id })

    if (!updated) {
      return c.json({ error: 'pod not found' }, 404)
    }

    return c.json({ id, desired_status: 'deleted' })
  })

  app.post('/pods/:id/stop', async (c) => {
    const id = c.req.param('id')

    const [updated] = await db
      .update(pods)
      .set({ desired_status: 'stopped', updated_at: new Date() })
      .where(eq(pods.id, id))
      .returning({ id: pods.id })

    if (!updated) {
      return c.json({ error: 'pod not found' }, 404)
    }

    return c.json({ id, desired_status: 'stopped' })
  })

  app.post('/pods/:id/start', async (c) => {
    const id = c.req.param('id')

    const [updated] = await db
      .update(pods)
      .set({ desired_status: 'running', updated_at: new Date() })
      .where(and(eq(pods.id, id), eq(pods.desired_status, 'stopped')))
      .returning({ id: pods.id })

    if (!updated) {
      const [exists] = await db
        .select({ id: pods.id })
        .from(pods)
        .where(eq(pods.id, id))
        .limit(1)

      if (!exists) {
        return c.json({ error: 'pod not found' }, 404)
      }

      await db
        .update(pods)
        .set({ desired_status: 'running', updated_at: new Date() })
        .where(eq(pods.id, id))
    }

    return c.json({ id, desired_status: 'running' })
  })

  return app
}

import { Hono } from 'hono'
import type { PodService } from '@agentpod/core'

export function createPodRoutes(podService: PodService): Hono {
  const app = new Hono()

  app.post('/pods', async (c) => {
    const body = (await c.req.json()) as {
      tenant_id?: string
      name?: string
      adapter_id?: string
      config?: Record<string, unknown>
    }

    const pod = await podService.create({
      tenantId: body.tenant_id ?? '',
      name: body.name ?? '',
      adapterId: body.adapter_id ?? '',
      config: body.config,
    })

    return c.json(pod, 201)
  })

  app.get('/pods', async (c) => {
    const tenantId = c.req.query('tenant_id')
    const rows = await podService.list(tenantId)
    return c.json(rows)
  })

  app.get('/pods/:id', async (c) => {
    const row = await podService.getById(c.req.param('id'))
    return c.json(row)
  })

  app.delete('/pods/:id', async (c) => {
    const id = c.req.param('id')
    await podService.delete(id)
    return c.json({ id, desired_status: 'deleted' })
  })

  app.post('/pods/:id/stop', async (c) => {
    const id = c.req.param('id')
    await podService.stop(id)
    return c.json({ id, desired_status: 'stopped' })
  })

  app.post('/pods/:id/start', async (c) => {
    const id = c.req.param('id')
    await podService.start(id)
    return c.json({ id, desired_status: 'running' })
  })

  return app
}

import { Hono } from 'hono'
import { CoreError } from '@agentpod/core'
import type { PodService } from '@agentpod/core'
import { z } from 'zod'

const createPodBodySchema = z.object({
  tenant_id: z.string().trim().min(1),
  name: z.string().trim().min(1),
  adapter_id: z.string().trim().min(1),
  config: z.record(z.unknown()).optional(),
})

export function createPodRoutes(podService: PodService): Hono {
  const app = new Hono()

  app.post('/pods', async (c) => {
    const json = await c.req.json().catch(() => {
      throw new CoreError('VALIDATION_ERROR', 'invalid JSON body', 400)
    })
    const body = createPodBodySchema.safeParse(json)
    if (!body.success) {
      throw new CoreError('VALIDATION_ERROR', 'invalid request body', 400, body.error.issues)
    }

    const pod = await podService.create({
      tenantId: body.data.tenant_id,
      name: body.data.name,
      adapterId: body.data.adapter_id,
      config: body.data.config,
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

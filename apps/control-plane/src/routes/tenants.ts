import { Hono } from 'hono'
import { CoreError } from '@agentpod/core'
import type { TenantService } from '@agentpod/core'
import { z } from 'zod'

const createTenantBodySchema = z.object({
  name: z.string().trim().min(1),
  email: z.string().trim().optional(),
})

export function createTenantRoutes(tenantService: TenantService): Hono {
  const app = new Hono()

  app.post('/tenants', async (c) => {
    const json = await c.req.json().catch(() => {
      throw new CoreError('VALIDATION_ERROR', 'invalid JSON body', 400)
    })
    const body = createTenantBodySchema.safeParse(json)
    if (!body.success) {
      throw new CoreError('VALIDATION_ERROR', 'invalid request body', 400, body.error.issues)
    }

    const tenant = await tenantService.create({
      name: body.data.name,
      email: body.data.email,
    })
    return c.json(tenant, 201)
  })

  app.get('/tenants', async (c) => {
    const rows = await tenantService.list()
    return c.json(rows)
  })

  app.get('/tenants/:id', async (c) => {
    const tenant = await tenantService.getById(c.req.param('id'))
    return c.json(tenant)
  })

  return app
}

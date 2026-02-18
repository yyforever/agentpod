import { Hono } from 'hono'
import type { TenantService } from '@agentpod/core'

export function createTenantRoutes(tenantService: TenantService): Hono {
  const app = new Hono()

  app.post('/tenants', async (c) => {
    const body = (await c.req.json()) as { name?: string; email?: string }
    const tenant = await tenantService.create({
      name: body.name ?? '',
      email: body.email,
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

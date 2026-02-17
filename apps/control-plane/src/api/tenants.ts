import { Hono } from 'hono'
import { eq } from 'drizzle-orm'
import { randomUUID } from 'node:crypto'
import type { DbClient } from '../db/index.js'
import { tenants } from '../db/schema.js'

export function createTenantRoutes(db: DbClient): Hono {
  const app = new Hono()

  app.post('/tenants', async (c) => {
    const body = (await c.req.json()) as { name?: string; email?: string | null }

    if (!body.name || body.name.trim().length === 0) {
      return c.json({ error: 'name is required' }, 400)
    }

    const now = new Date()
    const tenant = {
      id: randomUUID(),
      name: body.name.trim(),
      email: body.email ?? null,
      created_at: now,
      updated_at: now,
    }

    await db.insert(tenants).values(tenant)

    return c.json(tenant, 201)
  })

  app.get('/tenants', async (c) => {
    const rows = await db.select().from(tenants)
    return c.json(rows)
  })

  app.get('/tenants/:id', async (c) => {
    const id = c.req.param('id')
    const [tenant] = await db.select().from(tenants).where(eq(tenants.id, id)).limit(1)

    if (!tenant) {
      return c.json({ error: 'tenant not found' }, 404)
    }

    return c.json(tenant)
  })

  return app
}

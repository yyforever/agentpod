import { eq } from 'drizzle-orm'
import { randomUUID } from 'node:crypto'
import type { Tenant } from '@agentpod/shared'
import { CoreError } from './errors.js'
import type { DbClient } from './db/index.js'
import { pods, tenants } from './db/schema.js'

function normalizeTenant(row: typeof tenants.$inferSelect): Tenant {
  const now = new Date()
  return {
    ...row,
    created_at: row.created_at ?? now,
    updated_at: row.updated_at ?? now,
  }
}

export class TenantService {
  constructor(private readonly db: DbClient) {}

  async create(input: { name: string; email?: string }): Promise<Tenant> {
    const name = input.name?.trim()
    if (!name) {
      throw new CoreError('VALIDATION_ERROR', 'name is required', 400)
    }

    const now = new Date()
    const tenant: Tenant = {
      id: randomUUID(),
      name,
      email: input.email ?? null,
      created_at: now,
      updated_at: now,
    }

    await this.db.insert(tenants).values(tenant)
    return tenant
  }

  async list(): Promise<Tenant[]> {
    const rows = await this.db.select().from(tenants)
    return rows.map(normalizeTenant)
  }

  async getById(id: string): Promise<Tenant> {
    const [tenant] = await this.db.select().from(tenants).where(eq(tenants.id, id)).limit(1)
    if (!tenant) {
      throw new CoreError('NOT_FOUND', 'tenant not found', 404)
    }
    return normalizeTenant(tenant)
  }

  async delete(id: string): Promise<void> {
    const [tenant] = await this.db.select({ id: tenants.id }).from(tenants).where(eq(tenants.id, id))

    if (!tenant) {
      throw new CoreError('NOT_FOUND', 'tenant not found', 404)
    }

    const [pod] = await this.db.select({ id: pods.id }).from(pods).where(eq(pods.tenant_id, id)).limit(1)
    if (pod) {
      throw new CoreError('CONFLICT', 'cannot delete tenant with existing pods', 409)
    }

    await this.db.delete(tenants).where(eq(tenants.id, id))
  }
}

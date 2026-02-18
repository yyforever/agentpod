import { after, before, test } from 'node:test'
import assert from 'node:assert/strict'
import { sql } from 'drizzle-orm'
import { TenantService, createDb, runMigrations } from '../index.js'

const databaseUrl = process.env.DATABASE_URL

if (!databaseUrl) {
  test('TenantService CRUD operations', { skip: true }, () => {})
} else {
  const client = createDb(databaseUrl)
  const tenantService = new TenantService(client.db)

  async function resetDatabase(): Promise<void> {
    await client.db.execute(sql`
      TRUNCATE TABLE pod_events, pod_status, pod_configs, pods, tenants RESTART IDENTITY CASCADE
    `)
  }

  before(async () => {
    await runMigrations(client.db)
    await resetDatabase()
  })

  after(async () => {
    await client.pool.end()
  })

  test('TenantService CRUD operations', async () => {
    const created = await tenantService.create({
      name: 'Acme',
      email: 'owner@acme.test',
    })

    assert.ok(created.id.length > 0)
    assert.equal(created.name, 'Acme')
    assert.equal(created.email, 'owner@acme.test')

    const fetched = await tenantService.getById(created.id)
    assert.equal(fetched.id, created.id)

    const listed = await tenantService.list()
    assert.equal(listed.length, 1)
    assert.equal(listed[0]?.id, created.id)

    await tenantService.delete(created.id)

    const afterDelete = await tenantService.list()
    assert.equal(afterDelete.length, 0)
  })
}

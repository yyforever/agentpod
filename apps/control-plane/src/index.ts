import { serve } from '@hono/node-server'
import { Hono } from 'hono'
import { db, pool } from './db/index.js'
import { runMigrations } from './db/migrate.js'
import { createTenantRoutes } from './api/tenants.js'
import { createPodRoutes } from './api/pods.js'
import { AdapterRegistry } from './adapters/registry.js'
import { openclawAdapter } from './adapters/openclaw.js'
import { DockerClient } from './docker/client.js'
import { start as startReconciler, stop as stopReconciler } from './reconciler/index.js'

const app = new Hono()

app.get('/health', (c) => {
  return c.json({ status: 'ok', timestamp: new Date().toISOString() })
})

const adapterRegistry = new AdapterRegistry()
adapterRegistry.register(openclawAdapter)

app.route('/api', createTenantRoutes(db))
app.route('/api', createPodRoutes(db, adapterRegistry))

const port = Number.parseInt(process.env.PORT ?? '4000', 10)
const dockerClient = new DockerClient()

let shuttingDown = false

async function bootstrap(): Promise<void> {
  await runMigrations()

  startReconciler(db, dockerClient, adapterRegistry)

  const server = serve({ fetch: app.fetch, port }, () => {
    console.log(`Control plane listening on port ${port}`)
  })

  const shutdown = async (signal: string) => {
    if (shuttingDown) {
      return
    }
    shuttingDown = true

    console.log(`Received ${signal}, shutting down...`)
    stopReconciler()

    await new Promise<void>((resolve) => {
      server.close(() => resolve())
    })

    await pool.end()
    process.exit(0)
  }

  process.on('SIGINT', () => {
    void shutdown('SIGINT')
  })

  process.on('SIGTERM', () => {
    void shutdown('SIGTERM')
  })
}

bootstrap().catch(async (error) => {
  console.error('Failed to start control plane', error)
  await pool.end()
  process.exit(1)
})

export { app }

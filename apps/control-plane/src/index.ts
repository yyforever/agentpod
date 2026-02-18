import { serve } from '@hono/node-server'
import { Hono } from 'hono'
import {
  AdapterRegistry,
  DockerClient,
  PodService,
  ReconcileService,
  TenantService,
  createDb,
  openclawAdapter,
  runMigrations,
} from '@agentpod/core'
import { authPlaceholder, errorHandler, requestLogger } from './middleware.js'
import { createPodRoutes } from './routes/pods.js'
import { createTenantRoutes } from './routes/tenants.js'

const app = new Hono()

app.use('*', requestLogger)
app.use('/api/*', authPlaceholder)
app.onError(errorHandler)

app.get('/health', (c) => {
  return c.json({ status: 'ok', timestamp: new Date().toISOString() })
})

const { db, pool } = createDb()
const adapterRegistry = new AdapterRegistry()
adapterRegistry.register(openclawAdapter)

const dockerClient = new DockerClient()
const tenantService = new TenantService(db)
const podService = new PodService(db, dockerClient, adapterRegistry, {
  domain: process.env.AGENTPOD_DOMAIN ?? 'localhost',
  dataDir: process.env.AGENTPOD_DATA_DIR ?? '/data/pods',
  network: process.env.AGENTPOD_NETWORK ?? 'agentpod-net',
})
const reconciler = new ReconcileService(db, dockerClient, adapterRegistry, {
  domain: process.env.AGENTPOD_DOMAIN ?? 'localhost',
  network: process.env.AGENTPOD_NETWORK ?? 'agentpod-net',
})

app.route('/api', createTenantRoutes(tenantService))
app.route('/api', createPodRoutes(podService))

const port = Number.parseInt(process.env.PORT ?? '4000', 10)
let shuttingDown = false

async function bootstrap(): Promise<void> {
  await runMigrations(db)
  reconciler.start()

  const server = serve({ fetch: app.fetch, port }, () => {
    console.log(`Control plane listening on port ${port}`)
  })

  const shutdown = async (signal: string) => {
    if (shuttingDown) {
      return
    }

    shuttingDown = true
    console.log(`Received ${signal}, shutting down...`)

    reconciler.stop()

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

bootstrap().catch(async (error: unknown) => {
  console.error('Failed to start control plane', error)
  await pool.end()
  process.exit(1)
})

export { app }

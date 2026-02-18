import { Command } from 'commander'
import {
  AdapterRegistry,
  DockerClient,
  PodService,
  TenantService,
  createDb,
  openclawAdapter,
  runMigrations,
} from '@agentpod/core'
import { createPodCommands } from './commands/pod.js'
import { createStatusCommand } from './commands/status.js'
import { createTenantCommands } from './commands/tenant.js'

const program = new Command()

async function main(): Promise<void> {
  const { db, pool } = createDb()
  await runMigrations(db)

  const adapters = new AdapterRegistry()
  adapters.register(openclawAdapter)

  const docker = new DockerClient()
  const tenantService = new TenantService(db)
  const podService = new PodService(db, docker, adapters, {
    domain: process.env.AGENTPOD_DOMAIN ?? 'localhost',
    dataDir: process.env.AGENTPOD_DATA_DIR ?? '/data/pods',
    network: process.env.AGENTPOD_NETWORK ?? 'agentpod-net',
  })

  program
    .name('agentpod')
    .description('AgentPod command line interface')
    .addCommand(createTenantCommands(tenantService))
    .addCommand(createPodCommands(podService))
    .addCommand(createStatusCommand(tenantService, podService))

  try {
    await program.parseAsync(process.argv)
  } finally {
    await pool.end()
  }
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error)
  console.error(message)
  process.exit(1)
})

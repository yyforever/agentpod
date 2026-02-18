import { Command } from 'commander'
import { readFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import path from 'node:path'
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
const API_KEY_FLAG = '--api-key'

function readApiKeyFromArgs(argv: string[]): string | undefined {
  for (let i = 2; i < argv.length; i += 1) {
    const arg = argv[i]
    if (!arg) {
      continue
    }

    if (arg.startsWith(`${API_KEY_FLAG}=`)) {
      const value = arg.slice(`${API_KEY_FLAG}=`.length).trim()
      return value.length > 0 ? value : undefined
    }

    if (arg === API_KEY_FLAG) {
      const value = argv[i + 1]?.trim()
      return value && !value.startsWith('-') ? value : undefined
    }
  }

  return undefined
}

async function readApiKeyFromConfig(): Promise<string | undefined> {
  const configPath = path.join(homedir(), '.agentpod', 'config.json')

  try {
    const raw = await readFile(configPath, 'utf8')
    const parsed = JSON.parse(raw) as unknown
    if (!parsed || typeof parsed !== 'object') {
      return undefined
    }

    const apiKey = (parsed as { apiKey?: unknown }).apiKey
    if (typeof apiKey !== 'string') {
      return undefined
    }

    const trimmed = apiKey.trim()
    return trimmed.length > 0 ? trimmed : undefined
  } catch (error) {
    const nodeError = error as NodeJS.ErrnoException
    if (nodeError.code === 'ENOENT') {
      return undefined
    }

    throw error
  }
}

async function resolveApiKey(argv: string[]): Promise<string | undefined> {
  const fromFlag = readApiKeyFromArgs(argv)
  if (fromFlag) {
    return fromFlag
  }

  const fromEnv = process.env.AGENTPOD_API_KEY?.trim()
  if (fromEnv) {
    return fromEnv
  }

  return readApiKeyFromConfig()
}

function installApiKeyHeader(apiKey: string | undefined): void {
  if (!apiKey) {
    return
  }

  const originalFetch = globalThis.fetch.bind(globalThis)
  globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const headers = new Headers(input instanceof Request ? input.headers : undefined)

    if (init?.headers) {
      const initHeaders = new Headers(init.headers)
      for (const [name, value] of initHeaders.entries()) {
        headers.set(name, value)
      }
    }

    headers.set('Authorization', `Bearer ${apiKey}`)
    return originalFetch(input, { ...init, headers })
  }
}

async function main(): Promise<void> {
  const apiKey = await resolveApiKey(process.argv)
  if (apiKey) {
    process.env.AGENTPOD_API_KEY = apiKey
  }
  installApiKeyHeader(apiKey)

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
    encryptionKey: process.env.AGENTPOD_ENCRYPTION_KEY,
  })

  program
    .name('agentpod')
    .description('AgentPod command line interface')
    .option('--api-key <apiKey>', 'API key used for Authorization: Bearer in HTTP requests')
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

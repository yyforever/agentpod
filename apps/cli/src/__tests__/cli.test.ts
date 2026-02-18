import assert from 'node:assert/strict'
import { execFile, spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { mkdir, rm } from 'node:fs/promises'
import path from 'node:path'
import { after, before, test } from 'node:test'
import { setTimeout as delay } from 'node:timers/promises'
import { fileURLToPath } from 'node:url'
import { createDb, runMigrations } from '@agentpod/core'

const databaseUrl = process.env.DATABASE_URL

if (!databaseUrl) {
  test('CLI integration tests', { skip: true }, () => {})
} else {
  const testEncryptionKey =
    '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef'
  const controlPlaneUrl = 'http://localhost:4000'
  const cliDataDir = '/tmp/agentpod-cli-test'
  const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../../')

  const client = createDb(databaseUrl)
  let controlPlane: ChildProcessWithoutNullStreams | null = null
  let controlPlaneStdout = ''
  let controlPlaneStderr = ''

  function createTestEnv(): NodeJS.ProcessEnv {
    return {
      ...process.env,
      DATABASE_URL: databaseUrl,
      AGENTPOD_API_URL: controlPlaneUrl,
      AGENTPOD_DATA_DIR: cliDataDir,
      AGENTPOD_DOMAIN: 'localhost',
      AGENTPOD_NETWORK: 'agentpod-net',
      AGENTPOD_API_KEY: '',
      AGENTPOD_ENCRYPTION_KEY: testEncryptionKey,
      FORCE_COLOR: '0',
    }
  }

  async function resetDatabase(): Promise<void> {
    await client.pool.query(
      'TRUNCATE TABLE pod_events, pod_status, pod_configs, pods, tenants RESTART IDENTITY CASCADE',
    )
  }

  async function waitForControlPlaneReady(timeoutMs = 20_000): Promise<void> {
    const deadline = Date.now() + timeoutMs

    while (Date.now() < deadline) {
      if (controlPlane && controlPlane.exitCode !== null) {
        throw new Error(
          `control-plane exited before ready (code=${controlPlane.exitCode})\nstdout:\n${controlPlaneStdout}\nstderr:\n${controlPlaneStderr}`,
        )
      }

      try {
        const response = await fetch(`${controlPlaneUrl}/api/tenants`)
        if (response.status === 200) {
          return
        }
      } catch {
        // Keep polling until timeout.
      }

      await delay(250)
    }

    throw new Error(
      `control-plane did not become ready within ${timeoutMs}ms\nstdout:\n${controlPlaneStdout}\nstderr:\n${controlPlaneStderr}`,
    )
  }

  function startControlPlane(): void {
    controlPlaneStdout = ''
    controlPlaneStderr = ''

    controlPlane = spawn('node', ['--import', 'tsx', 'apps/control-plane/src/index.ts'], {
      cwd: repoRoot,
      env: {
        ...createTestEnv(),
        PORT: '4000',
      },
      stdio: 'pipe',
    })

    controlPlane.stdout.on('data', (chunk: Buffer) => {
      controlPlaneStdout += chunk.toString('utf8')
    })

    controlPlane.stderr.on('data', (chunk: Buffer) => {
      controlPlaneStderr += chunk.toString('utf8')
    })
  }

  async function stopControlPlane(): Promise<void> {
    const child = controlPlane
    controlPlane = null

    if (!child) {
      return
    }

    if (child.exitCode !== null) {
      return
    }

    child.kill('SIGTERM')

    await Promise.race([
      new Promise<void>((resolve) => {
        child.once('exit', () => resolve())
      }),
      delay(5_000),
    ])

    if (child.exitCode === null) {
      child.kill('SIGKILL')
      await new Promise<void>((resolve) => {
        child.once('exit', () => resolve())
      })
    }
  }

  function extractId(output: string, entity: 'tenant' | 'pod'): string {
    const regex =
      entity === 'tenant'
        ? /Created tenant ([0-9a-fA-F-]{36})/
        : /Created pod ([0-9a-fA-F-]{36})/
    const match = output.match(regex)
    assert.ok(match?.[1], `failed to extract ${entity} id from output:\n${output}`)
    return match[1]
  }

  async function getDesiredStatus(podId: string): Promise<string | null> {
    const result = await client.pool.query<{ desired_status: string }>(
      'SELECT desired_status FROM pods WHERE id = $1 LIMIT 1',
      [podId],
    )

    return result.rows[0]?.desired_status ?? null
  }

  function runCli(args: string[]): Promise<{ stdout: string; stderr: string; code: number }> {
    return new Promise((resolve) => {
      execFile(
        'node',
        ['--import', 'tsx', 'apps/cli/src/index.ts', ...args],
        {
          cwd: repoRoot,
          env: createTestEnv(),
          maxBuffer: 10 * 1024 * 1024,
        },
        (error, stdout, stderr) => {
          const code = (() => {
            if (!error) {
              return 0
            }

            const err = error as NodeJS.ErrnoException & { code?: number | string }
            return typeof err.code === 'number' ? err.code : 1
          })()

          resolve({ stdout, stderr, code })
        },
      )
    })
  }

  before(async () => {
    await runMigrations(client.db)
    await resetDatabase()
    await rm(cliDataDir, { recursive: true, force: true })
    await mkdir(cliDataDir, { recursive: true })
    startControlPlane()
    await waitForControlPlaneReady()
  })

  after(async () => {
    await stopControlPlane()
    await rm(cliDataDir, { recursive: true, force: true })
    await client.pool.end()
  })

  test('CLI commands', async (t) => {
    let tenantId = ''
    let podId = ''

    await t.test('1. tenant list returns success', async () => {
      const result = await runCli(['tenant', 'list'])
      assert.equal(result.code, 0)
      assert.match(result.stdout, /\b(index|┌|\[\])\b|^$/m)
    })

    await t.test('2. tenant create returns success', async () => {
      const result = await runCli([
        'tenant',
        'create',
        '--name',
        'test-tenant',
        '--email',
        'test@test.com',
      ])

      assert.equal(result.code, 0)
      tenantId = extractId(result.stdout, 'tenant')
    })

    await t.test('3. tenant list includes created tenant', async () => {
      const result = await runCli(['tenant', 'list'])
      assert.equal(result.code, 0)
      assert.match(result.stdout, new RegExp(tenantId))
    })

    await t.test('4. pod create returns success', async () => {
      const result = await runCli([
        'pod',
        'create',
        '--tenant-id',
        tenantId,
        '--name',
        'test-pod',
        '--adapter-id',
        'openclaw',
      ])

      assert.equal(result.code, 0)
      podId = extractId(result.stdout, 'pod')
    })

    await t.test('5. pod list includes created pod', async () => {
      const result = await runCli(['pod', 'list'])
      assert.equal(result.code, 0)
      assert.match(result.stdout, new RegExp(podId))
    })

    await t.test('6. pod stop sets desired_status=stopped', async () => {
      const result = await runCli(['pod', 'stop', podId])
      assert.equal(result.code, 0)
      assert.equal(await getDesiredStatus(podId), 'stopped')
    })

    await t.test('7. pod start sets desired_status=running', async () => {
      const result = await runCli(['pod', 'start', podId])
      assert.equal(result.code, 0)
      assert.equal(await getDesiredStatus(podId), 'running')
    })

    await t.test('8. pod delete sets desired_status=deleted', async () => {
      const result = await runCli(['pod', 'delete', podId])
      assert.equal(result.code, 0)
      assert.equal(await getDesiredStatus(podId), 'deleted')
    })

    await t.test('9. status shows overview', async () => {
      const result = await runCli(['status'])
      assert.equal(result.code, 0)
      assert.match(result.stdout, /AgentPod Status/)
    })

    await t.test('10. invalid command exits non-zero', async () => {
      const result = await runCli(['invalid-command'])
      assert.notEqual(result.code, 0)
      assert.match(result.stderr, /unknown command|error:/i)
    })
  })
}

import chalk from 'chalk'
import { Command } from 'commander'
import { CoreError, PodService } from '@agentpod/core'

function printTable(rows: Array<Record<string, unknown>>): void {
  console.table(rows)
}

function handleError(error: unknown): never {
  if (error instanceof CoreError) {
    console.error(chalk.red(`Error [${error.code}]: ${error.message}`))
    if (error.details) {
      console.error(chalk.gray(JSON.stringify(error.details, null, 2)))
    }
    process.exit(1)
  }

  const message = error instanceof Error ? error.message : String(error)
  console.error(chalk.red(`Error: ${message}`))
  process.exit(1)
}

export function createPodCommands(podService: PodService): Command {
  const command = new Command('pod').description('Manage pods')

  command
    .command('list')
    .description('List pods')
    .option('--tenant <tenantId>', 'Filter by tenant id')
    .action(async (options: { tenant?: string }) => {
      try {
        const pods = await podService.list(options.tenant)
        printTable(
          pods.map((pod) => ({
            id: pod.id,
            tenantId: pod.tenant_id,
            name: pod.name,
            adapter: pod.adapter_id,
            desired: pod.desired_status,
            actual: pod.actual_status,
            phase: pod.status?.phase ?? '-',
            ready: pod.status?.ready ?? false,
          })),
        )
      } catch (error) {
        handleError(error)
      }
    })

  command
    .command('create')
    .description('Create a pod')
    .requiredOption('--tenant <tenantId>', 'Tenant id')
    .requiredOption('--name <name>', 'Pod name')
    .requiredOption('--adapter <adapterId>', 'Adapter id')
    .option('--config <json>', 'JSON config string')
    .action(
      async (options: {
        tenant: string
        name: string
        adapter: string
        config?: string
      }) => {
        try {
          const config = options.config
            ? (JSON.parse(options.config) as Record<string, unknown>)
            : undefined

          const pod = await podService.create({
            tenantId: options.tenant,
            name: options.name,
            adapterId: options.adapter,
            config,
          })

          console.log(chalk.green(`Created pod ${pod.id}`))
          printTable([
            {
              id: pod.id,
              name: pod.name,
              tenantId: pod.tenant_id,
              subdomain: pod.subdomain,
              desired: pod.desired_status,
            },
          ])
        } catch (error) {
          handleError(error)
        }
      },
    )

  command
    .command('start')
    .description('Set pod desired status to running')
    .argument('<podId>', 'Pod id')
    .action(async (podId: string) => {
      try {
        await podService.start(podId)
        console.log(chalk.green(`Pod ${podId} set to running`))
      } catch (error) {
        handleError(error)
      }
    })

  command
    .command('stop')
    .description('Set pod desired status to stopped')
    .argument('<podId>', 'Pod id')
    .action(async (podId: string) => {
      try {
        await podService.stop(podId)
        console.log(chalk.green(`Pod ${podId} set to stopped`))
      } catch (error) {
        handleError(error)
      }
    })

  command
    .command('delete')
    .description('Set pod desired status to deleted')
    .argument('<podId>', 'Pod id')
    .action(async (podId: string) => {
      try {
        await podService.delete(podId)
        console.log(chalk.green(`Pod ${podId} set to deleted`))
      } catch (error) {
        handleError(error)
      }
    })

  command
    .command('logs')
    .description('Show container logs for a pod')
    .argument('<podId>', 'Pod id')
    .option('--tail <number>', 'Number of lines to fetch', '200')
    .action(async (podId: string, options: { tail: string }) => {
      try {
        const pod = await podService.getById(podId)
        const containerId = pod.container_id
        if (!containerId) {
          throw new CoreError('NOT_FOUND', 'pod has no container id yet', 404)
        }

        const tail = Number.parseInt(options.tail, 10)
        const logs = await podService.getDockerClient().getContainerLogs(containerId, {
          tail: Number.isFinite(tail) ? tail : 200,
        })
        process.stdout.write(logs)
      } catch (error) {
        handleError(error)
      }
    })

  return command
}

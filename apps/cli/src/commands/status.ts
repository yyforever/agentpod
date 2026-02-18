import chalk from 'chalk'
import { Command } from 'commander'
import { CoreError, PodService, TenantService } from '@agentpod/core'

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

export function createStatusCommand(
  tenantService: TenantService,
  podService: PodService,
): Command {
  return new Command('status')
    .description('Show control plane status overview')
    .action(async () => {
      try {
        const [tenants, pods] = await Promise.all([tenantService.list(), podService.list()])

        const running = pods.filter((pod) => pod.actual_status === 'running').length
        const stopped = pods.filter((pod) => pod.actual_status === 'stopped').length
        const pending = pods.filter((pod) => pod.actual_status === 'pending').length
        const errored = pods.filter((pod) => pod.actual_status === 'error').length

        console.log(chalk.cyan('AgentPod Status'))
        console.table([
          {
            tenants: tenants.length,
            pods: pods.length,
            running,
            stopped,
            pending,
            error: errored,
          },
        ])
      } catch (error) {
        handleError(error)
      }
    })
}

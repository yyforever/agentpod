import chalk from 'chalk'
import { Command } from 'commander'
import { PodService, TenantService } from '@agentpod/core'

export function createStatusCommand(
  tenantService: TenantService,
  podService: PodService,
): Command {
  return new Command('status')
    .description('Show control plane status overview')
    .action(async () => {
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
    })
}

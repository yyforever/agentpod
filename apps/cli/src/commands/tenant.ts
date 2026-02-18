import chalk from 'chalk'
import { Command } from 'commander'
import { CoreError, TenantService } from '@agentpod/core'

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

export function createTenantCommands(tenantService: TenantService): Command {
  const command = new Command('tenant').description('Manage tenants')

  command
    .command('list')
    .description('List all tenants')
    .action(async () => {
      try {
        const tenants = await tenantService.list()
        printTable(
          tenants.map((tenant) => ({
            id: tenant.id,
            name: tenant.name,
            email: tenant.email,
            createdAt: tenant.created_at.toISOString(),
          })),
        )
      } catch (error) {
        handleError(error)
      }
    })

  command
    .command('create')
    .description('Create a tenant')
    .requiredOption('--name <name>', 'Tenant display name')
    .option('--email <email>', 'Tenant email')
    .action(async (options: { name: string; email?: string }) => {
      try {
        const tenant = await tenantService.create({
          name: options.name,
          email: options.email,
        })
        console.log(chalk.green(`Created tenant ${tenant.id}`))
        printTable([
          {
            id: tenant.id,
            name: tenant.name,
            email: tenant.email,
          },
        ])
      } catch (error) {
        handleError(error)
      }
    })

  command
    .command('delete')
    .description('Delete a tenant')
    .argument('<tenantId>', 'Tenant id')
    .action(async (tenantId: string) => {
      try {
        await tenantService.delete(tenantId)
        console.log(chalk.green(`Deleted tenant ${tenantId}`))
      } catch (error) {
        handleError(error)
      }
    })

  return command
}

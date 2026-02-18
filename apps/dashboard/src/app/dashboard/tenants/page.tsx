import { createTenantAction } from '@/app/dashboard/actions'
import { CreateTenantDialog } from '@/components/dashboard/create-tenant-dialog'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { formatDate } from '@/lib/format'
import { getPods, getTenants } from '@/lib/api'

type TenantsPageProps = {
  searchParams: Promise<{ error?: string }>
}

export default async function TenantsPage({ searchParams }: TenantsPageProps) {
  const [tenants, pods, params] = await Promise.all([getTenants(), getPods(), searchParams])

  const hasError = params.error === 'invalid_input'

  return (
    <section className="space-y-4 pb-20 md:pb-0">
      <div className="flex items-center justify-between gap-2">
        <h1 className="text-2xl font-semibold">Tenants</h1>
        <CreateTenantDialog action={createTenantAction} />
      </div>

      {hasError ? <p className="text-sm text-red-400">Please provide a valid tenant name.</p> : null}

      <div className="rounded-lg border border-zinc-800 bg-zinc-900/60 p-2">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Name</TableHead>
              <TableHead>Email</TableHead>
              <TableHead>Created</TableHead>
              <TableHead>Pod Count</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {tenants.length === 0 ? (
              <TableRow>
                <TableCell className="text-center text-zinc-400" colSpan={4}>
                  No tenants found.
                </TableCell>
              </TableRow>
            ) : (
              tenants.map((tenant) => {
                const podCount = pods.filter((pod) => pod.tenant_id === tenant.id).length

                return (
                  <TableRow key={tenant.id}>
                    <TableCell>{tenant.name}</TableCell>
                    <TableCell>{tenant.email ?? '—'}</TableCell>
                    <TableCell>{formatDate(tenant.created_at)}</TableCell>
                    <TableCell>{podCount}</TableCell>
                  </TableRow>
                )
              })
            )}
          </TableBody>
        </Table>
      </div>
    </section>
  )
}

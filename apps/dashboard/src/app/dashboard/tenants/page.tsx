import {
  createTenantAction,
  deleteTenantAction,
  updateTenantAction,
} from '@/app/dashboard/actions'
import { CreateTenantDialog } from '@/components/dashboard/create-tenant-dialog'
import { TenantRowActions } from '@/components/dashboard/tenant-row-actions'
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

function getErrorMessage(error?: string): string | null {
  if (!error) {
    return null
  }

  if (error === 'invalid_input' || error === 'invalid_tenant_input') {
    return 'Please provide a valid tenant name.'
  }

  if (error === 'tenant_has_pods') {
    return 'Tenant cannot be deleted while pods still exist.'
  }

  return 'Unable to complete tenant action.'
}

export default async function TenantsPage({ searchParams }: TenantsPageProps) {
  const [tenants, pods, params] = await Promise.all([getTenants(), getPods(), searchParams])
  const errorMessage = getErrorMessage(params.error)

  return (
    <section className="space-y-4 pb-20 md:pb-0">
      <div className="flex items-center justify-between gap-2">
        <h1 className="text-2xl font-semibold">Tenants</h1>
        <CreateTenantDialog action={createTenantAction} />
      </div>

      {errorMessage ? <p className="text-sm text-red-400">{errorMessage}</p> : null}

      <div className="rounded-lg border border-zinc-800 bg-zinc-900/60 p-2">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Name</TableHead>
              <TableHead>Email</TableHead>
              <TableHead>Created</TableHead>
              <TableHead>Pod Count</TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {tenants.length === 0 ? (
              <TableRow>
                <TableCell className="text-center text-zinc-400" colSpan={5}>
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
                    <TableCell className="text-right">
                      <TenantRowActions
                        tenantId={tenant.id}
                        tenantName={tenant.name}
                        tenantEmail={tenant.email}
                        updateAction={updateTenantAction.bind(null, tenant.id)}
                        deleteAction={deleteTenantAction.bind(null, tenant.id)}
                      />
                    </TableCell>
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

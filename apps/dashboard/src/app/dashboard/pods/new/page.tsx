import Link from 'next/link'
import { createPodAction } from '@/app/dashboard/actions'
import { CreatePodForm } from '@/components/dashboard/create-pod-form'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { registeredAdapters } from '@/lib/adapters'
import { getTenants } from '@/lib/api'

type CreatePodPageProps = {
  searchParams: Promise<{ error?: string }>
}

function getErrorMessage(error?: string): string | null {
  if (!error) {
    return null
  }

  if (error === 'invalid_config_json') {
    return 'Config must be valid JSON object.'
  }

  if (error === 'invalid_input') {
    return 'Missing required fields.'
  }

  return 'Unable to create pod.'
}

export default async function CreatePodPage({ searchParams }: CreatePodPageProps) {
  const tenants = await getTenants()
  const params = await searchParams
  const errorMessage = getErrorMessage(params.error)

  return (
    <section className="max-w-3xl space-y-4 pb-20 md:pb-0">
      <h1 className="text-2xl font-semibold">Create Pod</h1>

      {errorMessage ? (
        <Alert variant="destructive">
          <AlertTitle>Validation Error</AlertTitle>
          <AlertDescription>{errorMessage}</AlertDescription>
        </Alert>
      ) : null}

      {tenants.length === 0 ? (
        <Alert>
          <AlertTitle>No tenants available</AlertTitle>
          <AlertDescription>
            Create a tenant first from <Link className="underline" href="/dashboard/tenants">Tenants</Link>.
          </AlertDescription>
        </Alert>
      ) : (
        <Card className="border-zinc-800 bg-zinc-900/70">
          <CardHeader>
            <CardTitle>Pod Details</CardTitle>
          </CardHeader>
          <CardContent>
            <CreatePodForm tenants={tenants} adapters={registeredAdapters} action={createPodAction} />
          </CardContent>
        </Card>
      )}
    </section>
  )
}

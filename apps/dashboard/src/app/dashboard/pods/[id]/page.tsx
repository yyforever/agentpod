import { deletePodAction, startPodAction, stopPodAction } from '@/app/dashboard/actions'
import { PodDetailActions } from '@/components/dashboard/pod-detail-actions'
import { PodLogsViewer } from '@/components/dashboard/pod-logs-viewer'
import { PodStatusEventsListener } from '@/components/dashboard/pod-status-events-listener'
import { PodStatusBadge } from '@/components/dashboard/pod-status-badge'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { formatDate } from '@/lib/format'
import { getPod } from '@/lib/api'

type PodDetailPageProps = {
  params: Promise<{ id: string }>
}

export default async function PodDetailPage({ params }: PodDetailPageProps) {
  const { id } = await params
  const pod = await getPod(id)
  const canStart = pod.actual_status !== 'running'
  const canStop = pod.actual_status === 'running'

  return (
    <section className="space-y-4 pb-20 md:pb-0">
      <PodStatusEventsListener podId={pod.id} />
      <div>
        <h1 className="text-2xl font-semibold">{pod.name}</h1>
        <p className="text-sm text-zinc-400">Pod ID: {pod.id}</p>
      </div>

      <Card className="border-zinc-800 bg-zinc-900/70">
        <CardHeader>
          <CardTitle>Status</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center gap-3">
            <PodStatusBadge status={pod.actual_status} />
            <span className="text-sm text-zinc-400">Desired: {pod.desired_status}</span>
          </div>
          <div className="grid gap-2 text-sm text-zinc-300 md:grid-cols-2">
            <p>Adapter: {pod.adapter_id}</p>
            <p>Subdomain: {pod.subdomain}</p>
            <p>Created: {formatDate(pod.created_at)}</p>
            <p>Updated: {formatDate(pod.updated_at)}</p>
          </div>
          <PodDetailActions
            canStart={canStart}
            canStop={canStop}
            startAction={startPodAction.bind(null, pod.id, `/dashboard/pods/${pod.id}`)}
            stopAction={stopPodAction.bind(null, pod.id, `/dashboard/pods/${pod.id}`)}
            deleteAction={deletePodAction.bind(null, pod.id, '/dashboard/pods')}
          />
        </CardContent>
      </Card>

      <Card className="border-zinc-800 bg-zinc-900/70">
        <CardHeader>
          <CardTitle>Config</CardTitle>
        </CardHeader>
        <CardContent>
          <pre className="overflow-x-auto rounded-md border border-zinc-800 bg-zinc-950 p-4 text-xs text-zinc-200">
            {JSON.stringify(pod.config ?? {}, null, 2)}
          </pre>
        </CardContent>
      </Card>

      <Card className="border-zinc-800 bg-zinc-900/70">
        <CardHeader>
          <CardTitle>Logs</CardTitle>
        </CardHeader>
        <CardContent>
          <PodLogsViewer podId={pod.id} />
        </CardContent>
      </Card>

      <Alert>
        <AlertTitle>Events</AlertTitle>
        <AlertDescription>
          Event timeline placeholder. This will be wired to `pod_events` in a follow-up.
        </AlertDescription>
      </Alert>
    </section>
  )
}

import Link from 'next/link'
import { Plus } from 'lucide-react'
import { deletePodAction, startPodAction, stopPodAction } from '@/app/dashboard/actions'
import { PodActionsMenu } from '@/components/dashboard/pod-actions-menu'
import { PodStatusEventsListener } from '@/components/dashboard/pod-status-events-listener'
import { PodStatusBadge } from '@/components/dashboard/pod-status-badge'
import { Button } from '@/components/ui/button'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { formatDate } from '@/lib/format'
import { getPods } from '@/lib/api'

export const dynamic = 'force-dynamic'

export default async function PodListPage() {
  const pods = await getPods()
  const baseDomain = process.env.AGENTPOD_DOMAIN ?? 'localhost'

  return (
    <section className="space-y-4 pb-20 md:pb-0">
      <PodStatusEventsListener />
      <div className="flex items-center justify-between gap-2">
        <h1 className="text-2xl font-semibold">Pods</h1>
        <Button asChild>
          <Link href="/dashboard/pods/new">
            <Plus className="mr-2 size-4" />
            Create Pod
          </Link>
        </Button>
      </div>

      <div className="rounded-lg border border-zinc-800 bg-zinc-900/60 p-2">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Name</TableHead>
              <TableHead>Adapter</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Subdomain</TableHead>
              <TableHead>Created</TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {pods.length === 0 ? (
              <TableRow>
                <TableCell colSpan={6} className="text-center text-zinc-400">
                  No pods found.
                </TableCell>
              </TableRow>
            ) : (
              pods.map((pod) => {
                const canStart = pod.actual_status !== 'running'
                const canStop = pod.actual_status === 'running'

                return (
                  <TableRow key={pod.id}>
                    <TableCell>
                      <Link className="text-zinc-100 underline-offset-4 hover:underline" href={`/dashboard/pods/${pod.id}`}>
                        {pod.name}
                      </Link>
                    </TableCell>
                    <TableCell>{pod.adapter_id}</TableCell>
                    <TableCell>
                      <PodStatusBadge status={pod.actual_status} />
                    </TableCell>
                    <TableCell>
                      <a
                        className="text-zinc-200 underline-offset-4 hover:underline"
                        href={`http://${pod.subdomain}.${baseDomain}`}
                        target="_blank"
                        rel="noreferrer"
                      >
                        {pod.subdomain}.{baseDomain}
                      </a>
                    </TableCell>
                    <TableCell>{formatDate(pod.created_at)}</TableCell>
                    <TableCell className="text-right">
                      <PodActionsMenu
                        canStart={canStart}
                        canStop={canStop}
                        startAction={startPodAction.bind(null, pod.id, '/dashboard/pods')}
                        stopAction={stopPodAction.bind(null, pod.id, '/dashboard/pods')}
                        deleteAction={deletePodAction.bind(null, pod.id, '/dashboard/pods')}
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

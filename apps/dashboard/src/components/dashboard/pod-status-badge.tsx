import type { PodActualStatus } from '@agentpod/shared'
import { Badge } from '@/components/ui/badge'

type PodStatusBadgeProps = {
  status: PodActualStatus
}

const statusClassMap: Record<PodActualStatus, string> = {
  running: 'bg-emerald-600 text-emerald-50',
  stopped: 'bg-amber-500 text-amber-950',
  pending: 'bg-blue-600 text-blue-50',
  error: 'bg-red-600 text-red-50',
  exited: 'bg-zinc-600 text-zinc-50',
  unknown: 'bg-zinc-600 text-zinc-50',
}

const indicatorClassMap: Record<PodActualStatus, string> = {
  running: 'bg-emerald-300',
  pending: 'bg-amber-300',
  error: 'bg-red-300',
  stopped: 'bg-zinc-300',
  exited: 'bg-zinc-300',
  unknown: 'bg-zinc-300',
}

export function PodStatusBadge({ status }: PodStatusBadgeProps) {
  return (
    <Badge className={statusClassMap[status]}>
      <span className={`inline-block size-2 rounded-full ${indicatorClassMap[status]}`} />
      <span>{status}</span>
    </Badge>
  )
}

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { getPods } from '@/lib/api'

export const dynamic = 'force-dynamic'

export default async function DashboardOverviewPage() {
  const pods = await getPods()

  const totalPods = pods.length
  const runningPods = pods.filter((pod) => pod.actual_status === 'running').length
  const stoppedPods = pods.filter((pod) => ['stopped', 'exited'].includes(pod.actual_status)).length
  const errorPods = pods.filter((pod) => pod.actual_status === 'error').length

  return (
    <section className="space-y-4 pb-20 md:pb-0">
      <h1 className="text-2xl font-semibold">Dashboard</h1>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Card className="border-zinc-800 bg-zinc-900/70">
          <CardHeader>
            <CardTitle className="text-sm text-zinc-400">Total Pods</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-3xl font-bold">{totalPods}</p>
          </CardContent>
        </Card>
        <Card className="border-zinc-800 bg-zinc-900/70">
          <CardHeader>
            <CardTitle className="text-sm text-zinc-400">Running</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-3xl font-bold text-emerald-400">{runningPods}</p>
          </CardContent>
        </Card>
        <Card className="border-zinc-800 bg-zinc-900/70">
          <CardHeader>
            <CardTitle className="text-sm text-zinc-400">Stopped</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-3xl font-bold text-amber-400">{stoppedPods}</p>
          </CardContent>
        </Card>
        <Card className="border-zinc-800 bg-zinc-900/70">
          <CardHeader>
            <CardTitle className="text-sm text-zinc-400">Error</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-3xl font-bold text-red-400">{errorPods}</p>
          </CardContent>
        </Card>
      </div>
    </section>
  )
}

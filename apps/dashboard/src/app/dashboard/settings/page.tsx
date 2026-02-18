import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'

export default function SettingsPage() {
  return (
    <section className="space-y-4 pb-20 md:pb-0">
      <h1 className="text-2xl font-semibold">Settings</h1>

      <Card className="border-zinc-800 bg-zinc-900/70">
        <CardHeader>
          <CardTitle>Control Plane</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 text-sm text-zinc-300">
          <p>
            CONTROL_PLANE_URL: <code>{process.env.CONTROL_PLANE_URL ?? 'http://localhost:4000'}</code>
          </p>
          <p>
            AGENTPOD_DOMAIN: <code>{process.env.AGENTPOD_DOMAIN ?? 'localhost'}</code>
          </p>
          <p className="text-zinc-400">API key and admin secret values are intentionally hidden.</p>
        </CardContent>
      </Card>
    </section>
  )
}

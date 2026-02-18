import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { registeredAdapters } from '@/lib/adapters'

export default function AdaptersPage() {
  return (
    <section className="space-y-4 pb-20 md:pb-0">
      <h1 className="text-2xl font-semibold">Adapters</h1>
      <div className="grid gap-4 sm:grid-cols-2">
        {registeredAdapters.map((adapter) => (
          <Card key={adapter.id} className="border-zinc-800 bg-zinc-900/70">
            <CardHeader>
              <CardTitle className="text-lg">{adapter.label}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3 text-sm text-zinc-300">
              <p>{adapter.description}</p>
              <p>ID: {adapter.id}</p>
              <p>Version: {adapter.version}</p>
              <div className="flex flex-wrap gap-2">
                {adapter.tags.map((tag) => (
                  <Badge key={tag} variant="secondary">
                    {tag}
                  </Badge>
                ))}
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
    </section>
  )
}

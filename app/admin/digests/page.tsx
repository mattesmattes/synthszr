import { Sparkles, Play } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'

export default function DigestsPage() {
  return (
    <div className="p-8">
      <div className="mb-8 flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tighter">Digests</h1>
          <p className="mt-1 text-muted-foreground">
            AI-generierte Analysen aus dem Daily Repo
          </p>
        </div>
        <Button className="gap-2">
          <Play className="h-4 w-4" />
          Analyse starten
        </Button>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Sparkles className="h-5 w-5" />
            Noch keine Digests
          </CardTitle>
          <CardDescription>
            Digests werden automatisch täglich um 8:00 Uhr generiert oder können manuell gestartet werden.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">
            Jeder Digest analysiert die Inhalte des Daily Repos nach deinem konfigurierten Prompt
            und erstellt eine deutschsprachige Übersicht der relevantesten Insights.
          </p>
        </CardContent>
      </Card>
    </div>
  )
}

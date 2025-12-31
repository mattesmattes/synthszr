import { MessageSquare, Plus } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'

const defaultPrompt = `Es geht mir nicht um die wichtigsten Industrienews, sondern um die originalsten Insights für meinen eigenen Synthzr Newsletter.

Meine Kernthese ist, dass AI nicht alles effizienter macht, sondern dass die Synthese aus allen Bereichen (Marketing, Design, Business, Code etc.) zu völlig neuen Produkten und Services führen wird und die Wertschöpfung von IT- und Agenturdienstleistern komplett verändern wird.

Erstell aus allen Inhalten des Daily Repos, die hierfür relevant sind, eine ausführlich deutschsprachige Übersicht mit den wichtigsten Passagen der jeweiligen Quellen und Verlinkungen.

Falls Inhalte nicht auf Deutsch sind, übersetze die relevanten Passagen ins Deutsche.`

export default function PromptsPage() {
  return (
    <div className="p-8">
      <div className="mb-8 flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tighter">Analyse-Prompts</h1>
          <p className="mt-1 text-muted-foreground">
            Konfiguriere die Prompts für die AI-Analyse
          </p>
        </div>
        <Button className="gap-2">
          <Plus className="h-4 w-4" />
          Neuer Prompt
        </Button>
      </div>

      <Card>
        <CardHeader>
          <div className="flex items-start justify-between">
            <div>
              <CardTitle className="flex items-center gap-2">
                <MessageSquare className="h-5 w-5" />
                Synthzr Standard
              </CardTitle>
              <CardDescription className="mt-1">
                Standard-Prompt für die tägliche Analyse
              </CardDescription>
            </div>
            <Badge variant="default">Aktiv</Badge>
          </div>
        </CardHeader>
        <CardContent>
          <pre className="whitespace-pre-wrap rounded-md bg-secondary/50 p-4 font-mono text-sm">
            {defaultPrompt}
          </pre>
          <div className="mt-4 flex gap-2">
            <Button variant="outline" size="sm">
              Bearbeiten
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}

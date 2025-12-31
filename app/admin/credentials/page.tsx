import { Key, Plus, Shield } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'

export default function CredentialsPage() {
  return (
    <div className="p-8">
      <div className="mb-8 flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tighter">Paywall-Credentials</h1>
          <p className="mt-1 text-muted-foreground">
            Zugangsdaten für Paywall-geschützte Inhalte
          </p>
        </div>
        <Button className="gap-2">
          <Plus className="h-4 w-4" />
          Credentials hinzufügen
        </Button>
      </div>

      <Alert className="mb-6">
        <Shield className="h-4 w-4" />
        <AlertTitle>Sicherheitshinweis</AlertTitle>
        <AlertDescription>
          Passwörter werden verschlüsselt in der Datenbank gespeichert.
          Stelle sicher, dass du nur Credentials für Dienste eingibst, für die du ein aktives Abonnement hast.
        </AlertDescription>
      </Alert>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Key className="h-5 w-5" />
            Keine Credentials konfiguriert
          </CardTitle>
          <CardDescription>
            Füge Zugangsdaten für Paywall-geschützte Quellen hinzu, um PDFs und Premium-Artikel automatisch zu sammeln.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">
            Unterstützte Funktionen:
          </p>
          <ul className="mt-2 list-inside list-disc text-sm text-muted-foreground">
            <li>Automatischer Login bei konfigurierten Domains</li>
            <li>PDF-Download hinter Paywalls</li>
            <li>Vollständige Artikel-Extraktion</li>
          </ul>
        </CardContent>
      </Card>
    </div>
  )
}

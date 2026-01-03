'use client'

import { useEffect, useState } from 'react'
import { Mail, Plus, Trash2, ToggleLeft, ToggleRight, Loader2, Search, CheckCircle2, Circle } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { Badge } from '@/components/ui/badge'
import { Checkbox } from '@/components/ui/checkbox'
import { createClient } from '@/lib/supabase/client'

interface NewsletterSource {
  id: string
  email: string
  name: string | null
  enabled: boolean
  created_at: string
}

interface ScannedSender {
  email: string
  name: string
  count: number
  subjects: string[]
  latestDate: string
  isLikelyNewsletter: boolean
}

export default function NewslettersPage() {
  const [sources, setSources] = useState<NewsletterSource[]>([])
  const [loading, setLoading] = useState(true)
  const [dialogOpen, setDialogOpen] = useState(false)
  const [newEmail, setNewEmail] = useState('')
  const [newName, setNewName] = useState('')
  const [saving, setSaving] = useState(false)

  // Gmail scan state
  const [scanDialogOpen, setScanDialogOpen] = useState(false)
  const [scanning, setScanning] = useState(false)
  const [scannedSenders, setScannedSenders] = useState<ScannedSender[]>([])
  const [selectedSenders, setSelectedSenders] = useState<Set<string>>(new Set())
  const [importing, setImporting] = useState(false)
  const [scanError, setScanError] = useState<string | null>(null)

  const supabase = createClient()

  useEffect(() => {
    fetchSources()
  }, [])

  async function fetchSources() {
    setLoading(true)
    const { data, error } = await supabase
      .from('newsletter_sources')
      .select('*')
      .order('created_at', { ascending: false })

    if (error) {
      console.error('Error fetching sources:', error)
    } else {
      setSources(data || [])
    }
    setLoading(false)
  }

  async function addSource() {
    if (!newEmail.trim()) return

    setSaving(true)
    const { error } = await supabase
      .from('newsletter_sources')
      .insert({
        email: newEmail.trim().toLowerCase(),
        name: newName.trim() || null,
        enabled: true,
      })

    if (error) {
      console.error('Error adding source:', error)
      alert('Fehler: ' + (error.message || 'Quelle konnte nicht hinzugefügt werden'))
    } else {
      setNewEmail('')
      setNewName('')
      setDialogOpen(false)
      fetchSources()
    }
    setSaving(false)
  }

  async function toggleSource(id: string, currentEnabled: boolean) {
    const { error } = await supabase
      .from('newsletter_sources')
      .update({ enabled: !currentEnabled })
      .eq('id', id)

    if (error) {
      console.error('Error toggling source:', error)
    } else {
      setSources(sources.map(s =>
        s.id === id ? { ...s, enabled: !currentEnabled } : s
      ))
    }
  }

  async function deleteSource(id: string) {
    if (!confirm('Diese Newsletter-Quelle wirklich löschen?')) return

    const { error } = await supabase
      .from('newsletter_sources')
      .delete()
      .eq('id', id)

    if (error) {
      console.error('Error deleting source:', error)
    } else {
      setSources(sources.filter(s => s.id !== id))
    }
  }

  async function scanGmailSenders() {
    setScanning(true)
    setScanError(null)
    setScannedSenders([])
    setSelectedSenders(new Set())

    try {
      const response = await fetch('/api/admin/scan-gmail-senders')
      const data = await response.json()

      if (!response.ok) {
        throw new Error(data.error || 'Fehler beim Scannen')
      }

      setScannedSenders(data.senders)
      // Pre-select likely newsletters
      const likelyNewsletters = new Set<string>(
        data.senders
          .filter((s: ScannedSender) => s.isLikelyNewsletter)
          .map((s: ScannedSender) => s.email)
      )
      setSelectedSenders(likelyNewsletters)
    } catch (error) {
      console.error('Error scanning Gmail:', error)
      setScanError(error instanceof Error ? error.message : 'Unbekannter Fehler')
    } finally {
      setScanning(false)
    }
  }

  function toggleSenderSelection(email: string) {
    setSelectedSenders(prev => {
      const next = new Set(prev)
      if (next.has(email)) {
        next.delete(email)
      } else {
        next.add(email)
      }
      return next
    })
  }

  function selectAllSenders() {
    setSelectedSenders(new Set(scannedSenders.map(s => s.email)))
  }

  function deselectAllSenders() {
    setSelectedSenders(new Set())
  }

  async function importSelectedSenders() {
    if (selectedSenders.size === 0) return

    setImporting(true)
    const sendersToImport = scannedSenders.filter(s => selectedSenders.has(s.email))

    try {
      const { error } = await supabase
        .from('newsletter_sources')
        .insert(
          sendersToImport.map(s => ({
            email: s.email.toLowerCase(),
            name: s.name || null,
            enabled: true,
          }))
        )

      if (error) {
        throw error
      }

      setScanDialogOpen(false)
      setScannedSenders([])
      setSelectedSenders(new Set())
      fetchSources()
    } catch (error) {
      console.error('Error importing senders:', error)
      alert('Fehler beim Importieren: ' + (error instanceof Error ? error.message : 'Unbekannter Fehler'))
    } finally {
      setImporting(false)
    }
  }

  return (
    <div className="p-8">
      <div className="mb-8 flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tighter">Newsletter-Quellen</h1>
          <p className="mt-1 text-muted-foreground">
            E-Mail-Adressen von Newslettern, die gesammelt werden sollen
          </p>
        </div>
        <div className="flex gap-2">
          {/* Gmail Scan Dialog */}
          <Dialog open={scanDialogOpen} onOpenChange={setScanDialogOpen}>
            <DialogTrigger asChild>
              <Button variant="outline" className="gap-2" onClick={() => {
                setScanDialogOpen(true)
                if (scannedSenders.length === 0) {
                  scanGmailSenders()
                }
              }}>
                <Search className="h-4 w-4" />
                Gmail scannen
              </Button>
            </DialogTrigger>
            <DialogContent className="max-w-2xl p-0">
              <div className="p-6 pb-0">
                <DialogHeader>
                  <DialogTitle>Newsletter aus Gmail importieren</DialogTitle>
                  <DialogDescription>
                    Scannt die letzten 30 Tage nach regelmäßigen Absendern.
                  </DialogDescription>
                </DialogHeader>
              </div>

              {scanning ? (
                <div className="flex flex-col items-center justify-center py-12 px-6">
                  <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
                  <p className="mt-4 text-sm text-muted-foreground">
                    Scanne Gmail-Posteingang...
                  </p>
                </div>
              ) : scanError ? (
                <div className="py-8 px-6 text-center">
                  <p className="text-sm text-red-600">{scanError}</p>
                  <Button variant="outline" className="mt-4" onClick={scanGmailSenders}>
                    Erneut versuchen
                  </Button>
                </div>
              ) : scannedSenders.length === 0 ? (
                <div className="py-8 px-6 text-center">
                  <p className="text-sm text-muted-foreground">
                    Keine neuen Newsletter-Quellen gefunden.
                  </p>
                </div>
              ) : (
                <>
                  <div className="flex items-center justify-between px-6 py-2 border-y bg-muted/30">
                    <p className="text-sm text-muted-foreground">
                      {scannedSenders.length} gefunden · {selectedSenders.size} ausgewählt
                    </p>
                    <div className="flex gap-2">
                      <Button variant="ghost" size="sm" onClick={selectAllSenders}>
                        Alle
                      </Button>
                      <Button variant="ghost" size="sm" onClick={deselectAllSenders}>
                        Keine
                      </Button>
                    </div>
                  </div>

                  <div className="max-h-[50vh] overflow-y-auto px-6 py-3">
                    <div className="space-y-2">
                      {scannedSenders.map((sender) => (
                        <div
                          key={sender.email}
                          className={`flex cursor-pointer items-start gap-3 rounded-lg border p-3 transition-colors hover:bg-muted/50 ${
                            selectedSenders.has(sender.email) ? 'border-primary bg-primary/5' : ''
                          }`}
                          onClick={() => toggleSenderSelection(sender.email)}
                        >
                          <Checkbox
                            checked={selectedSenders.has(sender.email)}
                            onCheckedChange={() => toggleSenderSelection(sender.email)}
                            onClick={(e) => e.stopPropagation()}
                            className="mt-0.5 flex-shrink-0"
                          />
                          <div className="min-w-0 flex-1">
                            <div className="flex flex-wrap items-center gap-1.5">
                              <span className="text-sm font-medium">
                                {sender.name || sender.email}
                              </span>
                              {sender.isLikelyNewsletter && (
                                <Badge variant="secondary" className="text-xs">
                                  Newsletter
                                </Badge>
                              )}
                              <Badge variant="outline" className="text-xs">
                                {sender.count}×
                              </Badge>
                            </div>
                            <p className="mt-0.5 truncate font-mono text-xs text-muted-foreground">
                              {sender.email}
                            </p>
                            {sender.subjects.length > 0 && (
                              <p className="mt-1 truncate text-xs text-muted-foreground">
                                „{sender.subjects[0]}"
                              </p>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                </>
              )}

              <div className="flex justify-end gap-2 p-6 pt-4 border-t">
                <Button variant="outline" onClick={() => setScanDialogOpen(false)}>
                  Abbrechen
                </Button>
                <Button
                  onClick={importSelectedSenders}
                  disabled={importing || selectedSenders.size === 0}
                >
                  {importing ? (
                    <>
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      Importiere...
                    </>
                  ) : (
                    `${selectedSenders.size} importieren`
                  )}
                </Button>
              </div>
            </DialogContent>
          </Dialog>

          {/* Manual Add Dialog */}
          <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
            <DialogTrigger asChild>
              <Button className="gap-2">
                <Plus className="h-4 w-4" />
                Manuell hinzufügen
              </Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Newsletter-Quelle hinzufügen</DialogTitle>
                <DialogDescription>
                  Füge eine E-Mail-Adresse hinzu, von der Newsletter gesammelt werden sollen.
                </DialogDescription>
              </DialogHeader>
              <div className="space-y-4 py-4">
                <div className="space-y-2">
                  <Label htmlFor="email">E-Mail-Adresse *</Label>
                  <Input
                    id="email"
                    type="email"
                    placeholder="newsletter@example.com"
                    value={newEmail}
                    onChange={(e) => setNewEmail(e.target.value)}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="name">Name (optional)</Label>
                  <Input
                    id="name"
                    placeholder="z.B. Morning Brew"
                    value={newName}
                    onChange={(e) => setNewName(e.target.value)}
                  />
                </div>
              </div>
              <DialogFooter>
                <Button variant="outline" onClick={() => setDialogOpen(false)}>
                  Abbrechen
                </Button>
                <Button onClick={addSource} disabled={saving || !newEmail.trim()}>
                  {saving ? (
                    <>
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      Speichern...
                    </>
                  ) : (
                    'Hinzufügen'
                  )}
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Mail className="h-5 w-5" />
            Konfigurierte Quellen
          </CardTitle>
          <CardDescription>
            E-Mails von diesen Absendern werden automatisch gesammelt und analysiert.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
            </div>
          ) : sources.length === 0 ? (
            <div className="py-8 text-center">
              <Mail className="mx-auto h-12 w-12 text-muted-foreground/50" />
              <p className="mt-4 text-sm text-muted-foreground">
                Noch keine Newsletter-Quellen konfiguriert.
              </p>
              <p className="text-sm text-muted-foreground">
                Füge E-Mail-Adressen hinzu, um Newsletter zu sammeln.
              </p>
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>E-Mail</TableHead>
                  <TableHead>Name</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Hinzugefügt</TableHead>
                  <TableHead className="text-right">Aktionen</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {sources.map((source) => (
                  <TableRow key={source.id}>
                    <TableCell className="font-mono text-sm">
                      {source.email}
                    </TableCell>
                    <TableCell>
                      {source.name || <span className="text-muted-foreground">—</span>}
                    </TableCell>
                    <TableCell>
                      <Badge variant={source.enabled ? 'default' : 'secondary'}>
                        {source.enabled ? 'Aktiv' : 'Pausiert'}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {new Date(source.created_at).toLocaleDateString('de-DE')}
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex justify-end gap-2">
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => toggleSource(source.id, source.enabled)}
                          title={source.enabled ? 'Pausieren' : 'Aktivieren'}
                        >
                          {source.enabled ? (
                            <ToggleRight className="h-4 w-4 text-green-600" />
                          ) : (
                            <ToggleLeft className="h-4 w-4 text-muted-foreground" />
                          )}
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => deleteSource(source.id)}
                          title="Löschen"
                        >
                          <Trash2 className="h-4 w-4 text-red-600" />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  )
}

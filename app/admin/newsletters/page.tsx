'use client'

import { useEffect, useState } from 'react'
import { Mail, Plus, Trash2, ToggleLeft, ToggleRight, Loader2 } from 'lucide-react'
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
import { createClient } from '@/lib/supabase/client'

interface NewsletterSource {
  id: string
  email: string
  name: string | null
  enabled: boolean
  created_at: string
}

export default function NewslettersPage() {
  const [sources, setSources] = useState<NewsletterSource[]>([])
  const [loading, setLoading] = useState(true)
  const [dialogOpen, setDialogOpen] = useState(false)
  const [newEmail, setNewEmail] = useState('')
  const [newName, setNewName] = useState('')
  const [saving, setSaving] = useState(false)

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

  return (
    <div className="p-8">
      <div className="mb-8 flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tighter">Newsletter-Quellen</h1>
          <p className="mt-1 text-muted-foreground">
            E-Mail-Adressen von Newslettern, die gesammelt werden sollen
          </p>
        </div>
        <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
          <DialogTrigger asChild>
            <Button className="gap-2">
              <Plus className="h-4 w-4" />
              Quelle hinzufügen
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

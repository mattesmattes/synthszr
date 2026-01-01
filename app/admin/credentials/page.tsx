'use client'

import { useEffect, useState } from 'react'
import { Key, Plus, Shield, Trash2, Edit2, Loader2, Globe, User, Lock, FileText } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'

interface Credential {
  id: string
  domain: string
  username: string
  notes: string | null
  last_used_at: string | null
  created_at: string
}

export default function CredentialsPage() {
  const [credentials, setCredentials] = useState<Credential[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [dialogOpen, setDialogOpen] = useState(false)
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false)
  const [editingCredential, setEditingCredential] = useState<Credential | null>(null)
  const [deletingCredential, setDeletingCredential] = useState<Credential | null>(null)

  const [formData, setFormData] = useState({
    domain: '',
    username: '',
    password: '',
    notes: '',
  })

  useEffect(() => {
    fetchCredentials()
  }, [])

  async function fetchCredentials() {
    setLoading(true)
    try {
      const res = await fetch('/api/admin/credentials', { credentials: 'include' })
      if (res.ok) {
        const data = await res.json()
        setCredentials(data)
      }
    } catch (error) {
      console.error('Error fetching credentials:', error)
    } finally {
      setLoading(false)
    }
  }

  function openAddDialog() {
    setEditingCredential(null)
    setFormData({ domain: '', username: '', password: '', notes: '' })
    setDialogOpen(true)
  }

  function openEditDialog(credential: Credential) {
    setEditingCredential(credential)
    setFormData({
      domain: credential.domain,
      username: credential.username,
      password: '',
      notes: credential.notes || '',
    })
    setDialogOpen(true)
  }

  function openDeleteDialog(credential: Credential) {
    setDeletingCredential(credential)
    setDeleteDialogOpen(true)
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setSaving(true)

    try {
      const method = editingCredential ? 'PUT' : 'POST'
      const body = editingCredential
        ? { id: editingCredential.id, ...formData }
        : formData

      const res = await fetch('/api/admin/credentials', {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        credentials: 'include',
      })

      if (res.ok) {
        setDialogOpen(false)
        fetchCredentials()
      } else {
        const error = await res.json()
        alert(error.error || 'Fehler beim Speichern')
      }
    } catch (error) {
      console.error('Error saving credential:', error)
      alert('Fehler beim Speichern')
    } finally {
      setSaving(false)
    }
  }

  async function handleDelete() {
    if (!deletingCredential) return

    try {
      const res = await fetch(`/api/admin/credentials?id=${deletingCredential.id}`, {
        method: 'DELETE',
        credentials: 'include',
      })

      if (res.ok) {
        setDeleteDialogOpen(false)
        setDeletingCredential(null)
        fetchCredentials()
      } else {
        const error = await res.json()
        alert(error.error || 'Fehler beim Löschen')
      }
    } catch (error) {
      console.error('Error deleting credential:', error)
      alert('Fehler beim Löschen')
    }
  }

  return (
    <div className="p-8">
      <div className="mb-8 flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tighter">Paywall-Credentials</h1>
          <p className="mt-1 text-muted-foreground">
            Zugangsdaten für Paywall-geschützte Inhalte
          </p>
        </div>
        <Button className="gap-2" onClick={openAddDialog}>
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

      {loading ? (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
        </div>
      ) : credentials.length === 0 ? (
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
      ) : (
        <div className="grid gap-4">
          {credentials.map((cred) => (
            <Card key={cred.id}>
              <CardContent className="flex items-center justify-between py-4">
                <div className="flex items-center gap-4">
                  <div className="flex h-10 w-10 items-center justify-center rounded-full bg-muted">
                    <Globe className="h-5 w-5 text-muted-foreground" />
                  </div>
                  <div>
                    <div className="font-medium">{cred.domain}</div>
                    <div className="flex items-center gap-2 text-sm text-muted-foreground">
                      <User className="h-3 w-3" />
                      {cred.username}
                      {cred.notes && (
                        <>
                          <span className="mx-1">·</span>
                          <FileText className="h-3 w-3" />
                          {cred.notes.slice(0, 30)}
                          {cred.notes.length > 30 && '...'}
                        </>
                      )}
                    </div>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  {cred.last_used_at && (
                    <span className="text-xs text-muted-foreground">
                      Zuletzt: {new Date(cred.last_used_at).toLocaleDateString('de-DE')}
                    </span>
                  )}
                  <Button variant="ghost" size="icon" onClick={() => openEditDialog(cred)}>
                    <Edit2 className="h-4 w-4" />
                  </Button>
                  <Button variant="ghost" size="icon" onClick={() => openDeleteDialog(cred)}>
                    <Trash2 className="h-4 w-4 text-destructive" />
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {/* Add/Edit Dialog */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {editingCredential ? 'Credentials bearbeiten' : 'Neue Credentials hinzufügen'}
            </DialogTitle>
            <DialogDescription>
              {editingCredential
                ? 'Aktualisiere die Zugangsdaten. Lasse das Passwort-Feld leer, um es nicht zu ändern.'
                : 'Füge Zugangsdaten für eine Paywall-geschützte Website hinzu.'}
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={handleSubmit}>
            <div className="space-y-4 py-4">
              <div className="space-y-2">
                <Label htmlFor="domain">Domain</Label>
                <div className="relative">
                  <Globe className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    id="domain"
                    placeholder="beispiel.de"
                    value={formData.domain}
                    onChange={(e) => setFormData({ ...formData, domain: e.target.value })}
                    className="pl-9"
                    required
                  />
                </div>
              </div>
              <div className="space-y-2">
                <Label htmlFor="username">Benutzername / E-Mail</Label>
                <div className="relative">
                  <User className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    id="username"
                    placeholder="benutzer@email.de"
                    value={formData.username}
                    onChange={(e) => setFormData({ ...formData, username: e.target.value })}
                    className="pl-9"
                    required
                  />
                </div>
              </div>
              <div className="space-y-2">
                <Label htmlFor="password">
                  Passwort {editingCredential && <span className="text-muted-foreground">(leer lassen = nicht ändern)</span>}
                </Label>
                <div className="relative">
                  <Lock className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    id="password"
                    type="password"
                    placeholder="••••••••"
                    value={formData.password}
                    onChange={(e) => setFormData({ ...formData, password: e.target.value })}
                    className="pl-9"
                    required={!editingCredential}
                  />
                </div>
              </div>
              <div className="space-y-2">
                <Label htmlFor="notes">Notizen (optional)</Label>
                <Textarea
                  id="notes"
                  placeholder="z.B. Abo-Typ, Ablaufdatum..."
                  value={formData.notes}
                  onChange={(e) => setFormData({ ...formData, notes: e.target.value })}
                  rows={2}
                />
              </div>
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setDialogOpen(false)}>
                Abbrechen
              </Button>
              <Button type="submit" disabled={saving}>
                {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                {editingCredential ? 'Aktualisieren' : 'Hinzufügen'}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Delete Confirmation Dialog */}
      <AlertDialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Credentials löschen?</AlertDialogTitle>
            <AlertDialogDescription>
              Möchtest du die Credentials für <strong>{deletingCredential?.domain}</strong> wirklich löschen?
              Diese Aktion kann nicht rückgängig gemacht werden.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Abbrechen</AlertDialogCancel>
            <AlertDialogAction onClick={handleDelete} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
              Löschen
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}

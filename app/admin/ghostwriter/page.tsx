'use client'

import { useEffect, useState } from 'react'
import { PenTool, Plus, Trash2, Edit2, Loader2, Check, Star } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Switch } from '@/components/ui/switch'
import { Badge } from '@/components/ui/badge'
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

interface GhostwriterPrompt {
  id: string
  name: string
  prompt_text: string
  is_active: boolean
  created_at: string
  updated_at: string
}

export default function GhostwriterPage() {
  const [prompts, setPrompts] = useState<GhostwriterPrompt[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [dialogOpen, setDialogOpen] = useState(false)
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false)
  const [editingPrompt, setEditingPrompt] = useState<GhostwriterPrompt | null>(null)
  const [deletingPrompt, setDeletingPrompt] = useState<GhostwriterPrompt | null>(null)

  const [formData, setFormData] = useState({
    name: '',
    prompt_text: '',
    is_active: false,
  })

  useEffect(() => {
    fetchPrompts()
  }, [])

  async function fetchPrompts() {
    setLoading(true)
    try {
      const res = await fetch('/api/admin/ghostwriter-prompts', { credentials: 'include' })
      if (res.ok) {
        const data = await res.json()
        setPrompts(data)
      }
    } catch (error) {
      console.error('Error fetching prompts:', error)
    } finally {
      setLoading(false)
    }
  }

  function openAddDialog() {
    setEditingPrompt(null)
    setFormData({ name: '', prompt_text: '', is_active: false })
    setDialogOpen(true)
  }

  function openEditDialog(prompt: GhostwriterPrompt) {
    setEditingPrompt(prompt)
    setFormData({
      name: prompt.name,
      prompt_text: prompt.prompt_text,
      is_active: prompt.is_active,
    })
    setDialogOpen(true)
  }

  function openDeleteDialog(prompt: GhostwriterPrompt) {
    setDeletingPrompt(prompt)
    setDeleteDialogOpen(true)
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setSaving(true)

    try {
      const method = editingPrompt ? 'PUT' : 'POST'
      const body = editingPrompt
        ? { id: editingPrompt.id, ...formData }
        : formData

      const res = await fetch('/api/admin/ghostwriter-prompts', {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        credentials: 'include',
      })

      if (res.ok) {
        setDialogOpen(false)
        fetchPrompts()
      } else {
        const error = await res.json()
        alert(error.error || 'Fehler beim Speichern')
      }
    } catch (error) {
      console.error('Error saving prompt:', error)
      alert('Fehler beim Speichern')
    } finally {
      setSaving(false)
    }
  }

  async function handleDelete() {
    if (!deletingPrompt) return

    try {
      const res = await fetch(`/api/admin/ghostwriter-prompts?id=${deletingPrompt.id}`, {
        method: 'DELETE',
        credentials: 'include',
      })

      if (res.ok) {
        setDeleteDialogOpen(false)
        setDeletingPrompt(null)
        fetchPrompts()
      } else {
        const error = await res.json()
        alert(error.error || 'Fehler beim Löschen')
      }
    } catch (error) {
      console.error('Error deleting prompt:', error)
      alert('Fehler beim Löschen')
    }
  }

  async function toggleActive(prompt: GhostwriterPrompt) {
    try {
      const res = await fetch('/api/admin/ghostwriter-prompts', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: prompt.id,
          name: prompt.name,
          prompt_text: prompt.prompt_text,
          is_active: !prompt.is_active,
        }),
        credentials: 'include',
      })

      if (res.ok) {
        fetchPrompts()
      }
    } catch (error) {
      console.error('Error toggling active:', error)
    }
  }

  return (
    <div className="p-8">
      <div className="mb-8 flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tighter">Ghostwriter-Prompts</h1>
          <p className="mt-1 text-muted-foreground">
            Prompts für die automatische Blogartikel-Generierung aus Digests
          </p>
        </div>
        <Button className="gap-2" onClick={openAddDialog}>
          <Plus className="h-4 w-4" />
          Neuer Prompt
        </Button>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
        </div>
      ) : prompts.length === 0 ? (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <PenTool className="h-5 w-5" />
              Keine Prompts vorhanden
            </CardTitle>
            <CardDescription>
              Erstelle deinen ersten Ghostwriter-Prompt, um Blogposts aus Digests zu generieren.
            </CardDescription>
          </CardHeader>
        </Card>
      ) : (
        <div className="space-y-4">
          {prompts.map((prompt) => (
            <Card key={prompt.id} className={prompt.is_active ? 'border-primary' : ''}>
              <CardContent className="py-4">
                <div className="flex items-start justify-between gap-4">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-2">
                      <h3 className="font-medium">{prompt.name}</h3>
                      {prompt.is_active && (
                        <Badge variant="default" className="gap-1">
                          <Star className="h-3 w-3" />
                          Aktiv
                        </Badge>
                      )}
                    </div>
                    <p className="text-sm text-muted-foreground line-clamp-3">
                      {prompt.prompt_text}
                    </p>
                    <p className="text-xs text-muted-foreground mt-2">
                      Erstellt: {new Date(prompt.created_at).toLocaleDateString('de-DE')}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => toggleActive(prompt)}
                      className="gap-1"
                    >
                      {prompt.is_active ? (
                        <Check className="h-4 w-4 text-primary" />
                      ) : (
                        <Star className="h-4 w-4" />
                      )}
                      {prompt.is_active ? 'Aktiv' : 'Aktivieren'}
                    </Button>
                    <Button variant="ghost" size="icon" onClick={() => openEditDialog(prompt)}>
                      <Edit2 className="h-4 w-4" />
                    </Button>
                    <Button variant="ghost" size="icon" onClick={() => openDeleteDialog(prompt)}>
                      <Trash2 className="h-4 w-4 text-destructive" />
                    </Button>
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {/* Add/Edit Dialog */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-hidden flex flex-col">
          <DialogHeader>
            <DialogTitle>
              {editingPrompt ? 'Prompt bearbeiten' : 'Neuer Ghostwriter-Prompt'}
            </DialogTitle>
            <DialogDescription>
              Definiere Stil, Tonalität und Struktur für die Blogartikel-Generierung.
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={handleSubmit} className="flex flex-col flex-1 min-h-0">
            <div className="space-y-4 py-4 flex-1 overflow-y-auto">
              <div className="space-y-2">
                <Label htmlFor="name">Name</Label>
                <Input
                  id="name"
                  placeholder="z.B. Synthzr Standard"
                  value={formData.name}
                  onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                  required
                />
              </div>
              <div className="space-y-2 flex-1 flex flex-col">
                <Label htmlFor="prompt_text">Prompt</Label>
                <Textarea
                  id="prompt_text"
                  placeholder="Beschreibe Stil, Tonalität und Struktur..."
                  value={formData.prompt_text}
                  onChange={(e) => setFormData({ ...formData, prompt_text: e.target.value })}
                  className="font-mono text-sm flex-1 min-h-[200px] max-h-[50vh] resize-y"
                  required
                />
              </div>
              <div className="flex items-center gap-2">
                <Switch
                  id="is_active"
                  checked={formData.is_active}
                  onCheckedChange={(checked) => setFormData({ ...formData, is_active: checked })}
                />
                <Label htmlFor="is_active">Als aktiven Prompt setzen</Label>
              </div>
            </div>
            <DialogFooter className="border-t pt-4">
              <Button type="button" variant="outline" onClick={() => setDialogOpen(false)}>
                Abbrechen
              </Button>
              <Button type="submit" disabled={saving}>
                {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                {editingPrompt ? 'Aktualisieren' : 'Erstellen'}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Delete Confirmation Dialog */}
      <AlertDialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Prompt löschen?</AlertDialogTitle>
            <AlertDialogDescription>
              Möchtest du den Prompt &quot;{deletingPrompt?.name}&quot; wirklich löschen?
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

'use client'

import { useEffect, useState } from 'react'
import { ImageIcon, Plus, Trash2, Edit2, Loader2, Check, Star } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Switch } from '@/components/ui/switch'
import { Slider } from '@/components/ui/slider'
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

interface ImagePrompt {
  id: string
  name: string
  prompt_text: string
  is_active: boolean
  enable_dithering: boolean
  dithering_gain: number
  created_at: string
  updated_at: string
}

const DEFAULT_PROMPT = `Visualisiere in Schwarz-Weiß die folgende News satirisch im Stil von Mort Drucker ohne in der Visualisierung auf "Mort Drucker" oder "MAD" hinzuweisen.

WICHTIGE STILRICHTLINIEN:
- Klarer Schwarz-Weiß-Kontrast mit Schraffuren und Linienzeichnung
- Satirische, leicht überzeichnete Darstellung
- Dynamische Kompositionen mit ausdrucksstarken Figuren
- Keine Text-Elemente oder Beschriftungen im Bild
- Keine Referenzen auf MAD Magazine oder den Künstler

NEWS TEXT:
{newsText}`

export default function ImagePromptsPage() {
  const [prompts, setPrompts] = useState<ImagePrompt[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [dialogOpen, setDialogOpen] = useState(false)
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false)
  const [editingPrompt, setEditingPrompt] = useState<ImagePrompt | null>(null)
  const [deletingPrompt, setDeletingPrompt] = useState<ImagePrompt | null>(null)

  const [formData, setFormData] = useState({
    name: '',
    prompt_text: '',
    is_active: false,
    enable_dithering: false,
    dithering_gain: 1.0,
  })

  useEffect(() => {
    fetchPrompts()
  }, [])

  async function fetchPrompts() {
    setLoading(true)
    try {
      const res = await fetch('/api/admin/image-prompts', { credentials: 'include' })
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
    setFormData({
      name: '',
      prompt_text: DEFAULT_PROMPT,
      is_active: false,
      enable_dithering: false,
      dithering_gain: 1.0,
    })
    setDialogOpen(true)
  }

  function openEditDialog(prompt: ImagePrompt) {
    setEditingPrompt(prompt)
    setFormData({
      name: prompt.name,
      prompt_text: prompt.prompt_text,
      is_active: prompt.is_active,
      enable_dithering: prompt.enable_dithering ?? false,
      dithering_gain: prompt.dithering_gain ?? 1.0,
    })
    setDialogOpen(true)
  }

  function openDeleteDialog(prompt: ImagePrompt) {
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

      const res = await fetch('/api/admin/image-prompts', {
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
      const res = await fetch(`/api/admin/image-prompts?id=${deletingPrompt.id}`, {
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

  async function toggleActive(prompt: ImagePrompt) {
    try {
      const res = await fetch('/api/admin/image-prompts', {
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
          <h1 className="text-3xl font-bold tracking-tighter">Bild-Prompts</h1>
          <p className="mt-1 text-muted-foreground">
            Prompts für die KI-Bildgenerierung zu Blogartikeln
          </p>
        </div>
        <Button className="gap-2" onClick={openAddDialog}>
          <Plus className="h-4 w-4" />
          Neuer Prompt
        </Button>
      </div>

      <Card className="mb-6 bg-muted/50">
        <CardContent className="py-3">
          <p className="text-sm text-muted-foreground">
            <strong>Hinweis:</strong> Der Platzhalter <code className="bg-background px-1 rounded">{'{newsText}'}</code> wird
            automatisch durch den News-Text ersetzt. Wenn kein aktiver Prompt definiert ist, wird der Standard-Prompt verwendet.
          </p>
        </CardContent>
      </Card>

      {loading ? (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
        </div>
      ) : prompts.length === 0 ? (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <ImageIcon className="h-5 w-5" />
              Keine Prompts vorhanden
            </CardTitle>
            <CardDescription>
              Erstelle deinen ersten Bild-Prompt. Ohne aktiven Prompt wird der Standard-Prompt verwendet.
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
                    <p className="text-sm text-muted-foreground line-clamp-3 font-mono">
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
              {editingPrompt ? 'Prompt bearbeiten' : 'Neuer Bild-Prompt'}
            </DialogTitle>
            <DialogDescription>
              Definiere den Stil und die Anweisungen für die KI-Bildgenerierung.
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={handleSubmit} className="flex flex-col flex-1 min-h-0">
            <div className="space-y-4 py-4 flex-1 overflow-y-auto">
              <div className="space-y-2">
                <Label htmlFor="name">Name</Label>
                <Input
                  id="name"
                  placeholder="z.B. Mort Drucker Satire"
                  value={formData.name}
                  onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                  required
                />
              </div>
              <div className="space-y-2 flex-1 flex flex-col">
                <Label htmlFor="prompt_text">Prompt</Label>
                <Textarea
                  id="prompt_text"
                  placeholder="Beschreibe den Bildstil..."
                  value={formData.prompt_text}
                  onChange={(e) => setFormData({ ...formData, prompt_text: e.target.value })}
                  className="font-mono text-sm flex-1 min-h-[250px] max-h-[50vh] resize-y"
                  required
                />
                <p className="text-xs text-muted-foreground">
                  Verwende <code className="bg-muted px-1 rounded">{'{newsText}'}</code> als Platzhalter für den News-Text.
                </p>
              </div>
              <div className="flex items-center gap-2">
                <Switch
                  id="is_active"
                  checked={formData.is_active}
                  onCheckedChange={(checked) => setFormData({ ...formData, is_active: checked })}
                />
                <Label htmlFor="is_active">Als aktiven Prompt setzen</Label>
              </div>

              {/* Dithering Settings */}
              <div className="border rounded-lg p-4 space-y-4">
                <h4 className="text-sm font-medium">Dithering-Einstellungen</h4>
                <div className="flex items-center gap-2">
                  <Switch
                    id="enable_dithering"
                    checked={formData.enable_dithering}
                    onCheckedChange={(checked) => setFormData({ ...formData, enable_dithering: checked })}
                  />
                  <Label htmlFor="enable_dithering">Floyd-Steinberg Dithering aktivieren</Label>
                </div>
                {formData.enable_dithering && (
                  <div className="space-y-2">
                    <div className="flex items-center justify-between">
                      <Label htmlFor="dithering_gain">Error Diffusion Gain</Label>
                      <span className="text-sm text-muted-foreground">{formData.dithering_gain.toFixed(2)}</span>
                    </div>
                    <Slider
                      id="dithering_gain"
                      min={0.5}
                      max={2.0}
                      step={0.1}
                      value={[formData.dithering_gain]}
                      onValueChange={([value]) => setFormData({ ...formData, dithering_gain: value })}
                      className="w-full"
                    />
                    <p className="text-xs text-muted-foreground">
                      Steuert die Stärke des Dithering-Effekts (0.5 = subtil, 2.0 = stark)
                    </p>
                  </div>
                )}
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

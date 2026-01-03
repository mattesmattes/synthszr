'use client'

import { useEffect, useState } from 'react'
import { Lightbulb, Plus, Trash2, Edit2, Loader2, Check, Star } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Switch } from '@/components/ui/switch'
import { Badge } from '@/components/ui/badge'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
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

interface SynthesisPrompt {
  id: string
  name: string
  scoring_prompt: string
  development_prompt: string
  core_thesis: string | null
  is_active: boolean
  created_at: string
}

export default function SynthesisPromptsPage() {
  const [prompts, setPrompts] = useState<SynthesisPrompt[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [dialogOpen, setDialogOpen] = useState(false)
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false)
  const [editingPrompt, setEditingPrompt] = useState<SynthesisPrompt | null>(null)
  const [deletingPrompt, setDeletingPrompt] = useState<SynthesisPrompt | null>(null)

  const [formData, setFormData] = useState({
    name: '',
    scoring_prompt: '',
    development_prompt: '',
    core_thesis: '',
    is_active: false,
  })

  useEffect(() => {
    fetchPrompts()
  }, [])

  async function fetchPrompts() {
    setLoading(true)
    try {
      const res = await fetch('/api/admin/synthesis-prompts', { credentials: 'include' })
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
      scoring_prompt: getDefaultScoringPrompt(),
      development_prompt: getDefaultDevelopmentPrompt(),
      core_thesis: getDefaultCoreThesis(),
      is_active: false,
    })
    setDialogOpen(true)
  }

  function openEditDialog(prompt: SynthesisPrompt) {
    setEditingPrompt(prompt)
    setFormData({
      name: prompt.name,
      scoring_prompt: prompt.scoring_prompt,
      development_prompt: prompt.development_prompt,
      core_thesis: prompt.core_thesis || '',
      is_active: prompt.is_active,
    })
    setDialogOpen(true)
  }

  function openDeleteDialog(prompt: SynthesisPrompt) {
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

      const res = await fetch('/api/admin/synthesis-prompts', {
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
      const res = await fetch(`/api/admin/synthesis-prompts?id=${deletingPrompt.id}`, {
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

  async function toggleActive(prompt: SynthesisPrompt) {
    try {
      const res = await fetch('/api/admin/synthesis-prompts', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: prompt.id,
          name: prompt.name,
          scoring_prompt: prompt.scoring_prompt,
          development_prompt: prompt.development_prompt,
          core_thesis: prompt.core_thesis,
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
          <h1 className="text-3xl font-bold tracking-tighter">Synthese-Prompts</h1>
          <p className="mt-1 text-muted-foreground">
            Konfiguriere die Prompts für die AI-gestützte Synthese historischer Verbindungen
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
              <Lightbulb className="h-5 w-5" />
              Keine Synthese-Prompts vorhanden
            </CardTitle>
            <CardDescription>
              Erstelle deinen ersten Synthese-Prompt, um automatische Verbindungen zwischen News zu finden.
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
                    <div className="space-y-2 text-sm text-muted-foreground">
                      <div>
                        <span className="font-medium text-foreground">Kernthese:</span>{' '}
                        {prompt.core_thesis?.slice(0, 100) || 'Keine'}...
                      </div>
                      <div>
                        <span className="font-medium text-foreground">Scoring:</span>{' '}
                        {prompt.scoring_prompt.slice(0, 80)}...
                      </div>
                      <div>
                        <span className="font-medium text-foreground">Development:</span>{' '}
                        {prompt.development_prompt.slice(0, 80)}...
                      </div>
                    </div>
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
        <DialogContent className="max-w-4xl max-h-[90vh] overflow-hidden flex flex-col">
          <DialogHeader>
            <DialogTitle>
              {editingPrompt ? 'Synthese-Prompt bearbeiten' : 'Neuer Synthese-Prompt'}
            </DialogTitle>
            <DialogDescription>
              Definiere, wie Claude Verbindungen zwischen News findet und Synthesen entwickelt.
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={handleSubmit} className="flex flex-col flex-1 min-h-0">
            <Tabs defaultValue="general" className="flex-1 flex flex-col min-h-0">
              <TabsList className="w-full justify-start">
                <TabsTrigger value="general">Allgemein</TabsTrigger>
                <TabsTrigger value="scoring">Scoring-Prompt</TabsTrigger>
                <TabsTrigger value="development">Development-Prompt</TabsTrigger>
              </TabsList>

              <div className="flex-1 overflow-y-auto py-4">
                <TabsContent value="general" className="space-y-4 mt-0">
                  <div className="space-y-2">
                    <Label htmlFor="name">Name</Label>
                    <Input
                      id="name"
                      placeholder="z.B. Standard Synthese"
                      value={formData.name}
                      onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                      required
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="core_thesis">Kernthese (für Relevanz-Bewertung)</Label>
                    <Textarea
                      id="core_thesis"
                      placeholder="Deine Kernthese, die als Filter für relevante Synthesen dient..."
                      value={formData.core_thesis}
                      onChange={(e) => setFormData({ ...formData, core_thesis: e.target.value })}
                      className="min-h-[100px]"
                    />
                    <p className="text-xs text-muted-foreground">
                      Diese These wird verwendet, um Synthesen nach Relevanz zu bewerten.
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
                </TabsContent>

                <TabsContent value="scoring" className="mt-0">
                  <div className="space-y-2">
                    <Label htmlFor="scoring_prompt">Scoring-Prompt (Claude Haiku)</Label>
                    <Textarea
                      id="scoring_prompt"
                      placeholder="Prompt für die schnelle Bewertung von Synthese-Kandidaten..."
                      value={formData.scoring_prompt}
                      onChange={(e) => setFormData({ ...formData, scoring_prompt: e.target.value })}
                      className="font-mono text-sm min-h-[400px]"
                      required
                    />
                    <p className="text-xs text-muted-foreground">
                      Variablen: {'{current_news}'}, {'{historical_news}'}, {'{days_ago}'}
                    </p>
                  </div>
                </TabsContent>

                <TabsContent value="development" className="mt-0">
                  <div className="space-y-2">
                    <Label htmlFor="development_prompt">Development-Prompt (Claude Opus)</Label>
                    <Textarea
                      id="development_prompt"
                      placeholder="Prompt für die Entwicklung der finalen Synthese..."
                      value={formData.development_prompt}
                      onChange={(e) => setFormData({ ...formData, development_prompt: e.target.value })}
                      className="font-mono text-sm min-h-[400px]"
                      required
                    />
                    <p className="text-xs text-muted-foreground">
                      Variablen: {'{current_news}'}, {'{historical_news}'}, {'{days_ago}'}, {'{synthesis_type}'}, {'{core_thesis}'}
                    </p>
                  </div>
                </TabsContent>
              </div>
            </Tabs>

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
            <AlertDialogTitle>Synthese-Prompt löschen?</AlertDialogTitle>
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

function getDefaultScoringPrompt(): string {
  return `Bewerte diese Verbindung zwischen zwei News-Items:

NEWS A (aktuell): {current_news}
NEWS B (historisch, {days_ago} Tage alt): {historical_news}

Bewertungskriterien:
1. ORIGINALITÄT (0-10): Wie unerwartet/überraschend ist diese Verbindung?
2. RELEVANZ (0-10): Wie bedeutsam ist der Zusammenhang?
3. SYNTHESE-TYP: Wähle einen:
   - contradiction: Widerspruch zu früherer Aussage
   - evolution: Entwicklung einer laufenden Story
   - cross_domain: Verbindung verschiedener Bereiche
   - validation: Bestätigung einer früheren Prognose
   - pattern: Wiederkehrendes Muster

Antworte im Format:
ORIGINALITÄT: [0-10]
RELEVANZ: [0-10]
TYP: [type]
BEGRÜNDUNG: [1-2 Sätze]`
}

function getDefaultDevelopmentPrompt(): string {
  return `Entwickle einen originellen Synthese-Insight basierend auf dieser Verbindung:

AKTUELLE NEWS: {current_news}
HISTORISCHE NEWS ({days_ago} Tage alt): {historical_news}
SYNTHESE-TYP: {synthesis_type}

KERNTHESE ZUR ORIENTIERUNG:
{core_thesis}

Erstelle einen prägnanten Synthese-Kommentar (2-4 Sätze), der:
1. Die Verbindung zwischen beiden News erklärt
2. Einen originellen Insight liefert, der über beide Einzelnews hinausgeht
3. Zur Kernthese passt (falls relevant)
4. Als "Mattes Synthese" im Blog verwendbar ist

Format:
HEADLINE: [Kurze, prägnante Überschrift]
SYNTHESE: [Der Insight-Text]
REFERENZ: [Kurzer Verweis auf die historische News]`
}

function getDefaultCoreThesis(): string {
  return `AI macht nicht alles effizienter, sondern die Synthese aus allen Bereichen (Marketing, Design, Business, Code) führt zu völlig neuen Produkten und Services und verändert die Wertschöpfung von IT- und Agenturdienstleistern komplett.`
}

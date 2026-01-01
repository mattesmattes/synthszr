'use client'

import { useEffect, useState } from 'react'
import { BookOpen, Plus, Trash2, Edit2, Loader2, Tag, CheckCircle, XCircle } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'

interface VocabularyEntry {
  id: string
  term: string
  preferred_usage: string | null
  avoid_alternatives: string | null
  context: string | null
  category: string
  created_at: string
  updated_at: string
}

const categories = [
  { value: 'general', label: 'Allgemein' },
  { value: 'tech', label: 'Technologie' },
  { value: 'business', label: 'Business' },
  { value: 'brand', label: 'Brand/Marke' },
  { value: 'style', label: 'Schreibstil' },
]

const categoryColors: Record<string, string> = {
  general: 'bg-gray-100 text-gray-800',
  tech: 'bg-blue-100 text-blue-800',
  business: 'bg-green-100 text-green-800',
  brand: 'bg-purple-100 text-purple-800',
  style: 'bg-orange-100 text-orange-800',
}

export default function VocabularyPage() {
  const [entries, setEntries] = useState<VocabularyEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [dialogOpen, setDialogOpen] = useState(false)
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false)
  const [editingEntry, setEditingEntry] = useState<VocabularyEntry | null>(null)
  const [deletingEntry, setDeletingEntry] = useState<VocabularyEntry | null>(null)
  const [filterCategory, setFilterCategory] = useState<string>('all')

  const [formData, setFormData] = useState({
    term: '',
    preferred_usage: '',
    avoid_alternatives: '',
    context: '',
    category: 'general',
  })

  useEffect(() => {
    fetchEntries()
  }, [])

  async function fetchEntries() {
    setLoading(true)
    try {
      const res = await fetch('/api/admin/vocabulary', { credentials: 'include' })
      if (res.ok) {
        const data = await res.json()
        setEntries(data)
      }
    } catch (error) {
      console.error('Error fetching vocabulary:', error)
    } finally {
      setLoading(false)
    }
  }

  function openAddDialog() {
    setEditingEntry(null)
    setFormData({
      term: '',
      preferred_usage: '',
      avoid_alternatives: '',
      context: '',
      category: 'general',
    })
    setDialogOpen(true)
  }

  function openEditDialog(entry: VocabularyEntry) {
    setEditingEntry(entry)
    setFormData({
      term: entry.term,
      preferred_usage: entry.preferred_usage || '',
      avoid_alternatives: entry.avoid_alternatives || '',
      context: entry.context || '',
      category: entry.category,
    })
    setDialogOpen(true)
  }

  function openDeleteDialog(entry: VocabularyEntry) {
    setDeletingEntry(entry)
    setDeleteDialogOpen(true)
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setSaving(true)

    try {
      const method = editingEntry ? 'PUT' : 'POST'
      const body = editingEntry
        ? { id: editingEntry.id, ...formData }
        : formData

      const res = await fetch('/api/admin/vocabulary', {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        credentials: 'include',
      })

      if (res.ok) {
        setDialogOpen(false)
        fetchEntries()
      } else {
        const error = await res.json()
        alert(error.error || 'Fehler beim Speichern')
      }
    } catch (error) {
      console.error('Error saving entry:', error)
      alert('Fehler beim Speichern')
    } finally {
      setSaving(false)
    }
  }

  async function handleDelete() {
    if (!deletingEntry) return

    try {
      const res = await fetch(`/api/admin/vocabulary?id=${deletingEntry.id}`, {
        method: 'DELETE',
        credentials: 'include',
      })

      if (res.ok) {
        setDeleteDialogOpen(false)
        setDeletingEntry(null)
        fetchEntries()
      } else {
        const error = await res.json()
        alert(error.error || 'Fehler beim Löschen')
      }
    } catch (error) {
      console.error('Error deleting entry:', error)
      alert('Fehler beim Löschen')
    }
  }

  const filteredEntries = filterCategory === 'all'
    ? entries
    : entries.filter(e => e.category === filterCategory)

  const groupedEntries = filteredEntries.reduce((acc, entry) => {
    const cat = entry.category || 'general'
    if (!acc[cat]) acc[cat] = []
    acc[cat].push(entry)
    return acc
  }, {} as Record<string, VocabularyEntry[]>)

  return (
    <div className="p-8">
      <div className="mb-8 flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tighter">Vokabular</h1>
          <p className="mt-1 text-muted-foreground">
            Definiere bevorzugte Begriffe und Formulierungen für den Ghostwriter
          </p>
        </div>
        <Button className="gap-2" onClick={openAddDialog}>
          <Plus className="h-4 w-4" />
          Neuer Eintrag
        </Button>
      </div>

      {/* Filter */}
      <div className="mb-6 flex items-center gap-4">
        <Label className="text-sm text-muted-foreground">Filter:</Label>
        <Select value={filterCategory} onValueChange={setFilterCategory}>
          <SelectTrigger className="w-[180px]">
            <SelectValue placeholder="Alle Kategorien" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Alle Kategorien</SelectItem>
            {categories.map(cat => (
              <SelectItem key={cat.value} value={cat.value}>{cat.label}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <span className="text-sm text-muted-foreground">
          {filteredEntries.length} Einträge
        </span>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
        </div>
      ) : entries.length === 0 ? (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <BookOpen className="h-5 w-5" />
              Kein Vokabular definiert
            </CardTitle>
            <CardDescription>
              Füge Begriffe hinzu, die der Ghostwriter bevorzugt oder vermeiden soll.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-muted-foreground">
              Das Vokabular hilft dabei, einen konsistenten Schreibstil zu etablieren:
            </p>
            <ul className="mt-2 list-inside list-disc text-sm text-muted-foreground">
              <li>Bevorzugte Begriffe und Formulierungen</li>
              <li>Alternativen, die vermieden werden sollen</li>
              <li>Kontext und Verwendungshinweise</li>
            </ul>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-6">
          {Object.entries(groupedEntries).map(([category, categoryEntries]) => (
            <div key={category}>
              <h2 className="text-lg font-semibold mb-3 flex items-center gap-2">
                <Tag className="h-4 w-4" />
                {categories.find(c => c.value === category)?.label || category}
                <Badge variant="secondary" className="ml-2">{categoryEntries.length}</Badge>
              </h2>
              <div className="grid gap-3">
                {categoryEntries.map((entry) => (
                  <Card key={entry.id}>
                    <CardContent className="py-4">
                      <div className="flex items-start justify-between gap-4">
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 mb-2">
                            <span className="font-mono font-bold text-lg">{entry.term}</span>
                            <Badge className={categoryColors[entry.category] || categoryColors.general}>
                              {categories.find(c => c.value === entry.category)?.label || entry.category}
                            </Badge>
                          </div>
                          <div className="space-y-1 text-sm">
                            {entry.preferred_usage && (
                              <div className="flex items-start gap-2">
                                <CheckCircle className="h-4 w-4 text-green-500 mt-0.5 shrink-0" />
                                <span><strong>Bevorzugt:</strong> {entry.preferred_usage}</span>
                              </div>
                            )}
                            {entry.avoid_alternatives && (
                              <div className="flex items-start gap-2">
                                <XCircle className="h-4 w-4 text-red-500 mt-0.5 shrink-0" />
                                <span><strong>Vermeide:</strong> {entry.avoid_alternatives}</span>
                              </div>
                            )}
                            {entry.context && (
                              <p className="text-muted-foreground italic mt-2">{entry.context}</p>
                            )}
                          </div>
                        </div>
                        <div className="flex items-center gap-1">
                          <Button variant="ghost" size="icon" onClick={() => openEditDialog(entry)}>
                            <Edit2 className="h-4 w-4" />
                          </Button>
                          <Button variant="ghost" size="icon" onClick={() => openDeleteDialog(entry)}>
                            <Trash2 className="h-4 w-4 text-destructive" />
                          </Button>
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Add/Edit Dialog */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {editingEntry ? 'Eintrag bearbeiten' : 'Neuer Vokabular-Eintrag'}
            </DialogTitle>
            <DialogDescription>
              Definiere einen Begriff und wie er verwendet werden soll.
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={handleSubmit}>
            <div className="space-y-4 py-4">
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="term">Begriff</Label>
                  <Input
                    id="term"
                    placeholder="z.B. AI, Synthese"
                    value={formData.term}
                    onChange={(e) => setFormData({ ...formData, term: e.target.value })}
                    required
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="category">Kategorie</Label>
                  <Select
                    value={formData.category}
                    onValueChange={(value) => setFormData({ ...formData, category: value })}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {categories.map(cat => (
                        <SelectItem key={cat.value} value={cat.value}>{cat.label}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <div className="space-y-2">
                <Label htmlFor="preferred_usage">Bevorzugte Verwendung</Label>
                <Input
                  id="preferred_usage"
                  placeholder="z.B. AI, Künstliche Intelligenz"
                  value={formData.preferred_usage}
                  onChange={(e) => setFormData({ ...formData, preferred_usage: e.target.value })}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="avoid_alternatives">Zu vermeidende Alternativen</Label>
                <Input
                  id="avoid_alternatives"
                  placeholder="z.B. KI (zu unpräzise)"
                  value={formData.avoid_alternatives}
                  onChange={(e) => setFormData({ ...formData, avoid_alternatives: e.target.value })}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="context">Kontext / Hinweise</Label>
                <Textarea
                  id="context"
                  placeholder="Wann und wie soll der Begriff verwendet werden?"
                  value={formData.context}
                  onChange={(e) => setFormData({ ...formData, context: e.target.value })}
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
                {editingEntry ? 'Aktualisieren' : 'Hinzufügen'}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Delete Confirmation Dialog */}
      <AlertDialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Eintrag löschen?</AlertDialogTitle>
            <AlertDialogDescription>
              Möchtest du den Eintrag &quot;{deletingEntry?.term}&quot; wirklich löschen?
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

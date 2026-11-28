'use client'

import { useEffect, useMemo, useRef, useState, useCallback } from 'react'
import { toast } from 'sonner'
import { useConfirm } from '@/components/admin/admin-feedback'
import { BookOpen, Plus, Trash2, Edit2, Loader2, Tag, CheckCircle, XCircle, Upload, FileText, Sparkles, Check } from 'lucide-react'
import { applyMultiSelect } from '@/lib/news-queue/multi-select'
import {
  useMultiSelect,
  MultiSelectBar,
  MultiSelectCheckbox,
  MULTI_SELECT_ROW_CLASS,
} from '@/components/admin/multi-select'
import { runBatched } from '@/lib/admin/run-batched'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Badge } from '@/components/ui/badge'
import { Progress } from '@/components/ui/progress'
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

interface ExtractedVocabulary {
  term: string
  category: string
  preferred_usage: string
  context: string
}

const categories = [
  // Core categories
  { value: 'general', label: 'Allgemein' },
  { value: 'tech', label: 'Technologie' },
  { value: 'business', label: 'Business' },
  { value: 'brand', label: 'Brand/Marke' },
  { value: 'style', label: 'Schreibstil' },
  // Extended stylistic categories
  { value: 'fachbegriff', label: 'Fachbegriff' },
  { value: 'eigener_fachbegriff', label: 'Eigener Fachbegriff' },
  { value: 'anglizismus', label: 'Anglizismus' },
  { value: 'metapher', label: 'Metapher' },
  { value: 'neologismus', label: 'Neologismus' },
  { value: 'business_jargon', label: 'Business-Jargon' },
  { value: 'startup_jargon', label: 'Startup-Jargon' },
  { value: 'akronym', label: 'Akronym' },
  { value: 'bildliche_sprache', label: 'Bildliche Sprache' },
  { value: 'phrase', label: 'Phrase/Redewendung' },
  { value: 'satzkonstruktion', label: 'Satzkonstruktion' },
  { value: 'redewendung', label: 'Redewendung' },
  { value: 'umgangssprache', label: 'Umgangssprache' },
  { value: 'fremdwort', label: 'Fremdwort' },
  { value: 'mantra', label: 'Mantra' },
  { value: 'zitat', label: 'Zitat' },
  { value: 'lieblingswort', label: 'Lieblingswort' },
  { value: 'wortbildung', label: 'Wortbildung' },
  { value: 'praefixbildung', label: 'Präfixbildung' },
]

const categoryColors: Record<string, string> = {
  // Core categories
  general: 'bg-gray-100 text-gray-800 dark:bg-gray-800 dark:text-gray-200',
  tech: 'bg-blue-100 text-blue-800 dark:bg-blue-950/60 dark:text-blue-200',
  business: 'bg-green-100 text-green-800 dark:bg-green-950/60 dark:text-green-200',
  brand: 'bg-purple-100 text-purple-800 dark:bg-purple-950/60 dark:text-purple-200',
  style: 'bg-orange-100 text-orange-800 dark:bg-orange-950/60 dark:text-orange-200',
  // Extended stylistic categories
  fachbegriff: 'bg-indigo-100 text-indigo-800 dark:bg-indigo-950/60 dark:text-indigo-200',
  eigener_fachbegriff: 'bg-violet-100 text-violet-800 dark:bg-violet-950/60 dark:text-violet-200',
  anglizismus: 'bg-cyan-100 text-cyan-800 dark:bg-cyan-950/60 dark:text-cyan-200',
  metapher: 'bg-amber-100 text-amber-800 dark:bg-amber-950/60 dark:text-amber-200',
  neologismus: 'bg-lime-100 text-lime-800 dark:bg-lime-950/60 dark:text-lime-200',
  business_jargon: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-200',
  startup_jargon: 'bg-teal-100 text-teal-800 dark:bg-teal-950/60 dark:text-teal-200',
  akronym: 'bg-sky-100 text-sky-800 dark:bg-sky-950/60 dark:text-sky-200',
  bildliche_sprache: 'bg-rose-100 text-rose-800 dark:bg-rose-950/60 dark:text-rose-200',
  phrase: 'bg-fuchsia-100 text-fuchsia-800 dark:bg-fuchsia-950/60 dark:text-fuchsia-200',
  satzkonstruktion: 'bg-pink-100 text-pink-800 dark:bg-pink-950/60 dark:text-pink-200',
  redewendung: 'bg-red-100 text-red-800 dark:bg-red-950/60 dark:text-red-200',
  umgangssprache: 'bg-yellow-100 text-yellow-800 dark:bg-yellow-950/60 dark:text-yellow-200',
  fremdwort: 'bg-stone-100 text-stone-800 dark:bg-stone-800 dark:text-stone-200',
  mantra: 'bg-zinc-100 text-zinc-800 dark:bg-zinc-800 dark:text-zinc-200',
  zitat: 'bg-slate-100 text-slate-800 dark:bg-slate-800 dark:text-slate-200',
  lieblingswort: 'bg-orange-200 text-orange-900 dark:bg-orange-900/60 dark:text-orange-100',
  wortbildung: 'bg-green-200 text-green-900 dark:bg-green-900/60 dark:text-green-100',
  praefixbildung: 'bg-blue-200 text-blue-900 dark:bg-blue-900/60 dark:text-blue-100',
}

export default function VocabularyPage() {
  const confirmDialog = useConfirm()
  const [entries, setEntries] = useState<VocabularyEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [dialogOpen, setDialogOpen] = useState(false)
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false)
  const [editingEntry, setEditingEntry] = useState<VocabularyEntry | null>(null)
  const [deletingEntry, setDeletingEntry] = useState<VocabularyEntry | null>(null)
  const [filterCategory, setFilterCategory] = useState<string>('all')

  // Extraction state
  const [isDragging, setIsDragging] = useState(false)
  const [extracting, setExtracting] = useState(false)
  const [extractedVocabulary, setExtractedVocabulary] = useState<ExtractedVocabulary[]>([])
  const [styleSummary, setStyleSummary] = useState<string | null>(null)
  const [selectedExtracted, setSelectedExtracted] = useState<Set<number>>(new Set())
  const extractedAnchorRef = useRef<string | null>(null)
  const [addingExtracted, setAddingExtracted] = useState(false)
  const [bulkBusy, setBulkBusy] = useState<string | null>(null)
  const [bulkCategory, setBulkCategory] = useState<string>('general')

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
        toast.error(error.error || 'Fehler beim Speichern')
      }
    } catch (error) {
      console.error('Error saving entry:', error)
      toast.error('Fehler beim Speichern')
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
        toast.error(error.error || 'Fehler beim Löschen')
      }
    } catch (error) {
      console.error('Error deleting entry:', error)
      toast.error('Fehler beim Löschen')
    }
  }

  // Drag & Drop handlers
  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    setIsDragging(true)
  }, [])

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    setIsDragging(false)
  }, [])

  const handleDrop = useCallback(async (e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    setIsDragging(false)

    const files = e.dataTransfer.files
    if (files.length === 0) return

    await extractVocabularyFromFile(files[0])
  }, [])

  const handleFileSelect = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files
    if (!files || files.length === 0) return

    await extractVocabularyFromFile(files[0])
    e.target.value = '' // Reset input
  }, [])

  async function extractVocabularyFromFile(file: File) {
    setExtracting(true)
    setExtractedVocabulary([])
    setStyleSummary(null)
    setSelectedExtracted(new Set())

    try {
      const formData = new FormData()
      formData.append('file', file)

      const res = await fetch('/api/admin/vocabulary/extract', {
        method: 'POST',
        body: formData,
        credentials: 'include',
      })

      const data = await res.json()

      if (!res.ok || !data.ok) {
        toast.error(data.error || 'Fehler bei der Analyse')
        return
      }

      setExtractedVocabulary(data.vocabulary || [])
      setStyleSummary(data.styleSummary || null)
      // Select all by default
      setSelectedExtracted(new Set(data.vocabulary?.map((_: ExtractedVocabulary, i: number) => i) || []))
    } catch (error) {
      console.error('Error extracting vocabulary:', error)
      toast.error('Fehler bei der Analyse')
    } finally {
      setExtracting(false)
    }
  }

  function toggleExtractedSelection(index: number, shiftKey = false) {
    const visibleExtractedIds = extractedVocabulary.map((_, i) => String(i))
    setSelectedExtracted(prev => {
      const prevStrings = new Set(Array.from(prev, (n) => String(n)))
      const result = applyMultiSelect({
        visibleIds: visibleExtractedIds,
        selected: prevStrings,
        anchorId: extractedAnchorRef.current,
        clickedId: String(index),
        shiftKey,
      })
      extractedAnchorRef.current = result.anchorId
      return new Set(Array.from(result.selected, (s) => Number(s)))
    })
  }

  function selectAllExtracted() {
    setSelectedExtracted(new Set(extractedVocabulary.map((_, i) => i)))
    extractedAnchorRef.current = extractedVocabulary.length > 0 ? '0' : null
  }

  function deselectAllExtracted() {
    setSelectedExtracted(new Set())
    extractedAnchorRef.current = null
  }

  async function addSelectedVocabulary() {
    if (selectedExtracted.size === 0) return

    setAddingExtracted(true)

    try {
      const itemsToAdd = Array.from(selectedExtracted).map(i => extractedVocabulary[i])

      // Add each item
      for (const item of itemsToAdd) {
        await fetch('/api/admin/vocabulary', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            term: item.term,
            preferred_usage: item.preferred_usage,
            avoid_alternatives: '',
            context: item.context,
            category: item.category,
          }),
          credentials: 'include',
        })
      }

      // Refresh entries
      await fetchEntries()

      // Clear extraction results
      setExtractedVocabulary([])
      setStyleSummary(null)
      setSelectedExtracted(new Set())

      toast.success(`${itemsToAdd.length} Einträge hinzugefügt!`)
    } catch (error) {
      console.error('Error adding vocabulary:', error)
      toast.error('Fehler beim Hinzufügen')
    } finally {
      setAddingExtracted(false)
    }
  }

  const filteredEntries = useMemo(
    () => (filterCategory === 'all' ? entries : entries.filter(e => e.category === filterCategory)),
    [entries, filterCategory],
  )

  const groupedEntries = useMemo(
    () =>
      filteredEntries.reduce((acc, entry) => {
        const cat = entry.category || 'general'
        if (!acc[cat]) acc[cat] = []
        acc[cat].push(entry)
        return acc
      }, {} as Record<string, VocabularyEntry[]>),
    [filteredEntries],
  )

  // Match visual group-by-group render order so Shift+Click range selection follows screen order.
  const visibleEntryIds = useMemo(
    () => Object.values(groupedEntries).flatMap((group) => group.map((entry) => entry.id)),
    [groupedEntries],
  )
  const selection = useMultiSelect(visibleEntryIds, {
    resetKey: filterCategory,
    disableEscape: dialogOpen || deleteDialogOpen,
  })
  const selectedEntries = useMemo(() => {
    const byId = new Map(filteredEntries.map((e) => [e.id, e]))
    return selection.visibleSelectedIds
      .map((id) => byId.get(id))
      .filter((e): e is VocabularyEntry => Boolean(e))
  }, [filteredEntries, selection.visibleSelectedIds])

  async function bulkChangeCategory() {
    if (selectedEntries.length === 0) return
    setBulkBusy('category')
    try {
      const result = await runBatched(selectedEntries, async (entry) => {
        const res = await fetch('/api/admin/vocabulary', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            id: entry.id,
            term: entry.term,
            preferred_usage: entry.preferred_usage || '',
            avoid_alternatives: entry.avoid_alternatives || '',
            context: entry.context || '',
            category: bulkCategory,
          }),
          credentials: 'include',
        })
        if (!res.ok) {
          const err = await res.json().catch(() => null)
          throw new Error(err?.error || `HTTP ${res.status}`)
        }
      })
      if (result.failed.length > 0) {
        toast.error(`${result.failed.length} von ${selectedEntries.length} Updates fehlgeschlagen`)
      }
      if (result.succeeded > 0) {
        selection.clear()
        await fetchEntries()
      }
    } finally {
      setBulkBusy(null)
    }
  }

  async function bulkDeleteEntries() {
    const ids = selection.visibleSelectedIds
    if (ids.length === 0) return
    if (!(await confirmDialog({
      title: `${ids.length} Vokabular-Einträge wirklich löschen?`,
      confirmLabel: 'Löschen',
      destructive: true,
    }))) return
    setBulkBusy('delete')
    try {
      const result = await runBatched(ids, async (id) => {
        const res = await fetch(`/api/admin/vocabulary?id=${encodeURIComponent(id)}`, {
          method: 'DELETE',
          credentials: 'include',
        })
        if (!res.ok) {
          const err = await res.json().catch(() => null)
          throw new Error(err?.error || `HTTP ${res.status}`)
        }
      })
      if (result.failed.length > 0) {
        toast.error(`${result.failed.length} von ${ids.length} Löschungen fehlgeschlagen`)
      }
      if (result.succeeded > 0) {
        selection.clear()
        await fetchEntries()
      }
    } finally {
      setBulkBusy(null)
    }
  }

  return (
    <div className="p-4 md:p-6 lg:p-8 mx-auto max-w-6xl">
      <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Vokabular</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Definiere bevorzugte Begriffe und Formulierungen für den Ghostwriter
          </p>
        </div>
        <Button className="gap-2" onClick={openAddDialog}>
          <Plus className="h-4 w-4" />
          Neuer Eintrag
        </Button>
      </div>

      {/* Drag & Drop Upload Area */}
      <Card
        className={`mb-6 border-2 border-dashed transition-colors ${
          isDragging ? 'border-primary bg-primary/5' : 'border-muted-foreground/25'
        }`}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
      >
        <CardContent className="py-6">
          <div className="flex flex-col items-center justify-center gap-3 text-center">
            {extracting ? (
              <>
                <Loader2 className="h-8 w-8 animate-spin text-primary" />
                <p className="text-sm text-muted-foreground">Analysiere Dokument und extrahiere Vokabular...</p>
                <Progress value={undefined} className="w-48" />
              </>
            ) : (
              <>
                <Upload className="h-8 w-8 text-muted-foreground" />
                <div>
                  <p className="font-medium">Datei hochladen für Stilanalyse</p>
                  <p className="text-sm text-muted-foreground">
                    PDF, HTML, MD, TXT oder RTF hierher ziehen
                  </p>
                </div>
                <label>
                  <input
                    type="file"
                    className="hidden"
                    accept=".pdf,.html,.htm,.md,.txt,.rtf"
                    onChange={handleFileSelect}
                  />
                  <Button variant="outline" size="sm" className="cursor-pointer" asChild>
                    <span><FileText className="h-4 w-4 mr-2" />Datei auswählen</span>
                  </Button>
                </label>
              </>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Extracted Vocabulary Results */}
      {extractedVocabulary.length > 0 && (
        <Card className="mb-6 border-primary/50">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Sparkles className="h-5 w-5 text-primary" />
              Extrahiertes Vokabular
              <Badge variant="secondary">{extractedVocabulary.length} Begriffe</Badge>
            </CardTitle>
            {styleSummary && (
              <CardDescription className="italic">
                &quot;{styleSummary}&quot;
              </CardDescription>
            )}
          </CardHeader>
          <CardContent>
            <div className="mb-4 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Button variant="outline" size="sm" onClick={selectAllExtracted}>
                  Alle auswählen
                </Button>
                <Button variant="outline" size="sm" onClick={deselectAllExtracted}>
                  Keine auswählen
                </Button>
                <span className="text-sm text-muted-foreground">
                  {selectedExtracted.size} ausgewählt
                </span>
              </div>
              <Button
                onClick={addSelectedVocabulary}
                disabled={selectedExtracted.size === 0 || addingExtracted}
                className="gap-2"
              >
                {addingExtracted ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Plus className="h-4 w-4" />
                )}
                Ausgewählte übernehmen
              </Button>
            </div>

            <div className="max-h-96 overflow-y-auto space-y-1">
              {extractedVocabulary.map((item, index) => (
                <div
                  key={index}
                  onMouseDown={(e) => {
                    if (e.shiftKey) e.preventDefault()
                  }}
                  onClick={(e) => toggleExtractedSelection(index, e.shiftKey)}
                  className={`cursor-pointer rounded px-2 py-1.5 transition-colors flex items-center gap-2 ${
                    selectedExtracted.has(index)
                      ? 'bg-primary/10'
                      : 'hover:bg-muted/50'
                  }`}
                >
                  <div className={`flex h-4 w-4 items-center justify-center rounded border shrink-0 ${
                    selectedExtracted.has(index)
                      ? 'border-primary bg-primary text-primary-foreground'
                      : 'border-muted-foreground/50'
                  }`}>
                    {selectedExtracted.has(index) && <Check className="h-2.5 w-2.5" />}
                  </div>
                  <span className="font-mono font-medium text-sm">{item.term}</span>
                  <Badge variant="outline" className={`text-xs px-1.5 py-0 ${categoryColors[item.category] || categoryColors.general}`}>
                    {categories.find(c => c.value === item.category)?.label || item.category}
                  </Badge>
                  {item.preferred_usage && (
                    <span className="text-xs text-muted-foreground truncate">{item.preferred_usage}</span>
                  )}
                </div>
              ))}
            </div>

            <div className="mt-4 flex justify-end">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  setExtractedVocabulary([])
                  setStyleSummary(null)
                  setSelectedExtracted(new Set())
                }}
              >
                Verwerfen
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

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
          <MultiSelectBar
            selection={selection}
            totalVisible={filteredEntries.length}
            busy={bulkBusy !== null}
          >
            <div className="flex items-center gap-1.5">
              <Select value={bulkCategory} onValueChange={setBulkCategory}>
                <SelectTrigger className="h-7 w-[160px] text-xs bg-background">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {categories.map(cat => (
                    <SelectItem key={cat.value} value={cat.value}>{cat.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Button
                size="sm"
                variant="outline"
                className="h-7 text-xs gap-1"
                onClick={() => void bulkChangeCategory()}
                disabled={bulkBusy !== null || selectedEntries.length === 0}
              >
                {bulkBusy === 'category' ? <Loader2 className="h-3 w-3 animate-spin" /> : <Tag className="h-3 w-3" />}
                Kategorie setzen
              </Button>
            </div>
            <Button
              size="sm"
              variant="destructive"
              className="h-7 text-xs gap-1"
              onClick={() => void bulkDeleteEntries()}
              disabled={bulkBusy !== null || selection.visibleSelectedIds.length === 0}
            >
              {bulkBusy === 'delete' ? <Loader2 className="h-3 w-3 animate-spin" /> : <Trash2 className="h-3 w-3" />}
              Löschen ({selection.visibleSelectedIds.length})
            </Button>
          </MultiSelectBar>
          {Object.entries(groupedEntries).map(([category, categoryEntries]) => (
            <div key={category}>
              <h2 className="text-lg font-semibold mb-3 flex items-center gap-2">
                <Tag className="h-4 w-4" />
                {categories.find(c => c.value === category)?.label || category}
                <Badge variant="secondary" className="ml-2">{categoryEntries.length}</Badge>
              </h2>
              <div className="grid gap-3">
                {categoryEntries.map((entry) => {
                  const isSelected = selection.isSelected(entry.id)
                  return (
                  <Card
                    key={entry.id}
                    {...selection.rowSelectionProps(entry.id)}
                    className={isSelected ? MULTI_SELECT_ROW_CLASS : undefined}
                  >
                    <CardContent className="py-4">
                      <div className="flex items-start justify-between gap-4">
                        <MultiSelectCheckbox
                          checked={isSelected}
                          onToggle={(shiftKey) => selection.toggle(entry.id, shiftKey)}
                          ariaLabel={`Vokabel auswählen: ${entry.term}`}
                          className="mt-1.5"
                        />
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
                  )
                })}
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

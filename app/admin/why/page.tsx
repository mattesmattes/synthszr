'use client'

import { useState, useEffect } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { TiptapEditor } from '@/components/tiptap-editor'
import { createClient } from '@/lib/supabase/client'
import { Loader2, Save, ExternalLink } from 'lucide-react'
import Link from 'next/link'

interface StaticPage {
  id: string
  slug: string
  title: string
  content: Record<string, unknown>
}

export default function AdminWhyPage() {
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [page, setPage] = useState<StaticPage | null>(null)
  const [title, setTitle] = useState('')
  const [content, setContent] = useState<Record<string, unknown>>({})

  useEffect(() => {
    async function fetchPage() {
      const supabase = createClient()
      const { data, error } = await supabase
        .from('static_pages')
        .select('*')
        .eq('slug', 'why')
        .single()

      if (data) {
        console.log('[Why Load] Loaded page:', data.id)
        console.log('[Why Load] Title:', data.title)
        console.log('[Why Load] Content:', JSON.stringify(data.content).slice(0, 100))
        setPage(data)
        setTitle(data.title)
        setContent(data.content)
      } else if (error && error.code !== 'PGRST116') {
        console.error('[Why Load] Error fetching page:', error)
      } else {
        console.log('[Why Load] No existing page found, will create new')
      }
      setLoading(false)
    }

    fetchPage()
  }, [])

  const handleSave = async () => {
    setSaving(true)

    console.log('[Why Save] Starting save...')
    console.log('[Why Save] Title:', title)
    console.log('[Why Save] Content keys:', Object.keys(content))
    console.log('[Why Save] Content:', JSON.stringify(content).slice(0, 300))

    // Validate content
    if (!content || Object.keys(content).length === 0) {
      alert('Fehler: Inhalt ist leer!')
      setSaving(false)
      return
    }

    // Use upsert with slug as the unique key (serverseitig, Security-Stufe 2)
    const res = await fetch('/api/admin/static-pages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ slug: 'why', title, content }),
    })
    const { page: savedPage, error } = await res.json()

    console.log('[Why Save] Upsert result:', error ? 'FAILED' : 'OK')
    if (error) console.log('[Why Save] Error:', error)

    if (!res.ok) {
      alert(`Fehler beim Speichern: ${error}`)
    } else {
      if (savedPage) {
        setPage(savedPage)
      }
      alert('Gespeichert!')
    }

    setSaving(false)
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Why Page</h1>
          <p className="text-sm text-muted-foreground">
            Bearbeite die statische &quot;Why&quot; Seite
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Link href="/why" target="_blank">
            <Button variant="outline" size="sm" className="gap-2">
              <ExternalLink className="h-4 w-4" />
              Vorschau
            </Button>
          </Link>
          <Button onClick={handleSave} disabled={saving} className="gap-2">
            {saving ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Save className="h-4 w-4" />
            )}
            Speichern
          </Button>
        </div>
      </div>

      <div className="space-y-4">
        <div className="space-y-2">
          <Label htmlFor="title" className="font-mono text-xs">
            Titel
          </Label>
          <Input
            id="title"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Seitentitel"
            className="text-lg"
          />
        </div>

        <div className="space-y-2">
          <Label className="font-mono text-xs">Inhalt</Label>
          <TiptapEditor content={content} onChange={setContent} />
        </div>
      </div>
    </div>
  )
}

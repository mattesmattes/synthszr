'use client'

import { useState, useEffect, useCallback } from 'react'
import { upload } from '@vercel/blob/client'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Switch } from '@/components/ui/switch'
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs'
import { Loader2, Plus, Trash2, Upload, Save, Copy } from 'lucide-react'
import { AdPromoView } from '@/components/ad-promo'
import type { AdPromo, AdPromoConfig, AdPromoLayout } from '@/lib/ad-promos/types'

export default function AdPromosAdminPage() {
  const [promos, setPromos] = useState<AdPromo[]>([])
  const [config, setConfig] = useState<AdPromoConfig>({ mode: 'rotate', constantId: null })
  const [loading, setLoading] = useState(true)
  const [savingConfig, setSavingConfig] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    const [pRes, cRes] = await Promise.all([
      fetch('/api/admin/ad-promos').then(r => r.json()),
      fetch('/api/admin/ad-promos/config').then(r => r.json()),
    ])
    setPromos(pRes.promos ?? [])
    setConfig(cRes.config ?? { mode: 'rotate', constantId: null })
    setLoading(false)
  }, [])

  useEffect(() => { load() }, [load])

  const createPromo = async () => {
    const res = await fetch('/api/admin/ad-promos', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'Neue Promo',
        title: 'Titel',
        body: 'Beschreibung',
        cta_label: 'Mehr →',
        link_url: 'https://',
      }),
    })
    const json = await res.json()
    if (json.promo) setPromos(prev => [...prev, json.promo])
  }

  const updatePromo = async (id: string, patch: Partial<AdPromo>) => {
    setPromos(prev => prev.map(p => p.id === id ? { ...p, ...patch } : p))
    await fetch(`/api/admin/ad-promos/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(patch),
    })
  }

  const deletePromo = async (id: string) => {
    if (!confirm('Promo wirklich löschen?')) return
    await fetch(`/api/admin/ad-promos/${id}`, { method: 'DELETE' })
    setPromos(prev => prev.filter(p => p.id !== id))
  }

  const duplicatePromo = async (source: AdPromo) => {
    const res = await fetch('/api/admin/ad-promos', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: `${source.name} (Kopie)`,
        layout: source.layout,
        title: source.title,
        body: source.body,
        cta_label: source.cta_label,
        link_url: source.link_url,
        eyebrow: source.eyebrow,
        image_left_url: source.image_left_url,
        image_left_bg: source.image_left_bg,
        image_left_blend: source.image_left_blend,
        image_right_url: source.image_right_url,
        image_right_bg: source.image_right_bg,
        image_right_blend: source.image_right_blend,
        text_bg: source.text_bg,
        text_color: source.text_color,
        active: false,
        sort_order: promos.length,
      }),
    })
    const json = await res.json()
    if (json.promo) setPromos(prev => [...prev, json.promo])
  }

  const saveConfig = async (next: AdPromoConfig) => {
    setSavingConfig(true)
    setConfig(next)
    await fetch('/api/admin/ad-promos/config', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(next),
    })
    setSavingConfig(false)
  }

  if (loading) {
    return <div className="flex items-center justify-center p-12"><Loader2 className="h-6 w-6 animate-spin" /></div>
  }

  return (
    <div className="mx-auto max-w-5xl space-y-8 p-6">
      <div>
        <h1 className="font-mono text-2xl font-bold">Ad Promos</h1>
        <p className="text-sm text-muted-foreground">Promotionsblöcke für Posts, Homepage und Why-Seite verwalten.</p>
      </div>

      {/* Display Mode */}
      <div className="rounded-lg border border-border bg-card p-4 space-y-3">
        <h2 className="font-mono text-sm font-semibold uppercase">Anzeige-Modus</h2>
        <div className="flex flex-wrap items-center gap-3">
          <label className="flex items-center gap-2">
            <input
              type="radio"
              checked={config.mode === 'rotate'}
              onChange={() => saveConfig({ mode: 'rotate', constantId: null })}
            />
            <span className="text-sm">Täglich rotieren (alle aktiven Promos)</span>
          </label>
          <label className="flex items-center gap-2">
            <input
              type="radio"
              checked={config.mode === 'constant'}
              onChange={() => saveConfig({ mode: 'constant', constantId: config.constantId ?? promos.find(p => p.active)?.id ?? null })}
            />
            <span className="text-sm">Konstant eine Promo zeigen</span>
          </label>
          <label className="flex items-center gap-2">
            <input
              type="radio"
              checked={config.mode === 'off'}
              onChange={() => saveConfig({ mode: 'off', constantId: null })}
            />
            <span className="text-sm">Keine Promo anzeigen</span>
          </label>
          {config.mode === 'constant' && (
            <select
              className="ml-2 rounded-md border border-border bg-background px-2 py-1 text-sm"
              value={config.constantId ?? ''}
              onChange={e => saveConfig({ mode: 'constant', constantId: e.target.value || null })}
            >
              <option value="">— wählen —</option>
              {promos.filter(p => p.active).map(p => (
                <option key={p.id} value={p.id}>{p.name}</option>
              ))}
            </select>
          )}
          {savingConfig && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />}
        </div>
      </div>

      <Button onClick={createPromo}><Plus className="mr-2 h-4 w-4" />Neue Promo</Button>

      {promos.length === 0 ? (
        <div className="rounded-lg border border-dashed border-border p-12 text-center text-sm text-muted-foreground">
          Noch keine Promos angelegt.
        </div>
      ) : (
        <Tabs defaultValue={promos[0].id} className="w-full">
          <TabsList className="flex h-auto flex-wrap justify-start">
            {promos.map(promo => (
              <TabsTrigger key={promo.id} value={promo.id} className="gap-2">
                <span
                  className={`inline-block h-2 w-2 rounded-full ${promo.active ? 'bg-emerald-500' : 'bg-muted-foreground/40'}`}
                  aria-label={promo.active ? 'aktiv' : 'deaktiviert'}
                />
                {promo.name}
              </TabsTrigger>
            ))}
          </TabsList>
          {promos.map(promo => (
            <TabsContent key={promo.id} value={promo.id} className="mt-4">
              <PromoEditor
                promo={promo}
                onChange={(patch) => updatePromo(promo.id, patch)}
                onDelete={() => deletePromo(promo.id)}
                onDuplicate={() => duplicatePromo(promo)}
              />
            </TabsContent>
          ))}
        </Tabs>
      )}
    </div>
  )
}

function PromoEditor({
  promo,
  onChange,
  onDelete,
  onDuplicate,
}: {
  promo: AdPromo
  onChange: (patch: Partial<AdPromo>) => void
  onDelete: () => void
  onDuplicate: () => void
}) {
  const [uploading, setUploading] = useState<'left' | 'right' | null>(null)
  const [draft, setDraft] = useState(promo)
  const [dirty, setDirty] = useState(false)

  useEffect(() => { setDraft(promo); setDirty(false) }, [promo.id, promo.updated_at])

  const update = (patch: Partial<AdPromo>) => {
    setDraft(prev => ({ ...prev, ...patch }))
    setDirty(true)
  }

  const save = () => {
    onChange(draft)
    setDirty(false)
  }

  const handleImageUpload = async (slot: 'left' | 'right', file: File) => {
    setUploading(slot)
    try {
      const blob = await upload(`ad-promos/${promo.id}-${slot}-${Date.now()}-${file.name}`, file, {
        access: 'public',
        handleUploadUrl: '/api/admin/ad-promos/upload',
      })
      const patch = slot === 'left' ? { image_left_url: blob.url } : { image_right_url: blob.url }
      setDraft(prev => ({ ...prev, ...patch }))
      onChange(patch) // persist immediately for images
    } finally {
      setUploading(null)
    }
  }

  return (
    <div className="rounded-lg border border-border bg-card p-4 space-y-4">
      <div className="flex items-start justify-between gap-3">
        <Input
          className="max-w-md font-mono text-sm font-semibold"
          value={draft.name}
          onChange={e => update({ name: e.target.value })}
          placeholder="Interner Name"
        />
        <div className="flex items-center gap-3">
          <label className="flex items-center gap-2 text-sm">
            <Switch checked={draft.active} onCheckedChange={(v) => { update({ active: v }); onChange({ active: v }) }} />
            {draft.active ? 'Aktiv' : 'Deaktiviert'}
          </label>
          {dirty && (
            <Button size="sm" onClick={save}><Save className="mr-1 h-4 w-4" />Speichern</Button>
          )}
          <Button size="sm" variant="ghost" onClick={onDuplicate} title="Als Vorlage kopieren"><Copy className="h-4 w-4" /></Button>
          <Button size="sm" variant="ghost" onClick={onDelete}><Trash2 className="h-4 w-4" /></Button>
        </div>
      </div>

      {/* Layout */}
      <div className="flex items-center gap-3">
        <Label className="text-xs">Layout:</Label>
        <select
          className="rounded-md border border-border bg-background px-2 py-1 text-sm"
          value={draft.layout}
          onChange={e => update({ layout: e.target.value as AdPromoLayout })}
        >
          <option value="grid">Grid (2 Bilder + Text)</option>
          <option value="single">Single (1 Bild 880px + Text)</option>
        </select>
      </div>

      {/* Images */}
      <div className="grid grid-cols-2 gap-4">
        <ImageSlot
          label={draft.layout === 'single' ? 'Bild (880px breit)' : 'Bild Links'}
          url={draft.image_left_url}
          bg={draft.image_left_bg}
          uploading={uploading === 'left'}
          onUpload={(file) => handleImageUpload('left', file)}
          onBgChange={(c) => update({ image_left_bg: c })}
          onClear={() => { update({ image_left_url: null }); onChange({ image_left_url: null }) }}
        />
        {draft.layout === 'grid' && (
          <ImageSlot
            label="Bild Rechts"
            url={draft.image_right_url}
            bg={draft.image_right_bg}
            uploading={uploading === 'right'}
            onUpload={(file) => handleImageUpload('right', file)}
            onBgChange={(c) => update({ image_right_bg: c })}
            onClear={() => { update({ image_right_url: null }); onChange({ image_right_url: null }) }}
          />
        )}
      </div>

      {/* Text */}
      <div className="grid grid-cols-2 gap-3">
        <div>
          <Label className="text-xs">Eyebrow</Label>
          <Input value={draft.eyebrow ?? ''} onChange={e => update({ eyebrow: e.target.value || null })} />
        </div>
        <div>
          <Label className="text-xs">Titel</Label>
          <Input value={draft.title} onChange={e => update({ title: e.target.value })} />
        </div>
      </div>
      <div>
        <Label className="text-xs">Body (HTML erlaubt)</Label>
        <Textarea rows={4} value={draft.body} onChange={e => update({ body: e.target.value })} />
      </div>
      <div className="grid grid-cols-3 gap-3">
        <div>
          <Label className="text-xs">CTA-Label</Label>
          <Input value={draft.cta_label} onChange={e => update({ cta_label: e.target.value })} />
        </div>
        <div className="col-span-2">
          <Label className="text-xs">Link-URL</Label>
          <Input value={draft.link_url} onChange={e => update({ link_url: e.target.value })} />
        </div>
      </div>
      <div className="flex items-center gap-4">
        <ColorField label="Text-BG" value={draft.text_bg} onChange={c => update({ text_bg: c })} />
        <ColorField label="Textfarbe" value={draft.text_color} onChange={c => update({ text_color: c })} />
        <div className="ml-auto">
          <Label className="text-xs">Sortierung</Label>
          <Input
            type="number"
            className="w-20"
            value={draft.sort_order}
            onChange={e => update({ sort_order: parseInt(e.target.value) || 0 })}
          />
        </div>
      </div>

      {/* Live Preview */}
      <div>
        <Label className="text-xs">Vorschau</Label>
        <div className="rounded-md border border-border bg-background p-4">
          <AdPromoView promo={draft} />
        </div>
      </div>
    </div>
  )
}

function ImageSlot({
  label, url, bg, uploading, onUpload, onBgChange, onClear,
}: {
  label: string
  url: string | null
  bg: string
  uploading: boolean
  onUpload: (file: File) => void
  onBgChange: (c: string) => void
  onClear: () => void
}) {
  return (
    <div className="space-y-2 rounded-md border border-border p-3">
      <Label className="text-xs">{label}</Label>
      <div className="flex aspect-square items-center justify-center overflow-hidden rounded" style={{ backgroundColor: bg }}>
        {url ? (
          <img src={url} alt="" className="max-h-full max-w-full object-contain" style={{ mixBlendMode: 'multiply' }} />
        ) : (
          <span className="text-xs text-muted-foreground">Kein Bild</span>
        )}
      </div>
      <div className="flex items-center gap-2">
        <label className="flex items-center gap-1 cursor-pointer text-xs">
          {uploading ? <Loader2 className="h-3 w-3 animate-spin" /> : <Upload className="h-3 w-3" />}
          <span>{uploading ? 'Lädt…' : 'Upload'}</span>
          <input
            type="file"
            accept="image/*"
            className="hidden"
            disabled={uploading}
            onChange={e => { const f = e.target.files?.[0]; if (f) onUpload(f); e.target.value = '' }}
          />
        </label>
        {url && (
          <button type="button" className="text-xs text-muted-foreground hover:text-destructive" onClick={onClear}>Entfernen</button>
        )}
      </div>
      <div className="flex items-center gap-2">
        <ColorField label="BG (Multiply)" value={bg} onChange={onBgChange} />
      </div>
    </div>
  )
}

function ColorField({ label, value, onChange }: { label: string; value: string; onChange: (c: string) => void }) {
  return (
    <div className="flex items-center gap-2">
      <Label className="text-xs">{label}</Label>
      <input
        type="color"
        value={value}
        onChange={e => onChange(e.target.value)}
        className="h-7 w-10 cursor-pointer rounded border border-border bg-transparent"
      />
      <Input className="w-24 font-mono text-xs" value={value} onChange={e => onChange(e.target.value)} />
    </div>
  )
}

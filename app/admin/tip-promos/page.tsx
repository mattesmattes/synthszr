'use client'

import { useState, useEffect, useCallback } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Switch } from '@/components/ui/switch'
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs'
import { Loader2, Plus, Trash2 } from 'lucide-react'
import { TipPromoBox } from '@/components/tip-promo-box'
import type { TipPromo, TipPromoConfig } from '@/lib/tip-promos/types'

const DEFAULT_GRADIENT = { from: '#B4E37A', to: '#F6E23E', direction: 'to bottom' as const, text: '#1a1a0a' }

export default function TipPromosAdminPage() {
  const [promos, setPromos] = useState<TipPromo[]>([])
  const [config, setConfig] = useState<TipPromoConfig>({ mode: 'rotate', constantId: null })
  const [loading, setLoading] = useState(true)
  const [savingConfig, setSavingConfig] = useState(false)
  const [activeTab, setActiveTab] = useState<string>('')

  const load = useCallback(async () => {
    setLoading(true)
    const [pRes, cRes] = await Promise.all([
      fetch('/api/admin/tip-promos').then(r => r.json()),
      fetch('/api/admin/tip-promos/config').then(r => r.json()),
    ])
    setPromos(pRes.promos ?? [])
    setConfig(cRes.config ?? { mode: 'rotate', constantId: null })
    setLoading(false)
    if (pRes.promos?.[0]) setActiveTab(pRes.promos[0].id)
  }, [])

  useEffect(() => { load() }, [load])

  const createPromo = async () => {
    const res = await fetch('/api/admin/tip-promos', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'Neuer Tipp',
        headline: 'TIPP DES TAGES',
        body: 'Hier steht der Tipp-Text. Unterstützt <b>Fett</b>, <i>Kursiv</i>, <a href="#">Links</a>.',
        link_url: '',
        cta_label: '',
        gradient_from: DEFAULT_GRADIENT.from,
        gradient_to: DEFAULT_GRADIENT.to,
        gradient_direction: DEFAULT_GRADIENT.direction,
        text_color: DEFAULT_GRADIENT.text,
        active: false,
        sort_order: promos.length,
      }),
    })
    const json = await res.json()
    if (json.promo) {
      setPromos(prev => [...prev, json.promo])
      setActiveTab(json.promo.id)
    }
  }

  const updatePromo = async (id: string, patch: Partial<TipPromo>) => {
    setPromos(prev => prev.map(p => p.id === id ? { ...p, ...patch } : p))
    await fetch(`/api/admin/tip-promos/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(patch),
    })
  }

  const deletePromo = async (id: string) => {
    if (!confirm('Tipp wirklich löschen?')) return
    await fetch(`/api/admin/tip-promos/${id}`, { method: 'DELETE' })
    setPromos(prev => prev.filter(p => p.id !== id))
  }

  const saveConfig = async (next: TipPromoConfig) => {
    setSavingConfig(true)
    setConfig(next)
    await fetch('/api/admin/tip-promos/config', {
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
    <div className="mx-auto max-w-5xl space-y-6 p-6">
      <div>
        <h1 className="font-mono text-2xl font-bold">Tip Promos</h1>
        <p className="text-sm text-muted-foreground">
          &quot;Tipp des Tages&quot;-Boxen verwalten — erscheinen im ersten Artikel eines Posts, direkt vor dem Synthszr Take (Web + Newsletter).
        </p>
      </div>

      {/* Display Mode */}
      <div className="rounded-lg border border-border bg-card p-4 space-y-3">
        <h2 className="font-mono text-sm font-semibold uppercase">Anzeige-Modus</h2>
        <div className="flex flex-wrap items-center gap-3">
          <label className="flex items-center gap-2 text-sm">
            <input
              type="radio"
              checked={config.mode === 'rotate'}
              onChange={() => saveConfig({ mode: 'rotate', constantId: null })}
            />
            Rotation (täglich wechselnd)
          </label>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="radio"
              checked={config.mode === 'constant'}
              onChange={() => saveConfig({ mode: 'constant', constantId: promos.find(p => p.active)?.id ?? null })}
            />
            Fest
          </label>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="radio"
              checked={config.mode === 'off'}
              onChange={() => saveConfig({ mode: 'off', constantId: null })}
            />
            Keine Promo anzeigen
          </label>
          {config.mode === 'constant' && (
            <select
              value={config.constantId ?? ''}
              onChange={e => saveConfig({ mode: 'constant', constantId: e.target.value || null })}
              className="text-xs rounded border px-2 py-1 bg-background"
              disabled={savingConfig}
            >
              <option value="">— wählen —</option>
              {promos.filter(p => p.active).map(p => (
                <option key={p.id} value={p.id}>{p.name}</option>
              ))}
            </select>
          )}
        </div>
      </div>

      <div className="flex items-center justify-between">
        <h2 className="font-mono text-sm font-semibold uppercase">Tipps ({promos.length})</h2>
        <Button size="sm" onClick={createPromo}>
          <Plus className="h-4 w-4 mr-1" /> Neuer Tipp
        </Button>
      </div>

      {promos.length === 0 ? (
        <div className="rounded-lg border border-dashed border-border p-8 text-center text-sm text-muted-foreground">
          Noch keine Tipps angelegt.
        </div>
      ) : (
        <Tabs value={activeTab} onValueChange={setActiveTab}>
          <TabsList className="flex-wrap h-auto">
            {promos.map(p => (
              <TabsTrigger key={p.id} value={p.id} className="text-xs">
                {p.active && <span className="mr-1 inline-block w-1.5 h-1.5 rounded-full bg-green-500" />}
                {p.name}
              </TabsTrigger>
            ))}
          </TabsList>
          {promos.map(p => (
            <TabsContent key={p.id} value={p.id} className="space-y-4 mt-4">
              <TipEditor promo={p} onUpdate={patch => updatePromo(p.id, patch)} onDelete={() => deletePromo(p.id)} />
            </TabsContent>
          ))}
        </Tabs>
      )}
    </div>
  )
}

function TipEditor({ promo, onUpdate, onDelete }: {
  promo: TipPromo
  onUpdate: (patch: Partial<TipPromo>) => void
  onDelete: () => void
}) {
  return (
    <div className="grid gap-6 md:grid-cols-[1fr_320px]">
      <div className="space-y-4">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <Label className="text-xs">Aktiv</Label>
            <Switch checked={promo.active} onCheckedChange={v => onUpdate({ active: v })} />
          </div>
          <Button size="sm" variant="ghost" className="text-red-500 hover:text-red-700" onClick={onDelete}>
            <Trash2 className="h-4 w-4 mr-1" /> Löschen
          </Button>
        </div>

        <div className="grid gap-3">
          <div>
            <Label className="text-xs">Name (intern)</Label>
            <Input value={promo.name} onChange={e => onUpdate({ name: e.target.value })} />
          </div>
          <div>
            <Label className="text-xs">Headline</Label>
            <Input value={promo.headline} onChange={e => onUpdate({ headline: e.target.value })} />
          </div>
          <div>
            <Label className="text-xs">Copytext (HTML erlaubt: &lt;b&gt; &lt;i&gt; &lt;a&gt;)</Label>
            <Textarea
              value={promo.body}
              onChange={e => onUpdate({ body: e.target.value })}
              rows={5}
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label className="text-xs">URL (optional)</Label>
              <Input
                value={promo.link_url}
                onChange={e => onUpdate({ link_url: e.target.value })}
                placeholder="https://…"
              />
            </div>
            <div>
              <Label className="text-xs">Linktext (optional)</Label>
              <Input
                value={promo.cta_label}
                onChange={e => onUpdate({ cta_label: e.target.value })}
                placeholder="z.B. Mehr erfahren"
                disabled={!promo.link_url}
              />
            </div>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <Label className="text-xs">Gradient Start</Label>
            <div className="flex gap-2 items-center">
              <input type="color" value={promo.gradient_from} onChange={e => onUpdate({ gradient_from: e.target.value })} className="h-9 w-12 rounded cursor-pointer" />
              <Input value={promo.gradient_from} onChange={e => onUpdate({ gradient_from: e.target.value })} className="text-xs font-mono" />
            </div>
          </div>
          <div>
            <Label className="text-xs">Gradient Ende</Label>
            <div className="flex gap-2 items-center">
              <input type="color" value={promo.gradient_to} onChange={e => onUpdate({ gradient_to: e.target.value })} className="h-9 w-12 rounded cursor-pointer" />
              <Input value={promo.gradient_to} onChange={e => onUpdate({ gradient_to: e.target.value })} className="text-xs font-mono" />
            </div>
          </div>
          <div>
            <Label className="text-xs">Richtung</Label>
            <select
              value={promo.gradient_direction}
              onChange={e => onUpdate({ gradient_direction: e.target.value })}
              className="w-full rounded border px-2 py-2 text-sm bg-background"
            >
              <option value="to bottom">nach unten</option>
              <option value="to top">nach oben</option>
              <option value="to right">nach rechts</option>
              <option value="to left">nach links</option>
              <option value="135deg">diagonal ↘</option>
              <option value="45deg">diagonal ↗</option>
            </select>
          </div>
          <div>
            <Label className="text-xs">Textfarbe</Label>
            <div className="flex gap-2 items-center">
              <input type="color" value={promo.text_color} onChange={e => onUpdate({ text_color: e.target.value })} className="h-9 w-12 rounded cursor-pointer" />
              <Input value={promo.text_color} onChange={e => onUpdate({ text_color: e.target.value })} className="text-xs font-mono" />
            </div>
          </div>
        </div>
      </div>

      {/* Live Preview */}
      <div className="sticky top-4 self-start">
        <Label className="text-xs uppercase tracking-wider text-muted-foreground">Vorschau</Label>
        <div className="mt-2 rounded-lg border border-border bg-card p-4">
          <TipPromoBox promo={promo} />
        </div>
        <p className="mt-2 text-[10px] text-muted-foreground">
          So erscheint die Box im Artikel (vor dem Synthszr Take).
        </p>
      </div>
    </div>
  )
}

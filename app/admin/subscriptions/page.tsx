'use client'

import { useEffect, useState } from 'react'
import { Wallet, Loader2, RefreshCw, EyeOff, Ban, ExternalLink } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Badge } from '@/components/ui/badge'
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { createClient } from '@/lib/supabase/client'

interface Subscription {
  id: string
  provider_name: string
  amount: number | null
  currency: string | null
  interval: string
  amount_monthly: number | null
  last_payment_at: string | null
  evidence_message_ids: { id: string; subject: string; date: string; gmailLink: string }[]
  unsubscribe_type: string
  unsubscribe_target: string | null
  is_content_source: boolean
  status: string
}

export default function SubscriptionsPage() {
  const [subs, setSubs] = useState<Subscription[]>([])
  const [loading, setLoading] = useState(true)
  const [scanning, setScanning] = useState(false)
  const [scanMsg, setScanMsg] = useState<string | null>(null)
  const supabase = createClient()

  useEffect(() => { fetchSubs() }, [])

  async function fetchSubs() {
    setLoading(true)
    const { data, error } = await supabase
      .from('paid_subscriptions')
      .select('*')
      .neq('status', 'ignored')
      .order('amount_monthly', { ascending: false })
    if (error) console.error('Error fetching subscriptions:', error)
    else setSubs(data || [])
    setLoading(false)
  }

  async function rescan() {
    setScanning(true)
    setScanMsg(null)
    try {
      const res = await fetch('/api/admin/scan-subscriptions', { method: 'POST' })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Scan fehlgeschlagen')
      setScanMsg(`${data.scanned} gefunden, ${data.upserted} aktualisiert`)
      await fetchSubs()
    } catch (e) {
      setScanMsg(e instanceof Error ? e.message : 'Fehler beim Scannen')
    } finally {
      setScanning(false)
    }
  }

  async function setStatus(id: string, status: string) {
    const { error } = await supabase
      .from('paid_subscriptions')
      .update({ status, updated_at: new Date().toISOString() })
      .eq('id', id)
    if (error) alert('Fehler: ' + error.message)
    else fetchSubs()
  }

  const [cancelTarget, setCancelTarget] = useState<Subscription | null>(null)
  const [cancelling, setCancelling] = useState(false)

  const isAutoCancellable = (s: Subscription) => s.unsubscribe_type === 'oneclick' || s.unsubscribe_type === 'http'

  async function confirmCancel() {
    if (!cancelTarget) return
    setCancelling(true)
    try {
      if (isAutoCancellable(cancelTarget)) {
        const res = await fetch('/api/admin/subscriptions/cancel', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ id: cancelTarget.id }),
        })
        const data = await res.json()
        if (!res.ok || !data.ok) {
          const url = cancelTarget.unsubscribe_target
            || `https://www.google.com/search?q=${encodeURIComponent(cancelTarget.provider_name + ' Abo kündigen')}`
          window.open(url, '_blank', 'noopener,noreferrer')
          alert('Automatische Kündigung fehlgeschlagen (' + (data.detail || data.error || 'unbekannt') + ') — die Seite wurde geöffnet, bitte manuell abschließen.')
        }
      } else {
        // Fall B: Ziel im Browser des Nutzers öffnen (mailto/login_portal/unknown)
        const url = cancelTarget.unsubscribe_target
          || `https://www.google.com/search?q=${encodeURIComponent(cancelTarget.provider_name + ' Abo kündigen')}`
        window.open(url, '_blank', 'noopener,noreferrer')
      }
      await fetchSubs()
    } finally {
      setCancelling(false)
      setCancelTarget(null)
    }
  }

  const totalMonthly = subs
    .filter((s) => s.status !== 'cancelled')
    .reduce((sum, s) => sum + (s.amount_monthly || 0), 0)

  const [addOpen, setAddOpen] = useState(false)
  const [addName, setAddName] = useState('')
  const [addAmount, setAddAmount] = useState('')
  const [addInterval, setAddInterval] = useState('monthly')
  const [addSaving, setAddSaving] = useState(false)

  async function addManual() {
    if (!addName.trim()) return
    setAddSaving(true)
    const amount = addAmount ? parseFloat(addAmount.replace(',', '.')) : null
    const factor: Record<string, number> = { monthly: 1, yearly: 1 / 12, quarterly: 1 / 3, weekly: 52 / 12, one_time: 0, unknown: 0 }
    const amountMonthly = amount != null ? Math.round(amount * (factor[addInterval] ?? 0) * 100) / 100 : null
    const { error } = await supabase.from('paid_subscriptions').insert({
      provider_name: addName.trim(),
      provider_key: addName.trim().toLowerCase(),
      amount, currency: '€', interval: addInterval, amount_monthly: amountMonthly,
      status: 'active', manually_added: true, unsubscribe_type: 'unknown',
    })
    if (error) alert('Fehler: ' + error.message)
    else { setAddName(''); setAddAmount(''); setAddInterval('monthly'); setAddOpen(false); fetchSubs() }
    setAddSaving(false)
  }

  return (
    <div className="p-8">
      <div className="mb-8 flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tighter">Abo-Kosten</h1>
          <p className="mt-1 text-muted-foreground">
            Monatlich gesamt: <span className="font-semibold text-foreground">{totalMonthly.toFixed(2)} €</span>
            {scanMsg && <span className="ml-3 text-xs">· {scanMsg}</span>}
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" className="gap-2" onClick={rescan} disabled={scanning}>
            {scanning ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
            Neu scannen
          </Button>
          <Button variant="outline" onClick={() => setAddOpen(true)}>Manuell hinzufügen</Button>
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2"><Wallet className="h-5 w-5" /> Kostenpflichtige Abos</CardTitle>
          <CardDescription>Aus der Gmail-Inbox erkannt. „Neu scannen" aktualisiert die Liste.</CardDescription>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="flex items-center justify-center py-8"><Loader2 className="h-8 w-8 animate-spin text-muted-foreground" /></div>
          ) : subs.length === 0 ? (
            <div className="py-8 text-center">
              <Wallet className="mx-auto h-12 w-12 text-muted-foreground/50" />
              <p className="mt-4 text-sm text-muted-foreground">Noch keine Abos erkannt. Klicke „Neu scannen".</p>
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Anbieter</TableHead>
                  <TableHead>Monatlich</TableHead>
                  <TableHead>Intervall</TableHead>
                  <TableHead>Letzte Zahlung</TableHead>
                  <TableHead>Belege</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Aktionen</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {subs.map((s) => (
                  <TableRow key={s.id}>
                    <TableCell className="font-medium">
                      {s.provider_name}
                      {s.is_content_source && <Badge variant="secondary" className="ml-2 text-xs">Content-Quelle</Badge>}
                    </TableCell>
                    <TableCell>
                      {s.amount_monthly != null ? `${s.amount_monthly.toFixed(2)} ${s.currency || '€'}` : '—'}
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">{s.interval}</TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {s.last_payment_at ? new Date(s.last_payment_at).toLocaleDateString('de-DE') : '—'}
                    </TableCell>
                    <TableCell>
                      {s.evidence_message_ids?.[0] ? (
                        <a href={s.evidence_message_ids[0].gmailLink} target="_blank" rel="noopener noreferrer"
                           className="inline-flex items-center gap-1 text-xs text-primary hover:underline">
                          {s.evidence_message_ids.length}× <ExternalLink className="h-3 w-3" />
                        </a>
                      ) : '—'}
                    </TableCell>
                    <TableCell>
                      <Badge variant={s.status === 'cancelled' ? 'secondary' : 'default'}>{s.status}</Badge>
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex justify-end gap-1">
                        <Button variant="ghost" size="icon" title="Kündigen"
                          onClick={() => setCancelTarget(s)}>
                          <Ban className="h-4 w-4 text-red-600" />
                        </Button>
                        {s.status === 'active' && (
                          <Button variant="ghost" size="sm" title="Als gekündigt markieren"
                            onClick={async () => {
                              const res = await fetch('/api/admin/subscriptions/cancel', {
                                method: 'POST', headers: { 'Content-Type': 'application/json' },
                                body: JSON.stringify({ id: s.id, manual: true }),
                              })
                              if (!res.ok) alert('Fehler beim Markieren als gekündigt')
                              await fetchSubs()
                            }}>
                            ✓ erledigt
                          </Button>
                        )}
                        <Button variant="ghost" size="icon" title="Ausblenden / Kein Abo"
                          onClick={() => setStatus(s.id, 'ignored')}>
                          <EyeOff className="h-4 w-4 text-muted-foreground" />
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

      <Dialog open={!!cancelTarget} onOpenChange={(o) => !o && setCancelTarget(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{cancelTarget?.provider_name} kündigen?</DialogTitle>
            <DialogDescription>
              {cancelTarget && isAutoCancellable(cancelTarget)
                ? `Führt einen Unsubscribe-Request an ${cancelTarget.provider_name} aus.`
                : 'Erfordert Login/Bestätigung — die Seite wird in einem neuen Tab geöffnet, du schließt die Kündigung manuell ab.'}
              {cancelTarget?.is_content_source && ' Achtung: Damit fällt auch eine redaktionelle Content-Quelle weg.'}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCancelTarget(null)}>Abbrechen</Button>
            <Button onClick={confirmCancel} disabled={cancelling}>
              {cancelling ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
              {cancelTarget && isAutoCancellable(cancelTarget) ? 'Jetzt kündigen' : 'Seite öffnen'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={addOpen} onOpenChange={setAddOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Abo manuell hinzufügen</DialogTitle>
            <DialogDescription>Für Abos, die der Scan nicht erkannt hat.</DialogDescription>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <Input placeholder="Anbieter (z. B. Stratechery)" value={addName} onChange={(e) => setAddName(e.target.value)} />
            <Input placeholder="Betrag (z. B. 12.00)" value={addAmount} onChange={(e) => setAddAmount(e.target.value)} />
            <select className="w-full rounded-md border bg-background px-3 py-2 text-sm"
              value={addInterval} onChange={(e) => setAddInterval(e.target.value)}>
              <option value="monthly">monatlich</option>
              <option value="yearly">jährlich</option>
              <option value="quarterly">quartalsweise</option>
              <option value="weekly">wöchentlich</option>
            </select>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setAddOpen(false)}>Abbrechen</Button>
            <Button onClick={addManual} disabled={addSaving || !addName.trim()}>
              {addSaving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}Hinzufügen
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

'use client'

import { useEffect, useState } from 'react'
import { Wallet, Loader2, RefreshCw, EyeOff, Ban, ExternalLink } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Badge } from '@/components/ui/badge'
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

  const totalMonthly = subs
    .filter((s) => s.status !== 'cancelled')
    .reduce((sum, s) => sum + (s.amount_monthly || 0), 0)

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
        <Button variant="outline" className="gap-2" onClick={rescan} disabled={scanning}>
          {scanning ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
          Neu scannen
        </Button>
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
                          onClick={() => alert('Kündigung folgt in Task 10')}>
                          <Ban className="h-4 w-4 text-red-600" />
                        </Button>
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
    </div>
  )
}

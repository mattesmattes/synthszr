import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { getSession } from '@/lib/auth/session'
import { executeAutoUnsubscribe } from '@/lib/subscriptions/cancel'

export async function POST(request: Request) {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'Nicht autorisiert' }, { status: 401 })

  const { id, manual } = await request.json()
  if (!id) return NextResponse.json({ error: 'id fehlt' }, { status: 400 })

  const supabase = await createClient()
  const { data: sub } = await supabase
    .from('paid_subscriptions')
    .select('id, unsubscribe_type, unsubscribe_target, cancel_log')
    .eq('id', id)
    .single()
  if (!sub) return NextResponse.json({ error: 'Abo nicht gefunden' }, { status: 404 })

  if (manual === true) {
    const logEntry = { ts: new Date().toISOString(), type: sub.unsubscribe_type, result: 'manual', detail: 'manuell als gekündigt markiert' }
    const newLog = Array.isArray(sub.cancel_log) ? [...sub.cancel_log, logEntry] : [logEntry]
    await supabase.from('paid_subscriptions')
      .update({ status: 'cancelled', cancel_log: newLog, updated_at: new Date().toISOString() })
      .eq('id', id)
    return NextResponse.json({ ok: true, status: 'cancelled' })
  }

  const type = sub.unsubscribe_type as 'oneclick' | 'http' | 'mailto' | 'login_portal' | 'unknown'
  if (type !== 'oneclick' && type !== 'http') {
    return NextResponse.json({ error: 'Nur im Browser kündbar (Fall B)', ok: false }, { status: 400 })
  }
  if (!sub.unsubscribe_target) {
    return NextResponse.json({ error: 'Kein Unsubscribe-Ziel', ok: false }, { status: 400 })
  }

  await supabase.from('paid_subscriptions').update({ status: 'cancelling' }).eq('id', id)
  const result = await executeAutoUnsubscribe(type, sub.unsubscribe_target)

  const logEntry = { ts: new Date().toISOString(), type, result: result.ok ? 'success' : 'error', detail: result.detail }
  const newLog = Array.isArray(sub.cancel_log) ? [...sub.cancel_log, logEntry] : [logEntry]
  const newStatus = result.ok ? 'cancelled' : 'active'
  await supabase.from('paid_subscriptions')
    .update({ status: newStatus, cancel_log: newLog, updated_at: new Date().toISOString() })
    .eq('id', id)

  return NextResponse.json({ ok: result.ok, status: newStatus, detail: result.detail })
}

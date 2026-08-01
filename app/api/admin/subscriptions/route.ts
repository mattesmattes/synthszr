import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { getSession } from '@/lib/auth/session'
import { deriveProviderKey, normalizeMonthly } from '@/lib/subscriptions/detector'
import type { Interval } from '@/lib/subscriptions/types'

// Serverseitige, authentifizierte CRUD für paid_subscriptions — ersetzt den
// direkten Browser-anon-Zugriff (Security-Stufe 2: Tabelle ist RLS-gesperrt).

export async function GET() {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'Nicht autorisiert' }, { status: 401 })
  const supabase = createAdminClient()
  const { data, error } = await supabase
    .from('paid_subscriptions')
    .select('*')
    .neq('status', 'ignored')
    .order('amount_monthly', { ascending: false })
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ subscriptions: data ?? [] })
}

export async function PATCH(request: Request) {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'Nicht autorisiert' }, { status: 401 })
  const { id, status } = await request.json()
  if (!id || !status) return NextResponse.json({ error: 'id und status erforderlich' }, { status: 400 })
  const supabase = createAdminClient()
  const { error } = await supabase
    .from('paid_subscriptions')
    .update({ status, updated_at: new Date().toISOString() })
    .eq('id', id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}

export async function POST(request: Request) {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'Nicht autorisiert' }, { status: 401 })
  const { providerName, amount, interval } = await request.json()
  if (!providerName?.trim()) return NextResponse.json({ error: 'providerName erforderlich' }, { status: 400 })
  const iv = (interval || 'monthly') as Interval
  const amt = typeof amount === 'number' ? amount : null
  const amountMonthly = amt != null ? Math.round(normalizeMonthly(amt, iv) * 100) / 100 : null
  const supabase = createAdminClient()
  const { error } = await supabase.from('paid_subscriptions').insert({
    provider_name: providerName.trim(),
    provider_key: deriveProviderKey(providerName),
    amount: amt, currency: '€', interval: iv, amount_monthly: amountMonthly,
    status: 'active', manually_added: true, unsubscribe_type: 'unknown',
  })
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}

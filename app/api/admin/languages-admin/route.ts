/**
 * Languages Admin API — Security-Stufe 2 (Welle 1d)
 *
 * GET: Liefert aktive, nicht-Standard-Sprachen (code, name). Ersetzt den
 * direkten Browser-anon-Zugriff aus app/admin/newsletter-send/page.tsx
 * (checkTranslationStatus). Nicht zu verwechseln mit der öffentlichen
 * app/api/languages-Route oder app/api/admin/languages (voller Datensatz
 * für die Sprachverwaltung).
 */

import { NextResponse } from 'next/server'
import { getSession } from '@/lib/auth/session'
import { createAdminClient } from '@/lib/supabase/admin'

export async function GET() {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'Nicht autorisiert' }, { status: 401 })

  const supabase = createAdminClient()
  const { data, error } = await supabase
    .from('languages')
    .select('code, name')
    .eq('is_active', true)
    .eq('is_default', false)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ languages: data ?? [] })
}

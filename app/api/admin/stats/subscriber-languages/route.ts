import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { getSession } from '@/lib/auth/session'

export const runtime = 'nodejs'

interface LanguageStat {
  code: string
  name: string
  native_name: string | null
  count: number
}

/**
 * Returns active subscriber counts grouped by their preferred language.
 * Subscribers without a language preference are grouped under the default language.
 */
export async function GET() {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'Nicht autorisiert' }, { status: 401 })

  const supabase = createAdminClient()

  const [{ data: languages }, { data: subscribers }] = await Promise.all([
    supabase.from('languages').select('code, name, native_name, is_default').eq('is_active', true),
    supabase
      .from('subscribers')
      .select('preferences')
      .eq('status', 'active'),
  ])

  if (!languages || !subscribers) {
    return NextResponse.json({ languages: [], total: 0 })
  }

  const defaultLang = languages.find(l => l.is_default)?.code ?? 'de'
  const counts = new Map<string, number>()

  for (const sub of subscribers) {
    const prefs = sub.preferences as { language?: string } | null
    const lang = prefs?.language || defaultLang
    counts.set(lang, (counts.get(lang) ?? 0) + 1)
  }

  const result: LanguageStat[] = languages
    .map(l => ({
      code: l.code,
      name: l.name,
      native_name: l.native_name,
      count: counts.get(l.code) ?? 0,
    }))
    .sort((a, b) => b.count - a.count)

  return NextResponse.json({
    languages: result,
    total: subscribers.length,
  })
}

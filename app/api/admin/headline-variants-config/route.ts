import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { getSession } from '@/lib/auth/session'

const KEY = 'headline_variants_config'

/**
 * Liest und setzt den Ersetzungs-Schalter der Überschriften-Varianten.
 *
 * Der Schalter steuert NUR, ob Variante 1 die vom Ghostwriter geschriebene
 * Überschrift ersetzt. Erzeugt und mitgeführt werden die Vorschläge in jedem
 * Fall — sonst fehlten die Auswertungsdaten genau in der Anlaufzeit.
 *
 * Liegt in `settings` (Key-Value), damit das Umlegen keine Auslieferung
 * braucht. Fehlt der Eintrag, gilt AUS.
 */
export async function GET() {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'Nicht autorisiert' }, { status: 401 })

  try {
    const { data } = await createAdminClient()
      .from('settings').select('value').eq('key', KEY).maybeSingle()
    const replaceHeading = (data?.value as { replaceHeading?: unknown } | null)?.replaceHeading === true
    return NextResponse.json({ replaceHeading })
  } catch {
    // Der Editor soll bei einem Lesefehler nicht scheitern — er zeigt dann den
    // sicheren Zustand (aus).
    return NextResponse.json({ replaceHeading: false })
  }
}

export async function POST(request: NextRequest) {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'Nicht autorisiert' }, { status: 401 })

  try {
    const { replaceHeading } = await request.json()
    if (typeof replaceHeading !== 'boolean') {
      return NextResponse.json({ error: 'replaceHeading muss true oder false sein' }, { status: 400 })
    }

    const { error } = await createAdminClient()
      .from('settings')
      .upsert({ key: KEY, value: { replaceHeading } }, { onConflict: 'key' })

    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json({ ok: true, replaceHeading })
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Unbekannter Fehler' },
      { status: 500 },
    )
  }
}

/**
 * Erzeugt vorgemerkte Lexikonbegriffe eines Artikels — EINZELN, in Runden vom
 * Browser getrieben.
 *
 * WARUM EIGENER ENDPUNKT und nicht der Speicherpfad: das Speichern eines
 * Artikels darf nicht Minuten dauern. Deshalb erzeugt es höchstens
 * MAX_GENERATE_PER_SAVE (3) Begriffe und merkt den Rest vor. Bei zwölf
 * bestätigten Kandidaten wären das aber vier Speichervorgänge — und mit allen
 * vorausgewählt (2026-08-05) noch mehr. Hier läuft dieselbe Erzeugung mit
 * limit=1 je Aufruf, 45-90s, weit unter maxDuration; der Browser wiederholt, bis
 * nichts mehr offen ist, und zeigt nach jedem Begriff, dass es weitergeht.
 *
 * WAS DIESER ENDPUNKT NICHT TUT: er rührt `content` nicht an. Die Mark-Injektion
 * in den Artikeltext (applyGlossaryConfirmation) bleibt dem Speichern
 * überlassen — der Editor hält währenddessen seinen eigenen Stand im Browser,
 * und ein Schreiben von hier würde ihn beim nächsten Speichern überschreiben
 * oder überschrieben werden. Die Begriffe entstehen also und werden
 * veröffentlicht; verlinkt werden sie beim nächsten regulären Speichern.
 */
import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { getSession } from '@/lib/auth/session'
import { ensureConfirmedTermsExist } from '@/lib/glossary/ensure-terms'
import type { GlossaryCandidate } from '@/lib/glossary/types'

export const maxDuration = 300

export async function POST(request: NextRequest) {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'Nicht autorisiert' }, { status: 401 })

  const body = await request.json().catch(() => null) as
    { postId?: string; confirmedSlugs?: string[]; limit?: number } | null
  if (!body?.postId) return NextResponse.json({ error: 'postId fehlt' }, { status: 400 })
  if (!Array.isArray(body.confirmedSlugs) || body.confirmedSlugs.length === 0) {
    return NextResponse.json({ error: 'confirmedSlugs fehlt' }, { status: 400 })
  }

  const supabase = createAdminClient()
  // Deckel auf 3, damit der Parameter das Zeitlimit nicht umgehen kann — derselbe
  // Grund wie beim limit des Artikel-Crawls.
  const limit = Math.min(Math.max(1, Number(body.limit) || 1), 3)

  try {
    const ensured = await ensureConfirmedTermsExist(supabase, body.postId, body.confirmedSlugs, limit)

    // Vormerkliste fortschreiben. `pendingRemainder === null` heisst "nichts mehr
    // offen"; die Liste wird dann NICHT geleert, sondern nur der Rest gemeldet —
    // das Leeren gehoert zum Speicherpfad, der auch veroeffentlicht und verlinkt.
    if (ensured.pendingRemainder !== null) {
      const { error } = await supabase
        .from('generated_posts')
        .update({ pending_glossary_terms: ensured.pendingRemainder })
        .eq('id', body.postId)
      if (error) throw new Error(`Vormerkliste nicht speicherbar: ${error.message}`)
    }

    // Wie viele bestaetigte Kandidaten sind noch zu erzeugen? Nur diese zaehlen
    // fuer die Abbruchbedingung der Browser-Schleife; nicht bestaetigte bleiben
    // in der Liste, sind aber keine offene Arbeit.
    const confirmed = new Set(body.confirmedSlugs)
    const remainder: GlossaryCandidate[] = ensured.pendingRemainder ?? []
    const remaining = remainder.filter((c) => confirmed.has(c.slug) && c.needsGeneration).length

    return NextResponse.json({
      generated: ensured.generatedSlugs,
      remaining,
      // Namen fuer das Protokoll: der Slug allein ist im UI schwer lesbar.
      names: remainder
        .filter((c) => confirmed.has(c.slug) && c.needsGeneration)
        .map((c) => c.name)
        .slice(0, 5),
    })
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : 'Begriffs-Erzeugung fehlgeschlagen' },
      { status: 500 },
    )
  }
}

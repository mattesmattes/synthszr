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
 * VERLINKUNG AM ENDE: ist kein Begriff mehr offen, laeuft applyGlossaryConfirmation
 * auf dem Stand AUS DER DATENBANK und schreibt die Marks zurueck. Das ist sicher,
 * weil der Lauf direkt nach dem Speichern startet — da sind Editor und Datenbank
 * identisch. Arbeitet der Operator danach weiter und speichert erneut, ueberschreibt
 * er die Marks kurz, aber der Speicherpfad injiziert sie selbst wieder: die
 * Verlinkung ist idempotent und heilt sich damit von allein.
 */
import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { getSession } from '@/lib/auth/session'
import { ensureConfirmedTermsExist } from '@/lib/glossary/ensure-terms'
import { applyGlossaryConfirmation } from '@/lib/glossary/confirm'
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

    // Nichts mehr offen → jetzt verlinken und veroeffentlichen. Erst hier, nicht
    // nach jedem Begriff: die Injektion laeuft ueber den ganzen Artikeltext und
    // waere pro Begriff dieselbe Arbeit N-mal.
    let linked = 0
    if (remaining === 0) {
      // Content AUS DER DATENBANK laden und uebergeben: ohne ihn veroeffentlicht
      // applyGlossaryConfirmation nur die Begriffe und injiziert keine Marks —
      // die Verlinkung waere dann still ausgeblieben.
      const { data: postRow } = await supabase
        .from('generated_posts').select('content').eq('id', body.postId).maybeSingle()
      const currentContent = (postRow as { content?: unknown } | null)?.content
      const result = await applyGlossaryConfirmation(
        supabase,
        body.postId,
        body.confirmedSlugs,
        typeof currentContent === 'string' ? currentContent : JSON.stringify(currentContent ?? null),
      )
      linked = result.publishedSlugs.length
      if (result.content !== undefined) {
        const { error } = await supabase
          .from('generated_posts')
          .update({ content: result.content })
          .eq('id', body.postId)
        if (error) throw new Error(`Artikeltext nicht speicherbar: ${error.message}`)
      }
      // Vormerkliste leeren, wie im Speicherpfad — aber nur bei Erfolg, sonst
      // muesste der Operator die Kandidaten neu identifizieren lassen.
      if (linked > 0) {
        await supabase.from('generated_posts')
          .update({ pending_glossary_terms: null }).eq('id', body.postId)
      }
    }

    return NextResponse.json({
      generated: ensured.generatedSlugs,
      remaining,
      linked,
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

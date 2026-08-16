import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { getSession } from '@/lib/auth/session'

/**
 * POST /api/admin/headline-choice
 *
 * Hält fest, welche der vorgeschlagenen Überschriften gewählt wurde.
 *
 * WOZU: Die Wahl beantwortet die Frage, an der sich der ÜBERSCHRIFT-Block im
 * Prompt zweimal verhoben hat — wie pointiert dürfen Überschriften sein
 * (Kalibrierungen bb8bfea → b9f07d0 → 2e4878b). Sie ist ein saubereres Signal
 * als eine Textänderung: drei bekannte Möglichkeiten, eine geklickt, nichts zu
 * interpretieren.
 *
 * Body:
 *  postId       Artikel (Pflicht)
 *  queueItemId  Abschnitt; null bei Bündeln, die mehrere Items zusammenfassen
 *  variants     alle Vorschläge in Angebotsreihenfolge
 *  chosenIndex  Index des Gewählten in `variants`
 */
export async function POST(request: NextRequest) {
  const session = await getSession()
  if (!session) {
    return NextResponse.json({ error: 'Nicht autorisiert' }, { status: 401 })
  }

  try {
    const { postId, queueItemId, variants, chosenIndex } = await request.json()

    if (!postId || !Array.isArray(variants) || variants.length < 2) {
      return NextResponse.json({ error: 'postId und variants sind erforderlich' }, { status: 400 })
    }
    if (typeof chosenIndex !== 'number' || chosenIndex < 0 || chosenIndex >= variants.length) {
      return NextResponse.json({ error: 'chosenIndex liegt ausserhalb von variants' }, { status: 400 })
    }
    if (!variants.every((v: unknown) => typeof v === 'string')) {
      return NextResponse.json({ error: 'variants muss Zeichenketten enthalten' }, { status: 400 })
    }

    const supabase = createAdminClient()

    // Stand des Ersetzungs-Schalters mitschreiben. Ohne ihn wäre später nicht
    // mehr zu unterscheiden, ob Index 0 die frisch erzeugte journalistische
    // Variante war oder die alte Überschrift aus writeSection.
    const { data: cfg } = await supabase
      .from('settings').select('value').eq('key', 'headline_variants_config').maybeSingle()
    const replacementActive = (cfg?.value as { replaceHeading?: unknown } | null)?.replaceHeading === true

    const zeile = {
      post_id: postId,
      queue_item_id: queueItemId ?? null,
      variants,
      chosen_index: chosenIndex,
      chosen_text: variants[chosenIndex],
      replacement_active: replacementActive,
    }

    // Eine Wahl je Abschnitt — ein zweiter Klick korrigiert den ersten. Der
    // Konflikt greift nur bei gesetzter queue_item_id (so ist der Teilindex
    // definiert); Bündel ohne Kennung werden deshalb einfach eingefügt.
    const { error } = queueItemId
      ? await supabase.from('headline_choices').upsert(zeile, { onConflict: 'post_id,queue_item_id' })
      : await supabase.from('headline_choices').insert(zeile)

    if (error) {
      // Nicht fatal: Die Überschrift ist im Editor bereits getauscht. Ein
      // fehlgeschlagenes Protokoll darf die Arbeit nicht blockieren — es fehlt
      // dann eine Zeile in der Auswertung, mehr nicht.
      console.error('[HeadlineChoice] Konnte Wahl nicht speichern:', error.message)
      return NextResponse.json({ ok: false, error: error.message }, { status: 200 })
    }

    return NextResponse.json({ ok: true })
  } catch (err) {
    console.error('[HeadlineChoice] Fehler:', err)
    return NextResponse.json({ ok: false }, { status: 200 })
  }
}

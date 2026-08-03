/**
 * Aktualitätsprüfung fürs Fachbegriff-Lexikon (Task 17, Design-Spec §I): prüft
 * pro Lauf einen Batch der am längsten nicht geprüften veröffentlichten
 * Begriffe per LLM-Call gegen ihre aktuellen News (glossary_term_news, Task 14)
 * und markiert das Ergebnis:
 *
 * - unverändert → review_state='ok', last_reviewed_at=now()
 * - veraltet    → neuer Text nach pending_body, review_state='revision_pending'
 *
 * Der Live-Text (`body`) bleibt in BEIDEN Fällen unverändert — eine Revision
 * braucht immer die redaktionelle Freigabe im Admin (app/admin/glossary), damit
 * automatische Regenerierung keine manuellen Korrekturen überschreibt.
 *
 * Begriffe mit review_state='revision_pending' werden von der Auswahl
 * ausgeschlossen: sie warten bereits auf eine Admin-Entscheidung, ein erneuter
 * Lauf darf den offenen Vorschlag nicht klammheimlich durch einen zweiten
 * ersetzen, bevor der erste gesehen wurde.
 *
 * Struktur folgt lib/glossary/news.ts: Supabase-Client als Parameter (Tests
 * bauen einen Fake-Client, kein createAdminClient()-Mock nötig), Fehler in
 * einem Begriff werden geloggt und übersprungen statt die Schleife
 * abzubrechen (Per-Item-Isolation, Review-Fix aus Task 14).
 *
 * Review-Fund (Fix-Runde 1): zwei Fehlerarten brauchen ENTGEGENGESETZTE
 * Behandlung, sonst tauscht man einen Defekt gegen einen anderen.
 * - Transiente Infrastrukturfehler (News-Query scheitert, DB-Write scheitert,
 *   Netzwerk/Timeout im LLM-Call) sind dem Begriff nicht zuzurechnen: Begriff
 *   überspringen, OHNE review_state/last_reviewed_at zu ändern — er soll beim
 *   nächsten Lauf unverändert wieder ganz vorn stehen.
 * - Deterministische, begriffsspezifische Defekte (kaputter/leerer body,
 *   unparsbare Modellantwort, leere Revision) würden bei jedem Lauf identisch
 *   wiederkehren: `review_state='flagged'` + `last_reviewed_at=now()`
 *   schreiben. Das rotiert den Begriff aus dem Warteschlangenkopf heraus und
 *   macht ihn im Admin sichtbar (Badge existiert bereits in
 *   app/admin/glossary/page.tsx), statt den Cron dauerhaft zu blockieren.
 *
 * ZUSATZ (Controller, aus der Task-15-Vorabprüfung): pro erfolgreich
 * geprüftem Begriff wird zusätzlich assignProducts (Task 15) aufgerufen —
 * Begriffe, die vor Task 15 entstanden sind, bekämen sonst nie Produkte, und
 * die Chart-Liste wächst laufend. Eigener try/catch: ein Fehler dort darf den
 * Review-Lauf nicht abbrechen.
 */
import { createAdminClient } from '@/lib/supabase/admin'
import { buildTipTapBody, extractPlainText, isValidTipTapDoc } from '@/lib/glossary/generate'
import { assignProducts } from '@/lib/glossary/products'
import { z } from 'zod'

type SupabaseAdminClient = ReturnType<typeof createAdminClient>

/** Design-Spec §I: 10 Begriffe pro Tag, damit jeder Begriff etwa monatlich
 *  dran ist, ohne dass ein Lauf das ganze Lexikon abarbeiten muss. */
const BATCH_LIMIT = 10

interface GlossaryReviewTermRow {
  id: string
  slug: string
  canonical_name: string
  summary: string
  body: unknown
}

interface GlossaryReviewNewsRow {
  title: string
  context_sentence: string | null
  published_at: string | null
}

export interface GlossaryReviewResult {
  /** Wie viele Begriffe in diesem Lauf geladen wurden (Batch-Größe). */
  termsChecked: number
  /** Wie viele davon erfolgreich geprüft UND geschrieben wurden — inklusive
   *  Begriffen, die wegen eines deterministischen Defekts als 'flagged'
   *  markiert wurden (auch das ist ein geschriebenes Ergebnis, kein Fehler,
   *  der übersprungen wurde). */
  termsReviewed: number
  /** Teilmenge von termsReviewed, die als veraltet markiert wurde. */
  revisionsProposed: number
}

const ReviewSchema = z.object({
  outdated: z.boolean(),
  blocks: z.array(z.object({ type: z.enum(['paragraph', 'heading']), text: z.string() })).optional(),
  reasoning: z.string().optional(),
})

const REVIEW_TOOL = {
  name: 'review_glossary_term',
  description: 'Prüfen, ob ein Lexikon-Erklärungstext angesichts aktueller News noch sachlich aktuell ist, und bei Veralterung einen überarbeiteten Text liefern',
  input_schema: {
    type: 'object' as const,
    properties: {
      outdated: {
        type: 'boolean',
        description: 'true, wenn der bestehende Text durch die aktuellen News sachlich überholt oder irreführend geworden ist',
      },
      blocks: {
        type: 'array',
        description: 'NUR befüllen, wenn outdated=true: der komplette überarbeitete Erklärungstext (Absätze/Überschriften in Lesereihenfolge, gleiche Struktur wie der bestehende Text)',
        items: {
          type: 'object',
          properties: {
            type: { type: 'string', enum: ['paragraph', 'heading'] },
            text: { type: 'string' },
          },
          required: ['type', 'text'],
        },
      },
      reasoning: { type: 'string', description: 'Kurze Begründung der Einschätzung' },
    },
    required: ['outdated'],
  },
}

function buildReviewPrompt(
  canonicalName: string,
  summary: string,
  bodyText: string,
  news: GlossaryReviewNewsRow[],
): string {
  const newsBlock = news.length > 0
    ? news.map((n) => `- ${n.title}${n.context_sentence ? ` — ${n.context_sentence}` : ''}`).join('\n')
    : '(keine aktuellen News zu diesem Begriff)'
  return `Begriff: „${canonicalName}"
Kurzbeschreibung: ${summary}

BESTEHENDER ERKLÄRUNGSTEXT:
${bodyText}

AKTUELLE NEWS ZU DIESEM BEGRIFF:
${newsBlock}

Ist der bestehende Erklärungstext angesichts dieser News noch sachlich korrekt und aktuell? Ein Text gilt NUR dann als veraltet, wenn er inhaltlich falsch, überholt oder durch neue Entwicklungen unvollständig irreführend geworden ist — nicht bei bloßem Stilwunsch. Antworte via Tool mit outdated. Falls outdated=true, liefere in blocks den KOMPLETTEN überarbeiteten Text in derselben Struktur (Einleitungsabsatz ohne Überschrift, danach Überschriften mit Absätzen).`
}

/** Aktuelle News für den Aktualitäts-Kontext (Design-Spec §I) — liest nur die
 *  bereits vom wöchentlichen Cron (Task 14) befüllte Cache-Tabelle, kein
 *  eigener Vektor-Zugriff im Review-Pfad.
 *
 *  Rückgabe `null` bei einem Query-Fehler — UNTERSCHIEDEN von einem echten
 *  „keine News vorhanden" (leeres Array, ein legitimer Prüffall). Review-Fund
 *  Important 2: ein verschluckter Lesefehler wäre sonst nicht von „wirklich
 *  keine News" zu unterscheiden gewesen, das Modell hätte ohne den
 *  entscheidenden Kontext geurteilt, und der Aufrufer hätte das Ergebnis
 *  trotzdem als 'ok' mit frischem last_reviewed_at gestempelt. */
async function loadTermNews(
  supabase: SupabaseAdminClient,
  termId: string,
): Promise<GlossaryReviewNewsRow[] | null> {
  const { data, error } = await supabase
    .from('glossary_term_news')
    .select('title, context_sentence, published_at')
    .eq('term_id', termId)
    .order('published_at', { ascending: false })
  if (error) {
    console.error('[GlossaryReview] News konnten nicht geladen werden für', termId, error.message)
    return null
  }
  return (data ?? []) as GlossaryReviewNewsRow[]
}

// isValidTipTapDoc lebt jetzt in lib/glossary/generate.ts (Fix-Runde 1, Task
// 16): war bytegleich zu einer zweiten Kopie in translate.ts dupliziert — mit
// genau der Gefahr, an der die Review-Fund-Important-3-Historie hing (siehe
// dortiger Kommentar). Verhalten hier unverändert.

/** Markiert einen Begriff mit einem deterministischen Defekt als 'flagged'
 *  und schreibt last_reviewed_at fort, damit er aus dem Warteschlangenkopf
 *  rotiert. Gibt zurück, ob der Schreibvorgang gelungen ist — schlägt er
 *  fehl, zählt der Begriff (korrekt) nicht als geprüft. */
async function markFlagged(supabase: SupabaseAdminClient, termId: string, reason: string): Promise<boolean> {
  console.error('[GlossaryReview] als flagged markiert für', termId, '—', reason)
  const { error } = await supabase
    .from('glossary_terms')
    .update({ review_state: 'flagged', last_reviewed_at: new Date().toISOString() })
    .eq('id', termId)
  if (error) {
    console.error('[GlossaryReview] flagged-Update fehlgeschlagen für', termId, error.message)
    return false
  }
  return true
}

/**
 * Prüft einen Batch der am längsten nicht geprüften veröffentlichten
 * Begriffe und schreibt review_state/pending_body bzw. last_reviewed_at.
 * Gibt niemals einen Fehler nach außen — ein einzelner Begriff, der scheitert,
 * wird geloggt und übersprungen, der Rest läuft weiter.
 */
export async function reviewGlossaryTerms(supabase: SupabaseAdminClient): Promise<GlossaryReviewResult> {
  const { data: terms, error: termsError } = await supabase
    .from('glossary_terms')
    .select('id, slug, canonical_name, summary, body')
    .eq('status', 'published')
    .neq('review_state', 'revision_pending')
    .order('last_reviewed_at', { ascending: true, nullsFirst: true })
    .limit(BATCH_LIMIT)

  if (termsError) {
    console.error('[GlossaryReview] Begriffsliste konnte nicht geladen werden:', termsError.message)
    return { termsChecked: 0, termsReviewed: 0, revisionsProposed: 0 }
  }
  const termRows = (terms ?? []) as GlossaryReviewTermRow[]
  if (termRows.length === 0) {
    return { termsChecked: 0, termsReviewed: 0, revisionsProposed: 0 }
  }

  if (!process.env.ANTHROPIC_API_KEY) {
    console.error('[GlossaryReview] ANTHROPIC_API_KEY fehlt, Lauf übersprungen')
    return { termsChecked: termRows.length, termsReviewed: 0, revisionsProposed: 0 }
  }

  const Anthropic = (await import('@anthropic-ai/sdk')).default
  const { getModelForUseCase } = await import('@/lib/ai/model-config')
  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
  const model = await getModelForUseCase('glossary_review')

  let termsReviewed = 0
  let revisionsProposed = 0

  for (const term of termRows) {
    try {
      if (!isValidTipTapDoc(term.body)) {
        // Deterministischer Defekt (kaputter/fehlender body) — flaggen statt
        // überspringen, sonst bliebe der Begriff für immer an der Spitze der
        // last_reviewed_at-Sortierung.
        if (await markFlagged(supabase, term.id, 'ungültiger oder fehlender body')) termsReviewed++
        continue
      }

      const news = await loadTermNews(supabase, term.id)
      if (news === null) {
        // Transienter Lesefehler, dem Begriff nicht zuzurechnen — OHNE
        // Stempel überspringen, der nächste Lauf versucht es erneut.
        continue
      }

      const bodyText = extractPlainText(term.body)
      const resp = await client.messages.create({
        model, max_tokens: 4096, tools: [REVIEW_TOOL],
        tool_choice: { type: 'tool', name: REVIEW_TOOL.name },
        messages: [{ role: 'user', content: buildReviewPrompt(term.canonical_name, term.summary, bodyText, news) }],
      })
      const block = resp.content.find((b) => b.type === 'tool_use')
      const parsed = ReviewSchema.safeParse(block && 'input' in block ? block.input : null)
      if (!parsed.success) {
        // Unparsbare Modellantwort auf denselben Input wiederholt sich beim
        // nächsten Lauf identisch — deterministisch, deshalb flaggen statt
        // stillschweigend überspringen.
        if (await markFlagged(supabase, term.id, `ungültige Tool-Antwort: ${parsed.error.message}`)) termsReviewed++
        continue
      }

      // ZUSATZ: assignProducts pro geprüftem Begriff, unabhängig vom
      // Review-Ausgang — eigener try/catch, ein Fehler hier darf weder diesen
      // Begriff noch den restlichen Lauf kosten.
      try {
        await assignProducts(term.id, term.canonical_name, term.summary)
      } catch (e) {
        console.error('[GlossaryReview] assignProducts fehlgeschlagen für', term.id, e instanceof Error ? e.message : e)
      }

      if (!parsed.data.outdated) {
        const { error: updateError } = await supabase
          .from('glossary_terms')
          .update({ review_state: 'ok', last_reviewed_at: new Date().toISOString() })
          .eq('id', term.id)
        if (updateError) {
          console.error('[GlossaryReview] Update fehlgeschlagen für', term.id, updateError.message)
          continue
        }
        termsReviewed++
        continue
      }

      const blocks = parsed.data.blocks ?? []
      const pendingBody = buildTipTapBody(blocks)
      if (pendingBody.content.length === 0) {
        // outdated=true ohne brauchbaren Text — wiederholt sich beim nächsten
        // Lauf auf denselben Input identisch, deshalb flaggen.
        if (await markFlagged(supabase, term.id, 'outdated=true aber leerer Revisionstext')) termsReviewed++
        continue
      }
      const { error: updateError } = await supabase
        .from('glossary_terms')
        .update({ pending_body: pendingBody, review_state: 'revision_pending' })
        .eq('id', term.id)
      if (updateError) {
        console.error('[GlossaryReview] Revision konnte nicht geschrieben werden für', term.id, updateError.message)
        continue
      }
      termsReviewed++
      revisionsProposed++
    } catch (e) {
      console.error('[GlossaryReview] Begriff übersprungen:', term.id, e instanceof Error ? e.message : e)
    }
  }

  return { termsChecked: termRows.length, termsReviewed, revisionsProposed }
}

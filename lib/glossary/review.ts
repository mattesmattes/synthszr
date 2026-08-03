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
 * ZUSATZ (Controller, aus der Task-15-Vorabprüfung): pro erfolgreich
 * geprüftem Begriff wird zusätzlich assignProducts (Task 15) aufgerufen —
 * Begriffe, die vor Task 15 entstanden sind, bekämen sonst nie Produkte, und
 * die Chart-Liste wächst laufend. Eigener try/catch: ein Fehler dort darf den
 * Review-Lauf nicht abbrechen.
 */
import { createAdminClient } from '@/lib/supabase/admin'
import { buildTipTapBody, extractPlainText, type TipTapDoc } from '@/lib/glossary/generate'
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
  /** Wie viele davon erfolgreich geprüft UND geschrieben wurden. */
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
 *  eigener Vektor-Zugriff im Review-Pfad. */
async function loadTermNews(
  supabase: SupabaseAdminClient,
  termId: string,
): Promise<GlossaryReviewNewsRow[]> {
  const { data, error } = await supabase
    .from('glossary_term_news')
    .select('title, context_sentence, published_at')
    .eq('term_id', termId)
    .order('published_at', { ascending: false })
  if (error) {
    console.error('[GlossaryReview] News konnten nicht geladen werden für', termId, error.message)
    return []
  }
  return (data ?? []) as GlossaryReviewNewsRow[]
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
      const news = await loadTermNews(supabase, term.id)
      const bodyText = extractPlainText(term.body as TipTapDoc)
      const resp = await client.messages.create({
        model, max_tokens: 4096, tools: [REVIEW_TOOL],
        tool_choice: { type: 'tool', name: REVIEW_TOOL.name },
        messages: [{ role: 'user', content: buildReviewPrompt(term.canonical_name, term.summary, bodyText, news) }],
      })
      const block = resp.content.find((b) => b.type === 'tool_use')
      const parsed = ReviewSchema.safeParse(block && 'input' in block ? block.input : null)
      if (!parsed.success) {
        console.error('[GlossaryReview] ungültige Tool-Antwort für', term.id, parsed.error.message)
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
        console.error('[GlossaryReview] outdated=true aber leerer Revisionstext für', term.id)
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

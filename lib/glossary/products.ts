/**
 * Ordnet einem Lexikonbegriff Chart-Produkte zu (Task 15): lädt eine
 * begrenzte Kandidatenliste chartbarer, sichtbarer Produkte mit
 * Mindest-Mentions, lässt ein LLM eine Relevanz-Teilmenge auswählen und
 * schreibt das Ergebnis nach glossary_term_products (source='llm'). Aufrufer
 * ist lib/glossary/candidates.ts (tryGenerateDraft) — dort eigenständig
 * try/catch-geschützt: ein Fehler hier darf den generierten Begriff nicht
 * kosten, der Text ist das Produkt, die Zuordnung die Zugabe.
 *
 * Kandidaten-Query folgt dem einzigen echten PostgREST-Embed-Vorbild im Repo
 * (lib/rankings/leaderboard.ts): von product_metrics AUS, products!inner(...)
 * eingebettet, chartable liegt auf der Basistabelle. minMentions=2 ist das im
 * Projekt belegte Chart-Kriterium (leaderboard.ts) — chartable selbst ist nur
 * ein Ausschlussflag (Umbrella/Allerwelts-Wort/Exclusion, precompute.ts),
 * keine Relevanzschwelle. Ungefiltert wären das pro Begriff mehrere
 * Zehntausend Kandidaten-Token, deshalb zusätzlich nach mention_count
 * absteigend sortiert und auf PRODUCT_CANDIDATE_LIMIT gekappt — die
 * prominentesten Produkte sind für einen Lexikoneintrag auch die
 * relevantesten.
 */
import { z } from 'zod'
import { createAdminClient } from '@/lib/supabase/admin'

type AdminClient = ReturnType<typeof createAdminClient>

const PRODUCT_CANDIDATE_LIMIT = 300
// Deckt MAX_PRODUCTS in lib/glossary/detail.ts — mehr Zeilen würden geschrieben,
// von der Leseseite aber nie angezeigt.
const MAX_ASSIGNMENTS = 10

interface ProductCandidate {
  id: string
  canonicalName: string
  vendorNamespace: string
}

/** Supabase typisiert einen Fremdschlüssel-Join je nach FK-Erkennung als
 *  Objekt ODER Array — gleiches Muster wie lib/rankings/leaderboard.ts. */
function joinedProduct(p: unknown): { id: string; canonical_name: string; vendor_namespace: string } | null {
  if (!p) return null
  return (Array.isArray(p) ? p[0] : p) as { id: string; canonical_name: string; vendor_namespace: string } | undefined ?? null
}

/** Degradiert bei einem DB-Fehler auf eine leere Liste (gleiches Muster wie
 *  lib/glossary/detail.ts:getTermProducts) — assignProducts schreibt dann
 *  einfach nichts, statt den ganzen Aufruf scheitern zu lassen. */
async function loadProductCandidates(supabase: AdminClient): Promise<ProductCandidate[]> {
  const { data, error } = await supabase
    .from('product_metrics')
    .select('mention_count, products!inner(id, canonical_name, vendor_namespace)')
    .eq('chartable', true)
    .eq('products.visibility_status', 'visible')
    .gte('mention_count', 2)
    .order('mention_count', { ascending: false })
    .limit(PRODUCT_CANDIDATE_LIMIT)
  if (error) {
    console.error('[Glossary] loadProductCandidates:', error.message)
    return []
  }
  return ((data ?? []) as Array<Record<string, unknown>>)
    .map((r) => {
      const p = joinedProduct(r.products)
      if (!p) return null
      return { id: p.id, canonicalName: p.canonical_name, vendorNamespace: p.vendor_namespace }
    })
    .filter((p): p is ProductCandidate => p !== null)
}

const AssignmentsSchema = z.object({
  assignments: z.array(z.object({
    product_id: z.string(),
    relevance: z.number(),
  })),
})

const ASSIGN_TOOL = {
  name: 'assign_products',
  description: 'Chart-Produkte auswählen, die inhaltlich zu einem Lexikonbegriff passen',
  input_schema: {
    type: 'object' as const,
    properties: {
      assignments: {
        type: 'array',
        description: `Höchstens ${MAX_ASSIGNMENTS} Produkte aus der Kandidatenliste, nur mit echtem inhaltlichem Bezug`,
        items: {
          type: 'object',
          properties: {
            product_id: { type: 'string', description: 'Die id des Produkts aus der Kandidatenliste' },
            relevance: { type: 'number', description: '0 (Rand-Erwähnung) bis 1 (der Begriff beschreibt das Produkt zentral)' },
          },
          required: ['product_id', 'relevance'],
        },
      },
    },
    required: ['assignments'],
  },
}

function buildAssignPrompt(termName: string, summary: string, candidates: ProductCandidate[]): string {
  const list = candidates.map((c) => `${c.id} — ${c.canonicalName} (${c.vendorNamespace})`).join('\n')
  return `Begriff: „${termName}"
Kurzbeschreibung: ${summary}

KANDIDATEN (id — Name (Hersteller)):
${list}

Welche dieser KI-Produkte stehen inhaltlich in Verbindung mit dem Begriff „${termName}" — z. B. weil sie das Verfahren nutzen, es implementieren oder damit beworben werden? Antworte via Tool mit assignments: höchstens ${MAX_ASSIGNMENTS} Einträgen, jeweils die product_id EXAKT aus der Liste und relevance (0–1). Nur Produkte mit echtem inhaltlichem Bezug, keine vagen Verbindungen. Passt kein Produkt, eine leere Liste.`
}

/**
 * Wählt per LLM aus einer Kandidatenliste chartbarer Produkte relevante
 * Treffer für `termName`/`summary` aus und schreibt sie nach
 * glossary_term_products. Rückgabe: Anzahl geschriebener Zeilen.
 *
 * Manuelle Zuordnungen (source='manual') sind vor Überschreiben geschützt:
 * ein Upsert mit onConflict kennt kein WHERE, deshalb werden ihre product_ids
 * vorab geladen und aus der LLM-Antwort herausgefiltert, statt sie upzuserten.
 */
export async function assignProducts(termId: string, termName: string, summary: string): Promise<number> {
  const supabase = createAdminClient()
  const candidates = await loadProductCandidates(supabase)
  if (candidates.length === 0) return 0

  if (!process.env.ANTHROPIC_API_KEY) {
    throw new Error('[glossary/products] ANTHROPIC_API_KEY fehlt')
  }
  const Anthropic = (await import('@anthropic-ai/sdk')).default
  const { getModelForUseCase } = await import('@/lib/ai/model-config')
  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
  const model = await getModelForUseCase('glossary_product_assignment')
  const resp = await client.messages.create({
    model, max_tokens: 2048, tools: [ASSIGN_TOOL],
    tool_choice: { type: 'tool', name: ASSIGN_TOOL.name },
    messages: [{ role: 'user', content: buildAssignPrompt(termName, summary, candidates) }],
  })
  const block = resp.content.find((b) => b.type === 'tool_use')
  const parsed = AssignmentsSchema.safeParse(block && 'input' in block ? block.input : null)
  if (!parsed.success) {
    throw new Error(`[glossary/products] ungültige Tool-Antwort für "${termName}": ${parsed.error.message}`)
  }

  // Defensiv gegen Halluzinationen: nur ids akzeptieren, die WIRKLICH aus der
  // Kandidatenliste stammen — ein erfundener/vertippter uuid würde sonst als
  // FK-Violation den gesamten Upsert scheitern lassen.
  const candidateIds = new Set(candidates.map((c) => c.id))
  const seen = new Set<string>()
  const rows: Array<{ term_id: string; product_id: string; relevance: number }> = []
  for (const a of parsed.data.assignments) {
    if (!candidateIds.has(a.product_id) || seen.has(a.product_id)) continue
    seen.add(a.product_id)
    rows.push({ term_id: termId, product_id: a.product_id, relevance: Math.min(1, Math.max(0, a.relevance)) })
    if (rows.length >= MAX_ASSIGNMENTS) break
  }
  if (rows.length === 0) return 0

  // Manuelle Zuordnungen laden und aus der LLM-Antwort herausfiltern, statt
  // sie upzuserten (ein onConflict-Upsert allein kennt kein WHERE). Anders als
  // loadProductCandidates (reiner Read, degradiert auf []) ist das hier ein
  // Read, der einen Schreibvorgang absichert: schlägt er fehl, wüssten wir
  // nicht mehr, welche product_ids manuell (source='manual') sind — "loggen
  // und mit leerem Set weiterlaufen" würde dann genau die Zeilen überschreiben,
  // die Befund 5 schützen soll. Also abbrechen, nichts schreiben.
  const { data: existing, error: existingError } = await supabase
    .from('glossary_term_products')
    .select('product_id, source')
    .eq('term_id', termId)
  if (existingError) {
    console.error('[Glossary] assignProducts: Bestandsabgleich fehlgeschlagen, breche ohne Schreiben ab:', existingError.message)
    return 0
  }
  const manualIds = new Set(
    ((existing ?? []) as Array<{ product_id: string; source: string }>)
      .filter((r) => r.source === 'manual')
      .map((r) => r.product_id),
  )
  const toWrite = rows
    .filter((r) => !manualIds.has(r.product_id))
    .map((r) => ({ ...r, source: 'llm' as const }))
  if (toWrite.length === 0) return 0

  const { error } = await supabase
    .from('glossary_term_products')
    .upsert(toWrite, { onConflict: 'term_id,product_id' })
  if (error) {
    throw new Error(`glossary_term_products upsert failed: ${error.message}`)
  }
  return toWrite.length
}

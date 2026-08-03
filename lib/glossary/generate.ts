/**
 * Begriffs-Generator (Task 8): identifiziert erklärungsbedürftige Fachbegriffe
 * in einem Artikeltext (identifyCandidates) und schreibt für einen Begriff
 * einen vollständigen Lexikoneintrag samt Verständlichkeits-QS
 * (generateTermContent). Reines LLM-Modul — Persistenz (glossary_terms)
 * übernimmt der Aufrufer (Tasks 1–7), nicht dieses Modul.
 *
 * API-Call-Muster exakt wie lib/rankings/product-validity-qa.ts:
 * { model, max_tokens, tools, tool_choice: { type: 'tool', name } } — KEIN
 * temperature, KEIN thinking/budget_tokens. Die 2026er-Frontier-Modelle lehnen
 * manche Parameterkombinationen mit 400 ab; dieses Muster ist in diesem
 * Projekt nachweislich stabil.
 */
import { z } from 'zod'

// ---------------------------------------------------------------------------
// Slug
// ---------------------------------------------------------------------------

// Explizite Transliteration statt reinem Diacritics-Stripping: NFKD-Zerlegung
// von "ä" ergibt "a" + Combining-Diaeresis, ein reines Strip landet also bei
// "a" — im Deutschen falsch (Konvention ist "ae"). Erst die Umlaute/ß ersetzen,
// danach übrige Akzente (é, à, …) über NFKD auf ASCII zurückführen.
const UMLAUT_MAP: Record<string, string> = {
  ä: 'ae', ö: 'oe', ü: 'ue', Ä: 'Ae', Ö: 'Oe', Ü: 'Ue', ß: 'ss',
}

/** Pure: lowercase, ASCII-only, URL-safe. Umlaute werden transliteriert, nicht verworfen. */
export function slugify(name: string): string {
  let s = name
  for (const [k, v] of Object.entries(UMLAUT_MAP)) s = s.split(k).join(v)
  s = s.normalize('NFKD').replace(/[\u0300-\u036f]/g, '')
  s = s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')
  return s
}

// ---------------------------------------------------------------------------
// TipTap-Body
// ---------------------------------------------------------------------------

interface TipTapTextNode { type: 'text'; text: string }
interface TipTapBlockNode { type: 'paragraph' | 'heading'; attrs?: { level: number }; content: TipTapTextNode[] }
export interface TipTapDoc { type: 'doc'; content: TipTapBlockNode[] }

/** Pure: baut das TipTap-Dokument selbst aus validierten Blocks, statt der
 *  rohen LLM-Ausgabe zu vertrauen — eine falsch geschachtelte body-JSONB würde
 *  renderStaticArticleHtml stillschweigend auf einen leeren String zusammenfallen
 *  lassen (siehe Task 6/7). Leere Blocks werden verworfen. */
function buildTipTapBody(blocks: Array<{ type: 'paragraph' | 'heading'; text: string }>): TipTapDoc {
  const content: TipTapBlockNode[] = []
  for (const b of blocks) {
    const text = b.text.trim()
    if (!text) continue
    content.push(
      b.type === 'heading'
        ? { type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text }] }
        : { type: 'paragraph', content: [{ type: 'text', text }] },
    )
  }
  return { type: 'doc', content }
}

/** Pure: Klartext-Fassung des Bodys für den Verständlichkeits-Judge-Prompt. */
function extractPlainText(body: TipTapDoc): string {
  return body.content.map((node) => node.content.map((t) => t.text).join('')).join('\n\n')
}

// ---------------------------------------------------------------------------
// identifyCandidates
// ---------------------------------------------------------------------------

const CandidatesSchema = z.object({ candidates: z.array(z.string()) })

const CANDIDATES_TOOL = {
  name: 'report_candidates',
  description: 'Erklärungsbedürftige Fachbegriffe in einem Artikeltext melden, die noch keinen Glossareintrag haben',
  input_schema: {
    type: 'object' as const,
    properties: {
      candidates: {
        type: 'array',
        items: { type: 'string' },
        description: 'Begriffsnamen in kanonischer Schreibweise, z. B. "Mixture of Experts" statt "MoE"',
      },
    },
    required: ['candidates'],
  },
}

function buildCandidatesPrompt(articleText: string, knownSlugs: string[]): string {
  const known = knownSlugs.length ? knownSlugs.join(', ') : '(keine)'
  return `Im folgenden Artikeltext kommen möglicherweise Fachbegriffe aus KI/Tech vor, die ein Leser ohne Vorwissen nicht versteht (z. B. Modellarchitekturen, Trainings- oder Inferenzverfahren, Fachjargon).

Identifiziere NUR Begriffe, die eine eigene Lexikon-Erklärung verdienen. KEINE Firmennamen, KEINE Produktnamen, KEINE Allgemeinbegriffe, die jeder kennt.

BEREITS IM GLOSSAR (nicht erneut vorschlagen): ${known}

ARTIKELTEXT:
${articleText}

Antworte via Tool mit candidates: einer Liste der Begriffsnamen in kanonischer Schreibweise, ohne Duplikate. Wenn kein Begriff eine Erklärung braucht, eine leere Liste.`
}

/** Welche Begriffe im Artikeltext eine Glossar-Erklärung brauchen und noch
 *  nicht existieren. `knownSlugs` filtert defensiv nach dem LLM-Call — der
 *  Prompt bittet das Modell zwar, bekannte Begriffe auszulassen, aber Modelle
 *  befolgen das nicht zuverlässig, deshalb zusätzlich lokal filtern/dedup. */
export async function identifyCandidates(articleText: string, knownSlugs: string[]): Promise<string[]> {
  if (!process.env.ANTHROPIC_API_KEY) return []
  try {
    const Anthropic = (await import('@anthropic-ai/sdk')).default
    const { getModelForUseCase } = await import('@/lib/ai/model-config')
    const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
    const model = await getModelForUseCase('glossary_candidate_identification')
    const resp = await client.messages.create({
      model, max_tokens: 1024, tools: [CANDIDATES_TOOL],
      tool_choice: { type: 'tool', name: CANDIDATES_TOOL.name },
      messages: [{ role: 'user', content: buildCandidatesPrompt(articleText, knownSlugs) }],
    })
    const block = resp.content.find((b) => b.type === 'tool_use')
    const parsed = CandidatesSchema.safeParse(block && 'input' in block ? block.input : null)
    if (!parsed.success) return []

    const known = new Set(knownSlugs)
    const seen = new Set<string>()
    const out: string[] = []
    for (const raw of parsed.data.candidates) {
      const name = raw.trim()
      if (!name) continue
      const slug = slugify(name)
      if (known.has(slug) || seen.has(slug)) continue
      seen.add(slug)
      out.push(name)
    }
    return out
  } catch (e) {
    console.error('[glossary/generate] identifyCandidates:', e instanceof Error ? e.message : e)
    return []
  }
}

// ---------------------------------------------------------------------------
// generateTermContent
// ---------------------------------------------------------------------------

export interface GeneratedTerm {
  slug: string
  canonicalName: string
  aliases: string[]
  summary: string
  body: TipTapDoc
  needsIllustration: boolean
  illustrationAlt: string | null
  /** 0–100, wie gut der Text die Verständlichkeitskriterien erfüllt (Zielgruppe,
   *  Satzlänge, Struktur, Länge). `null`, wenn der QS-Call fehlgeschlagen ist —
   *  kein Grund, die Generierung selbst scheitern zu lassen. */
  readabilityScore: number | null
}

// Untergrenzen sind kein Stil-Detail: canonical_name='' würde slugify('') zu
// '' machen, und blocks=[] würde buildTipTapBody zu einem leeren Dokument.
// Beides muss die Parse-Stufe ablehnen, statt still ein degeneriertes
// GeneratedTerm zu erzeugen — sonst matcht ein leerer Name in Task 2 überall
// (boundaryRegex('')) und injectGlossaryMarks erzeugt ungültiges TipTap-JSON.
// min(4) auf blocks: Regel 3 im Systemprompt verlangt mindestens die vier
// Struktureinheiten (Intro-Absatz + drei Überschriften); das ist die
// Zod-seitige Grobgrenze, nicht die vollständige Struktur-Prüfung.
const ContentSchema = z.object({
  canonical_name: z.string().min(1),
  aliases: z.array(z.string()),
  summary: z.string().min(1),
  blocks: z.array(z.object({ type: z.enum(['paragraph', 'heading']), text: z.string() })).min(4),
  needs_illustration: z.boolean(),
  illustration_alt: z.string().nullable().optional(),
})

const ReadabilitySchema = z.object({
  readability_score: z.number().min(0).max(100),
  reasoning: z.string().optional(),
})

const CONTENT_TOOL = {
  name: 'write_glossary_term',
  description: 'Einen Lexikoneintrag für einen KI/Tech-Fachbegriff verfassen',
  input_schema: {
    type: 'object' as const,
    properties: {
      canonical_name: { type: 'string', description: 'Kanonischer Begriffsname, wie er im Fließtext stehen würde' },
      aliases: {
        type: 'array', items: { type: 'string' },
        description: 'Deutsche Flexionen, Abkürzungen, Schreibvarianten (z. B. "MoE", "Mixture-of-Experts"). NICHT den canonical_name selbst.',
      },
      summary: { type: 'string', description: '1–2 eigenständig verständliche Sätze (Lead/Meta-Description)' },
      blocks: {
        type: 'array',
        description: 'Absätze/Überschriften in Lesereihenfolge',
        items: {
          type: 'object',
          properties: {
            type: { type: 'string', enum: ['paragraph', 'heading'] },
            text: { type: 'string' },
          },
          required: ['type', 'text'],
        },
      },
      needs_illustration: { type: 'boolean', description: 'Nur true, wenn ein Schema/Ablauf etwas zeigt, das ein Satz nicht leisten kann' },
      illustration_alt: { type: 'string', description: 'Nur befüllen, wenn needs_illustration=true' },
    },
    required: ['canonical_name', 'aliases', 'summary', 'blocks', 'needs_illustration'],
  },
}

const READABILITY_TOOL = {
  name: 'judge_readability',
  description: 'Einen Lexikontext gegen Verständlichkeitskriterien bewerten',
  input_schema: {
    type: 'object' as const,
    properties: {
      readability_score: { type: 'number', description: '0–100, wie gut ALLE Kriterien erfüllt sind' },
      reasoning: { type: 'string' },
    },
    required: ['readability_score'],
  },
}

// Referenztexte (supabase/_glossary_testdata.sql) als Kalibrierungsbeispiele im
// Prompt — sie sind der konkrete Beweis für "was heißt 15-Jähriger ohne
// Vorwissen, aber nicht kindlich", präziser als jede abstrakte Beschreibung.
const CALIBRATION_EXAMPLES = `--- BEISPIEL 1: Inferenz ---
Ein KI-Modell durchläuft zwei sehr verschiedene Phasen. Beim Training lernt es aus Beispielen, was über Wochen laufen kann und einmal passiert. Bei der Inferenz benutzt man das fertige Modell: man stellt eine Frage, das Modell rechnet, eine Antwort kommt heraus. Das dauert Sekunden statt Wochen, passiert aber jedes Mal neu.

## Warum das wichtig ist
Training ist eine einmalige Investition, Inferenz eine Dauerbelastung. Wer einen Chatbot mit Millionen Nutzern betreibt, zahlt für jede einzelne Antwort. Deshalb dreht sich ein großer Teil der Forschung nicht darum, Modelle klüger zu machen, sondern billiger im Betrieb.

## Wie man sie günstiger macht
Der wirksamste Ansatz heißt Mixture of Experts: das Modell aktiviert pro Anfrage nur einen kleinen Teil seiner Bausteine statt alle. Ein Modell mit hunderten Milliarden Parametern rechnet dann so schnell wie ein viel kleineres, ohne an Fähigkeiten zu verlieren.

Daneben gibt es Verfahren, die Zahlen im Modell gröber speichern und dadurch Rechenzeit sparen. Beides zusammen hat die Inferenzkosten in den letzten Jahren deutlich gesenkt.

--- BEISPIEL 2: Mixture of Experts ---
Stell dir eine Redaktion vor, in der zu jeder Frage alle hundert Mitarbeiter gleichzeitig recherchieren. Das wäre gründlich, aber absurd teuer. Sinnvoller ist es, pro Frage die zwei Leute zu fragen, die sich damit auskennen. Genau das macht ein Mixture-of-Experts-Modell.

## Wie die Auswahl funktioniert
Ein kleines Zusatznetz, der Router, entscheidet für jedes Wort, welche Experten zuständig sind. Dieser Router wird mittrainiert, niemand teilt die Fachgebiete von Hand ein. Was ein Experte am Ende können wird, ergibt sich aus dem Training.

## Der Haken
Das ganze Modell muss trotzdem im Speicher liegen, auch die Experten, die gerade nichts tun. Man spart Rechenzeit, nicht Platz. Und wenn der Router schlecht verteilt, sind manche Experten überlastet und andere arbeitslos.`

const GENERATE_SYSTEM_PROMPT = `Du schreibst Lexikoneinträge für ein KI/Tech-Glossar auf einer Finanz-/Tech-News-Seite.

ZIELGRUPPE: ein 15-jähriger Gymnasiast ohne Vorwissen in KI oder Informatik. Sprich ihn NICHT kindlich an — schreib klar und sachlich, wie eine gute Erklärung im Unterricht, nicht wie ein Kindermagazin.

HARTE REGELN — keine Ausnahmen, kein "im Zweifel großzügig sein":
1. Der ERSTE ABSATZ darf KEINEN unerklärten Fachbegriff enthalten. Jeden Begriff, den du dort brauchst, erklärst du im selben Satz beiläufig — oder du verzichtest an dieser Stelle darauf und holst ihn erst später nach. Ein Verstoß gegen diese Regel macht den ganzen Eintrag unbrauchbar.
2. Durchschnittliche Satzlänge unter 20 Wörtern. Kurze Sätze, pro Satz ein Gedanke.
3. Struktur, in genau dieser Reihenfolge:
   - Ein Block "paragraph" ohne Überschrift: Was ist es?
   - Ein Block "heading" + mindestens ein "paragraph": Warum ist es wichtig?
   - Ein Block "heading" + mindestens ein "paragraph": Wie funktioniert es?
   - Ein Block "heading" + mindestens ein "paragraph": Wo begegnet man dem Begriff (im Alltag, in News, in Produkten)?
4. Gesamtlänge 400–700 Wörter über alle Blocks zusammen.
5. Nutze eine konkrete Analogie, wo sie den Sachverhalt wirklich trägt — erzwinge aber keine Metapher, wenn eine klare Definition treffender ist.

KALIBRIERUNG — bereits veröffentlichte Einträge auf exakt diesem Niveau (Ton, Satzlänge, Konkretheit):

${CALIBRATION_EXAMPLES}

AUSGABEFELDER:
- canonical_name: der Begriff in der Schreibweise, wie er im Fließtext stehen würde.
- aliases: deutsche Flexionen, Abkürzungen, Schreibvarianten (Beispiel: "MoE", "Mixture-of-Experts" für "Mixture of Experts"). Nenne NICHT canonical_name selbst als Alias.
- summary: 1–2 eigenständig verständliche Sätze, werden als Lead und Meta-Description verwendet.
- blocks: die Absätze/Überschriften aus Regel 3, in Reihenfolge. type "heading" NUR für die drei H2-Überschriften, sonst "paragraph".
- needs_illustration: NUR true, wenn ein Schema, eine Pipeline oder eine Ablaufskizze etwas zeigen kann, das ein Satz nicht leisten kann (z. B. ein mehrstufiger Prozess, eine Architektur mit mehreren benannten Bauteilen, ein Nebeneinander-Vergleich). Bei abstrakten Begriffen ohne visuelle Struktur — Eigenschaften, Kennzahlen, Prinzipien, Rechts- oder Organisationsbegriffe wie "Compliance" — ist es IMMER false. Pro Begriff gibt es maximal eine Illustration; sei im Zweifel strikt und wähle false.
- illustration_alt: nur befüllen, wenn needs_illustration=true, sonst leer lassen.`

function buildContentUserPrompt(name: string): string {
  return `Schreibe den Lexikoneintrag für den Begriff „${name}".`
}

function buildReadabilityPrompt(canonicalName: string, summary: string, body: TipTapDoc): string {
  return `Bewerte den folgenden Lexikoneintrag für ein KI/Tech-Glossar gegen diese Kriterien:
1. Zielgruppe: 15-jähriger Gymnasiast ohne Vorwissen, aber nicht kindlich angesprochen.
2. Der erste Absatz enthält keinen unerklärten Fachbegriff.
3. Durchschnittliche Satzlänge unter 20 Wörtern.
4. Struktur: Was ist es → Warum wichtig → Wie funktioniert es → Wo begegnet man es.
5. Länge 400–700 Wörter.

BEGRIFF: ${canonicalName}
SUMMARY: ${summary}

TEXT:
${extractPlainText(body)}

Antworte via Tool mit readability_score (0–100: wie gut der Text ALLE Kriterien zusammen erfüllt; 100 = perfekt, unter 70 bedeutet, dass mindestens ein Kriterium spürbar verletzt ist) und einer kurzen reasoning.`
}

/** Entfernt Duplikate und den kanonischen Namen selbst (case-insensitive) aus den Aliases. */
function dedupeAliases(aliases: string[], canonicalName: string): string[] {
  const canonLower = canonicalName.trim().toLowerCase()
  const seen = new Set<string>()
  const out: string[] = []
  for (const raw of aliases) {
    const alias = raw.trim()
    if (!alias) continue
    const key = alias.toLowerCase()
    if (key === canonLower || seen.has(key)) continue
    seen.add(key)
    out.push(alias)
  }
  return out
}

/**
 * Generiert einen vollständigen Lexikoneintrag für `name`. Zwei LLM-Calls:
 * (1) der eigentliche Text via Tool-Call, (2) ein unabhängiger Verständlichkeits-
 * Judge, der den Text gegen die Kriterien aus dem Prompt bewertet. Call (1)
 * muss gelingen (ohne Inhalt kein Eintrag) — Call (2) ist informativ und
 * degradiert bei Fehlern auf readabilityScore=null statt die Generierung
 * scheitern zu lassen.
 */
export async function generateTermContent(name: string): Promise<GeneratedTerm> {
  if (!process.env.ANTHROPIC_API_KEY) {
    throw new Error('[glossary/generate] ANTHROPIC_API_KEY fehlt')
  }
  const Anthropic = (await import('@anthropic-ai/sdk')).default
  const { getModelForUseCase } = await import('@/lib/ai/model-config')
  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

  const contentModel = await getModelForUseCase('glossary_generation')
  const contentResp = await client.messages.create({
    model: contentModel, max_tokens: 4096, tools: [CONTENT_TOOL],
    tool_choice: { type: 'tool', name: CONTENT_TOOL.name },
    system: [{ type: 'text', text: GENERATE_SYSTEM_PROMPT, cache_control: { type: 'ephemeral' } }],
    messages: [{ role: 'user', content: buildContentUserPrompt(name) }],
  })
  const contentBlock = contentResp.content.find((b) => b.type === 'tool_use')
  const parsedContent = ContentSchema.safeParse(contentBlock && 'input' in contentBlock ? contentBlock.input : null)
  if (!parsedContent.success) {
    throw new Error(`[glossary/generate] ungültige Tool-Antwort für "${name}": ${parsedContent.error.message}`)
  }
  const c = parsedContent.data
  const canonicalName = c.canonical_name.trim()
  const slug = slugify(canonicalName)
  // ContentSchema prüft nur die Roh-Länge von canonical_name — ein reiner
  // Whitespace-String ("   ") besteht min(1), wird aber nach trim() bzw.
  // slugify() leer. "slug" ist kein Rohfeld des Tools (wir berechnen es
  // selbst), deshalb hier die äquivalente Non-Empty-Prüfung auf das Ergebnis.
  if (!canonicalName || !slug) {
    throw new Error(`[glossary/generate] leerer canonical_name/slug für "${name}"`)
  }
  const aliases = dedupeAliases(c.aliases, canonicalName)
  const body = buildTipTapBody(c.blocks)
  const needsIllustration = c.needs_illustration
  const illustrationAlt = needsIllustration ? (c.illustration_alt?.trim() || null) : null

  let readabilityScore: number | null = null
  try {
    const readabilityModel = await getModelForUseCase('glossary_readability_qa')
    const judgeResp = await client.messages.create({
      model: readabilityModel, max_tokens: 512, tools: [READABILITY_TOOL],
      tool_choice: { type: 'tool', name: READABILITY_TOOL.name },
      messages: [{ role: 'user', content: buildReadabilityPrompt(canonicalName, c.summary, body) }],
    })
    const judgeBlock = judgeResp.content.find((b) => b.type === 'tool_use')
    const parsedJudge = ReadabilitySchema.safeParse(judgeBlock && 'input' in judgeBlock ? judgeBlock.input : null)
    if (parsedJudge.success) readabilityScore = parsedJudge.data.readability_score
  } catch (e) {
    console.error('[glossary/generate] readability judge:', e instanceof Error ? e.message : e)
  }

  return {
    slug, canonicalName, aliases,
    summary: c.summary.trim(),
    body, needsIllustration, illustrationAlt, readabilityScore,
  }
}

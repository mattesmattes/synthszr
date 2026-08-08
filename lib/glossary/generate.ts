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

/**
 * Normalisiert einen Slug für den Dubletten-Vergleich: ohne Bindestriche und
 * ohne einen einzelnen End-"s". Exakte Slug-Gleichheit übersieht Schreibvarianten
 * wie "Eval"/"Evals" (Singular/Plural) oder "Pretraining"/"Pre-Training"
 * (Bindestrich) - beide ergeben unterschiedliche Slugs und wurden in Prod als
 * zwei getrennte Begriffe erzeugt (Befund 2026-08-06, vier solche Paare unter
 * 471 veröffentlichten Begriffen, je einmal voll bezahlt: zwei Opus-Aufrufe pro
 * Begriff).
 *
 * Geprüft an genau diesem Bestand (tests/fixtures/glossary-published-slugs.ts):
 * die Regel erzeugt dort KEINE Kollision zwischen inhaltlich verschiedenen
 * Begriffen - nur die vier tatsächlichen Dubletten normalisieren gleich, alle
 * übrigen 463 bleiben eindeutig.
 *
 * Rein syntaktisch und bewusst eng: erkennt keine echten Synonyme, bei denen
 * Wortstamm oder Sprache wechselt (z.B. "Evaluation"/"Eval" - beobachtet im
 * selben Bestand, aber ein anderes Wort, kein Schreibfehler; "Foundation
 * Model"/"Fundamentmodell" bräuchte Embeddings). Dafür ist diese Funktion nicht
 * gedacht - sie fängt nur die Bindestrich-/Pluralvariante DESSELBEN Worts.
 */
export function normalizeSlugForDedup(slug: string): string {
  return slug.replace(/-/g, '').replace(/s$/, '')
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
export function buildTipTapBody(blocks: Array<{ type: 'paragraph' | 'heading'; text: string }>): TipTapDoc {
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

/** Pure: Klartext-Fassung des Bodys für den Verständlichkeits-Judge-Prompt.
 *  Auch von lib/glossary/review.ts genutzt (Task 17), um den bestehenden
 *  Erklärungstext in den Aktualitäts-Prompt zu geben. */
export function extractPlainText(body: TipTapDoc): string {
  return body.content.map((node) => node.content.map((t) => t.text).join('')).join('\n\n')
}

/** Deterministische Vorprüfung vor extractPlainText: `body` ist jsonb ohne
 *  NOT NULL (Schema), ein kaputter/fehlender Body würde bei JEDEM Lauf
 *  identisch scheitern. Hier war body immer frisch von buildTipTapBody
 *  konstruiert — die Vorbedingung ist durch den Aufrufkontext garantiert,
 *  eine Prüfung an dieser Stelle wäre also überflüssig. Trotzdem hier
 *  zentral exportiert (statt in jedem Aufrufer neu geschrieben): sowohl
 *  lib/glossary/review.ts (liest gespeicherten body, Vorbedingung gilt dort
 *  NICHT mehr automatisch) als auch lib/glossary/translate.ts (Task 16,
 *  prüft body VOR dem Übersetzungs-Call) brauchten bytegleiche Kopien dieser
 *  Funktion — Fix-Runde 1 des Reviews hat das als Duplikat markiert
 *  (dieselbe Logik hätte sonst zweimal auseinanderlaufen können, wie es
 *  review.ts' eigener Kommentarverlauf schon einmal zeigte: die erste
 *  Fassung dort prüfte nur die oberste Ebene, ein Top-Level-Node ohne
 *  eigenes content-Array wie ein leerer Absatz oder ein horizontalRule warf
 *  eine TypeError in extractPlainText). Deshalb jetzt jeden Node prüfen,
 *  nicht nur den Doc-Wrapper — und nur EINE Fassung davon.
 *
 *  Task 16 (Übersetzung) baut seinen übersetzten body ebenfalls über
 *  buildTipTapBody, hebt die paragraph/heading-Garantie also NICHT auf, wie
 *  ursprünglich befürchtet — die Vorprüfung bleibt trotzdem sinnvoll, weil
 *  translate.ts vor dem Übersetzen den GESPEICHERTEN Quell-body einer
 *  Fremdtabelle liest (glossary_terms), nicht selbst konstruiert. */
export function isValidTipTapDoc(body: unknown): body is TipTapDoc {
  if (!body || typeof body !== 'object') return false
  const content = (body as { content?: unknown }).content
  if (!Array.isArray(content)) return false
  return content.every((n) => Array.isArray((n as { content?: unknown }).content))
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

/**
 * Auswahlkriterium der Kandidaten.
 *
 * BETREIBER-VORGABE 2026-08-08: Das Lexikon erklärt technische, Finanz- und
 * KI-Fachbegriffe. Allgemeinverständliche deutsche Wörter gehören nicht hinein.
 *
 * Die vorige Fassung nannte als Ausschluss nur „KEINE Allgemeinbegriffe, die
 * jeder kennt" und als Domäne nur „KI/Tech". Beides war zu schwach: aus EINER
 * Kandidatenliste mussten 39 Begriffe von Hand gestrichen werden — darunter
 * „Gabelstapler", „Baugenehmigung", „Grünstreifen", „Stallgeruch",
 * „Eintrittspreis" und „Wettbewerbsvorteil". Im Kontext eines Artikels hält das
 * Modell solche Wörter offenbar für erklärungswürdig; eine abstrakte Regel
 * ändert das nicht, konkrete Negativ-Beispiele schon. Finanzbegriffe fehlten
 * als Domäne ganz, obwohl das Lexikon sie führt.
 *
 * Die zweite gestrichene Gruppe waren Ad-hoc-Formulierungen des Autors
 * („API-Mauern", „Bürokratisches Niemandsland", „Digitalisierungsrendite") —
 * Wörter, die außerhalb dieses einen Artikels niemand nachschlägt. Auch dafür
 * steht jetzt eine eigene Regel im Prompt.
 */
export function buildCandidatesPrompt(articleText: string, knownSlugs: string[]): string {
  const known = knownSlugs.length ? knownSlugs.join(', ') : '(keine)'
  return `Im folgenden Artikeltext kommen möglicherweise Fachbegriffe vor, die ein Leser ohne Vorwissen nicht versteht.

DAS LEXIKON ERKLÄRT GENAU DREI ARTEN VON BEGRIFFEN:
1. Technik/IT — z. B. Kubernetes, Syscall, Microservices, Disassembler
2. KI — z. B. Modellarchitekturen, Trainings- und Inferenzverfahren, Benchmarks
3. Finanzen/Kapitalmarkt — z. B. Investment-Grade-Anleihe, Streubesitz, Verbriefung

NICHT AUFNEHMEN — das ist genauso wichtig wie die Auswahl:
- Allgemeinverständliche deutsche Wörter, auch wenn sie im Artikel eine Rolle spielen. Test: Würde ein Erwachsener ohne Fachwissen das Wort verstehen? Dann NICHT vorschlagen. Beispiele für Wörter, die NICHT ins Lexikon gehören: Gabelstapler, Baugenehmigung, Grünstreifen, Eintrittspreis, Aufmerksamkeitsspanne, Wettbewerbsvorteil, Marktanteil, Anleihe, Präzedenzfall, Trojanisches Pferd.
- Ad-hoc-Wortschöpfungen und eigene Formulierungen des Autors, die nur in diesem Text vorkommen. Beispiele: „API-Mauern", „Bürokratisches Niemandsland", „Digitalisierungsrendite", „Konsumtreiber".
- KEINE Firmennamen, KEINE Markenprodukte (die stehen in den Synthszr Charts, nicht im Lexikon). Beispiele: Hugging Face, Red Hat, Cursor, Railway.
  AUSGENOMMEN sind BENANNTE TECHNOLOGIEN mit eigenem Erklärgehalt — die gehören ins Lexikon, auch wenn der Name von einer Firma stammt. Beispiele, die AUFGENOMMEN werden sollen: gVisor, Graviton-Prozessoren, Axion, Kubernetes. Prüfe: Erklärt man damit, WIE etwas funktioniert (dann aufnehmen), oder nennt man nur WER es anbietet (dann nicht)?

Ein Begriff gehört nur dann in die Liste, wenn jemand ihn ernsthaft nachschlagen würde, weil er ihn nicht kennt — und wenn er auch in anderen Artikeln wieder vorkommt.

BEREITS IM GLOSSAR (nicht erneut vorschlagen): ${known}

ARTIKELTEXT:
${articleText}

Antworte via Tool mit candidates: einer Liste der Begriffsnamen in kanonischer Schreibweise, ohne Duplikate. Lieber wenige gute Begriffe als viele zweifelhafte — eine leere Liste ist ein gültiges Ergebnis.`
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
/** Untergrenze aus Regel 4 des Prompts. Wird durchgesetzt (Nachforderung, dann
 *  Abbruch), nicht nur formuliert — die Regel gilt. */
const MIN_BODY_WORDS = 400

/** Wörter über alle Blocks, die Messgröße für Regel 4. */
function countBodyWords(blocks: Array<{ text: string }>): number {
  return blocks.reduce((n, b) => n + b.text.trim().split(/\s+/).filter(Boolean).length, 0)
}

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
3. Struktur, in genau dieser Reihenfolge. Die Fragen bestimmen, WAS im Abschnitt steht — nicht, wie die Überschrift lautet:
   - Ein Block "paragraph" ohne Überschrift: Was ist es?
   - Ein Block "heading" + mindestens ein "paragraph": Warum ist es wichtig?
   - Ein Block "heading" + mindestens ein "paragraph": Wie funktioniert es?
   - Ein Block "heading" + mindestens ein "paragraph": Wo begegnet man dem Begriff (im Alltag, in News, in Produkten)?
3a. ÜBERSCHRIFTEN benennen die SACHE, nicht die Leitfrage. Jede muss erkennbar zu DIESEM Begriff gehören und darf auf keinen anderen Eintrag passen. VERBOTEN sind deshalb die Leitfragen als Überschrift und jede Schablone dieser Art: "Warum das wichtig ist", "Wie es funktioniert", "Wo man dem Begriff begegnet". Zwei Einträge des Lexikons dürfen NIE dieselbe Überschrift tragen. Beispiel für "Inferenz": "Wie man sie günstiger macht" statt "Wie es funktioniert" — dieselbe Leitfrage, aber am konkreten Begriff formuliert.
4. LÄNGE, verbindlich: 400–700 Wörter über alle Blocks zusammen. Das ist keine Obergrenze, die du unterbieten sollst — 400 Wörter sind das MINDESTE. Konkret heißt das: der einleitende Absatz 4–6 Sätze, und jeder der drei Abschnitte mit Überschrift 2–3 Absätze à 3–5 Sätze. Ein Abschnitt aus einem einzigen Absatz ist zu dünn. Wenn dir der Stoff ausgeht, gehe in die Tiefe: ein konkretes Beispiel, eine Zahl, eine Abgrenzung zu einem verwandten Begriff, ein typischer Irrtum.
5. Nutze eine konkrete Analogie, wo sie den Sachverhalt wirklich trägt — erzwinge aber keine Metapher, wenn eine klare Definition treffender ist.

KALIBRIERUNG — die folgenden Beispiele sind AUSZÜGE und zeigen AUSSCHLIESSLICH Ton, Satzlänge und Konkretheit. Sie sind KEIN Längenmaßstab: sie sind auf ihre ersten Abschnitte gekürzt und damit deutlich kürzer als die 400–700 Wörter, die dein Eintrag haben muss. Schreibe in diesem Ton, aber vollständig nach Regel 3 und 4.

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
  const { getModelCapabilities } = await import('@/lib/claude/model-capabilities')
  const caps = getModelCapabilities(contentModel)

  /**
   * Ein Content-Call. `extraInstruction` hängt eine Nachforderung an denselben
   * Ein-Turn-Prompt an, statt einen Multi-Turn mit tool_result aufzubauen — das
   * Modell braucht für einen Neuschrieb keinen Gesprächsverlauf, nur die
   * gemessene Abweichung.
   *
   * max_tokens 8192 statt 4096: 700 Wörter sind mit JSON-Overhead rund 1.400
   * Tokens, aber das alte Budget musste ohne `thinking`-Feld zusätzlich das
   * Reasoning tragen — bei Opus 5 ist Thinking dann per Default AN und
   * max_tokens deckt beides gemeinsam ab. Genau daran wurden die Erklärtexte
   * abgeschnitten. Thinking wird deshalb explizit abgeschaltet (nur bei
   * Modellen, die die adaptive Form kennen — die alte Form würde `disabled`
   * nicht akzeptieren).
   */
  const callContent = (extraInstruction?: string) => client.messages.create({
    model: contentModel, max_tokens: 8192, tools: [CONTENT_TOOL],
    tool_choice: { type: 'tool', name: CONTENT_TOOL.name },
    // supportsDisabledThinking statt adaptiveThinking: die beiden fielen bis zum
    // 2026-08-07 zusammen, bis claude-fable-5 auftauchte — adaptiv ja, aber
    // `disabled` mit HTTP 400 abgelehnt. Das kostete 100 Begriffe in Serie.
    ...(caps.adaptiveThinking && caps.supportsDisabledThinking
      ? { thinking: { type: 'disabled' as const } }
      : {}),
    system: [{ type: 'text', text: GENERATE_SYSTEM_PROMPT, cache_control: { type: 'ephemeral' } }],
    messages: [{
      role: 'user' as const,
      content: extraInstruction
        ? `${buildContentUserPrompt(name)}\n\n${extraInstruction}`
        : buildContentUserPrompt(name),
    }],
  })

  const parse = (resp: { content: Array<unknown> }) => {
    const block = (resp.content as Array<{ type: string; input?: unknown }>).find((b) => b.type === 'tool_use')
    return ContentSchema.safeParse(block && 'input' in block ? block.input : null)
  }

  const contentResp = await callContent()
  const parsedContent = parse(contentResp)
  if (!parsedContent.success) {
    throw new Error(`[glossary/generate] ungültige Tool-Antwort für "${name}": ${parsedContent.error.message}`)
  }
  let c = parsedContent.data

  // Regel 4 wird DURCHGESETZT, nicht nur formuliert. Muster: enforceHeadingLength
  // im Ghostwriter — deterministisch angestoßen, nur wenn die Grenze verletzt ist.
  // Ein Versuch, danach Abbruch: der Aufrufer (generateAndInsertDraft) fängt den
  // Wurf und liefert null, der Kandidat bleibt in pending_glossary_terms für
  // einen späteren Anlauf vorgemerkt. Ein dauerhaft zu dünner Eintrag wird also
  // nicht angelegt, aber auch nicht stillschweigend verworfen.
  let words = countBodyWords(c.blocks)
  if (words < MIN_BODY_WORDS) {
    console.warn(`[glossary/generate] "${name}": ${words} Wörter im ersten Entwurf — fordere nach`)
    const retryResp = await callContent(
      `NACHFORDERUNG: Dein erster Entwurf war mit ${words} Wörtern zu kurz. Regel 4 verlangt ` +
      `mindestens ${MIN_BODY_WORDS} Wörter über alle Blocks zusammen. Schreibe den Eintrag ` +
      `vollständig neu und deutlich ausführlicher — nicht durch Wiederholung, sondern durch ` +
      `Substanz: ein konkretes Beispiel, eine Zahl, die Abgrenzung zu einem verwandten Begriff, ` +
      `ein typischer Irrtum. Jeder Abschnitt mit Überschrift braucht 2–3 Absätze à 3–5 Sätze.`,
    )
    const parsedRetry = parse(retryResp)
    if (parsedRetry.success) {
      const retryWords = countBodyWords(parsedRetry.data.blocks)
      if (retryWords > words) {
        c = parsedRetry.data
        words = retryWords
      }
    }
    if (words < MIN_BODY_WORDS) {
      throw new Error(
        `[glossary/generate] "${name}" bleibt mit ${words} Wörtern zu kurz (Regel 4: mindestens ${MIN_BODY_WORDS})`,
      )
    }
  }
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

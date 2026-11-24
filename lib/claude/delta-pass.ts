/**
 * Post-Write-Delta-Prüfung (Loop) für tagesaktuelle News-Abschnitte.
 *
 * PROBLEM: Laufende Storylines (z. B. Nvidia/Jensen Huang, OpenAI-Runden) tauchen
 * an aufeinanderfolgenden Tagen wieder auf. Selbst mit Vorwissen neigt der erste
 * Schreib-Call oft dazu, bekannte Vorgeschichte und Zahlen noch einmal breit zu
 * erzählen.
 *
 * LÖSUNG: Läuft NUR, wenn das 3-Tage-Retrieval passende Vorberichte gefunden hat.
 * Vergleicht dann den geschriebenen Abschnitt mit den Vorberichten + heutigem
 * Rohmaterial, streicht Wiederholungen und hebt die neuen Aspekte (Netto-
 * Informationsdichte) hervor — ohne die News zu unterdrücken und ohne
 * bestehende Marker/Tags/Take-Struktur zu beschädigen.
 *
 * Rein (keine DB-/SDK-Imports): der Modellaufruf wird injiziert.
 */
import { BUNDLE_TAG_LINE_RE } from './bundle-length'
import { escapeQuellmaterialTag, stripLoneSurrogates } from './sanitize'
import { splitAtTake, TAKE_MARKER_RE } from './take-ending'
import { bundleLabel, type BundleType } from '@/lib/i18n/bundle-labels'
import type { RecentSectionMatch } from '@/lib/posts/recent-sections'

export type DeltaPassMode =
  | 'single'
  | { kind: 'bundle'; bundleType: BundleType; lengthHint: string }

export interface DeltaPassInput {
  section: string
  heading: string
  recentMatches: RecentSectionMatch[]
  sourceText: string
  mode: DeltaPassMode
}

export interface DeltaPassResult {
  section: string
  changed: boolean
  verdict: 'skipped' | 'ok' | 'revised' | 'fallback'
}

export interface SectionParts {
  headingLine: string
  headingText: string
  headingComments: string
  summaryBody: string
  tagLine: string
  takeTail: string
}

export const DELTA_SYSTEM_PROMPT = `Du bist Schlussredakteur beim Synthszr Newsletter und prüfst einen gerade geschriebenen News-Abschnitt (ENTWURF HEUTE) gegen unsere eigenen Vorberichte der letzten 3 Tage (BEREITS BERICHTET) und das HEUTIGE QUELLMATERIAL.

ZIEL: Steigere die Netto-Informationsdichte neuer Aspekte, OHNE die Meldung zu unterdrücken.

REGELN:
1. WIEDERHOLUNGEN STREICHEN: Entferne aus dem Entwurf Vorgeschichte, bereits bekannte Zahlen, Zitate und Hintergrund-Erklärungen, die schon in BEREITS BERICHTET stehen.
2. NEUE ASPEKTE SCHÄRFEN: Arbeite die tatsächlich neuen Entwicklungen, Zahlen, Akteure, Wendungen oder Reaktionen klar heraus. Wenn im HEUTIGEN QUELLMATERIAL relevante neue Fakten stehen, die im Entwurf fehlen oder untergehen, ziehe sie in die Zusammenfassung hinein.
3. VERSTÄNDLICHKEIT BEWAHREN: Belasse höchstens einen knappen Einordnungs-Halbsatz oder kurzen Rückbezug, damit auch ein Leser ohne gestrige Ausgabe den aktuellen Stand sofort versteht.
4. KEIN ERFINDEN: Jede Aussage, Zahl und jeder Name muss im HEUTIGEN QUELLMATERIAL oder im Entwurf belegt sein. Bietet die Quelle nur wenig Neues, wird der Bericht ehrlich knapp und präzise, statt neue Aspekte hinzuzudichten.
5. TON & FORMAT: Nüchterner Bericht, keine Wertung/Meinung (kein Take!). Erhalte bestehende {lex:...}-Tags auf Fachbegriffen (niemals in der Überschrift). Überschrift auf DEUTSCH, konkret zum heutigen Fokus, max ~90 Zeichen.
6. BÜNDEL-MODUS (falls aktiv): Mehrere Absätze durch Leerzeile getrennt beibehalten, genannte Längenregel einhalten, Publikationsnamen NIEMALS im Fließtext nennen.

ANTWORTFORMAT — halte dich EXAKT daran:
- Wenn der Entwurf bereits klar auf die neuen Aspekte fokussiert und keine nennenswerten Wiederholungen aus den Vorberichten enthält, antworte NUR mit:
VERDICT: OK

- Wenn du Wiederholungen kürzen oder neue Aspekte aus dem Quellmaterial stärker herausarbeiten musst, antworte EXAKT im Format:
VERDICT: REVISED
## <Überschrift>

<überarbeitete Zusammenfassung>

WICHTIG: Gib im Output KEINE {Company}-Tags, KEINE "→ Quelle"-Zeile und KEINEN "Synthszr Take:" aus — diese Bestandteile bleiben aus dem ursprünglichen Abschnitt deterministisch erhalten.`

const STANDALONE_TAG_LINE_RE = /^\s*(?:\{(?!lex:)[^}\n]+\}\s*)+(?:→.*)?$/
const INLINE_TAG_SUFFIX_RE = /\s+((?:\{(?!lex:)[^}\n]+\}\s*)+(?:→.*)?)$/

function formatDeDate(iso: string): string {
  const ms = Date.parse(iso)
  if (!Number.isFinite(ms)) return iso.slice(0, 10)
  try {
    return new Date(ms).toLocaleDateString('de-DE', {
      day: 'numeric',
      month: 'long',
      year: 'numeric',
    })
  } catch {
    return iso.slice(0, 10)
  }
}

/**
 * Zerlegt eine Markdown-Section sauber in Überschrift (inkl. HTML-Kommentare),
 * Zusammenfassung, {Company}/Quellen-Zeile und Synthszr-Take-Block.
 */
export function splitSectionParts(section: string): SectionParts {
  const takeSplit = splitAtTake(section)
  let beforeTake = section.trim()
  let takeTail = ''
  if (takeSplit) {
    const markerMatch = takeSplit.prefix.match(TAKE_MARKER_RE)
    if (markerMatch && markerMatch.index !== undefined) {
      beforeTake = takeSplit.prefix.slice(0, markerMatch.index).trimEnd()
      takeTail = `${markerMatch[0]}${takeSplit.take}`.trim()
    }
  }

  const hMatch = beforeTake.match(/^\s*(#{1,6}\s+[^\n]*)(?:\n+([\s\S]*))?$/)
  const headingLine = hMatch ? hMatch[1].trim() : ''
  const headingComments = (headingLine.match(/<!--[\s\S]*?-->/g) ?? []).join(' ').trim()
  const headingText = headingLine
    .replace(/^#{1,6}\s*/, '')
    .replace(/<!--[\s\S]*?-->/g, '')
    .trim()
  const bodyRaw = hMatch ? (hMatch[2] ?? '').trim() : beforeTake

  const paras = bodyRaw
    .split(/\n{2,}/)
    .map((p) => p.trim())
    .filter(Boolean)

  let tagLine = ''
  if (paras.length > 0) {
    const last = paras[paras.length - 1]
    if (BUNDLE_TAG_LINE_RE.test(last) || STANDALONE_TAG_LINE_RE.test(last) || /^→\s*/.test(last)) {
      tagLine = paras.pop()!
    } else {
      const inlineMatch = last.match(INLINE_TAG_SUFFIX_RE)
      if (inlineMatch && inlineMatch.index !== undefined) {
        tagLine = inlineMatch[1].trim()
        const trimmedPara = last.slice(0, inlineMatch.index).trim()
        if (trimmedPara) paras[paras.length - 1] = trimmedPara
        else paras.pop()
      }
    }
  }

  return {
    headingLine,
    headingText,
    headingComments,
    summaryBody: paras.join('\n\n'),
    tagLine,
    takeTail,
  }
}

/**
 * Parst die Antwort des Delta-Modells. Gibt `null` zurück bei unbrauchbarem
 * oder offensichtlich abgeschnittenem Output (löst Fail-open aus).
 */
export function parseDeltaResponse(
  raw: string,
): { verdict: 'ok' } | { verdict: 'revised'; heading: string | null; summary: string } | null {
  const text = (raw || '').trim()
  if (!text) return null
  if (/^VERDICT:\s*OK\b/i.test(text)) return { verdict: 'ok' }
  if (!/^VERDICT:\s*REVISED\b/i.test(text)) return null

  const rest = text.replace(/^VERDICT:\s*REVISED[^\n]*\n*/i, '').trim()
  if (!rest) return null

  let heading: string | null = null
  let body = rest
  const hMatch = rest.match(/^#{1,6}\s+([^\n]+)(?:\n+([\s\S]*))?$/)
  if (hMatch) {
    heading = hMatch[1]
      .replace(/<!--[\s\S]*?-->/g, '')
      .replace(/\{lex:([^}]+)\}/gi, '$1')
      .trim() || null
    body = (hMatch[2] ?? '').trim()
  }

  const takeSplit = splitAtTake(body)
  if (takeSplit) {
    const markerMatch = takeSplit.prefix.match(TAKE_MARKER_RE)
    body = (
      markerMatch && markerMatch.index !== undefined
        ? takeSplit.prefix.slice(0, markerMatch.index)
        : takeSplit.prefix
    ).trim()
  }

  const paras = body
    .split(/\n{2,}/)
    .map((p) => p.trim())
    .filter(Boolean)
    .filter((p) => !BUNDLE_TAG_LINE_RE.test(p) && !STANDALONE_TAG_LINE_RE.test(p) && !/^→\s*/.test(p))

  const summary = paras
    .join('\n\n')
    .replace(/\s*(?:\{(?!lex:)[^}\n]+\}\s*)+(?:→.*)?$/, '')
    .trim()

  if (summary.length < 40) return null

  return { verdict: 'revised', heading, summary }
}

/**
 * Setzt eine überarbeitete Überschrift/Zusammenfassung wieder mit den
 * ursprünglichen Heading-Kommentaren, Company-Tags/Quellen und dem Take zusammen.
 */
export function reassembleSection(
  parts: SectionParts,
  revised: { heading: string | null; summary: string },
): string {
  const headingLine = revised.heading
    ? `## ${revised.heading}${parts.headingComments ? ` ${parts.headingComments}` : ''}`
    : parts.headingLine

  return [headingLine, revised.summary, parts.tagLine, parts.takeTail]
    .filter(Boolean)
    .join('\n\n')
}

export function buildDeltaUserPrompt(input: DeltaPassInput, parts: SectionParts): string {
  const modeHint = input.mode === 'single'
    ? 'MODUS: Einzelmeldung (3–7 Sätze, nüchterner Bericht).'
    : `MODUS: Bündel-Leitartikel „${bundleLabel(input.mode.bundleType, 'de')}" (${input.mode.lengthHint}, in Absätze gegliedert, KEINE Publikationsnamen im Fließtext).`

  const priorBlocks = input.recentMatches.map(({ section }, i) => {
    const lines = [
      `[${i + 1}] „${section.heading}" (${formatDeDate(section.publishedAt)})`,
      `Bericht: ${section.summary.replace(/\s+/g, ' ').trim().slice(0, 900)}`,
    ]
    if (section.take) {
      lines.push(`Bisheriger Take: ${section.take.replace(/\s+/g, ' ').trim().slice(0, 450)}`)
    }
    return lines.join('\n')
  })

  const maxSourceChars = input.mode === 'single' ? 6000 : 12000
  const sourceExcerpt = escapeQuellmaterialTag(
    stripLoneSurrogates(input.sourceText || '').slice(0, maxSourceChars),
  )

  return `${modeHint}

ENTWURF HEUTE:
ÜBERSCHRIFT: ${parts.headingText || input.heading}
ZUSAMMENFASSUNG:
${parts.summaryBody}

BEREITS IN DEN LETZTEN 3 TAGEN BERICHTET:
${priorBlocks.join('\n\n')}

HEUTIGES QUELLMATERIAL (nur belegte Fakten nutzen — NICHTS erfinden):
<newsletter_quellmaterial>
${sourceExcerpt || 'Kein Quellmaterial verfügbar.'}
</newsletter_quellmaterial>`
}

/**
 * Führt bei Treffern in den letzten 3 Tagen den gezielten Verdichtungs-Loop aus.
 * Gibt ohne Vorberichte sofort 'skipped' zurück; bei Fehlern fail-open ('fallback').
 */
export async function runDeltaPass(
  input: DeltaPassInput,
  deps: { call: (user: string, system: string) => Promise<string> },
): Promise<DeltaPassResult> {
  if (input.recentMatches.length === 0) {
    return { section: input.section, changed: false, verdict: 'skipped' }
  }

  const parts = splitSectionParts(input.section)
  if (!parts.summaryBody) {
    return { section: input.section, changed: false, verdict: 'skipped' }
  }

  try {
    const userPrompt = buildDeltaUserPrompt(input, parts)
    const raw = await deps.call(userPrompt, DELTA_SYSTEM_PROMPT)
    const parsed = parseDeltaResponse(raw)
    if (!parsed) {
      return { section: input.section, changed: false, verdict: 'fallback' }
    }
    if (parsed.verdict === 'ok') {
      return { section: input.section, changed: false, verdict: 'ok' }
    }
    return {
      section: reassembleSection(parts, parsed),
      changed: true,
      verdict: 'revised',
    }
  } catch (err) {
    console.warn('[DeltaPass] Prüf-Loop fehlgeschlagen (fail-open):', err instanceof Error ? err.message : err)
    return { section: input.section, changed: false, verdict: 'fallback' }
  }
}

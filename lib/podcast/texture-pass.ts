/**
 * Texturdurchgang für das Podcast-Skript (Tonalität v2, Betreiber 2026-11-14).
 *
 * BEFUND der Testläufe: Das Skript traf Tonlage und Rollen der Vorbilder,
 * klang aber „zu poliert": eine Pointe in fast jedem Wechsel, kaum schlichte
 * Rückmeldungen, wiederkehrende Wendungen. Ein Skript, das in einem Durchgang
 * entsteht, wird glatter als ein mitgeschnittenes Gespräch. Dieser zweite
 * Aufruf (Use Case `podcast_texture`) bearbeitet deshalb nur die Oberfläche:
 * Pointen ausdünnen, verbrauchte Wendungen ersetzen, schlichte Rückmeldungen
 * einstreuen, natürliche Stolperer, Sprache nach Regie. Fakten, Zahlen,
 * Reihenfolge, Marker und Sprecher bleiben.
 *
 * Danach prüft `validateTexture` hart; schlägt die Prüfung fehl oder der
 * Aufruf scheitert, bleibt die erste Fassung (fail-soft, wie das Intermezzo).
 */
import type { WornOut } from '@/lib/podcast/fingerprint'

export type TextureLang = 'de' | 'en'

export interface TextureOptions {
  lang: TextureLang
  worn: WornOut
  /** Sprache des Tages aus der Regie (`coarsenessInstruction`). */
  coarseness: string
  /** Zeilen, die wörtlich bleiben müssen (Zitate aus ---MOMENTS---). */
  protectedQuotes?: string[]
  /**
   * Die Stilmittel der Tagesregie (`textureDeviceNotes`). Ohne diese Liste
   * hielt der Durchgang einen durchlaufenden Spitznamen für eine verbrauchte
   * Wendung und eine Pointe zu viel und strich ihn (Fünf-Folgen-Test
   * 2026-11-14: 13 von 15 Spitznamen weg).
   */
  devices?: string[]
}

export interface TextureResult {
  script: string
  applied: boolean
  problems: string[]
}

const MARKER_RE = /^\[\s*(ARTICLE\s+\d+|INTERMEZZO)\s*\]\s*$/i
const SPEECH_RE = /^(HOST|GUEST)(?: \(overlapping\))?: \[[^\[\]]+\] \S/
const GREETING_RE = {
  en: /Hey, Hey and welcome to Synthesizer Daily[^!\n]*!/,
  de: /Hey, Hey und Willkommen bei Synthesizer Daily[^!\n]*!/,
}

/** Trennt das Skript vom ---MOMENTS---Abschnitt (der bleibt unangetastet). */
export function splitMomentsSection(script: string): { body: string; moments: string | null } {
  const i = script.indexOf('---MOMENTS---')
  if (i === -1) return { body: script.trimEnd(), moments: null }
  return { body: script.slice(0, i).trimEnd(), moments: script.slice(i).trim() }
}

/** Zitate aus dem MOMENTS-Abschnitt; die Zeilen dazu ändert der Texturdurchgang nicht. */
export function quotesFromMoments(moments: string | null): string[] {
  if (!moments) return []
  return [...moments.matchAll(/"([^"]{8,})"/g)].map((m) => m[1].trim()).slice(0, 5)
}

function spokenText(body: string, joiner = ' '): string {
  return body
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => /^(HOST|GUEST)\b/i.test(l))
    .map((l) => l.replace(/^(HOST|GUEST)(?:\s*\(overlapping\))?\s*:\s*(?:\[[^\]]*\]\s*)?/i, ''))
    .join(joiner)
}

const wordCount = (s: string) => s.split(/\s+/).filter(Boolean).length

/** Alle Zahlen mit Ziffern, normalisiert („1,385" = „1385"). */
export function numbersIn(text: string): Set<string> {
  const out = new Set<string>()
  for (const m of text.matchAll(/\d[\d,.]*\d|\d/g)) out.add(m[0].replace(/,(?=\d{3}\b)/g, '').replace(/[.,]$/, ''))
  return out
}

function markers(body: string): string[] {
  return body.split('\n').map((l) => l.trim()).filter((l) => MARKER_RE.test(l)).map((l) => l.replace(/\s+/g, ' ').toUpperCase())
}

function sectionWords(body: string): number[] {
  const out: number[] = [0]
  for (const raw of body.split('\n')) {
    const l = raw.trim()
    if (/^\[\s*ARTICLE\s+\d+\s*\]$/i.test(l)) { out.push(0); continue }
    if (/^(HOST|GUEST)\b/i.test(l)) out[out.length - 1] += wordCount(spokenText(l))
  }
  return out
}

/** Entfernt eine Vorrede des Modells vor der ersten Skriptzeile. */
export function stripPreamble(text: string): string {
  const lines = text.replace(/\r/g, '').split('\n')
  const first = lines.findIndex((l) => /^(HOST|GUEST)\b/i.test(l.trim()) || MARKER_RE.test(l.trim()))
  const kept = first === -1 ? lines : lines.slice(first)
  // ein schließender Codeblock oder ein Nachsatz nach der letzten Zeile fällt weg
  let last = kept.length - 1
  while (last >= 0 && kept[last].trim() && !/^(HOST|GUEST)\b/i.test(kept[last].trim()) && !MARKER_RE.test(kept[last].trim())) last--
  return kept.slice(0, last + 1).join('\n').trim()
}

/**
 * Namen, die im Original mindestens zweimal mitten im Satz groß geschrieben
 * stehen (Personen, Firmen, Spitznamen der Tagesregie). Einmalige Namen, etwa
 * aus einem ausgedünnten Vergleich, zählen nicht. Nur Englisch: im Deutschen
 * steht jedes Substantiv groß.
 */
export function recurringNames(text: string): string[] {
  const counts = new Map<string, number>()
  // Zeilen getrennt halten: ein Zeilenanfang ist ein Satzanfang.
  for (const m of text.matchAll(/(?<=[\p{Ll}\d,;)'’-][ \t]+)(\p{Lu}[\p{L}'’-]*)/gu)) {
    const w = m[1].replace(/['’]s$/, '').replace(/[-'’]+$/, '')
    if (w.length < 3 || /^I['’]/.test(w)) continue
    counts.set(w, (counts.get(w) ?? 0) + 1)
  }
  return [...counts].filter(([, n]) => n >= 2).map(([w]) => w)
}

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/** Harte Prüfung der überarbeiteten Fassung gegen das Original. */
export function validateTexture(original: string, revised: string, lang: TextureLang, protectedQuotes: string[] = []): { ok: boolean; problems: string[] } {
  const problems: string[] = []
  if (!revised.trim()) return { ok: false, problems: ['leer'] }

  const lines = revised.split('\n').map((l) => l.trim()).filter(Boolean)
  const bad = lines.filter((l) => !MARKER_RE.test(l) && !SPEECH_RE.test(l))
  if (bad.length) problems.push(`Format: ${bad.length} Zeile(n) ohne Sprecher/Sprechanweisung, z. B. "${bad[0].slice(0, 60)}"`)
  const doubleBracket = lines.filter((l) => SPEECH_RE.test(l) && /\[/.test(l.replace(/^[^\]]*\]/, '')))
  if (doubleBracket.length) problems.push(`zweite Klammer in ${doubleBracket.length} Zeile(n)`)

  const mo = markers(original), mr = markers(revised)
  if (mo.join('|') !== mr.join('|')) problems.push(`Marker geändert (${mo.length} → ${mr.length})`)

  const greeting = original.match(GREETING_RE[lang])?.[0]
  if (greeting && !revised.includes(greeting)) problems.push('Begrüßungssatz verändert')

  const no = numbersIn(spokenText(original)), nr = numbersIn(spokenText(revised))
  const lost = [...no].filter((n) => !nr.has(n)), added = [...nr].filter((n) => !no.has(n))
  if (lost.length || added.length) problems.push(`Zahlen geändert (fehlen: ${lost.slice(0, 4).join(', ') || '-'}; neu: ${added.slice(0, 4).join(', ') || '-'})`)

  if (lang === 'en') {
    const revisedText = spokenText(revised)
    const lostNames = recurringNames(spokenText(original, '\n')).filter((n) => !new RegExp(`(?<![\\p{L}])${escapeRe(n)}(?![\\p{L}])`, 'iu').test(revisedText))
    if (lostNames.length) problems.push(`Namen fehlen: ${lostNames.slice(0, 4).join(', ')}`)
  }

  // Die langen Riffs sind das Markenzeichen der GUEST-Stimme. Im
  // Fünf-Folgen-Test (2026-11-14) teilte der Durchgang sie mit eingestreuten
  // Rückmeldungen in Hälften: drei Zeilen über 120 Wörter wurden zu null.
  const lineWords = (body: string) => body.split('\n').filter((l) => /^(HOST|GUEST)\b/i.test(l.trim())).map((l) => wordCount(spokenText(l)))
  const riffsO = lineWords(original).filter((n) => n > 100).length
  const riffsR = lineWords(revised).filter((n) => n >= 85).length
  if (riffsR < riffsO) problems.push(`lange Riffs geteilt (${riffsO} Zeilen über 100 Wörter, danach ${riffsR} über 85)`)

  const wo = wordCount(spokenText(original)), wr = wordCount(spokenText(revised))
  if (wo > 0 && (wr < wo * 0.88 || wr > wo * 1.12)) problems.push(`Länge ${wr} statt ${wo} Wörter (±12 % erlaubt)`)

  const lo = original.split('\n').filter((l) => /^(HOST|GUEST)\b/i.test(l.trim())).length
  const lr = lines.filter((l) => /^(HOST|GUEST)\b/i.test(l)).length
  // Eingestreute Rückmeldungen und geteilte Zeilen sind gewollt: bis zu 30 % oder 12 Zeilen mehr.
  if (lo > 0 && (lr < lo * 0.9 || lr > Math.max(lo * 1.3, lo + 12))) problems.push(`Zeilenzahl ${lr} statt ${lo}`)

  const so = sectionWords(original), sr = sectionWords(revised)
  if (so.length === sr.length) {
    so.forEach((w, i) => {
      if (w >= 60 && (sr[i] < w * 0.65 || sr[i] > w * 1.35)) problems.push(`Abschnitt ${i + 1}: ${sr[i]} statt ${w} Wörter`)
    })
  }

  for (const q of protectedQuotes) {
    if (original.includes(q) && !revised.includes(q)) problems.push(`geschützte Zeile verändert: "${q.slice(0, 40)}"`)
  }

  return { ok: problems.length === 0, problems }
}

export function buildTexturePrompt(script: string, opts: TextureOptions): { system: string; user: string } {
  const language = opts.lang === 'de' ? 'German' : 'English'
  const greeting = script.match(GREETING_RE[opts.lang])?.[0]
  const system = `You are the dialogue editor of a daily two-voice podcast script (HOST = Emma, GUEST = Synthesizer). The script is already written and fact-checked. Your only job is texture: make it sound like two people talking off the cuff, not like a polished sitcom. Return the complete revised script and nothing else.

KEEP EXACTLY (any change here makes your edit unusable):
- The language of the script (${language}), the speaker of every existing line, and the order of lines and stories.
- Every [ARTICLE N] marker line, unchanged and in place.${greeting ? `\n- The greeting sentence, verbatim: ${greeting}` : ''}
- Every fact, name and number: do not add, drop or change a single digit; keep every prediction and its date.
- The protected lines listed below, verbatim.${opts.devices?.length ? `\n- Today's deliberate devices (listed under TODAY'S DEVICES) and every line that carries them. A nickname or running gag that recurs on purpose is one of them, not worn wording; keep it every time it appears.` : ''}
- The format: every spoken line is \`HOST: [direction] text\` or \`GUEST: [direction] text\`, optionally with \` (overlapping)\` right after the speaker; exactly one bracket per line, at the start, in English.
- The total length, within ten percent.
- Every line of more than 100 words stays one unbroken line: the long riffs are the point. You may edit words inside it, never split it.

DO:
1. Thin out the punchlines: at most one crafted punchline or wordplay per story, not counting today's devices; turn the rest into plain talk or a pivot, or simply let the exchange stop.
2. Replace worn wording: the phrases and lines listed under WORN OUT, and any phrase, hand-off, transition or joke shape that appears more than twice in this script (today's devices excepted).
3. Insert three to six plain backchannel lines (one to three words, no joke) inside explanations of 40 to 100 words: split such a line into two lines of the same speaker and put the other speaker's short line in between, mid-thought.
4. Give most lines over 50 words one spoken mark: a restart, a self-correction, an aside, or a filler ("I mean,", "you know,", "look,", "like"); no filler more than five times in the script, never inside a number or a name. Never leave three balanced, finished sentences in a row.
5. Language today: ${opts.coarseness}
6. Vary voice directions that repeat more than three times; keep them as speech instructions (affect, tone, pacing).
7. Where a speaker labels their own move or stance instead of just making it (announcing a verdict, a crusade, a takeover, a tally or scoreboard), cut the label and keep the act. A game or segment may keep its name.

DO NOT add new jokes, topics, facts or sincere moments, and do not explain your changes.`

  const q = (xs: string[]) => xs.map((x) => `- ${x}`).join('\n')
  const parts: string[] = []
  const w = opts.worn
  if (w.phrases.length || w.shortLines.length || w.directions.length) {
    parts.push(`WORN OUT (recur across recent episodes, replace them):\n${q([...w.phrases, ...w.shortLines, ...w.directions])}`)
  }
  if (opts.devices?.length) parts.push(`TODAY'S DEVICES (deliberate; keep them and every line that carries them):\n${q(opts.devices)}`)
  if (opts.protectedQuotes?.length) parts.push(`PROTECTED LINES (keep verbatim):\n${q(opts.protectedQuotes)}`)
  parts.push(`SCRIPT:\n${script}`)
  return { system, user: parts.join('\n\n') }
}

/** Der Modellaufruf mit Prüfung; jede Panne ergibt die erste Fassung. */
export async function applyTexturePass(script: string, opts: TextureOptions): Promise<TextureResult> {
  if (!process.env.ANTHROPIC_API_KEY) return { script, applied: false, problems: ['kein ANTHROPIC_API_KEY'] }
  try {
    const Anthropic = (await import('@anthropic-ai/sdk')).default
    const { getModelForUseCase } = await import('@/lib/ai/model-config')
    const { withUsageLogging } = await import('@/lib/ai/usage-log')
    const { extractScriptText, fallbackModelFor, scriptRequestBudget, shouldRetryWithFallback } = await import('@/lib/podcast/script-diagnostics')
    const client = withUsageLogging(new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY, timeout: 300_000 }), 'podcast_texture')
    const model = await getModelForUseCase('podcast_texture')
    const { system, user } = buildTexturePrompt(script, opts)
    const maxTokens = Math.max(10_000, Math.round(wordCount(script) * 3))
    const call = (m: string) => client.messages.stream({
      model: m,
      system,
      messages: [{ role: 'user', content: user }],
      ...scriptRequestBudget(m, maxTokens),
    }).finalMessage()

    let message = await call(model)
    if (!extractScriptText(message).trim() && shouldRetryWithFallback(message)) {
      const fallback = fallbackModelFor(model)
      if (fallback) message = await call(fallback)
    }
    const revised = stripPreamble(extractScriptText(message))
    const check = validateTexture(script, revised, opts.lang, opts.protectedQuotes)
    if (!check.ok) {
      console.warn('[PodcastTexture] Fassung verworfen:', check.problems.join('; '))
      return { script, applied: false, problems: check.problems }
    }
    return { script: revised, applied: true, problems: [] }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.warn('[PodcastTexture] Durchgang fehlgeschlagen (erste Fassung bleibt):', msg)
    return { script, applied: false, problems: [msg] }
  }
}

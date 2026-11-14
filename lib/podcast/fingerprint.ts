/**
 * Fingerabdruck der letzten Folgen gegen Schablonen (Tonalität v2, 2026-11-14).
 *
 * BEFUND aus den Testläufen zur Tonalität v2: Jedes Stilmittel, das der Prompt
 * verlangt, kehrt als Schablone wieder („Yes. Yes, indeed.", „Moving on.",
 * dieselbe Übergabe-Frage), und zwar nicht nur innerhalb einer Folge, sondern
 * Folge für Folge. `recent-openings.ts` deckt nur Anfang und Ende ab; dieser
 * Fingerabdruck sieht das ganze Skript der letzten Folgen an und meldet, welche
 * Wendungen, Kurzzeilen und Sprechanweisungen sich über mehrere Folgen
 * wiederholen. Skript, Tagesregie und Texturdurchgang bekommen die Liste mit
 * dem Auftrag, frische Worte zu finden.
 *
 * Reine Textstatistik, kein Modellaufruf. Themenwörter fallen heraus:
 * n-Gramme mit Eigennamen (Wörter, die überwiegend groß geschrieben stehen)
 * oder Ziffern zählen nicht, sonst stünde „Jensen Huang" nach einer Woche
 * Nvidia-Drama als verbrauchte Wendung da. Der Wiedererkennungssatz ist Marke
 * und zählt ebenfalls nicht.
 *
 * KEINE neue Tabelle: Die Skripte liegen in `post_podcasts.script_content`.
 */
import type { createAdminClient } from '@/lib/supabase/admin'

type AdminClient = ReturnType<typeof createAdminClient>

export interface WornOut {
  /** Wendungen (3–5 Wörter), die in mehreren der letzten Folgen vorkommen. */
  phrases: string[]
  /** Kurze Zeilen (höchstens vier Wörter), die sich über Folgen wiederholen. */
  shortLines: string[]
  /** Sprechanweisungen, die in den letzten Folgen ständig vorkommen. */
  directions: string[]
}

export const EMPTY_WORN: WornOut = { phrases: [], shortLines: [], directions: [] }

const STOP = new Set([
  'the', 'a', 'an', 'and', 'or', 'but', 'to', 'of', 'in', 'on', 'for', 'is', 'it', "it's", 'that', "that's",
  'this', 'with', 'as', 'at', 'be', 'are', 'was', 'i', "i'm", 'you', "you're", 'we', 'he', 'she', 'they',
  'so', 'just', 'what', 'not', 'no', 'yes', 'do', 'if', 'about', 'from', 'by', 'his', 'her', 'its', 'our',
  'your', 'my', 'me', 'him', 'them', 'there', 'here', 'then', 'than', 'all', 'one', 'up', 'out', 'who',
  'how', 'why', 'when', 'which', 'can', 'will', 'would', 'could', 'should', 'has', 'have', 'had', 'been',
  'were', 'into', 'over', 'more', 'okay', 'oh', 'well', 'now', 'get', 'got', 'did', 'does', 'too', 'very',
  // deutsch, für das seltene deutsche Skript
  'der', 'die', 'das', 'und', 'oder', 'aber', 'zu', 'von', 'im', 'in', 'auf', 'für', 'ist', 'es', 'ich',
  'du', 'wir', 'er', 'sie', 'ein', 'eine', 'nicht', 'mit', 'den', 'dem', 'des', 'auch', 'so', 'ja', 'nein',
])

/** Ein-Wort-Rückmeldungen sind erwünscht, auch wenn sie sich wiederholen. */
const PLAIN_BACKCHANNELS = new Set([
  'yeah', 'right', 'yep', 'yes', 'no', 'okay', 'mm', 'mhm', 'hm', 'hmm', 'wait', 'sure', 'true', 'exactly',
  'agreed', 'ja', 'genau', 'jep', 'stimmt', 'nein', 'moment',
])

const GREETING_RE = /hey,? hey,? (and welcome to|und willkommen bei) synthesizer daily/i

interface SpokenLine { direction: string | null; text: string }

/** Gesprochene Zeilen eines Skripts, ohne Marker und ohne ---MOMENTS---. */
export function spokenLines(script: string): SpokenLine[] {
  const body = script.split('---MOMENTS---')[0]
  const out: SpokenLine[] = []
  for (const raw of body.split('\n')) {
    const m = raw.trim().match(/^(?:HOST|GUEST)(?:\s*\(overlapping\))?\s*:\s*(?:\[([^\]]*)\]\s*)?(.*)$/i)
    if (m && m[2].trim()) out.push({ direction: m[1]?.trim().toLowerCase() ?? null, text: m[2].trim() })
  }
  return out
}

function tokens(text: string): string[] {
  return text
    .replace(/[“”„"]/g, ' ')
    .split(/[^\p{L}\p{N}'’-]+/u)
    .map((t) => t.replace(/^['’-]+|['’-]+$/g, ''))
    .filter(Boolean)
}

function normalizeLine(text: string): string {
  return tokens(text).map((t) => t.toLowerCase()).join(' ')
}

/**
 * Fingerabdruck über mehrere Skripte (neueste zuerst). Ein Merkmal gilt als
 * verbraucht, wenn es in mindestens `minScripts` verschiedenen Folgen vorkommt
 * (Standard: 40 % der Folgen, mindestens zwei).
 */
export function computeWornOut(
  scripts: string[],
  opts: { minScripts?: number; maxPhrases?: number; maxShortLines?: number; maxDirections?: number; excludeText?: string } = {},
): WornOut {
  const usable = scripts.filter((s) => s && s.trim())
  if (usable.length < 2) return EMPTY_WORN
  const minScripts = opts.minScripts ?? Math.max(2, Math.ceil(usable.length * 0.4))
  const maxPhrases = opts.maxPhrases ?? 20
  const maxShortLines = opts.maxShortLines ?? 12
  const maxDirections = opts.maxDirections ?? 6

  // Eigennamen erkennen: Wörter, die überwiegend groß geschrieben vorkommen.
  const caseCount = new Map<string, { upper: number; total: number }>()
  const perScript = usable.map((s) => spokenLines(s).filter((l) => !GREETING_RE.test(l.text)))
  for (const lines of perScript) {
    for (const line of lines) {
      tokens(line.text).forEach((t, i) => {
        const key = t.toLowerCase()
        const c = caseCount.get(key) ?? { upper: 0, total: 0 }
        c.total += 1
        // Satzanfang zählt nicht als Großschreibung.
        if (i > 0 && /^\p{Lu}/u.test(t)) c.upper += 1
        caseCount.set(key, c)
      })
    }
  }
  const isProper = (t: string) => {
    if (t === 'i' || t.startsWith("i'")) return false
    const c = caseCount.get(t)
    return Boolean(c && c.total >= 2 && c.upper / c.total > 0.6)
  }

  // n-Gramme (3–5 Wörter) mit Dokumenthäufigkeit
  const df = new Map<string, number>()
  const shortDf = new Map<string, { n: number; sample: string }>()
  for (const lines of perScript) {
    const seen = new Set<string>()
    const seenShort = new Set<string>()
    for (const line of lines) {
      const toks = tokens(line.text).map((t) => t.toLowerCase())
      for (let n = 3; n <= 5; n++) {
        for (let i = 0; i + n <= toks.length; i++) {
          const gram = toks.slice(i, i + n)
          if (gram.some((t) => /\d/.test(t) || isProper(t))) continue
          if (gram.filter((t) => !STOP.has(t)).length < 2) continue
          const key = gram.join(' ')
          if (!seen.has(key)) { seen.add(key); df.set(key, (df.get(key) ?? 0) + 1) }
        }
      }
      if (toks.length > 0 && toks.length <= 4) {
        const key = normalizeLine(line.text)
        if (toks.length === 1 && PLAIN_BACKCHANNELS.has(key)) continue
        if (toks.every((t) => PLAIN_BACKCHANNELS.has(t))) continue
        if (!seenShort.has(key)) {
          seenShort.add(key)
          const prev = shortDf.get(key)
          shortDf.set(key, { n: (prev?.n ?? 0) + 1, sample: prev?.sample ?? line.text })
        }
      }
    }
  }

  // Wendungen aus dem heutigen Artikel sind Thema, nicht Stil (eine Geschichte,
  // die sich über Tage zieht, wiederholt dieselben Sachbegriffe).
  const exclude = opts.excludeText ? ` ${normalizeLine(opts.excludeText)} ` : ''

  // Längere Wendungen zuerst; Teilstücke einer behaltenen Wendung fallen weg.
  const candidates = [...df.entries()]
    .filter(([gram, n]) => n >= minScripts && !(exclude && exclude.includes(` ${gram} `)))
    .sort((a, b) => b[1] - a[1] || b[0].split(' ').length - a[0].split(' ').length || a[0].localeCompare(b[0]))
  const phrases: string[] = []
  for (const [gram] of candidates) {
    if (phrases.some((p) => p.includes(gram) || gram.includes(p))) continue
    phrases.push(gram)
    if (phrases.length >= maxPhrases) break
  }

  const shortLines = [...shortDf.values()]
    .filter((v) => v.n >= minScripts)
    .sort((a, b) => b.n - a.n || a.sample.localeCompare(b.sample))
    .slice(0, maxShortLines)
    .map((v) => v.sample)

  // Sprechanweisungen: in den letzten drei Folgen ständig dieselbe
  const dirCount = new Map<string, number>()
  for (const lines of perScript.slice(0, 3)) {
    for (const l of lines) if (l.direction) dirCount.set(l.direction, (dirCount.get(l.direction) ?? 0) + 1)
  }
  const directions = [...dirCount.entries()]
    .filter(([, n]) => n >= 8)
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, maxDirections)
    .map(([d]) => `[${d}]`)

  return { phrases, shortLines, directions }
}

/** Skripte der letzten Folgen (neueste zuerst), ohne den aktuellen Post. */
export async function loadRecentScripts(
  supabase: AdminClient,
  locale: string,
  count = 7,
  excludePostId?: string,
): Promise<string[]> {
  try {
    const { data, error } = await supabase
      .from('post_podcasts')
      .select('post_id, script_content')
      .eq('locale', locale)
      .not('script_content', 'is', null)
      .order('created_at', { ascending: false })
      .limit(count * 2)
    if (error) {
      console.warn('[PodcastFingerprint] Letzte Skripte nicht lesbar:', error.message)
      return []
    }
    const seen = new Set<string>()
    const out: string[] = []
    for (const row of (data ?? []) as Array<{ post_id: string | null; script_content: string | null }>) {
      if (!row.script_content || (excludePostId && row.post_id === excludePostId)) continue
      const key = row.post_id ?? `${out.length}`
      if (seen.has(key)) continue
      seen.add(key)
      out.push(row.script_content)
      if (out.length >= count) break
    }
    return out
  } catch (err) {
    console.warn('[PodcastFingerprint]', err instanceof Error ? err.message : err)
    return []
  }
}

/** Prompt-Abschnitt; leer, wenn nichts verbraucht ist. */
export function wornSection(worn: WornOut, lang: 'de' | 'en'): string {
  if (!worn.phrases.length && !worn.shortLines.length && !worn.directions.length) return ''
  const q = (xs: string[]) => xs.map((x) => `"${x}"`).join(', ')
  if (lang === 'de') {
    return `\n\n**VERBRAUCHT IN DEN LETZTEN FOLGEN, heute nicht verwenden:**
${worn.phrases.length ? `- Wendungen: ${q(worn.phrases)}\n` : ''}${worn.shortLines.length ? `- Kurzzeilen: ${q(worn.shortLines)}\n` : ''}${worn.directions.length ? `- Sprechanweisungen, heute andere wählen: ${worn.directions.join(', ')}\n` : ''}Finde frische Worte. Der Wiedererkennungssatz ist ausgenommen.`
  }
  return `\n\n**WORN OUT IN RECENT EPISODES, do not use today:**
${worn.phrases.length ? `- Phrases: ${q(worn.phrases)}\n` : ''}${worn.shortLines.length ? `- Short lines: ${q(worn.shortLines)}\n` : ''}${worn.directions.length ? `- Voice directions, pick different ones today: ${worn.directions.join(', ')}\n` : ''}Find fresh wording. The recognisable greeting is exempt.`
}

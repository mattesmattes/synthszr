/**
 * Jede Woche neue Arten anzufangen und aufzuhören.
 *
 * BETREIBER-VORGABE 2026-08-15: „keine feste anzahl 8/7 … sondern jede woche
 * neue intros und outros generiert werden".
 *
 * Die eingebauten Modi in openers.ts bleiben als RÜCKFALL bestehen — sie sind
 * jetzt der Notnagel, nicht der Normalfall. Vor dem ersten Lauf, bei einem
 * Modell-Ausfall oder wenn die gespeicherte Liste unbrauchbar ist, greifen sie.
 * Ein Podcast ohne Einstieg wäre der schlechtere Tausch.
 *
 * WARUM DAS ÜBERHAUPT NÖTIG IST: Eine feste Liste ist gegen Wiederholung nur so
 * lange wirksam, wie sie neu ist. Acht Einstiege sind nach acht Folgen einmal
 * durch und werden ab der neunten selbst zum Muster — dieselbe Falle wie zuvor
 * der eine feste Satz, nur acht Mal langsamer.
 */
import type { createAdminClient } from '@/lib/supabase/admin'
import { OPENERS, CLOSERS, type Mode } from '@/lib/podcast/openers'

type AdminClient = ReturnType<typeof createAdminClient>

export interface ModeSet {
  openers: Mode[]
  closers: Mode[]
  /** ISO-Datum des Montags, für den der Satz erzeugt wurde. */
  week: string
  generatedAt: string
}

const settingsKey = (lang: string) => `podcast_modes_${lang}`

/**
 * Wie viele Modi je Woche entstehen.
 *
 * Die Zahlen bleiben TEILERFREMD (9 und 7). Nicht aus Ästhetik: Bei gleich
 * langen Listen ist die Paarung aus Einstieg und Schluss für jede Folge fest —
 * jede „Widerspruch"-Folge endete immer gleich. So durchlaufen die beiden
 * Achsen erst nach 63 Folgen dieselbe Kombination wieder.
 */
const OPENER_COUNT = 9
const CLOSER_COUNT = 7

/** Der Montag der Woche, zu der ein Datum gehört — der Schlüssel eines Satzes. */
export function weekKey(d: Date): string {
  const x = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()))
  const wd = (x.getUTCDay() + 6) % 7 // Montag = 0
  x.setUTCDate(x.getUTCDate() - wd)
  return x.toISOString().slice(0, 10)
}

/**
 * Ist der gespeicherte Satz brauchbar?
 *
 * Streng geprüft, weil ein halb ausgefüllter Satz schlimmer wäre als keiner:
 * Fehlten die Schlüsse, endete jede Folge gleich, und niemand käme auf die
 * Idee, dass die Ursache in einer Einstellung liegt.
 */
export function isUsable(set: unknown): set is ModeSet {
  const s = set as ModeSet | null
  if (!s || !Array.isArray(s.openers) || !Array.isArray(s.closers)) return false
  if (s.openers.length < 3 || s.closers.length < 3) return false
  const ok = (m: Mode) => m && typeof m.key === 'string' && typeof m.instruction === 'string' && m.instruction.length > 30
  return s.openers.every(ok) && s.closers.every(ok)
}

/** Der aktuelle Satz — oder die eingebauten Modi als Rückfall. */
export async function loadModes(supabase: AdminClient, lang: string): Promise<{ set: ModeSet; fallback: boolean }> {
  const eingebaut: ModeSet = {
    openers: OPENERS, closers: CLOSERS,
    week: 'eingebaut', generatedAt: 'eingebaut',
  }
  try {
    const { data } = await supabase.from('settings').select('value').eq('key', settingsKey(lang)).maybeSingle()
    const raw = (data as { value?: unknown } | null)?.value
    const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw
    if (isUsable(parsed)) return { set: parsed, fallback: false }
  } catch (err) {
    console.warn('[PodcastModes] Satz nicht lesbar:', err instanceof Error ? err.message : err)
  }
  return { set: eingebaut, fallback: true }
}

const TOOL = {
  name: 'report_modes',
  description: 'Meldet die neuen Eroeffnungs- und Schluss-Arten',
  input_schema: {
    type: 'object' as const,
    properties: {
      openers: {
        type: 'array',
        items: {
          type: 'object',
          properties: { key: { type: 'string' }, instruction: { type: 'string' } },
          required: ['key', 'instruction'],
        },
      },
      closers: {
        type: 'array',
        items: {
          type: 'object',
          properties: { key: { type: 'string' }, instruction: { type: 'string' } },
          required: ['key', 'instruction'],
        },
      },
    },
    required: ['openers', 'closers'],
  },
}

export function buildModePrompt(vorher: Mode[], vorherClosers: Mode[], lang: string): string {
  const liste = (ms: Mode[]) => ms.map((m) => `- ${m.key}: ${m.instruction}`).join('\n')
  const sprache = lang === 'de' ? 'DEUTSCH' : 'ENGLISCH'

  return `Du entwirfst Regieanweisungen für einen täglichen KI-Nachrichten-Podcast ("Synthesizer Daily", HOST weiblich moderiert, GUEST ist ein KI-Analyst mit pointierten Meinungen).

Gesucht: ${OPENER_COUNT} Arten, eine Folge zu ERÖFFNEN, und ${CLOSER_COUNT} Arten, sie zu SCHLIESSEN — für die kommende Woche.

WAS EINE GUTE ANWEISUNG AUSMACHT:
- Sie beschreibt eine TECHNIK, keinen Wortlaut. Niemals einen Beispielsatz mitliefern: Der wird sonst wörtlich übernommen und ist nach drei Folgen verbraucht.
- Sie ist in einer Zeile ausführbar und lässt trotzdem Spielraum.
- Sie erzeugt eine BEWEGUNG (ein Streit, ein Rätsel, ein Rückgriff, ein Bruch) — nicht nur eine Stimmung.
- Sie funktioniert an jedem beliebigen Nachrichtentag, nicht nur bei einem bestimmten Thema.

HARTE REGELN:
- Die Eröffnung ersetzt NIE die Begrüßung. Der Wiedererkennungssatz ("Hey, Hey und Willkommen bei Synthesizer Daily…") wird immer NACHGESCHOBEN, spätestens nach etwa 30 Sekunden. Jede Eröffnungsanweisung muss dazu passen.
- Jede Schluss-Anweisung muss zwei Pflicht-Elemente vertragen: Hinweis auf morgen und die Bitte um Weiterempfehlung. Sie sagt, WIE die verpackt werden.
- Schreibe die Anweisungen auf ${sprache}.
- key: kurz, kleingeschrieben, mit Bindestrichen, ohne Umlaute.

DIESE ARTEN GAB ES ZULETZT — bringe NEUE, nicht Umformulierungen davon:
Eröffnungen:
${liste(vorher)}

Schlüsse:
${liste(vorherClosers)}

Ein paar dürfen thematisch verwandt sein, wenn die Technik wirklich anders ist. Reine Umbenennungen sind wertlos.

Antworte über das Tool.`
}

/**
 * Neue Modi erzeugen und speichern.
 *
 * Bei Fehlschlag bleibt der ALTE Satz stehen. Ihn zu löschen, weil ein Lauf
 * misslang, hieße auf die eingebauten Modi zurückzufallen — schlechter als eine
 * Woche mit den vorigen zu arbeiten.
 */
export async function refreshModes(
  supabase: AdminClient,
  lang: string,
  now: Date,
): Promise<{ status: 'created' | 'exists' | 'failed'; week: string; openers?: number; closers?: number; error?: string }> {
  const week = weekKey(now)
  const aktuell = await loadModes(supabase, lang)
  if (!aktuell.fallback && aktuell.set.week === week) {
    return { status: 'exists', week }
  }

  if (!process.env.ANTHROPIC_API_KEY) {
    return { status: 'failed', week, error: 'kein ANTHROPIC_API_KEY' }
  }

  try {
    const Anthropic = (await import('@anthropic-ai/sdk')).default
    const { getModelForUseCase } = await import('@/lib/ai/model-config')
    const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
    const model = await getModelForUseCase('ghostwriter')

    const resp = await client.messages.create({
      model,
      max_tokens: 4000,
      tools: [TOOL],
      tool_choice: { type: 'tool', name: TOOL.name },
      messages: [{ role: 'user', content: buildModePrompt(aktuell.set.openers, aktuell.set.closers, lang) }],
    })
    const block = resp.content.find((b) => b.type === 'tool_use')
    const input = block && 'input' in block ? (block.input as { openers?: Mode[]; closers?: Mode[] }) : null

    const neu: ModeSet = {
      openers: (input?.openers ?? []).slice(0, OPENER_COUNT),
      closers: (input?.closers ?? []).slice(0, CLOSER_COUNT),
      week,
      generatedAt: now.toISOString(),
    }
    if (!isUsable(neu)) {
      return { status: 'failed', week, error: 'Antwort unbrauchbar — alter Satz bleibt' }
    }

    const { error } = await supabase
      .from('settings')
      .upsert({ key: settingsKey(lang), value: neu }, { onConflict: 'key' })
    if (error) return { status: 'failed', week, error: error.message }

    return { status: 'created', week, openers: neu.openers.length, closers: neu.closers.length }
  } catch (err) {
    return { status: 'failed', week, error: err instanceof Error ? err.message : String(err) }
  }
}

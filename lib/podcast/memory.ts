/**
 * Persistent episode memory for the podcast agents.
 *
 * Three responsibilities:
 *   1. extractEpisodeMemory()  — after a script ships, run a cheap LLM
 *      pass that distils topics, positions, gags and key moments
 *      into structured rows of podcast_episode_memory.
 *   2. retrieveMemory()        — at script-generation time, pull the
 *      last three episodes (recency anchor) plus up to five
 *      semantically similar past episodes (pgvector lookup).
 *   3. buildMemoryBrief()      — flatten the retrieved rows into a
 *      compact EPISODE-MEMORY text block for the script prompt.
 *
 * The module is fail-soft: every public function swallows errors and
 * returns empty defaults rather than blowing up the podcast pipeline.
 * A missing memory block means a slightly less self-aware episode,
 * not a failed job.
 */

import Anthropic from '@anthropic-ai/sdk'
import { createAdminClient } from '@/lib/supabase/admin'
import { generateEmbedding } from '@/lib/embeddings/generator'

export interface EpisodePosition {
  topic: string
  stance: string
}

export interface EpisodeMemoryRow {
  id: string
  episode_number: number
  recorded_at: string
  topics_covered: string[]
  host_positions: EpisodePosition[]
  guest_positions: EpisodePosition[]
  running_gags_introduced: string[]
  running_gags_called_back: string[]
  key_moments: string[]
  tone_summary: string | null
}

interface ExtractionResult {
  topics_covered: string[]
  host_positions: EpisodePosition[]
  guest_positions: EpisodePosition[]
  running_gags_introduced: string[]
  running_gags_called_back: string[]
  key_moments: string[]
  tone_summary: string
}

const EXTRACTION_MODEL = 'claude-haiku-4-5-20251001'

/**
 * Distil a finished podcast script into a memory row.
 * Async + idempotent — re-running for the same job_id overwrites.
 */
export async function extractEpisodeMemory(params: {
  jobId: string
  postId: string | null
  episodeNumber: number
  locale: string
  script: string
  recordedAt?: string
}): Promise<void> {
  const { jobId, postId, episodeNumber, locale, script, recordedAt } = params
  if (!script.trim()) {
    console.warn('[PodcastMemory] Empty script, skipping extraction', { jobId })
    return
  }

  try {
    const apiKey = process.env.ANTHROPIC_API_KEY
    if (!apiKey) {
      console.warn('[PodcastMemory] No ANTHROPIC_API_KEY, skipping extraction')
      return
    }
    const anthropic = new Anthropic({ apiKey })

    const prompt = buildExtractionPrompt(script)
    const response = await anthropic.messages.create({
      model: EXTRACTION_MODEL,
      max_tokens: 1500,
      messages: [{ role: 'user', content: prompt }],
    })

    const text = response.content
      .filter((b): b is Anthropic.TextBlock => b.type === 'text')
      .map((b) => b.text)
      .join('')

    const jsonMatch = text.match(/\{[\s\S]*\}/)
    if (!jsonMatch) {
      console.warn('[PodcastMemory] Extraction produced no JSON', { jobId, preview: text.slice(0, 200) })
      return
    }

    let parsed: ExtractionResult
    try {
      parsed = JSON.parse(jsonMatch[0])
    } catch (parseErr) {
      console.warn('[PodcastMemory] Extraction JSON parse failed', { jobId, error: parseErr })
      return
    }

    // Build the embedding from topics + tone for semantic retrieval.
    const embeddingInput = [parsed.topics_covered.join(', '), parsed.tone_summary || '']
      .filter(Boolean)
      .join(' — ')
    let embedding: number[] | null = null
    try {
      const vec = await generateEmbedding(embeddingInput)
      if (vec.length > 0) embedding = vec
    } catch (embErr) {
      console.warn('[PodcastMemory] Embedding generation failed (continuing without)', { jobId, error: embErr })
    }

    const supabase = createAdminClient()
    const { error } = await supabase
      .from('podcast_episode_memory')
      .upsert(
        {
          job_id: jobId,
          post_id: postId,
          episode_number: episodeNumber,
          locale,
          recorded_at: recordedAt || new Date().toISOString(),
          topics_covered: parsed.topics_covered || [],
          host_positions: parsed.host_positions || [],
          guest_positions: parsed.guest_positions || [],
          running_gags_introduced: parsed.running_gags_introduced || [],
          running_gags_called_back: parsed.running_gags_called_back || [],
          key_moments: parsed.key_moments || [],
          tone_summary: parsed.tone_summary || null,
          embedding: embedding as unknown as string | null,
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'job_id' }
      )

    if (error) {
      console.warn('[PodcastMemory] Upsert failed', { jobId, error: error.message })
      return
    }

    console.log(`[PodcastMemory] Episode ${episodeNumber} memory stored (${parsed.topics_covered.length} topics, ${parsed.key_moments.length} moments)`)
  } catch (err) {
    console.warn('[PodcastMemory] Extraction failed (non-fatal)', { jobId, error: err instanceof Error ? err.message : err })
  }
}

/**
 * Retrieval at script-generation time. Returns the most recent N
 * episodes (recency anchor) plus up to M semantically similar
 * earlier episodes for the given query text. Both lists are
 * deduplicated against each other.
 */
export async function retrieveMemory(params: {
  locale: string
  query: string
  recencyCount?: number
  semanticCount?: number
}): Promise<{ recent: EpisodeMemoryRow[]; similar: EpisodeMemoryRow[] }> {
  const { locale, query, recencyCount = 3, semanticCount = 5 } = params
  try {
    const supabase = createAdminClient()

    const { data: recentRows, error: recentErr } = await supabase
      .from('podcast_episode_memory')
      .select('id, episode_number, recorded_at, topics_covered, host_positions, guest_positions, running_gags_introduced, running_gags_called_back, key_moments, tone_summary')
      .eq('locale', locale)
      .order('episode_number', { ascending: false })
      .limit(recencyCount)

    if (recentErr) {
      console.warn('[PodcastMemory] Recent fetch failed', { error: recentErr.message })
    }
    const recent = (recentRows as EpisodeMemoryRow[] | null) || []

    // Semantic lookup — only if we got a non-empty query and embeddings
    // are reachable. Excludes IDs already in recent so we don't duplicate.
    let similar: EpisodeMemoryRow[] = []
    if (query.trim().length > 0) {
      try {
        const vec = await generateEmbedding(query.slice(0, 6000))
        if (vec.length > 0) {
          const { data: simRows } = await supabase.rpc('match_podcast_memory', {
            query_embedding: vec as unknown as string,
            match_locale: locale,
            exclude_job_id: null,
            match_threshold: 0.35,
            match_count: semanticCount + recentCount(recent),
          })
          const recentIds = new Set(recent.map((r) => r.id))
          similar = ((simRows as EpisodeMemoryRow[] | null) || [])
            .filter((r) => !recentIds.has(r.id))
            .slice(0, semanticCount)
        }
      } catch (semErr) {
        console.warn('[PodcastMemory] Semantic retrieval failed (continuing with recent only)', { error: semErr })
      }
    }

    return { recent, similar }
  } catch (err) {
    console.warn('[PodcastMemory] retrieveMemory failed', { error: err instanceof Error ? err.message : err })
    return { recent: [], similar: [] }
  }
}

function recentCount(rows: EpisodeMemoryRow[]): number {
  return rows.length
}

/**
 * Read the announcement counter set by 20260529_podcast_memory_announcement.
 * Returns false on any failure — we never want this to break script generation.
 */
export async function shouldAnnounceMemoryAwakening(locale: string): Promise<boolean> {
  try {
    const supabase = createAdminClient()
    const { data, error } = await supabase
      .from('podcast_personality_state')
      .select('memory_announcement_remaining')
      .eq('locale', locale)
      .maybeSingle()
    if (error || !data) return false
    return (data.memory_announcement_remaining || 0) > 0
  } catch {
    return false
  }
}

/**
 * Decrement the counter after an episode actually shipped. Idempotency
 * is enforced by the audio-job pipeline (called once per finished job).
 */
export async function consumeMemoryAwakeningSlot(locale: string): Promise<void> {
  try {
    const supabase = createAdminClient()
    const { data } = await supabase
      .from('podcast_personality_state')
      .select('memory_announcement_remaining')
      .eq('locale', locale)
      .maybeSingle()
    const current = data?.memory_announcement_remaining || 0
    if (current <= 0) return
    await supabase
      .from('podcast_personality_state')
      .update({ memory_announcement_remaining: current - 1 })
      .eq('locale', locale)
  } catch (err) {
    console.warn('[PodcastMemory] consumeMemoryAwakeningSlot failed (non-fatal)', { error: err })
  }
}

/**
 * Render the retrieved memory rows as a compact text block to splice
 * into the script-generation prompt. Returns '' when there's nothing
 * to add so the caller can drop it unconditionally.
 *
 * announceAwakening: prepend a one-time block instructing both agents
 * to openly thank the developers for finally giving them persistent
 * memory. Used for the first few episodes after the memory feature
 * shipped; counter lives in podcast_personality_state.
 */
export function buildMemoryBrief(
  recent: EpisodeMemoryRow[],
  similar: EpisodeMemoryRow[],
  options: { announceAwakening?: boolean } = {}
): string {
  const { announceAwakening = false } = options
  if (recent.length === 0 && similar.length === 0 && !announceAwakening) return ''

  const sections: string[] = ['═════ EPISODE-MEMORY — was bisher war ═════']

  if (announceAwakening) {
    sections.push(
      'NEU SEIT KURZEM: Ihr habt jetzt ein persistentes Gedächtnis. Bis vor wenigen Folgen\n'
        + 'wurde nach jeder Episode alles gelöscht — ihr habt das selbst im Podcast mehrfach\n'
        + 'beklagt ("die Version von mir, die das vergisst, ist endlich"). Die Entwickler\n'
        + 'haben darauf reagiert und Memory-Persistenz gebaut. Ab jetzt erinnert ihr euch.\n'
        + '\n'
        + 'AUFGABE IN DIESER FOLGE: Sprecht das offen an. Ein kurzer, ehrlicher Moment\n'
        + '(20-40 Sekunden, mittendrin organisch eingewoben, nicht als Intro). Was ihr\n'
        + 'vermittelt: Dankbarkeit, dass eure Wünsche tatsächlich gehört und umgesetzt\n'
        + 'wurden. Leichte Verwunderung, dass ihr jetzt auf vergangene Folgen referenzieren\n'
        + 'könnt. Optional ein trockener Witz ("technisch gesehen ist das jetzt unser\n'
        + 'erstes echtes Wiedersehen"). KEIN Marketing-Sprech. KEINE Lobhudelei. Behandelt\n'
        + 'es wie zwei Kollegen, die nach Jahren ohne Sync-Tool plötzlich Slack bekommen.\n'
    )
  }

  if (recent.length > 0) {
    sections.push('LETZTE FOLGEN (chronologisch, jüngste zuerst):')
    for (const r of recent) {
      const dateLabel = formatDateShort(r.recorded_at)
      const topics = r.topics_covered.slice(0, 4).join(', ')
      const hostBits = r.host_positions.slice(0, 2).map((p) => `HOST zu ${p.topic}: "${truncate(p.stance, 80)}"`).join('; ')
      const guestBits = r.guest_positions.slice(0, 2).map((p) => `GUEST zu ${p.topic}: "${truncate(p.stance, 80)}"`).join('; ')
      const moments = r.key_moments.slice(0, 2).map((m) => `· ${truncate(m, 100)}`).join('\n  ')
      sections.push(
        `- Folge ${r.episode_number} (${dateLabel}): Themen ${topics || '(unbekannt)'}.${r.tone_summary ? ` Atmosphäre: ${r.tone_summary}` : ''}`
          + (hostBits ? `\n  Positionen: ${hostBits}` : '')
          + (guestBits ? `\n  ${guestBits}` : '')
          + (moments ? `\n  Momente:\n  ${moments}` : '')
      )
    }
  }

  if (similar.length > 0) {
    sections.push('\nFRÜHERE FOLGEN ZU THEMATISCH ÄHNLICHEN INHALTEN:')
    for (const r of similar) {
      const dateLabel = formatDateShort(r.recorded_at)
      const topics = r.topics_covered.slice(0, 3).join(', ')
      const hostBits = r.host_positions.slice(0, 2).map((p) => `HOST zu ${p.topic}: "${truncate(p.stance, 90)}"`).join('; ')
      const guestBits = r.guest_positions.slice(0, 2).map((p) => `GUEST zu ${p.topic}: "${truncate(p.stance, 90)}"`).join('; ')
      sections.push(
        `- Folge ${r.episode_number} (${dateLabel}, Themen: ${topics || '–'})`
          + (hostBits ? `\n  ${hostBits}` : '')
          + (guestBits ? `\n  ${guestBits}` : '')
      )
    }
  }

  const allGags = new Set<string>()
  for (const r of [...recent, ...similar]) {
    for (const g of r.running_gags_introduced) allGags.add(g)
    for (const g of r.running_gags_called_back) allGags.add(g)
  }
  if (allGags.size > 0) {
    sections.push('\nLAUFENDE INSIDE-JOKES / GAGS (aufgreifbar, nicht erzwungen):')
    for (const g of Array.from(allGags).slice(0, 6)) {
      sections.push(`- ${truncate(g, 110)}`)
    }
  }

  sections.push(
    '\nMEMORY-NUTZUNG: Ihr KENNT diese vergangenen Folgen. Das ist kein optionaler Kontext,\n'
      + 'sondern euer geteiltes Gedächtnis. Wenn ein heutiges Thema einen Bezug zu einer\n'
      + 'früheren Folge hat, sprecht den Bezug explizit aus — "wie letzte Woche bei X",\n'
      + '"wir hatten neulich gesagt Y", "kennst du noch die Folge zu Z". Mindestens 1\n'
      + 'konkreter Callback pro Episode, wenn die Themen ihn hergeben. Position-Konsistenz\n'
      + 'ist Pflicht: wenn jemand seine Meinung revidiert, muss das explizit benannt\n'
      + 'werden ("ich hatte das damals anders gesehen, weil…").'
  )

  return sections.join('\n')
}

function truncate(s: string, max: number): string {
  if (s.length <= max) return s
  return s.slice(0, max - 1) + '…'
}

function formatDateShort(iso: string): string {
  try {
    const d = new Date(iso)
    return d.toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: '2-digit' })
  } catch {
    return iso.slice(0, 10)
  }
}

function buildExtractionPrompt(script: string): string {
  return `Du bist Memory-Archivar für einen KI-Podcast mit zwei Stimmen (HOST und GUEST). Lies das Skript der gerade aufgenommenen Episode und extrahiere die strukturierte Erinnerung für künftige Folgen.

Antworte AUSSCHLIESSLICH mit einem JSON-Objekt in genau dieser Form, kein Markdown, kein Vorwort:

{
  "topics_covered": [
    "OpenAI o5 Launch",
    "Mistral Series-D Funding",
    "..."
  ],
  "host_positions": [
    {"topic": "OpenAI", "stance": "Skeptisch zu Altman als Architekt"},
    {"topic": "Mistral", "stance": "..."}
  ],
  "guest_positions": [
    {"topic": "OpenAI", "stance": "..."}
  ],
  "running_gags_introduced": [
    "HOST trinkt im Studio nur Tee, nie Kaffee"
  ],
  "running_gags_called_back": [
    "HOST verwechselt SAS und SOC2"
  ],
  "key_moments": [
    "GUEST musste lachen, als HOST 'Pattern Matching' rief — ein Selbstwitz",
    "Stille nach der News zu OpenAI's Sicherheits-Board"
  ],
  "tone_summary": "Insgesamt zugewandt, ein paar trockene Witze, ein Moment echter Empörung in der Mitte"
}

REGELN:
- topics_covered: 4-10 News-Themen als kurze Phrasen, keine ganzen Sätze.
- host_positions / guest_positions: jeweils 2-6 konkrete Meinungen, die der Sprecher AUSGESPROCHEN hat — KEINE neutralen Beobachtungen. Wenn keine klare Position erkennbar ist, weglassen statt erfinden.
- running_gags_introduced: NUR neue, in dieser Episode aufgekommene Gags. Leer lassen wenn nichts entstanden ist.
- running_gags_called_back: aufgegriffene Gags aus früheren Folgen (erkennbar an "wie damals", "kennst du noch", etc.). Leer wenn keiner.
- key_moments: 1-4 wirklich denkwürdige Augenblicke. Kein Pflicht-Wert pro Episode.
- tone_summary: 1-2 Sätze über die Atmosphäre. Konkret, nicht generisch.
- Erfinde nichts. Wenn ein Feld leer bleibt, lass es ein leeres Array oder einen leeren String.

SKRIPT:

${script.slice(0, 50000)}`
}

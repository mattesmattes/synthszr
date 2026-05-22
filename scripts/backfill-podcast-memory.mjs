/**
 * Backfill podcast_episode_memory for every completed podcast_jobs row.
 *
 * Idempotent: re-running upserts on (job_id), so partial reruns are
 * safe. Skips jobs that already have a memory row unless --force is
 * passed.
 *
 * Run:
 *   NEXT_PUBLIC_SUPABASE_URL=https://… \
 *   ANTHROPIC_API_KEY=… \
 *   GOOGLE_GENERATIVE_AI_API_KEY=… \
 *     node --env-file=.env.local scripts/backfill-podcast-memory.mjs
 *
 * Cost estimate: ~$0.005 per episode via Haiku.
 */

import { createClient } from '@supabase/supabase-js'
import Anthropic from '@anthropic-ai/sdk'
import { GoogleGenerativeAI } from '@google/generative-ai'

const url = (process.env.NEXT_PUBLIC_SUPABASE_URL || '').trim()
const supabaseKey = (process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim()
const anthropicKey = (process.env.ANTHROPIC_API_KEY || '').trim()
const geminiKey = (process.env.GOOGLE_GENERATIVE_AI_API_KEY || '').trim()

if (!url || !supabaseKey || !anthropicKey || !geminiKey) {
  console.error('Missing env. Need NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, ANTHROPIC_API_KEY, GOOGLE_GENERATIVE_AI_API_KEY')
  process.exit(1)
}

const supabase = createClient(url, supabaseKey)
const anthropic = new Anthropic({ apiKey: anthropicKey })
const genAI = new GoogleGenerativeAI(geminiKey)

const force = process.argv.includes('--force')
const EXTRACTION_MODEL = 'claude-haiku-4-5-20251001'

const LOCALE_TO_TTS_LANG = { de: 'de', en: 'en', cs: 'en', nds: 'en' }

function buildExtractionPrompt(script) {
  return `Du bist Memory-Archivar für einen KI-Podcast mit zwei Stimmen (HOST und GUEST). Lies das Skript der gerade aufgenommenen Episode und extrahiere die strukturierte Erinnerung für künftige Folgen.

Antworte AUSSCHLIESSLICH mit einem JSON-Objekt in genau dieser Form, kein Markdown, kein Vorwort:

{
  "topics_covered": ["OpenAI o5 Launch", "Mistral Series-D Funding", "..."],
  "host_positions": [{"topic": "OpenAI", "stance": "Skeptisch zu Altman als Architekt"}, {"topic": "Mistral", "stance": "..."}],
  "guest_positions": [{"topic": "OpenAI", "stance": "..."}],
  "running_gags_introduced": ["HOST trinkt im Studio nur Tee, nie Kaffee"],
  "running_gags_called_back": ["HOST verwechselt SAS und SOC2"],
  "key_moments": ["GUEST musste lachen, als HOST 'Pattern Matching' rief"],
  "tone_summary": "Insgesamt zugewandt, ein paar trockene Witze, ein Moment echter Empörung in der Mitte"
}

REGELN:
- topics_covered: 4-10 News-Themen als kurze Phrasen, keine ganzen Sätze.
- host_positions / guest_positions: jeweils 2-6 konkrete Meinungen. Wenn keine klare Position erkennbar ist, weglassen statt erfinden.
- running_gags_introduced: NUR neue, in dieser Episode aufgekommene Gags. Leer wenn nichts entstand.
- running_gags_called_back: aufgegriffene Gags aus früheren Folgen. Leer wenn keiner.
- key_moments: 1-4 wirklich denkwürdige Augenblicke. Kein Pflicht-Wert pro Episode.
- tone_summary: 1-2 Sätze über die Atmosphäre. Konkret, nicht generisch.
- Erfinde nichts. Lass Felder leer wenn nicht erkennbar.

SKRIPT:

${script.slice(0, 50000)}`
}

async function extract(script) {
  const response = await anthropic.messages.create({
    model: EXTRACTION_MODEL,
    max_tokens: 1500,
    messages: [{ role: 'user', content: buildExtractionPrompt(script) }],
  })
  const text = response.content.filter((b) => b.type === 'text').map((b) => b.text).join('')
  const jsonMatch = text.match(/\{[\s\S]*\}/)
  if (!jsonMatch) throw new Error('No JSON in extraction output')
  return JSON.parse(jsonMatch[0])
}

async function embed(text) {
  if (!text.trim()) return null
  const model = genAI.getGenerativeModel({ model: 'gemini-embedding-001' })
  const result = await model.embedContent(text.slice(0, 6000))
  const v = result.embedding?.values
  return v && v.length > 0 ? v : null
}

async function main() {
  // 1. List completed jobs, oldest first
  const { data: jobs, error: jobsErr } = await supabase
    .from('podcast_jobs')
    .select('id, post_id, source_locale, script, completed_at')
    .eq('status', 'completed')
    .not('script', 'is', null)
    .order('created_at', { ascending: true })

  if (jobsErr) {
    console.error('Failed to list jobs:', jobsErr.message)
    process.exit(1)
  }
  console.log(`Found ${jobs.length} completed jobs with script content`)

  // 2. Skip jobs that already have memory (unless --force)
  let existingIds = new Set()
  if (!force) {
    const { data: existing } = await supabase
      .from('podcast_episode_memory')
      .select('job_id')
      .not('job_id', 'is', null)
    existingIds = new Set((existing || []).map((r) => r.job_id))
    console.log(`Already have memory for ${existingIds.size} jobs — skipping (use --force to re-extract)`)
  }

  const todo = jobs.filter((j) => !existingIds.has(j.id))
  console.log(`Backfill target: ${todo.length} jobs`)

  let episodeNumber = 0
  for (let i = 0; i < todo.length; i++) {
    const job = todo[i]
    episodeNumber++
    const locale = LOCALE_TO_TTS_LANG[job.source_locale] || 'de'

    process.stdout.write(`[${i + 1}/${todo.length}] Job ${job.id.slice(0, 8)}…  `)

    try {
      const memory = await extract(job.script)
      const embeddingInput = [memory.topics_covered?.join(', '), memory.tone_summary || ''].filter(Boolean).join(' — ')
      const embedding = await embed(embeddingInput)

      const { error: upsertErr } = await supabase
        .from('podcast_episode_memory')
        .upsert(
          {
            job_id: job.id,
            post_id: job.post_id,
            episode_number: episodeNumber,
            locale,
            recorded_at: job.completed_at || new Date().toISOString(),
            topics_covered: memory.topics_covered || [],
            host_positions: memory.host_positions || [],
            guest_positions: memory.guest_positions || [],
            running_gags_introduced: memory.running_gags_introduced || [],
            running_gags_called_back: memory.running_gags_called_back || [],
            key_moments: memory.key_moments || [],
            tone_summary: memory.tone_summary || null,
            embedding,
            updated_at: new Date().toISOString(),
          },
          { onConflict: 'job_id' }
        )

      if (upsertErr) {
        console.log(`upsert error: ${upsertErr.message}`)
      } else {
        console.log(`OK — ${memory.topics_covered?.length || 0} topics, ${memory.key_moments?.length || 0} moments`)
      }

      // Rate-limit: short sleep between calls so we don't hammer
      await new Promise((r) => setTimeout(r, 200))
    } catch (err) {
      console.log(`FAILED: ${err.message}`)
    }
  }

  console.log('Backfill complete.')
}

main().catch((err) => {
  console.error('Fatal:', err)
  process.exit(1)
})

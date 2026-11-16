import { NextRequest, NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/auth/session'
import { createAdminClient } from '@/lib/supabase/admin'
import { parseScriptText } from '@/lib/tts/elevenlabs-tts'
import { isGeminiTTSModel, isGeminiVoice } from '@/lib/tts/gemini-voices'
import { renderLine } from '@/lib/tts/render-line'
import { isSpeakable, prepareLineForTTS, type TTSProviderId } from '@/lib/tts/line-delivery'

/**
 * Stimmtest im Podcast Studio (Tab „Stimmtest“, seit 2026-11-16).
 *
 * GET                      → die letzten Folgen mit Skript (Titel, Datum, Zeilen)
 * GET ?postId=&locale=     → das Skript dieser Folge
 * POST {provider, model, voice, text, withDirection}
 *                          → eine Skriptzeile vertonen, genau wie im Audio-Job
 *                            (lib/tts/render-line.ts), Antwort als Base64
 *
 * Nur Admin; schreibt nichts in die Datenbank.
 */

export const maxDuration = 300

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const LOCALES = new Set(['de', 'en', 'cs', 'nds'])
const OPENAI_MODELS = new Set(['tts-1', 'tts-1-hd', 'gpt-4o-mini-tts'])
const OPENAI_VOICES = new Set(['alloy', 'echo', 'fable', 'nova', 'onyx', 'shimmer', 'coral', 'ash', 'sage', 'ballad', 'verse', 'marin', 'cedar'])
const MAX_TEXT_CHARS = 3000
const LIST_LIMIT = 15

type AdminClient = ReturnType<typeof createAdminClient>

async function loadTitles(supabase: AdminClient, ids: string[]): Promise<Map<string, string>> {
  const titles = new Map<string, string>()
  if (ids.length === 0) return titles
  const { data: generated } = await supabase.from('generated_posts').select('id, title').in('id', ids)
  for (const row of generated ?? []) if (row.title) titles.set(row.id, row.title)
  const missing = ids.filter((id) => !titles.has(id))
  if (missing.length > 0) {
    const { data: manual } = await supabase.from('posts').select('id, title').in('id', missing)
    for (const row of manual ?? []) if (row.title) titles.set(row.id, row.title)
  }
  return titles
}

export async function GET(request: NextRequest) {
  const authError = await requireAdmin(request)
  if (authError) return authError

  const supabase = createAdminClient()
  const postId = request.nextUrl.searchParams.get('postId')
  const locale = request.nextUrl.searchParams.get('locale') ?? 'en'

  if (postId) {
    if (!UUID_RE.test(postId) || !LOCALES.has(locale)) {
      return NextResponse.json({ error: 'Ungültige Folge' }, { status: 400 })
    }
    const { data, error } = await supabase
      .from('post_podcasts')
      .select('script_content, created_at')
      .eq('post_id', postId)
      .eq('locale', locale)
      .maybeSingle()
    if (error || !data?.script_content) {
      return NextResponse.json({ error: 'Kein Skript für diese Folge' }, { status: 404 })
    }
    const titles = await loadTitles(supabase, [postId])
    return NextResponse.json({ postId, locale, title: titles.get(postId) ?? null, createdAt: data.created_at, script: data.script_content })
  }

  // Alle vier Sprachzeilen tragen meist dasselbe Skript: je Post die englische
  // Zeile, sonst die erste vorhandene.
  const { data, error } = await supabase
    .from('post_podcasts')
    .select('post_id, locale, script_content, duration_seconds, created_at')
    .not('script_content', 'is', null)
    .order('created_at', { ascending: false })
    .limit(LIST_LIMIT * 4)
  if (error) {
    return NextResponse.json({ error: 'Folgen konnten nicht geladen werden' }, { status: 500 })
  }

  const byPost = new Map<string, NonNullable<typeof data>[number]>()
  for (const row of data ?? []) {
    const current = byPost.get(row.post_id)
    if (!current || (row.locale === 'en' && current.locale !== 'en')) byPost.set(row.post_id, row)
  }
  const rows = [...byPost.values()].slice(0, LIST_LIMIT)
  const titles = await loadTitles(supabase, rows.map((r) => r.post_id))

  return NextResponse.json({
    scripts: rows.map((row) => ({
      postId: row.post_id,
      locale: row.locale,
      title: titles.get(row.post_id) ?? null,
      createdAt: row.created_at,
      durationSeconds: row.duration_seconds,
      lines: parseScriptText(row.script_content ?? '').length,
    })),
  })
}

interface RenderRequest {
  provider?: string
  model?: string
  voice?: string
  text?: string
  withDirection?: boolean
}

export async function POST(request: NextRequest) {
  const authError = await requireAdmin(request)
  if (authError) return authError

  const body = (await request.json().catch(() => ({}))) as RenderRequest
  const provider = body.provider as TTSProviderId
  const text = typeof body.text === 'string' ? body.text.trim() : ''

  if (provider !== 'openai' && provider !== 'gemini') {
    return NextResponse.json({ error: 'Unbekannter Anbieter' }, { status: 400 })
  }
  if (!text || text.length > MAX_TEXT_CHARS) {
    return NextResponse.json({ error: `Text muss 1 bis ${MAX_TEXT_CHARS} Zeichen haben` }, { status: 400 })
  }
  const modelOk = provider === 'gemini' ? isGeminiTTSModel(body.model) : OPENAI_MODELS.has(body.model ?? '')
  if (!modelOk) {
    return NextResponse.json({ error: 'Unbekanntes Modell' }, { status: 400 })
  }
  const voiceOk = provider === 'gemini' ? isGeminiVoice(body.voice) : OPENAI_VOICES.has(body.voice ?? '')
  if (!voiceOk || !body.voice) {
    return NextResponse.json({ error: 'Unbekannte Stimme' }, { status: 400 })
  }

  const input = { provider, model: body.model, voice: body.voice, text, withDirection: body.withDirection !== false }
  const delivery = prepareLineForTTS({ provider, model: body.model ?? '', text, withDirection: input.withDirection })
  if (!isSpeakable(delivery)) {
    return NextResponse.json({ error: 'Die Zeile enthält keinen gesprochenen Text' }, { status: 400 })
  }

  const started = Date.now()
  try {
    const rendered = await renderLine(input, delivery)
    return NextResponse.json({
      audioBase64: rendered.buffer.toString('base64'),
      contentType: rendered.contentType,
      durationSec: Math.round(rendered.durationSec * 100) / 100,
      ms: Date.now() - started,
      delivery: rendered.delivery,
    })
  } catch (error) {
    console.error('[Voice Lab] Render failed:', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Vertonung fehlgeschlagen' },
      { status: 502 }
    )
  }
}

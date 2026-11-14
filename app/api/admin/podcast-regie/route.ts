import { NextRequest, NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/auth/session'
import { createAdminClient } from '@/lib/supabase/admin'
import { loadRegieHistory } from '@/lib/podcast/regie/history'
import { sampleRegie } from '@/lib/podcast/regie/sampler'
import { buildRegieOverview } from '@/lib/podcast/regie/overview'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** Skripte gibt es nur deutsch oder englisch (wie LOCALE_TO_TTS_LANG in generate-script). */
const toLang = (locale: string | null): 'de' | 'en' => (locale === 'de' ? 'de' : 'en')

type AdminClient = ReturnType<typeof createAdminClient>

/** Titel und Datum des Posts, in derselben Reihenfolge wie generate-script (KI-Post, sonst manueller Post). */
async function loadPostMeta(supabase: AdminClient, postId: string): Promise<{ title: string | null; createdAt: string | null }> {
  const { data: generated } = await supabase.from('generated_posts').select('title, created_at').eq('id', postId).maybeSingle()
  if (generated) return { title: generated.title ?? null, createdAt: generated.created_at ?? null }
  const { data: manual } = await supabase.from('posts').select('title, created_at').eq('id', postId).maybeSingle()
  return { title: manual?.title ?? null, createdAt: manual?.created_at ?? null }
}

/**
 * GET ?lang=en|de[&postId=<uuid>] → Tagesregie für die Karte im Podcast
 * Studio: Historie der letzten Folgen, Katalog mit Nutzung und Sperren und,
 * mit postId, die Vorschau der Ziehung für diesen Post. Nur lesend; die
 * Vorschau speichert nichts.
 */
export async function GET(request: NextRequest) {
  const authError = await requireAdmin(request)
  if (authError) return authError

  const lang = toLang(request.nextUrl.searchParams.get('lang'))
  const postId = request.nextUrl.searchParams.get('postId')
  const supabase = createAdminClient()
  const history = await loadRegieHistory(supabase, lang)

  let preview = null
  if (postId && UUID_RE.test(postId)) {
    const post = await loadPostMeta(supabase, postId)
    // Datum wie in generate-script: Erstellungstag des Posts, sonst heute (UTC).
    const date = (post.createdAt ? new Date(post.createdAt) : new Date()).toISOString().slice(0, 10)
    preview = { ...sampleRegie(history, { date, postId }), title: post.title }
  }

  return NextResponse.json(buildRegieOverview({ lang, history, preview }))
}

/**
 * GET /api/admin/posts
 * List posts for admin selection (e.g., podcast generation)
 *
 * Query params:
 * - limit: number (default: 20)
 * - published: boolean (default: true)
 *
 * POST/PATCH — Security-Stufe 2: serverseitiger, authentifizierter Write
 * für die Tabelle `posts` — ersetzt den direkten Browser-anon-Zugriff aus
 * components/post-form.tsx. Der SELECT oben bleibt unverändert (andere Tabelle:
 * generated_posts).
 */

import { NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/auth/session'
import { createAdminClient } from '@/lib/supabase/admin'

export async function GET(request: NextRequest) {
  const session = await getSession()
  if (!session) {
    return NextResponse.json({ error: 'Nicht autorisiert' }, { status: 401 })
  }

  const { searchParams } = new URL(request.url)
  const select = searchParams.get('select')

  // Security-Stufe 2 (Welle 1b): `posts`-Tabelle (manuelle Posts, alle
  // Status) für app/admin/page.tsx — getriggert über ?select=..., damit das
  // bestehende Verhalten unten (generated_posts mit limit/published) für
  // app/admin/audio/page.tsx unverändert bleibt.
  if (select) {
    try {
      const supabase = createAdminClient()
      const { data, error } = await supabase
        .from('posts')
        .select(select)
        .order('created_at', { ascending: false })
      if (error) return NextResponse.json({ error: error.message }, { status: 500 })
      return NextResponse.json(data)
    } catch (error) {
      return NextResponse.json(
        { error: error instanceof Error ? error.message : 'Unbekannter Fehler' },
        { status: 500 }
      )
    }
  }

  try {
    const limit = parseInt(searchParams.get('limit') || '20', 10)
    const publishedOnly = searchParams.get('published') !== 'false'

    const supabase = createAdminClient()

    // Fetch from generated_posts (AI-generated posts)
    let query = supabase
      .from('generated_posts')
      .select('id, title, slug, created_at, excerpt')
      .order('created_at', { ascending: false })
      .limit(limit)

    if (publishedOnly) {
      query = query.eq('status', 'published')
    }

    const { data: posts, error } = await query

    if (error) {
      console.error('[Admin Posts] Query error:', error)
      return NextResponse.json({ error: 'Failed to fetch posts' }, { status: 500 })
    }

    return NextResponse.json({
      posts: posts || [],
      count: posts?.length || 0,
    })
  } catch (error) {
    console.error('[Admin Posts] Error:', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    )
  }
}

export async function POST(request: NextRequest) {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'Nicht autorisiert' }, { status: 401 })

  const { title, slug, excerpt, content, category, published } = await request.json()
  if (!title || !slug) return NextResponse.json({ error: 'title und slug erforderlich' }, { status: 400 })

  const supabase = createAdminClient()
  const { error } = await supabase.from('posts').insert({
    title,
    slug,
    excerpt: excerpt || null,
    content,
    category,
    published,
    updated_at: new Date().toISOString(),
  })
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}

export async function PATCH(request: NextRequest) {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'Nicht autorisiert' }, { status: 401 })

  const { id, title, slug, excerpt, content, category, published, status } = await request.json()
  if (!id) return NextResponse.json({ error: 'id erforderlich' }, { status: 400 })

  const supabase = createAdminClient()
  // `status` optional: app/admin/page.tsx schreibt den Drei-Zustand-Status
  // (draft/published/archived) direkt; components/post-form.tsx nutzt weiterhin
  // nur `published` (Switch). Ein DB-Trigger hält `published` bei status-Schreiben
  // in Sync, s. supabase/migrations/20260516_posts_status_column.sql.
  const { error } = await supabase
    .from('posts')
    .update({
      title,
      slug,
      excerpt: excerpt || null,
      content,
      category,
      published,
      ...(status !== undefined ? { status } : {}),
      updated_at: new Date().toISOString(),
    })
    .eq('id', id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}

export async function DELETE(request: NextRequest) {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'Nicht autorisiert' }, { status: 401 })

  const { searchParams } = new URL(request.url)
  const id = searchParams.get('id')
  if (!id) return NextResponse.json({ error: 'id erforderlich' }, { status: 400 })

  const supabase = createAdminClient()
  const { error } = await supabase.from('posts').delete().eq('id', id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}

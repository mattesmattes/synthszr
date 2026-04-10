import { NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/auth/session'
import { createAdminClient } from '@/lib/supabase/admin'
import { extractAnalogies, tiptapToPlainText } from '@/lib/analogy/extractor'

export async function POST(request: NextRequest) {
  const session = await getSession()
  if (!session) {
    return NextResponse.json({ error: 'Nicht autorisiert' }, { status: 401 })
  }

  const { postId } = await request.json()
  if (!postId) {
    return NextResponse.json({ error: 'postId required' }, { status: 400 })
  }

  const supabase = createAdminClient()

  // Fetch post content
  const { data: post, error: postError } = await supabase
    .from('generated_posts')
    .select('title, content')
    .eq('id', postId)
    .single()

  if (postError || !post) {
    return NextResponse.json({ error: 'Post not found' }, { status: 404 })
  }

  // Convert TipTap JSON to plain text
  let content: unknown
  try {
    content = typeof post.content === 'string' ? JSON.parse(post.content) : post.content
  } catch {
    return NextResponse.json({ error: 'Invalid post content format' }, { status: 400 })
  }

  const plainText = tiptapToPlainText(content)
  if (plainText.length < 100) {
    return NextResponse.json({ error: 'Post content too short for analogy extraction' }, { status: 400 })
  }

  // Extract analogies via Claude
  const analogies = await extractAnalogies(plainText, post.title)

  if (analogies.length === 0) {
    return NextResponse.json({ message: 'No analogies found', extracted: 0 })
  }

  // Insert into DB
  const rows = analogies.map(a => ({
    post_id: postId,
    analogy_text: a.analogyText,
    context_text: a.contextText,
    image_prompt: a.imagePrompt,
    source_section: a.sourceSection,
    status: 'pending' as const,
  }))

  const { data: inserted, error: insertError } = await supabase
    .from('analogy_videos')
    .insert(rows)
    .select('id, analogy_text, status')

  if (insertError) {
    console.error('[AnalogyExtract] Insert error:', insertError)
    return NextResponse.json({ error: insertError.message }, { status: 500 })
  }

  return NextResponse.json({
    success: true,
    extracted: inserted?.length || 0,
    analogies: inserted,
  })
}

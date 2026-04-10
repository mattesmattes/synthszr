import { NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/auth/session'
import { createAdminClient } from '@/lib/supabase/admin'
import { extractAnalogies, tiptapToPlainText } from '@/lib/analogy/extractor'
import { generateMachineScript } from '@/lib/analogy/machine-extractor'

export async function POST(request: NextRequest) {
  const session = await getSession()
  if (!session) {
    return NextResponse.json({ error: 'Nicht autorisiert' }, { status: 401 })
  }

  const { postId, videoType = 'analogy' } = await request.json()
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
    return NextResponse.json({ error: 'Post content too short' }, { status: 400 })
  }

  if (videoType === 'machine') {
    // === The Machine: Generate terminal processing scripts ===
    const scripts = await generateMachineScript(plainText, post.title)

    if (scripts.length === 0) {
      return NextResponse.json({ message: 'No machine scripts generated', extracted: 0 })
    }

    const rows = scripts.map(s => ({
      post_id: postId,
      video_type: 'machine',
      analogy_text: s.take,
      context_text: s.title,
      source_section: s.sourceText,
      script_data: s,
      status: 'review' as const,
      progress: 100,
    }))

    let { data: inserted, error: insertError } = await supabase
      .from('analogy_videos')
      .insert(rows)
      .select('id, analogy_text, status')

    // Fallback: if video_type/script_data columns don't exist yet, insert without them
    if (insertError?.message?.includes('video_type') || insertError?.message?.includes('script_data')) {
      console.warn('[MachineExtract] v2 migration missing, inserting without video_type/script_data')
      const fallbackRows = scripts.map(s => ({
        post_id: postId,
        analogy_text: s.take,
        context_text: s.title,
        source_section: s.sourceText,
        status: 'review' as const,
        progress: 100,
      }))
      const result = await supabase.from('analogy_videos').insert(fallbackRows).select('id, analogy_text, status')
      inserted = result.data
      insertError = result.error
    }

    if (insertError) {
      console.error('[MachineExtract] Insert error:', insertError)
      return NextResponse.json({ error: insertError.message }, { status: 500 })
    }

    return NextResponse.json({
      success: true,
      extracted: inserted?.length || 0,
      videos: inserted,
    })
  }

  // === Analogy Machine: Extract analogies ===
  const analogies = await extractAnalogies(plainText, post.title)

  if (analogies.length === 0) {
    return NextResponse.json({ message: 'No analogies found', extracted: 0 })
  }

  const rows = analogies.map(a => ({
    post_id: postId,
    video_type: 'analogy',
    analogy_text: a.analogyText,
    context_text: a.contextText,
    image_prompt: a.imagePrompt,
    source_section: a.sourceSection,
    status: 'pending' as const,
  }))

  let { data: inserted, error: insertError } = await supabase
    .from('analogy_videos')
    .insert(rows)
    .select('id, analogy_text, status')

  // Fallback: if video_type column doesn't exist yet, insert without it
  if (insertError?.message?.includes('video_type')) {
    console.warn('[AnalogyExtract] v2 migration missing, inserting without video_type')
    const fallbackRows = analogies.map(a => ({
      post_id: postId,
      analogy_text: a.analogyText,
      context_text: a.contextText,
      image_prompt: a.imagePrompt,
      source_section: a.sourceSection,
      status: 'pending' as const,
    }))
    const result = await supabase.from('analogy_videos').insert(fallbackRows).select('id, analogy_text, status')
    inserted = result.data
    insertError = result.error
  }

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

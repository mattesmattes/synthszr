import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { getSession } from '@/lib/auth/session'

export async function GET() {
  const session = await getSession()
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const supabase = await createClient()
  const { data, error } = await supabase
    .from('ghostwriter_prompts')
    .select('*')
    .eq('is_archived', false)
    .order('created_at', { ascending: false })

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json(data)
}

export async function POST(request: NextRequest) {
  const session = await getSession()
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const body = await request.json()
    const { name, prompt_text, is_active } = body

    if (!name || !prompt_text) {
      return NextResponse.json(
        { error: 'Name und Prompt sind erforderlich' },
        { status: 400 }
      )
    }

    const supabase = await createClient()

    // If setting as active, deactivate all others first
    if (is_active) {
      await supabase
        .from('ghostwriter_prompts')
        .update({ is_active: false })
        .neq('id', '00000000-0000-0000-0000-000000000000')
    }

    const { data, error } = await supabase
      .from('ghostwriter_prompts')
      .insert({
        name: name.trim(),
        prompt_text: prompt_text.trim(),
        is_active: is_active || false,
      })
      .select()
      .single()

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    return NextResponse.json(data)
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Unbekannter Fehler' },
      { status: 500 }
    )
  }
}

export async function PUT(request: NextRequest) {
  const session = await getSession()
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const body = await request.json()
    const { id, name, prompt_text, is_active } = body

    if (!id || !name || !prompt_text) {
      return NextResponse.json(
        { error: 'ID, Name und Prompt sind erforderlich' },
        { status: 400 }
      )
    }

    const supabase = await createClient()

    // If setting as active, deactivate all others first
    if (is_active) {
      await supabase
        .from('ghostwriter_prompts')
        .update({ is_active: false })
        .neq('id', id)
    }

    const { data, error } = await supabase
      .from('ghostwriter_prompts')
      .update({
        name: name.trim(),
        prompt_text: prompt_text.trim(),
        is_active: is_active || false,
        updated_at: new Date().toISOString(),
      })
      .eq('id', id)
      .select()
      .single()

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    return NextResponse.json(data)
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Unbekannter Fehler' },
      { status: 500 }
    )
  }
}

export async function DELETE(request: NextRequest) {
  const session = await getSession()
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { searchParams } = new URL(request.url)
  const id = searchParams.get('id')

  if (!id) {
    return NextResponse.json({ error: 'ID erforderlich' }, { status: 400 })
  }

  const supabase = await createClient()

  // Archive instead of delete
  const { error } = await supabase
    .from('ghostwriter_prompts')
    .update({ is_archived: true, is_active: false })
    .eq('id', id)

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({ success: true })
}

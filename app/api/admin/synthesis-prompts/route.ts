import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { getSession } from '@/lib/auth/session'

export async function GET() {
  const session = await getSession()
  if (!session) {
    return NextResponse.json({ error: 'Nicht autorisiert' }, { status: 401 })
  }

  try {
    const supabase = await createClient()
    const { data, error } = await supabase
      .from('synthesis_prompts')
      .select('*')
      .eq('is_archived', false)
      .order('created_at', { ascending: false })

    if (error) throw error
    return NextResponse.json(data || [])
  } catch (error) {
    console.error('Error fetching synthesis prompts:', error)
    return NextResponse.json(
      { error: 'Failed to fetch prompts' },
      { status: 500 }
    )
  }
}

export async function POST(request: NextRequest) {
  const session = await getSession()
  if (!session) {
    return NextResponse.json({ error: 'Nicht autorisiert' }, { status: 401 })
  }

  try {
    const body = await request.json()
    const { name, scoring_prompt, development_prompt, core_thesis, is_active } = body

    if (!name || !scoring_prompt || !development_prompt) {
      return NextResponse.json(
        { error: 'Name, Scoring-Prompt und Development-Prompt sind erforderlich' },
        { status: 400 }
      )
    }

    const supabase = await createClient()

    // If setting as active, deactivate all others first
    if (is_active) {
      await supabase
        .from('synthesis_prompts')
        .update({ is_active: false })
        .eq('is_active', true)
    }

    const { data, error } = await supabase
      .from('synthesis_prompts')
      .insert({
        name,
        scoring_prompt,
        development_prompt,
        core_thesis: core_thesis || null,
        is_active: is_active || false,
      })
      .select()
      .single()

    if (error) throw error
    return NextResponse.json(data)
  } catch (error) {
    console.error('Error creating synthesis prompt:', error)
    return NextResponse.json(
      { error: 'Failed to create prompt' },
      { status: 500 }
    )
  }
}

export async function PUT(request: NextRequest) {
  const session = await getSession()
  if (!session) {
    return NextResponse.json({ error: 'Nicht autorisiert' }, { status: 401 })
  }

  try {
    const body = await request.json()
    const { id, name, scoring_prompt, development_prompt, core_thesis, is_active } = body

    if (!id) {
      return NextResponse.json({ error: 'ID erforderlich' }, { status: 400 })
    }

    const supabase = await createClient()

    // If setting as active, deactivate all others first
    if (is_active) {
      await supabase
        .from('synthesis_prompts')
        .update({ is_active: false })
        .eq('is_active', true)
        .neq('id', id)
    }

    const { data, error } = await supabase
      .from('synthesis_prompts')
      .update({
        name,
        scoring_prompt,
        development_prompt,
        core_thesis: core_thesis || null,
        is_active,
      })
      .eq('id', id)
      .select()
      .single()

    if (error) throw error
    return NextResponse.json(data)
  } catch (error) {
    console.error('Error updating synthesis prompt:', error)
    return NextResponse.json(
      { error: 'Failed to update prompt' },
      { status: 500 }
    )
  }
}

export async function DELETE(request: NextRequest) {
  const session = await getSession()
  if (!session) {
    return NextResponse.json({ error: 'Nicht autorisiert' }, { status: 401 })
  }

  try {
    const { searchParams } = new URL(request.url)
    const id = searchParams.get('id')

    if (!id) {
      return NextResponse.json({ error: 'ID erforderlich' }, { status: 400 })
    }

    const supabase = await createClient()

    // Archive instead of delete
    const { error } = await supabase
      .from('synthesis_prompts')
      .update({ is_archived: true, is_active: false })
      .eq('id', id)

    if (error) throw error
    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('Error deleting synthesis prompt:', error)
    return NextResponse.json(
      { error: 'Failed to delete prompt' },
      { status: 500 }
    )
  }
}

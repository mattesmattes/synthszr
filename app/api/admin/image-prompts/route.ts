import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { getSession } from '@/lib/auth/session'

const DEFAULT_PROMPT = `Visualisiere in Schwarz-Weiß die folgende News satirisch im Stil von Mort Drucker ohne in der Visualisierung auf "Mort Drucker" oder "MAD" hinzuweisen.

WICHTIGE STILRICHTLINIEN:
- Klarer Schwarz-Weiß-Kontrast mit Schraffuren und Linienzeichnung
- Satirische, leicht überzeichnete Darstellung
- Dynamische Kompositionen mit ausdrucksstarken Figuren
- Keine Text-Elemente oder Beschriftungen im Bild
- Keine Referenzen auf MAD Magazine oder den Künstler

NEWS TEXT:
{newsText}`

export async function GET() {
  const session = await getSession()
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const supabase = await createClient()
  const { data, error } = await supabase
    .from('image_prompts')
    .select('*')
    .order('created_at', { ascending: false })

  if (error) {
    // Table might not exist yet, return empty array
    if (error.code === '42P01') {
      return NextResponse.json([])
    }
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
    const { name, prompt_text, is_active, enable_dithering, dithering_gain, image_scale } = body

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
        .from('image_prompts')
        .update({ is_active: false })
        .neq('id', '00000000-0000-0000-0000-000000000000')
    }

    const { data, error } = await supabase
      .from('image_prompts')
      .insert({
        name: name.trim(),
        prompt_text: prompt_text.trim(),
        is_active: is_active || false,
        enable_dithering: enable_dithering ?? false,
        dithering_gain: dithering_gain ?? 1.0,
        image_scale: image_scale ?? 1.0,
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
    const { id, name, prompt_text, is_active, enable_dithering, dithering_gain, image_scale } = body

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
        .from('image_prompts')
        .update({ is_active: false })
        .neq('id', id)
    }

    const { data, error } = await supabase
      .from('image_prompts')
      .update({
        name: name.trim(),
        prompt_text: prompt_text.trim(),
        is_active: is_active || false,
        enable_dithering: enable_dithering ?? false,
        dithering_gain: dithering_gain ?? 1.0,
        image_scale: image_scale ?? 1.0,
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
  const { error } = await supabase
    .from('image_prompts')
    .delete()
    .eq('id', id)

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({ success: true })
}

// Helper to get active prompt with settings (used by image generator)
export interface ActiveImagePromptSettings {
  promptText: string
  enableDithering: boolean
  ditheringGain: number
  imageScale: number
}

export async function getActiveImagePrompt(): Promise<string> {
  const settings = await getActiveImagePromptSettings()
  return settings.promptText
}

export async function getActiveImagePromptSettings(): Promise<ActiveImagePromptSettings> {
  const supabase = await createClient()
  const { data } = await supabase
    .from('image_prompts')
    .select('prompt_text, enable_dithering, dithering_gain, image_scale')
    .eq('is_active', true)
    .single()

  return {
    promptText: data?.prompt_text || DEFAULT_PROMPT,
    enableDithering: data?.enable_dithering ?? false,
    ditheringGain: data?.dithering_gain ?? 1.0,
    imageScale: data?.image_scale ?? 1.0,
  }
}

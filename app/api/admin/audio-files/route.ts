import { NextRequest, NextResponse } from 'next/server'
import { del, put } from '@vercel/blob'
import { createClient } from '@/lib/supabase/server'
import { getSession } from '@/lib/auth/session'

// List all audio files
export async function GET() {
  const session = await getSession()
  if (!session) {
    return NextResponse.json({ error: 'Nicht autorisiert' }, { status: 401 })
  }

  const supabase = await createClient()

  const { data: files, error } = await supabase
    .from('podcast_audio_files')
    .select('*')
    .order('type', { ascending: true })
    .order('created_at', { ascending: false })

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({ files })
}

// Upload a new audio file
export async function POST(request: NextRequest) {
  const session = await getSession()
  if (!session) {
    return NextResponse.json({ error: 'Nicht autorisiert' }, { status: 401 })
  }

  try {
    const formData = await request.formData()
    const file = formData.get('file') as File | null
    const name = formData.get('name') as string | null
    const type = formData.get('type') as string | null

    if (!file || !name || !type) {
      return NextResponse.json(
        { error: 'file, name, and type are required' },
        { status: 400 }
      )
    }

    if (type !== 'intro' && type !== 'outro') {
      return NextResponse.json(
        { error: 'type must be "intro" or "outro"' },
        { status: 400 }
      )
    }

    // Upload to Vercel Blob
    const blob = await put(
      `podcast-audio/${type}/${name}-${Date.now()}.mp3`,
      file,
      { access: 'public', contentType: 'audio/mpeg' }
    )

    const supabase = await createClient()

    const { data: record, error } = await supabase
      .from('podcast_audio_files')
      .insert({ name, type, url: blob.url, file_size: file.size })
      .select()
      .single()

    if (error) {
      // Clean up blob if DB insert fails
      try {
        await del(blob.url)
      } catch (e) {
        console.error('Failed to clean up blob after DB error:', e)
      }
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    return NextResponse.json({ file: record })
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    )
  }
}

// Update name or set active
export async function PATCH(request: NextRequest) {
  const session = await getSession()
  if (!session) {
    return NextResponse.json({ error: 'Nicht autorisiert' }, { status: 401 })
  }

  try {
    const { id, name, is_active } = await request.json()

    if (!id) {
      return NextResponse.json(
        { error: 'id is required' },
        { status: 400 }
      )
    }

    const supabase = await createClient()

    if (name !== undefined) {
      const { data: record, error } = await supabase
        .from('podcast_audio_files')
        .update({ name })
        .eq('id', id)
        .select()
        .single()

      if (error) {
        return NextResponse.json({ error: error.message }, { status: 500 })
      }

      return NextResponse.json({ file: record })
    }

    if (is_active === true) {
      // Deactivate all files of the same type first
      const { data: current, error: fetchError } = await supabase
        .from('podcast_audio_files')
        .select('type')
        .eq('id', id)
        .single()

      if (fetchError || !current) {
        return NextResponse.json({ error: 'File not found' }, { status: 404 })
      }

      await supabase
        .from('podcast_audio_files')
        .update({ is_active: false })
        .eq('type', current.type)

      // Set this file as active
      const { data: record, error } = await supabase
        .from('podcast_audio_files')
        .update({ is_active: true })
        .eq('id', id)
        .select()
        .single()

      if (error) {
        return NextResponse.json({ error: error.message }, { status: 500 })
      }

      return NextResponse.json({ file: record })
    }

    if (is_active === false) {
      const { data: record, error } = await supabase
        .from('podcast_audio_files')
        .update({ is_active: false })
        .eq('id', id)
        .select()
        .single()

      if (error) {
        return NextResponse.json({ error: error.message }, { status: 500 })
      }

      return NextResponse.json({ file: record })
    }

    return NextResponse.json(
      { error: 'name or is_active must be provided' },
      { status: 400 }
    )
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    )
  }
}

// Delete an audio file
export async function DELETE(request: NextRequest) {
  const session = await getSession()
  if (!session) {
    return NextResponse.json({ error: 'Nicht autorisiert' }, { status: 401 })
  }

  const { searchParams } = new URL(request.url)
  const id = searchParams.get('id')

  if (!id) {
    return NextResponse.json({ error: 'id is required' }, { status: 400 })
  }

  const supabase = await createClient()

  // Get file details
  const { data: file, error: fetchError } = await supabase
    .from('podcast_audio_files')
    .select('*')
    .eq('id', id)
    .single()

  if (fetchError || !file) {
    return NextResponse.json({ error: 'File not found' }, { status: 404 })
  }

  if (file.is_active) {
    return NextResponse.json(
      { error: 'Cannot delete active file' },
      { status: 400 }
    )
  }

  // Delete from Vercel Blob
  if (file.url) {
    try {
      await del(file.url)
    } catch (e) {
      console.error('Failed to delete blob:', e)
    }
  }

  // Delete from DB
  const { error } = await supabase
    .from('podcast_audio_files')
    .delete()
    .eq('id', id)

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({ success: true })
}

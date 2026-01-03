import { NextRequest, NextResponse } from 'next/server'
import { del } from '@vercel/blob'
import { createClient } from '@/lib/supabase/server'
import { getSession } from '@/lib/auth/session'

// Get images for a post
export async function GET(request: NextRequest) {
  // Require admin authentication
  const session = await getSession()
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { searchParams } = new URL(request.url)
  const postId = searchParams.get('postId')

  if (!postId) {
    return NextResponse.json({ error: 'postId is required' }, { status: 400 })
  }

  const supabase = await createClient()

  const { data: images, error } = await supabase
    .from('post_images')
    .select('*')
    .eq('post_id', postId)
    .order('created_at', { ascending: true })

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({ images })
}

// Set cover image
export async function PATCH(request: NextRequest) {
  // Require admin authentication
  const session = await getSession()
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const { postId, imageId } = await request.json()

    if (!postId || !imageId) {
      return NextResponse.json(
        { error: 'postId and imageId are required' },
        { status: 400 }
      )
    }

    const supabase = await createClient()

    // Remove existing cover
    await supabase
      .from('post_images')
      .update({ is_cover: false })
      .eq('post_id', postId)

    // Set new cover
    const { error: updateError } = await supabase
      .from('post_images')
      .update({ is_cover: true })
      .eq('id', imageId)
      .eq('post_id', postId)

    if (updateError) {
      return NextResponse.json({ error: updateError.message }, { status: 500 })
    }

    // Update generated_posts reference
    await supabase
      .from('generated_posts')
      .update({ cover_image_id: imageId })
      .eq('id', postId)

    return NextResponse.json({ success: true })
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    )
  }
}

// Delete an image
export async function DELETE(request: NextRequest) {
  // Require admin authentication
  const session = await getSession()
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { searchParams } = new URL(request.url)
  const imageId = searchParams.get('imageId')

  if (!imageId) {
    return NextResponse.json({ error: 'imageId is required' }, { status: 400 })
  }

  const supabase = await createClient()

  // Get image details first
  const { data: image } = await supabase
    .from('post_images')
    .select('*')
    .eq('id', imageId)
    .single()

  if (image) {
    // Delete from Vercel Blob if URL exists
    if (image.image_url) {
      try {
        await del(image.image_url)
      } catch (e) {
        console.error('Failed to delete blob:', e)
      }
    }

    // If this was the cover, clear the reference
    if (image.is_cover) {
      await supabase
        .from('generated_posts')
        .update({ cover_image_id: null })
        .eq('id', image.post_id)
    }
  }

  // Delete the record
  const { error } = await supabase
    .from('post_images')
    .delete()
    .eq('id', imageId)

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({ success: true })
}

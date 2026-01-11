import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'

/**
 * GET /api/newsletter/preferences?token=xxx
 * Returns subscriber preferences for the given token
 */
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)
    const token = searchParams.get('token')

    if (!token) {
      return NextResponse.json({ error: 'Token erforderlich' }, { status: 400 })
    }

    const supabase = createAdminClient()

    // Find subscriber preference token
    const { data: tokenData, error: tokenError } = await supabase
      .from('subscriber_preference_tokens')
      .select('subscriber_id, expires_at')
      .eq('token', token)
      .single()

    if (tokenError || !tokenData) {
      return NextResponse.json({ error: 'Ungültiger Token' }, { status: 404 })
    }

    // Check if token is expired
    if (new Date(tokenData.expires_at) < new Date()) {
      return NextResponse.json({ error: 'Token abgelaufen' }, { status: 410 })
    }

    // Get subscriber data
    const { data: subscriber, error: subError } = await supabase
      .from('subscribers')
      .select('email, preferences')
      .eq('id', tokenData.subscriber_id)
      .single()

    if (subError || !subscriber) {
      return NextResponse.json({ error: 'Subscriber nicht gefunden' }, { status: 404 })
    }

    const preferences = subscriber.preferences as { language?: string } | null

    return NextResponse.json({
      email: subscriber.email,
      language: preferences?.language || 'de',
    })
  } catch (error) {
    console.error('Preferences GET error:', error)
    return NextResponse.json({ error: 'Interner Fehler' }, { status: 500 })
  }
}

/**
 * PUT /api/newsletter/preferences
 * Updates subscriber preferences
 */
export async function PUT(request: NextRequest) {
  try {
    const body = await request.json()
    const { token, language } = body

    if (!token) {
      return NextResponse.json({ error: 'Token erforderlich' }, { status: 400 })
    }

    const supabase = createAdminClient()

    // Find subscriber preference token
    const { data: tokenData, error: tokenError } = await supabase
      .from('subscriber_preference_tokens')
      .select('subscriber_id, expires_at')
      .eq('token', token)
      .single()

    if (tokenError || !tokenData) {
      return NextResponse.json({ error: 'Ungültiger Token' }, { status: 404 })
    }

    // Check if token is expired
    if (new Date(tokenData.expires_at) < new Date()) {
      return NextResponse.json({ error: 'Token abgelaufen' }, { status: 410 })
    }

    // Get current preferences
    const { data: subscriber } = await supabase
      .from('subscribers')
      .select('preferences')
      .eq('id', tokenData.subscriber_id)
      .single()

    const currentPrefs = (subscriber?.preferences as Record<string, unknown>) || {}

    // Update preferences
    const { error: updateError } = await supabase
      .from('subscribers')
      .update({
        preferences: { ...currentPrefs, language },
        updated_at: new Date().toISOString(),
      })
      .eq('id', tokenData.subscriber_id)

    if (updateError) {
      console.error('Preferences update error:', updateError)
      return NextResponse.json({ error: 'Fehler beim Speichern' }, { status: 500 })
    }

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('Preferences PUT error:', error)
    return NextResponse.json({ error: 'Interner Fehler' }, { status: 500 })
  }
}

/**
 * POST /api/newsletter/preferences
 * Creates a new preference token and returns the preferences URL
 * (Called when sending newsletter to include in footer)
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { subscriberId } = body

    if (!subscriberId) {
      return NextResponse.json({ error: 'Subscriber ID erforderlich' }, { status: 400 })
    }

    const supabase = createAdminClient()

    // Generate token
    const token = crypto.randomUUID()
    const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000) // 30 days

    // Clean up old tokens for this subscriber
    await supabase
      .from('subscriber_preference_tokens')
      .delete()
      .eq('subscriber_id', subscriberId)

    // Create new token
    const { error: insertError } = await supabase
      .from('subscriber_preference_tokens')
      .insert({
        subscriber_id: subscriberId,
        token,
        expires_at: expiresAt.toISOString(),
      })

    if (insertError) {
      console.error('Token insert error:', insertError)
      return NextResponse.json({ error: 'Fehler beim Erstellen des Tokens' }, { status: 500 })
    }

    return NextResponse.json({ token })
  } catch (error) {
    console.error('Preferences POST error:', error)
    return NextResponse.json({ error: 'Interner Fehler' }, { status: 500 })
  }
}

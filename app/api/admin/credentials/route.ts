import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { getSession } from '@/lib/auth/session'
import { encrypt, decrypt } from '@/lib/crypto'

export async function GET() {
  const session = await getSession()
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const supabase = await createClient()
  const { data, error } = await supabase
    .from('paywall_credentials')
    .select('id, domain, username, notes, last_used_at, created_at')
    .order('domain')

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
    const { domain, username, password, notes } = body

    if (!domain || !username || !password) {
      return NextResponse.json(
        { error: 'Domain, Username und Passwort sind erforderlich' },
        { status: 400 }
      )
    }

    // Encrypt password
    const encryptedPassword = encrypt(password)

    const supabase = await createClient()
    const { data, error } = await supabase
      .from('paywall_credentials')
      .insert({
        domain: domain.toLowerCase().trim(),
        username: username.trim(),
        password_encrypted: encryptedPassword,
        notes: notes?.trim() || null,
      })
      .select('id, domain, username, notes, created_at')
      .single()

    if (error) {
      if (error.code === '23505') {
        return NextResponse.json(
          { error: 'Credentials für diese Domain existieren bereits' },
          { status: 400 }
        )
      }
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
    .from('paywall_credentials')
    .delete()
    .eq('id', id)

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({ success: true })
}

export async function PUT(request: NextRequest) {
  const session = await getSession()
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const body = await request.json()
    const { id, domain, username, password, notes } = body

    if (!id || !domain || !username) {
      return NextResponse.json(
        { error: 'ID, Domain und Username sind erforderlich' },
        { status: 400 }
      )
    }

    const updateData: Record<string, string | null> = {
      domain: domain.toLowerCase().trim(),
      username: username.trim(),
      notes: notes?.trim() || null,
    }

    // Only update password if provided
    if (password) {
      updateData.password_encrypted = encrypt(password)
    }

    const supabase = await createClient()
    const { data, error } = await supabase
      .from('paywall_credentials')
      .update(updateData)
      .eq('id', id)
      .select('id, domain, username, notes, created_at')
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

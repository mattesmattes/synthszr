import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { jwtVerify } from 'jose'

const SESSION_COOKIE_NAME = 'synthszr_session'

function getSecretKey() {
  const secret = process.env.ADMIN_PASSWORD
  if (!secret) return null
  return new TextEncoder().encode(secret)
}

async function isAdminSession(request: NextRequest): Promise<boolean> {
  const sessionToken = request.cookies.get(SESSION_COOKIE_NAME)?.value
  if (!sessionToken) return false

  const secretKey = getSecretKey()
  if (!secretKey) return false

  try {
    await jwtVerify(sessionToken, secretKey)
    return true
  } catch {
    return false
  }
}

export async function POST(request: NextRequest) {
  // Check admin auth in production
  if (process.env.NODE_ENV === 'production') {
    const isAdmin = await isAdminSession(request)
    if (!isAdmin) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
  }

  try {
    const { sources } = await request.json()

    if (!Array.isArray(sources)) {
      return NextResponse.json({ error: 'Sources must be an array' }, { status: 400 })
    }

    const supabase = await createClient()

    let inserted = 0
    let skipped = 0
    const errors: string[] = []

    for (const source of sources) {
      const { name, email } = source

      if (!name || !email) {
        errors.push(`Missing name or email: ${JSON.stringify(source)}`)
        continue
      }

      // Check if already exists
      const { data: existing } = await supabase
        .from('newsletter_sources')
        .select('id')
        .eq('email', email)
        .single()

      if (existing) {
        skipped++
        continue
      }

      const { error } = await supabase
        .from('newsletter_sources')
        .insert({
          name,
          email,
          enabled: true,
        })

      if (error) {
        errors.push(`Error inserting ${email}: ${error.message}`)
      } else {
        inserted++
      }
    }

    return NextResponse.json({
      success: true,
      inserted,
      skipped,
      errors: errors.length > 0 ? errors : undefined,
    })
  } catch (error) {
    console.error('Batch import error:', error)
    return NextResponse.json({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    }, { status: 500 })
  }
}

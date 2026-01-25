import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { requireAdmin } from '@/lib/auth/session'

export async function POST(request: NextRequest) {
  // Always require admin auth
  const authError = await requireAdmin(request)
  if (authError) return authError

  try {
    const { sources } = await request.json()

    if (!Array.isArray(sources)) {
      return NextResponse.json({ error: 'Sources must be an array' }, { status: 400 })
    }

    const supabase = createAdminClient()

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

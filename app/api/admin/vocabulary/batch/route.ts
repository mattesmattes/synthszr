import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { getSession } from '@/lib/auth/session'

export async function POST(request: NextRequest) {
  const session = await getSession()
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const body = await request.json()
    const { entries, category } = body

    if (!entries || !Array.isArray(entries)) {
      return NextResponse.json(
        { error: 'Entries array erforderlich' },
        { status: 400 }
      )
    }

    const supabase = await createClient()

    const insertData = entries.map((entry: { term: string; preferred_usage?: string; context?: string }) => ({
      term: entry.term.trim(),
      preferred_usage: entry.preferred_usage?.trim() || null,
      context: entry.context?.trim() || null,
      category: category || 'general',
    }))

    const { data, error } = await supabase
      .from('vocabulary_dictionary')
      .insert(insertData)
      .select()

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    return NextResponse.json({ success: true, count: data.length })
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Unbekannter Fehler' },
      { status: 500 }
    )
  }
}

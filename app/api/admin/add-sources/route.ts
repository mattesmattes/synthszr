import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'

export async function POST(request: Request) {
  const url = new URL(request.url)
  const secret = url.searchParams.get('secret')
  if (secret !== 'add-2025') {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const supabase = createAdminClient()
    const results: string[] = []

    const newSources = [
      { email: 'connie@strictlyvc.com', name: 'StrictlyVC' },
      { email: 'status@mail.status.news', name: 'Status with Natalie Korach' },
      { email: 'hi@mail.theresanaiforthat.com', name: 'TAAFT - There\'s An AI For That' },
      { email: 'futurism@mail.beehiiv.com', name: 'Futurism' },
      { email: 'theleverage@substack.com', name: 'The Leverage (Evan Armstrong)' },
    ]

    for (const source of newSources) {
      const { error } = await supabase
        .from('newsletter_sources')
        .insert({
          email: source.email,
          name: source.name,
          enabled: true,
        })

      if (error) {
        if (error.code === '23505') {
          results.push(`ALREADY EXISTS: ${source.email}`)
        } else {
          results.push(`ERROR ${source.email}: ${error.message}`)
        }
      } else {
        results.push(`ADDED: ${source.email} (${source.name})`)
      }
    }

    return NextResponse.json({ success: true, results })
  } catch (error) {
    return NextResponse.json({
      error: error instanceof Error ? error.message : 'Unknown error'
    }, { status: 500 })
  }
}

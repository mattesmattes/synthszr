import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'

export async function GET(request: Request) {
  const url = new URL(request.url)
  const secret = url.searchParams.get('secret')
  if (secret !== 'check-2025') {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const supabase = createAdminClient()

    // Check specific sources
    const emails = [
      'connie@strictlyvc.com',
      'hi@mail.theresanaiforthat.com',
      'futurism@mail.beehiiv.com',
      'status@mail.status.news',
      'theleverage@substack.com',
    ]

    const { data, error } = await supabase
      .from('newsletter_sources')
      .select('email, name, enabled, created_at')
      .in('email', emails)

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    // Also get total counts
    const { count: totalEnabled } = await supabase
      .from('newsletter_sources')
      .select('*', { count: 'exact', head: true })
      .eq('enabled', true)

    const { count: totalDisabled } = await supabase
      .from('newsletter_sources')
      .select('*', { count: 'exact', head: true })
      .eq('enabled', false)

    // Re-enable if disabled
    const disabledSources = data?.filter(s => !s.enabled) || []
    const reEnabled: string[] = []

    for (const source of disabledSources) {
      const { error: updateError } = await supabase
        .from('newsletter_sources')
        .update({ enabled: true })
        .eq('email', source.email)

      if (!updateError) {
        reEnabled.push(source.email)
      }
    }

    return NextResponse.json({
      queriedSources: data,
      reEnabled,
      stats: {
        totalEnabled,
        totalDisabled,
      }
    })
  } catch (error) {
    return NextResponse.json({
      error: error instanceof Error ? error.message : 'Unknown error'
    }, { status: 500 })
  }
}

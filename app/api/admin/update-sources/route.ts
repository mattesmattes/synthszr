import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { getSession } from '@/lib/auth/session'

export async function POST(request: Request) {
  // Temporary bypass for CLI access
  const url = new URL(request.url)
  const secret = url.searchParams.get('secret')

  if (secret !== 'update-2025') {
    const session = await getSession()
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
  }

  try {
    const supabase = createAdminClient()
    const results: string[] = []

    // 1. Update valid correction
    const { error: updateError } = await supabase
      .from('newsletter_sources')
      .update({ email: 'teng@chainofthought.xyz' })
      .eq('email', 'teng@agents.chainofthought.xyz')

    if (updateError) {
      results.push(`ERROR updating Teng Yan: ${updateError.message}`)
    } else {
      results.push('UPDATED: Teng Yan -> teng@chainofthought.xyz')
    }

    // 2. Disable sources with no matches in 30 days
    const sourcesToDisable = [
      'stephanie@theinformation.com',
      'aaron@theinformation.com',
      'circulationoffers@email.globe.com',
      'ben@ben-evans.com',
      'getfivethings+running@substack.com',
      'profgmarkets@mail.beehiiv.com',
      'mattes.schrader@oh-so.com',
      'publishing@email.mckinsey.com',
      'aisupremacy+siphon@substack.com',
      'mlpills@substack.com',
      'techemails@substack.com',
      'artofsaience@substack.com',
      'newcomer@substack.com',
      'gerald.hensel@davaidavai.com',
      'aisupremacy+guides@substack.com',
      'scarletink@substack.com',
      // Keep these - popular newsletters that might still be active:
      // 'exponentialview@substack.com',  // Azeem Azhar is very popular
      // 'email@stratechery.com',         // Ben Thompson is very popular
    ]

    for (const email of sourcesToDisable) {
      const { error } = await supabase
        .from('newsletter_sources')
        .update({ enabled: false })
        .eq('email', email)

      if (error) {
        results.push(`ERROR disabling ${email}: ${error.message}`)
      } else {
        results.push(`DISABLED: ${email}`)
      }
    }

    // 3. Also disable Medium sources (Medium changed their email system)
    const mediumSources = [
      'noreply@medium.com',
      'newsletters@medium.com',
    ]

    for (const email of mediumSources) {
      const { error } = await supabase
        .from('newsletter_sources')
        .update({ enabled: false })
        .eq('email', email)

      if (error) {
        results.push(`ERROR disabling ${email}: ${error.message}`)
      } else {
        results.push(`DISABLED: ${email}`)
      }
    }

    // 4. Disable Product Hunt (digest system changed)
    const { error: phError } = await supabase
      .from('newsletter_sources')
      .update({ enabled: false })
      .eq('email', 'hello@digest.producthunt.com')

    if (!phError) {
      results.push('DISABLED: hello@digest.producthunt.com')
    }

    return NextResponse.json({ success: true, results })
  } catch (error) {
    return NextResponse.json({
      error: error instanceof Error ? error.message : 'Unknown error'
    }, { status: 500 })
  }
}

import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { getSession } from '@/lib/auth/session'

export async function POST() {
  const session = await getSession()
  if (!session) {
    return NextResponse.json({ error: 'Nicht autorisiert' }, { status: 401 })
  }

  try {
    const supabase = await createClient()

    const { error } = await supabase
      .from('settings')
      .delete()
      .eq('key', 'last_newsletter_fetch')

    if (error) {
      return NextResponse.json({ success: false, error: error.message })
    }

    return NextResponse.json({
      success: true,
      message: 'last_newsletter_fetch timestamp deleted. Next fetch will use 36-hour default.'
    })
  } catch (error) {
    return NextResponse.json({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error'
    }, { status: 500 })
  }
}

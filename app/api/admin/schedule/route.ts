import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { getSession } from '@/lib/auth/session'

export interface ScheduleConfig {
  newsletterFetch: {
    enabled: boolean
    hour: number
    minute: number
  }
  dailyAnalysis: {
    enabled: boolean
    hour: number
    minute: number
  }
  postGeneration: {
    enabled: boolean
    hour: number
    minute: number
  }
  newsletterSend?: {
    enabled: boolean
    hour: number
    minute: number
  }
}

const DEFAULT_SCHEDULE: ScheduleConfig = {
  newsletterFetch: {
    enabled: true,
    hour: 6,
    minute: 0,
  },
  dailyAnalysis: {
    enabled: true,
    hour: 8,
    minute: 0,
  },
  postGeneration: {
    enabled: false,
    hour: 9,
    minute: 0,
  },
  newsletterSend: {
    enabled: false,
    hour: 9,
    minute: 30,
  },
}

export async function GET() {
  const session = await getSession()
  if (!session) {
    return NextResponse.json({ error: 'Nicht autorisiert' }, { status: 401 })
  }

  const supabase = await createClient()
  const { data } = await supabase
    .from('settings')
    .select('value')
    .eq('key', 'schedule_config')
    .single()

  return NextResponse.json(data?.value || DEFAULT_SCHEDULE)
}

export async function PUT(request: NextRequest) {
  const session = await getSession()
  if (!session) {
    return NextResponse.json({ error: 'Nicht autorisiert' }, { status: 401 })
  }

  try {
    const config: ScheduleConfig = await request.json()

    const supabase = await createClient()
    const { error } = await supabase
      .from('settings')
      .upsert({
        key: 'schedule_config',
        value: config,
      }, { onConflict: 'key' })

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    return NextResponse.json({ success: true, config })
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    )
  }
}

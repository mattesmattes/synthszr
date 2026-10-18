import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { getSession } from '@/lib/auth/session'
import { DEFAULT_SCHEDULE_TIMEZONE, isValidTimeZone } from '@/lib/scheduler/clock'

export interface ScheduleConfig {
  /** IANA-Zone, in der alle Uhrzeiten gelten (2026-10-18); fehlt → Europe/Berlin. */
  timezone?: string
  newsletterFetch: {
    enabled: boolean
    hour: number
    minute: number
  }
  webcrawlFetch: {
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
    maxItems?: number
  }
  newsletterSend?: {
    enabled: boolean
    hour: number
    minute: number
  }
}

// Zeiten in Berlin/MEZ (nicht UTC) — der Scheduler rechnet zur Laufzeit um
const DEFAULT_SCHEDULE: ScheduleConfig = {
  timezone: DEFAULT_SCHEDULE_TIMEZONE,
  newsletterFetch: { enabled: true,  hour: 4, minute: 0  },   // 04:00 in der Zeitplan-Zone
  webcrawlFetch:   { enabled: true,  hour: 4, minute: 30 },   // 04:30 MEZ
  dailyAnalysis:   { enabled: true,  hour: 5, minute: 0  },   // 05:00 MEZ
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

  const supabase = createAdminClient()
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
    // Ein Tippfehler in der Zone darf die Kette nicht stillschweigend nach
    // Berlin zurückfallen lassen — der Scheduler täte genau das.
    if (config.timezone !== undefined && !isValidTimeZone(config.timezone)) {
      return NextResponse.json({ error: `Ungültige Zeitzone: ${config.timezone}` }, { status: 400 })
    }

    const supabase = createAdminClient()
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

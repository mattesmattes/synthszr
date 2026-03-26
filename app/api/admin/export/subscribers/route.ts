import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { getSession } from '@/lib/auth/session'

export async function GET() {
  const session = await getSession()
  if (!session) {
    return NextResponse.json({ error: 'Nicht autorisiert' }, { status: 401 })
  }

  try {
    const supabase = createAdminClient()

    const { data, error } = await supabase
      .from('subscribers')
      .select('email, created_at')
      .eq('status', 'active')
      .order('created_at', { ascending: false })

    if (error) {
      console.error('Export subscribers error:', error)
      return NextResponse.json({ error: 'Export fehlgeschlagen' }, { status: 500 })
    }

    const result = {
      exported_at: new Date().toISOString(),
      count: data.length,
      subscribers: data.map(s => ({
        email: s.email,
        registered_at: s.created_at,
      })),
    }

    return NextResponse.json(result)
  } catch (err) {
    console.error('Export error:', err)
    return NextResponse.json({ error: 'Interner Fehler' }, { status: 500 })
  }
}

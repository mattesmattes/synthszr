import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

export async function GET() {
  try {
    const supabase = await createClient()

    const { data, error } = await supabase
      .from('languages')
      .select('*')
      .eq('is_active', true)
      .order('is_default', { ascending: false })
      .order('name', { ascending: true })

    if (error) {
      console.error('Error fetching languages:', error)
      return NextResponse.json(
        { error: 'Failed to fetch languages' },
        { status: 500 }
      )
    }

    return NextResponse.json({ languages: data })
  } catch (error) {
    console.error('Error in languages API:', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}

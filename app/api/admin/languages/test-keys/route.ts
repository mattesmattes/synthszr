import { NextResponse } from 'next/server'
import { testApiKeys } from '@/lib/i18n/translation-service'
import { getSession } from '@/lib/auth/session'

/**
 * POST /api/admin/languages/test-keys
 * Tests if API keys are actually working by making real API calls
 */
export async function POST() {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'Nicht autorisiert' }, { status: 401 })

  try {
    const results = await testApiKeys()

    return NextResponse.json(results)
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    )
  }
}

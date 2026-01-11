import { NextResponse } from 'next/server'
import { testApiKeys } from '@/lib/i18n/translation-service'

/**
 * POST /api/admin/languages/test-keys
 * Tests if API keys are actually working by making real API calls
 */
export async function POST() {
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

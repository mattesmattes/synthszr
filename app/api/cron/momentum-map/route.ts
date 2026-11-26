import { NextRequest, NextResponse } from 'next/server'
import { revalidatePath } from 'next/cache'
import { verifyCronAuth } from '@/lib/security/cron-auth'
import { requireAdmin } from '@/lib/auth/session'
import { buildMomentumMapData, saveMomentumMapSnapshot } from '@/lib/rankings/momentum-map'
import { generateAndCacheMomentumAnalysis } from '@/lib/rankings/momentum-map-analysis'

/**
 * Monthly Momentum Map Poster Cron (vercel.json: "0 6 28 * *").
 * Runs every 28th of the month at 06:00 UTC (30 min after precompute-metrics),
 * computes the new 90-day snapshot titled for the UPCOMING month
 * (e.g. Dec 28 -> "JAN 2027 · ISSUE 02"), generates the bilingual DE/EN
 * editorial prose analysis, archives the snapshot in Supabase `settings`,
 * and updates `momentum_map_snapshot:latest`.
 */
export const maxDuration = 120

async function runMonthlyPosterGeneration() {
  const now = new Date()

  // 1. Build fresh 90-day snapshot titled for the upcoming month
  const initial = await buildMomentumMapData(now, { forceUpcomingMonth: true })

  // 2. Generate & cache bilingual prose analysis for the new issue
  let analysisGenerated = false
  try {
    const analysis = await generateAndCacheMomentumAnalysis(initial.monthLabel, initial.monthlyReport, { force: true })
    analysisGenerated = Boolean(analysis)
  } catch (err) {
    console.error('[Cron] momentum-map analysis generation failed (saving snapshot without prose):', err)
  }

  // 3. Re-build snapshot so the freshly cached analysis is embedded cleanly
  const finalData = analysisGenerated
    ? await buildMomentumMapData(now, { forceUpcomingMonth: true })
    : initial

  const { archiveKey } = await saveMomentumMapSnapshot(finalData)

  // 4. Revalidate public poster pages
  for (const locale of ['en', 'de', 'fr', 'cs', 'nds']) {
    revalidatePath(`/${locale}/rankings/poster`)
  }

  console.log(
    `[Cron] momentum-map generated ${finalData.issueCode} (${finalData.monthLabel}) -> ${archiveKey} (analysis=${analysisGenerated})`
  )

  return NextResponse.json({
    ok: true,
    issueCode: finalData.issueCode,
    monthLabel: finalData.monthLabel,
    archiveKey,
    analysisGenerated,
    mentions90d: finalData.totalMentions90d,
    articles90d: finalData.totalArticles90d,
    categories: finalData.categories.length,
  })
}

export async function GET(request: NextRequest) {
  const auth = verifyCronAuth(request)
  if (!auth.authorized) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  try {
    return await runMonthlyPosterGeneration()
  } catch (err) {
    console.error('[Cron] momentum-map GET failed:', err)
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Generation failed' },
      { status: 500 }
    )
  }
}

export async function POST(request: NextRequest) {
  const authError = await requireAdmin(request)
  if (authError) return authError
  try {
    return await runMonthlyPosterGeneration()
  } catch (err) {
    console.error('[Cron] momentum-map POST failed:', err)
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Generation failed' },
      { status: 500 }
    )
  }
}

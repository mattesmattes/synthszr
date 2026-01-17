import { NextResponse } from 'next/server'
import { createAnonClient } from '@/lib/supabase/admin'

interface CompanyMention {
  company_name: string
  company_slug: string
  company_type: 'public' | 'premarket'
  post_id: string
  created_at: string
}

interface CompanyAggregation {
  name: string
  slug: string
  type: 'public' | 'premarket'
  mentionCount: number
  latestMention: string
}

/**
 * GET /api/companies
 *
 * Returns all companies with mention counts, sorted alphabetically.
 * Only includes companies from published posts.
 */
export async function GET() {
  try {
    const supabase = createAnonClient()

    // Fetch all company mentions with post status filter
    // We need to join with generated_posts to check status
    const { data: mentions, error } = await supabase
      .from('post_company_mentions')
      .select(`
        company_name,
        company_slug,
        company_type,
        post_id,
        created_at,
        post:generated_posts!inner(status)
      `)
      .eq('post.status', 'published')

    if (error) {
      console.error('[api/companies] Query error:', error)
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    // Aggregate mentions by company
    const companyMap = new Map<string, CompanyAggregation>()

    for (const mention of (mentions || []) as CompanyMention[]) {
      const existing = companyMap.get(mention.company_slug)
      if (existing) {
        existing.mentionCount++
        if (mention.created_at > existing.latestMention) {
          existing.latestMention = mention.created_at
        }
      } else {
        companyMap.set(mention.company_slug, {
          name: mention.company_name,
          slug: mention.company_slug,
          type: mention.company_type,
          mentionCount: 1,
          latestMention: mention.created_at,
        })
      }
    }

    // Convert to array and sort alphabetically
    const companies = Array.from(companyMap.values())
      .sort((a, b) => a.name.localeCompare(b.name, 'de'))

    return NextResponse.json({
      ok: true,
      companies,
      total: companies.length,
    })
  } catch (error) {
    console.error('[api/companies] Failed:', error)
    const message = error instanceof Error ? error.message : 'Unknown error'
    return NextResponse.json({ ok: false, error: message }, { status: 500 })
  }
}

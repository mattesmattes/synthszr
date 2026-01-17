#!/usr/bin/env npx tsx
/**
 * Migrate Company Mentions
 *
 * One-time migration script that extracts company mentions from all
 * published posts and populates the post_company_mentions table.
 *
 * Run: npx tsx scripts/migrate-company-mentions.ts
 *
 * Prerequisites:
 * 1. Run the database migration first: npx supabase db push
 * 2. Ensure SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are set in .env.local
 */

import { createClient } from '@supabase/supabase-js'
import * as dotenv from 'dotenv'
import * as path from 'path'

// Load env vars from .env.local
dotenv.config({ path: path.join(__dirname, '..', '.env.local') })

// Import from relative paths since we're running as a script
import { KNOWN_COMPANIES, KNOWN_PREMARKET_COMPANIES } from '../lib/data/companies'
import { COMPANY_ALIASES } from '../lib/data/company-aliases'
import { isExcludedCompanyName } from '../lib/data/company-exclusions'

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error('❌ Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY')
  process.exit(1)
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
})

// Types
interface TipTapNode {
  type?: string
  text?: string
  content?: TipTapNode[]
}

interface ExtractedCompany {
  name: string
  slug: string
  type: 'public' | 'premarket'
}

interface Post {
  id: string
  title: string
  content: string
  status: string
}

// Extract text from TipTap JSON
function extractTextFromNode(node: TipTapNode): string {
  if (node.text) return node.text
  if (node.content && Array.isArray(node.content)) {
    return node.content.map(extractTextFromNode).join(' ')
  }
  return ''
}

function extractTextFromContent(content: unknown): string {
  if (!content || typeof content !== 'object') return ''
  return extractTextFromNode(content as TipTapNode)
}

// Escape regex special characters
function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

// Extract companies from content
function extractCompaniesFromContent(content: unknown): ExtractedCompany[] {
  const text = extractTextFromContent(content)
  if (!text) return []

  const companies: ExtractedCompany[] = []
  const seenSlugs = new Set<string>()

  const addCompany = (name: string, slug: string, type: 'public' | 'premarket') => {
    if (!seenSlugs.has(slug)) {
      seenSlugs.add(slug)
      companies.push({ name, slug, type })
    }
  }

  // Check public companies
  for (const [displayName, apiSlug] of Object.entries(KNOWN_COMPANIES)) {
    if (isExcludedCompanyName(displayName)) continue
    const regex = new RegExp(`\\b${escapeRegex(displayName)}s?(-[\\wäöüÄÖÜß]+)*\\b`, 'gi')
    const explicitRegex = new RegExp(`\\{${escapeRegex(displayName)}\\}`, 'gi')
    if (regex.test(text) || explicitRegex.test(text)) {
      addCompany(displayName, apiSlug, 'public')
    }
  }

  // Check premarket companies
  for (const [displayName, apiSlug] of Object.entries(KNOWN_PREMARKET_COMPANIES)) {
    if (isExcludedCompanyName(displayName)) continue
    const escapedName = escapeRegex(displayName)
    const regex = new RegExp(`\\b${escapedName}s?\\b`, 'gi')
    const explicitRegex = new RegExp(`\\{${escapedName}\\}`, 'gi')
    if (regex.test(text) || explicitRegex.test(text)) {
      addCompany(displayName, apiSlug, 'premarket')
    }
  }

  // Check company aliases
  for (const [aliasName, aliasInfo] of Object.entries(COMPANY_ALIASES)) {
    const escapedAlias = escapeRegex(aliasName)
    const regex = new RegExp(`\\b${escapedAlias}s?\\b`, 'gi')
    const explicitRegex = new RegExp(`\\{${escapedAlias}\\}`, 'gi')
    if (regex.test(text) || explicitRegex.test(text)) {
      const slug = aliasInfo.canonical.toLowerCase()
      addCompany(aliasInfo.canonical, slug, aliasInfo.type)
    }
  }

  return companies
}

async function migratePost(post: Post): Promise<{ success: boolean; companiesFound: number }> {
  try {
    // Parse content
    let content: unknown
    try {
      content = typeof post.content === 'string' ? JSON.parse(post.content) : post.content
    } catch {
      console.log(`  ⚠️ Invalid JSON for post ${post.id}`)
      return { success: false, companiesFound: 0 }
    }

    // Extract companies
    const companies = extractCompaniesFromContent(content)

    if (companies.length === 0) {
      return { success: true, companiesFound: 0 }
    }

    // Insert mentions
    const insertData = companies.map(company => ({
      post_id: post.id,
      company_name: company.name,
      company_slug: company.slug,
      company_type: company.type,
    }))

    const { error } = await supabase
      .from('post_company_mentions')
      .upsert(insertData, { onConflict: 'post_id,company_slug' })

    if (error) {
      console.error(`  ❌ Insert error for post ${post.id}:`, error.message)
      return { success: false, companiesFound: companies.length }
    }

    return { success: true, companiesFound: companies.length }
  } catch (error) {
    console.error(`  ❌ Error processing post ${post.id}:`, error)
    return { success: false, companiesFound: 0 }
  }
}

async function main() {
  console.log('🚀 Starting company mentions migration...\n')

  // Fetch all published posts
  const { data: posts, error } = await supabase
    .from('generated_posts')
    .select('id, title, content, status')
    .eq('status', 'published')
    .order('created_at', { ascending: true })

  if (error) {
    console.error('❌ Failed to fetch posts:', error.message)
    process.exit(1)
  }

  if (!posts || posts.length === 0) {
    console.log('ℹ️ No published posts found.')
    process.exit(0)
  }

  console.log(`📋 Found ${posts.length} published posts\n`)

  let totalSuccess = 0
  let totalFailed = 0
  let totalCompanies = 0

  for (const post of posts) {
    const shortTitle = post.title.substring(0, 50) + (post.title.length > 50 ? '...' : '')
    process.stdout.write(`  Processing: ${shortTitle}`)

    const result = await migratePost(post)

    if (result.success) {
      totalSuccess++
      totalCompanies += result.companiesFound
      console.log(` ✅ (${result.companiesFound} companies)`)
    } else {
      totalFailed++
      console.log(' ❌')
    }
  }

  console.log('\n' + '═'.repeat(50))
  console.log('📊 Migration Summary')
  console.log('═'.repeat(50))
  console.log(`  ✅ Success: ${totalSuccess} posts`)
  console.log(`  ❌ Failed: ${totalFailed} posts`)
  console.log(`  🏢 Companies found: ${totalCompanies} mentions`)
  console.log('═'.repeat(50) + '\n')

  if (totalFailed > 0) {
    process.exit(1)
  }
}

main().catch((error) => {
  console.error('❌ Migration failed:', error)
  process.exit(1)
})

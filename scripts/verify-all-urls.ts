/**
 * VERIFICATION SCRIPT - Run this anytime to verify all URLs are clean
 * npx tsx scripts/verify-all-urls.ts
 */

import { createClient } from '@supabase/supabase-js'
import * as dotenv from 'dotenv'
dotenv.config({ path: '.env.local' })

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL || '',
  process.env.SUPABASE_SERVICE_ROLE_KEY || ''
)

// ============================================
// COMPLETE LIST OF ALL TRACKING INDICATORS
// ============================================

const TRACKING_PARAMS = [
  // Beehiiv
  '_bhlid=', '_bhiiv=', 'bhcid=', 'bhcl_id=', 'bh_uid=',
  'last_resource_guid=', 'jwt_token=',
  // UTM
  'utm_source=', 'utm_medium=', 'utm_campaign=', 'utm_term=', 'utm_content=', 'utm_id=',
  // Social
  'fbclid=', 'gclid=', 'gclsrc=', 'dclid=', 'twclid=', 'msclkid=', 'li_fat_id=',
  // Email
  'mc_eid=', 'mc_cid=', 'cio_id=', 'cio_link_id=', 'sg_uid=', 'mkt_tok=',
  // Session/User
  'subscriber_id=', 'user_id=', 'email_id=', 'session_id=', 'link_id=',
  // HubSpot
  '__hsfp=', '__hssc=', '__hstc=', '__s=', 'hsCtaTracking=',
  // Other
  '_kx=', 'publication_id='
]

const REDIRECT_DOMAINS = [
  'link.mail.beehiiv.com',
  'links.beehiiv.com',
  'u001.beehiiv.com',
  'e.customeriomail.com',
  'customeriomail.com',
  'list-manage.com',
  'tracking.tldrnewsletter.com',
  'click.convertkit-mail.com',
  'email.mg.substack.com',
  'every.to/emails/click',
  'sendgrid.net/click',
  'mailchimp.com/track',
]

function checkContent(content: string): string[] {
  const issues: string[] = []

  for (const param of TRACKING_PARAMS) {
    if (content.includes(param)) {
      issues.push(param.replace('=', ''))
    }
  }

  for (const domain of REDIRECT_DOMAINS) {
    if (content.includes(domain)) {
      issues.push(domain)
    }
  }

  return issues
}

async function main() {
  console.log('╔═══════════════════════════════════════════════════╗')
  console.log('║     URL VERIFICATION - Synthszr Security Check    ║')
  console.log('╚═══════════════════════════════════════════════════╝\n')

  let totalProblems = 0

  // 1. Check German originals
  console.log('─── Deutsche Originalartikel ───')
  const { data: posts } = await supabase
    .from('generated_posts')
    .select('id, title, status, content')
    .eq('status', 'published')

  let deProblems = 0
  for (const post of posts || []) {
    const issues = checkContent(JSON.stringify(post.content))
    if (issues.length > 0) {
      console.log(`  ✗ ${post.title?.slice(0, 40)}...`)
      console.log(`    → ${issues.join(', ')}`)
      deProblems++
    }
  }

  if (deProblems === 0) {
    console.log(`  ✓ ${posts?.length} Artikel geprüft - ALLE SAUBER`)
  } else {
    console.log(`  ✗ ${deProblems} von ${posts?.length} haben Probleme`)
  }
  totalProblems += deProblems

  // 2. Check translations
  console.log('\n─── Übersetzungen ───')
  const { data: translations } = await supabase
    .from('content_translations')
    .select('id, generated_post_id, language_code, content')
    .not('generated_post_id', 'is', null)

  const publishedIds = new Set((posts || []).map(p => p.id))
  const publishedTranslations = (translations || []).filter(t => publishedIds.has(t.generated_post_id))

  const byLang: Record<string, { total: number; problems: number }> = {}

  for (const trans of publishedTranslations) {
    const lang = trans.language_code
    if (!byLang[lang]) byLang[lang] = { total: 0, problems: 0 }
    byLang[lang].total++

    if (trans.content) {
      const issues = checkContent(JSON.stringify(trans.content))
      if (issues.length > 0) {
        byLang[lang].problems++
        totalProblems++
      }
    }
  }

  for (const [lang, stats] of Object.entries(byLang)) {
    const status = stats.problems === 0 ? '✓' : '✗'
    console.log(`  ${status} ${lang.toUpperCase()}: ${stats.total} Übersetzungen, ${stats.problems} Probleme`)
  }

  // Final verdict
  console.log('\n═══════════════════════════════════════════════════')
  if (totalProblems === 0) {
    console.log('✓ ERGEBNIS: ALLE URLs SIND SAUBER')
    console.log(`  Geprüft: ${posts?.length} DE + ${publishedTranslations.length} Übersetzungen`)
  } else {
    console.log(`✗ ERGEBNIS: ${totalProblems} PROBLEME GEFUNDEN`)
  }
  console.log('═══════════════════════════════════════════════════')
}

main()

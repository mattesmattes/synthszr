#!/usr/bin/env node

/**
 * Full Pipeline Script
 * Runs the complete content generation pipeline for specified dates:
 * 1. Digest Analysis (from daily_repo)
 * 2. Synthesis Generation (historical connections)
 * 3. AI Article/Post Generation (ghostwriter)
 *
 * Usage: node scripts/run-full-pipeline.mjs
 *
 * Required env vars:
 * - NEXT_PUBLIC_SUPABASE_URL
 * - NEXT_PUBLIC_SUPABASE_ANON_KEY (or SUPABASE_SERVICE_ROLE_KEY for full access)
 * - GOOGLE_GENERATIVE_AI_API_KEY (for Gemini)
 * - ANTHROPIC_API_KEY (for Claude synthesis & ghostwriter)
 */

import { createClient } from '@supabase/supabase-js'

// Initialize Supabase client
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY

if (!supabaseUrl || !supabaseKey) {
  console.error('Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY')
  process.exit(1)
}

const supabase = createClient(supabaseUrl, supabaseKey)

// Dates to process (29.12.2025 - 03.01.2026)
const DATES_TO_PROCESS = [
  '2025-12-29',
  '2025-12-30',
  '2025-12-31',
  '2026-01-01',
  '2026-01-02',
  '2026-01-03',
]

// Canonical URLs for newsletter sources
const NEWSLETTER_CANONICAL_URLS = {
  'techmeme': 'https://techmeme.com',
  'stratechery': 'https://stratechery.com',
  'ben evans': 'https://www.ben-evans.com',
  'the information': 'https://www.theinformation.com',
  'axios': 'https://www.axios.com',
  'morning brew': 'https://www.morningbrew.com',
  'tldr': 'https://tldr.tech',
  'platformer': 'https://www.platformer.news',
  'the verge': 'https://www.theverge.com',
  'techcrunch': 'https://techcrunch.com',
  'wired': 'https://www.wired.com',
  'ars technica': 'https://arstechnica.com',
  'hacker news': 'https://news.ycombinator.com',
  'handelsblatt': 'https://www.handelsblatt.com',
  'morning briefing': 'https://www.handelsblatt.com/newsletter',
  'spiegel': 'https://www.spiegel.de',
  'faz': 'https://www.faz.net',
  'zeit': 'https://www.zeit.de',
  'heise': 'https://www.heise.de',
  't3n': 'https://t3n.de',
  'wsj': 'https://www.wsj.com',
  'wall street journal': 'https://www.wsj.com',
  'bloomberg': 'https://www.bloomberg.com',
  'medium': 'https://medium.com',
}

function extractSubstackInfo(email) {
  if (!email || !email.includes('@substack.com')) return null
  const subdomainMatch = email.match(/([a-z0-9_+-]+)@substack\.com/i)
  if (!subdomainMatch) return null
  const subdomain = subdomainMatch[1].split('+')[0]
  const nameMatch = email.match(/^"?([^"<]+)/)
  const name = nameMatch?.[1]?.trim() || subdomain
  return { name, url: `https://${subdomain}.substack.com` }
}

function findCanonicalUrl(title, email) {
  const substackInfo = extractSubstackInfo(email)
  if (substackInfo) return substackInfo
  const searchText = `${title} ${email || ''}`.toLowerCase()
  for (const [key, url] of Object.entries(NEWSLETTER_CANONICAL_URLS)) {
    if (searchText.includes(key)) {
      const name = email?.split('<')[0].trim() || key
      return { name, url }
    }
  }
  return null
}

// ============================================================================
// STEP 1: Digest Analysis
// ============================================================================
async function runDigestAnalysis(date) {
  console.log(`\n📰 [${date}] Starting Digest Analysis...`)

  // Check if digest already exists
  const { data: existingDigest } = await supabase
    .from('daily_digests')
    .select('id, word_count')
    .eq('digest_date', date)
    .single()

  if (existingDigest && existingDigest.word_count > 100) {
    console.log(`   ✓ Digest already exists (${existingDigest.word_count} words), skipping...`)
    return existingDigest.id
  }

  // Get active analysis prompt
  const { data: activePrompt } = await supabase
    .from('analysis_prompts')
    .select('prompt_text')
    .eq('is_active', true)
    .single()

  const promptText = activePrompt?.prompt_text || getDefaultAnalysisPrompt()

  // Get content for the date
  const { data: rawItems } = await supabase
    .from('daily_repo')
    .select('id, title, content, source_type, source_email, source_url, collected_at')
    .eq('newsletter_date', date)
    .order('collected_at', { ascending: false })

  if (!rawItems || rawItems.length === 0) {
    console.log(`   ⚠ No items found for ${date}, skipping...`)
    return null
  }

  console.log(`   Found ${rawItems.length} items in daily_repo`)

  // Apply source diversity filter (30% max per source)
  const getSourceId = (item) => {
    if (item.source_email) {
      const match = item.source_email.match(/<([^>]+)>/)
      return match ? match[1].toLowerCase() : item.source_email.toLowerCase().trim()
    }
    if (item.source_url) {
      try { return new URL(item.source_url).hostname.replace('www.', '') } catch {}
    }
    return 'unknown'
  }

  const itemsBySource = new Map()
  for (const item of rawItems) {
    const sourceId = getSourceId(item)
    if (!itemsBySource.has(sourceId)) itemsBySource.set(sourceId, [])
    itemsBySource.get(sourceId).push(item)
  }

  const maxPerSource = Math.max(2, Math.floor(rawItems.length * 0.3))
  const diverseItems = []
  for (const [, domainItems] of itemsBySource) {
    diverseItems.push(...domainItems.slice(0, maxPerSource))
  }
  const items = diverseItems.sort(() => Math.random() - 0.5)

  console.log(`   After diversity filter: ${items.length} items`)

  // Build content string
  const contentParts = []
  for (let i = 0; i < items.length; i++) {
    const item = items[i]
    let sourceDisplay
    if (item.source_url?.startsWith('http')) {
      try {
        const linkText = new URL(item.source_url).hostname.replace('www.', '')
        sourceDisplay = `[${linkText}](${item.source_url})`
      } catch { sourceDisplay = `[Link](${item.source_url})` }
    } else {
      const sourceInfo = findCanonicalUrl(item.title, item.source_email)
      sourceDisplay = sourceInfo
        ? `[${sourceInfo.name}](${sourceInfo.url})`
        : `${item.source_email || 'Newsletter'}`
    }
    const content = (item.content || 'Kein Inhalt').slice(0, 20000)
    contentParts.push(`## ${i + 1}. ${item.title}\n**Quelle:** ${sourceDisplay}\n\n${content}\n\n---`)
  }

  const processedItemIds = items.map(item => item.id)
  const fullContent = contentParts.join('\n\n')

  console.log(`   Calling Gemini for analysis (${fullContent.length} chars)...`)

  // Call Gemini for analysis
  const { streamText } = await import('ai')
  const { google } = await import('@ai-sdk/google')

  const SYSTEM_PROMPT = `Du bist ein Kurator, der relevante Inhalte für einen Newsletter SELEKTIERT und DOKUMENTIERT.

KRITISCHE REGEL - FILTERUNG:
- Zeige NUR Quellen, die für das Thema RELEVANT sind
- IGNORIERE irrelevante Quellen KOMPLETT - erwähne sie NICHT
- Schreibe NIEMALS "nicht relevant" oder "enthält keine relevanten Informationen"
- Wenn eine Quelle nichts Relevantes enthält: ÜBERSPRINGE SIE STILLSCHWEIGEND

EXTRAKTION:
- Extrahiere VOLLSTÄNDIGE relevante Passagen und Zitate
- Behalte Originalformulierungen bei (übersetze nur ins Deutsche)
- Längere Abschnitte sind ERWÜNSCHT - das ist Rohmaterial

QUELLENANGABEN:
- JEDE Information MUSS mit dem zugehörigen Markdown-Link versehen sein
- Format: [Quellenname](URL) oder "Zitat" – [Quelle](URL)
- Ohne Link = ungültige Information

SPRACHE:
- Output auf Deutsch
- Englische Zitate übersetzen, Original in Klammern wenn besonders treffend
- Fachbegriffe können auf Englisch bleiben`

  const fullPrompt = `${SYSTEM_PROMPT}\n\n${promptText}\n\n---\n\nHier sind die Newsletter-Inhalte des Tages:\n\n${fullContent}`

  let analysisContent = ''
  const result = streamText({
    model: google('gemini-2.5-pro'),
    prompt: fullPrompt,
    maxOutputTokens: 16384,
  })

  for await (const chunk of result.textStream) {
    analysisContent += chunk
    process.stdout.write('.')
  }
  console.log('')

  const wordCount = analysisContent.split(/\s+/).length
  console.log(`   Generated ${wordCount} words`)

  // Save or update digest
  const digestData = {
    digest_date: date,
    analysis_content: analysisContent,
    word_count: wordCount,
    sources_used: processedItemIds,
  }

  let digestId
  if (existingDigest) {
    const { error: updateError } = await supabase.from('daily_digests').update(digestData).eq('id', existingDigest.id)
    if (updateError) console.error(`   ❌ Update error: ${updateError.message}`)
    digestId = existingDigest.id
    console.log(`   ✓ Updated existing digest: ${digestId}`)
  } else {
    const { data: newDigest, error: insertError } = await supabase.from('daily_digests').insert(digestData).select('id').single()
    if (insertError) {
      console.error(`   ❌ Insert error: ${insertError.message}`)
      // Try to find the digest we just created by date
      const { data: findDigest } = await supabase.from('daily_digests').select('id').eq('digest_date', date).single()
      digestId = findDigest?.id
    } else {
      digestId = newDigest?.id
    }
    console.log(`   ✓ Created new digest: ${digestId}`)
  }

  return digestId
}

// ============================================================================
// STEP 2: Synthesis Generation
// ============================================================================
async function runSynthesisGeneration(digestId, date) {
  console.log(`\n🔗 [${date}] Starting Synthesis Generation for digest ${digestId}...`)

  // Check if syntheses already exist
  const { count: existingSyntheses } = await supabase
    .from('developed_syntheses')
    .select('id', { count: 'exact', head: true })
    .eq('digest_id', digestId)

  if (existingSyntheses && existingSyntheses > 0) {
    console.log(`   ✓ ${existingSyntheses} syntheses already exist, skipping...`)
    return existingSyntheses
  }

  // Get digest to find source items
  const { data: digest } = await supabase
    .from('daily_digests')
    .select('sources_used, digest_date')
    .eq('id', digestId)
    .single()

  if (!digest?.sources_used?.length) {
    console.log(`   ⚠ No sources found in digest, skipping synthesis...`)
    return 0
  }

  // Get items from digest
  const { data: items } = await supabase
    .from('daily_repo')
    .select('id, title, content, embedding')
    .in('id', digest.sources_used)

  if (!items?.length) {
    console.log(`   ⚠ No items found, skipping...`)
    return 0
  }

  console.log(`   Processing ${items.length} items...`)

  // Get active synthesis prompt
  const { data: synthesisPrompt } = await supabase
    .from('synthesis_prompts')
    .select('prompt_text, core_thesis')
    .eq('is_active', true)
    .single()

  const developmentPrompt = synthesisPrompt?.prompt_text || getDefaultSynthesisPrompt()
  const coreThesis = synthesisPrompt?.core_thesis || ''

  let synthesesCreated = 0
  const Anthropic = (await import('@anthropic-ai/sdk')).default
  const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

  for (let i = 0; i < items.length; i++) {
    const item = items[i]
    process.stdout.write(`   [${i + 1}/${items.length}] ${item.title.slice(0, 40)}...`)

    // Generate embedding if missing
    let embedding = item.embedding
    if (!embedding) {
      const { GoogleGenerativeAI } = await import('@google/generative-ai')
      const genAI = new GoogleGenerativeAI(process.env.GOOGLE_GENERATIVE_AI_API_KEY)
      const model = genAI.getGenerativeModel({ model: 'text-embedding-004' })
      const result = await model.embedContent(item.title + '\n\n' + (item.content || '').slice(0, 5000))
      embedding = result.embedding.values

      // Save embedding
      await supabase.from('daily_repo').update({ embedding }).eq('id', item.id)
    }

    // Find similar historical items
    const { data: similar } = await supabase.rpc('find_similar_items', {
      query_embedding: embedding,
      item_id: item.id,
      max_age_days: 90,
      match_threshold: 0.5,
      match_count: 3
    })

    if (!similar?.length) {
      console.log(' no matches')
      continue
    }

    // Use best match
    const bestMatch = similar[0]
    console.log(` match: ${bestMatch.similarity.toFixed(2)}`)

    // Develop synthesis with Claude
    const currentNews = `${item.title}\n\n${(item.content || '').slice(0, 2000)}`
    const historicalNews = `${bestMatch.title}\n\n${(bestMatch.content || '').slice(0, 2000)}`
    const daysAgo = Math.floor((Date.now() - new Date(bestMatch.collected_at).getTime()) / (1000 * 60 * 60 * 24))

    const prompt = developmentPrompt
      .replace('{current_news}', currentNews)
      .replace('{historical_news}', historicalNews)
      .replace('{days_ago}', String(daysAgo))
      .replace('{synthesis_type}', 'Thematische Verbindung')
      .replace('{core_thesis}', coreThesis)

    try {
      const response = await anthropic.messages.create({
        model: 'claude-opus-4-20250514',
        max_tokens: 1024,
        messages: [{ role: 'user', content: prompt }],
      })

      const text = response.content[0].type === 'text' ? response.content[0].text : ''

      // Parse response
      const headlineMatch = text.match(/HEADLINE:\s*(.+?)(?:\n|$)/i)
      const syntheseMatch = text.match(/SYNTHESE:\s*([\s\S]+?)(?=REFERENZ:|$)/i)
      const referenzMatch = text.match(/REFERENZ:\s*(.+?)(?:\n|$)/i)

      const synthesis = {
        digest_id: digestId,
        source_item_id: item.id,
        related_item_id: bestMatch.id,
        headline: headlineMatch?.[1]?.trim() || 'Synthese',
        content: syntheseMatch?.[1]?.trim() || text,
        historical_reference: referenzMatch?.[1]?.trim() || bestMatch.title,
        similarity_score: bestMatch.similarity,
        synthesis_type: 'Thematische Verbindung',
      }

      await supabase.from('developed_syntheses').insert(synthesis)
      synthesesCreated++

      // Rate limit for Claude Opus
      await new Promise(r => setTimeout(r, 1000))
    } catch (error) {
      console.log(` error: ${error.message}`)
    }
  }

  console.log(`   ✓ Created ${synthesesCreated} syntheses`)
  return synthesesCreated
}

// ============================================================================
// STEP 3: AI Article Generation (Ghostwriter)
// ============================================================================
async function runArticleGeneration(digestId, date) {
  console.log(`\n✍️  [${date}] Starting Article Generation for digest ${digestId}...`)

  // Check if post already exists
  const { data: existingPost } = await supabase
    .from('generated_posts')
    .select('id, title, word_count')
    .eq('digest_id', digestId)
    .single()

  if (existingPost && existingPost.word_count > 200) {
    console.log(`   ✓ Post already exists: "${existingPost.title}" (${existingPost.word_count} words), skipping...`)
    return existingPost.id
  }

  // Get digest
  const { data: digest } = await supabase
    .from('daily_digests')
    .select('*')
    .eq('id', digestId)
    .single()

  if (!digest) {
    console.log(`   ⚠ Digest not found, skipping...`)
    return null
  }

  // Get sources
  let sources = []
  if (digest.sources_used?.length) {
    const { data } = await supabase
      .from('daily_repo')
      .select('title, source_url, source_email, source_type')
      .in('id', digest.sources_used)
    sources = data || []
  }

  // Get syntheses
  const { data: syntheses } = await supabase
    .from('developed_syntheses')
    .select(`
      headline,
      content,
      historical_reference,
      source_item_id,
      daily_repo!developed_syntheses_source_item_id_fkey(title)
    `)
    .eq('digest_id', digestId)

  // Get active ghostwriter prompt
  const { data: ghostPrompt } = await supabase
    .from('ghostwriter_prompts')
    .select('prompt_text')
    .eq('is_active', true)
    .single()

  const promptText = ghostPrompt?.prompt_text || getDefaultGhostwriterPrompt()

  // Build source reference
  let sourceReference = ''
  if (sources.length > 0) {
    const sourcesWithUrls = sources.map(s => {
      if (s.source_url?.startsWith('http')) {
        return { title: s.title, url: s.source_url }
      }
      const info = findCanonicalUrl(s.title, s.source_email)
      return info ? { title: s.title, url: info.url } : null
    }).filter(Boolean)

    if (sourcesWithUrls.length > 0) {
      sourceReference = '\n\n---\n\nVERFÜGBARE QUELLEN MIT LINKS:\n'
      sourceReference += sourcesWithUrls.map((s, i) => `${i + 1}. [${s.title}](${s.url})`).join('\n')
    }
  }

  // Build synthesis context
  let synthesisContext = ''
  if (syntheses?.length > 0) {
    synthesisContext = '\n\n---\n\n## HINTERGRUND-RECHERCHE FÜR "MATTES SYNTHESE"\n\n'
    for (const syn of syntheses) {
      const articleTitle = syn.daily_repo?.title || 'Unbekannt'
      synthesisContext += `**ARTIKEL:** "${articleTitle.slice(0, 80)}"\n`
      synthesisContext += `**Recherchierte Verbindung:** ${syn.headline}\n`
      synthesisContext += `**Kontext:** ${syn.content}\n`
      if (syn.historical_reference) {
        synthesisContext += `**Historischer Bezug:** ${syn.historical_reference}\n`
      }
      synthesisContext += '\n---\n\n'
    }
  }

  const fullContent = digest.analysis_content + sourceReference + synthesisContext

  console.log(`   Calling Claude for ghostwriting (${fullContent.length} chars)...`)

  // Call Claude for ghostwriting
  const Anthropic = (await import('@anthropic-ai/sdk')).default
  const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

  let articleContent = ''
  const stream = anthropic.messages.stream({
    model: 'claude-sonnet-4-20250514',
    max_tokens: 8192,
    system: promptText,
    messages: [{ role: 'user', content: fullContent }],
  })

  for await (const event of stream) {
    if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') {
      articleContent += event.delta.text
      process.stdout.write('.')
    }
  }
  console.log('')

  // Extract title from content (first # heading)
  const titleMatch = articleContent.match(/^#\s+(.+)$/m)
  const title = titleMatch?.[1] || `Tagessynthese ${date}`

  // Create slug
  const slug = title.toLowerCase()
    .replace(/[äöüß]/g, c => ({ 'ä': 'ae', 'ö': 'oe', 'ü': 'ue', 'ß': 'ss' })[c])
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')

  const wordCount = articleContent.split(/\s+/).length
  console.log(`   Generated "${title}" (${wordCount} words)`)

  // Save post
  const postData = {
    digest_id: digestId,
    title,
    slug: `${slug}-${Date.now()}`,
    excerpt: articleContent.slice(0, 300) + '...',
    content: articleContent,
    word_count: wordCount,
    status: 'draft',
    category: 'tagessynthese',
  }

  let postId
  if (existingPost) {
    await supabase.from('generated_posts').update(postData).eq('id', existingPost.id)
    postId = existingPost.id
    console.log(`   ✓ Updated existing post: ${postId}`)
  } else {
    const { data: newPost } = await supabase.from('generated_posts').insert(postData).select('id').single()
    postId = newPost?.id
    console.log(`   ✓ Created new post: ${postId}`)
  }

  return postId
}

// ============================================================================
// Default Prompts
// ============================================================================
function getDefaultAnalysisPrompt() {
  return `ZIEL: Erstelle eine AUSFÜHRLICHE MATERIALSAMMLUNG für meinen Synthzr Newsletter.

KERNTHESE: AI macht nicht alles effizienter – die Synthese aus Marketing, Design, Business und Code führt zu völlig neuen Produkten/Services.

FORMAT FÜR JEDE QUELLE:
## [Titel der Quelle](URL)
**Kernaussagen:**
- [Vollständiges Zitat oder Passage]

**Originalzitate:**
> "Direktes Zitat" – [Quelle](URL)

**Relevanz für Synthese-These:**
[Warum interessant?]`
}

function getDefaultSynthesisPrompt() {
  return `Du analysierst eine aktuelle News und einen historischen Artikel um eine Synthese zu erstellen.

AKTUELLE NEWS:
{current_news}

HISTORISCHER ARTIKEL (vor {days_ago} Tagen):
{historical_news}

KERNTHESE: {core_thesis}

Erstelle eine kurze, prägnante Synthese im folgenden Format:

HEADLINE: [Prägnante Überschrift für die Verbindung]
SYNTHESE: [2-3 Sätze die erklären wie die aktuelle News mit dem historischen Artikel zusammenhängt]
REFERENZ: [Titel des historischen Artikels]`
}

function getDefaultGhostwriterPrompt() {
  return `Du bist ein erfahrener Tech-Blogger für den Synthzr Newsletter.

STIL:
- Persönlich aber professionell
- Aktive Sprache, direkte Ansprache
- Konkret und praxisorientiert

STRUKTUR:
- Fesselnder Hook am Anfang
- Klare Abschnitte mit Zwischenüberschriften
- Jeder News-Artikel: 5-7 Sätze
- "Mattes Synthese" Kommentare basierend auf Hintergrund-Recherche

FORMAT:
- Deutsch
- Markdown Formatierung
- 800-1200 Wörter`
}

// ============================================================================
// Main Execution
// ============================================================================
async function main() {
  console.log('═'.repeat(60))
  console.log('  SYNTHSZR FULL PIPELINE')
  console.log('  Dates: ' + DATES_TO_PROCESS.join(', '))
  console.log('═'.repeat(60))

  const results = []

  for (const date of DATES_TO_PROCESS) {
    console.log(`\n${'─'.repeat(60)}`)
    console.log(`  Processing: ${date}`)
    console.log('─'.repeat(60))

    const result = { date, digestId: null, syntheses: 0, postId: null, error: null }

    try {
      // Step 1: Digest Analysis
      result.digestId = await runDigestAnalysis(date)

      if (result.digestId) {
        // Step 2: Synthesis Generation
        result.syntheses = await runSynthesisGeneration(result.digestId, date)

        // Step 3: Article Generation
        result.postId = await runArticleGeneration(result.digestId, date)
      }
    } catch (error) {
      result.error = error.message
      console.error(`   ❌ Error: ${error.message}`)
    }

    results.push(result)

    // Small delay between dates
    await new Promise(r => setTimeout(r, 2000))
  }

  // Summary
  console.log(`\n${'═'.repeat(60)}`)
  console.log('  SUMMARY')
  console.log('═'.repeat(60))

  for (const r of results) {
    const status = r.error ? '❌' : (r.postId ? '✅' : '⚠️')
    console.log(`${status} ${r.date}: Digest=${r.digestId || 'none'}, Syntheses=${r.syntheses}, Post=${r.postId || 'none'}`)
    if (r.error) console.log(`   Error: ${r.error}`)
  }

  const successful = results.filter(r => r.postId).length
  console.log(`\nCompleted: ${successful}/${results.length} dates processed successfully`)
}

main().catch(console.error)

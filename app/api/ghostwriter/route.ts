import { NextRequest } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { getSession } from '@/lib/auth/session'
import { streamGhostwriter, findDuplicateMetaphors, streamMetaphorDeduplication, type AIModel } from '@/lib/claude/ghostwriter'
import { getSynthesesForDigest } from '@/lib/synthesis/pipeline'
import { sanitizeUrl, isTrackingRedirectUrl } from '@/lib/utils/url-sanitizer'
import { KNOWN_COMPANIES, KNOWN_PREMARKET_COMPANIES } from '@/lib/data/companies'

const VALID_MODELS: AIModel[] = ['claude-opus-4', 'claude-sonnet-4', 'gemini-2.5-pro', 'gemini-3-pro-preview', 'gpt-5.2', 'gpt-5.2-mini']

// Canonical URLs for newsletter sources that may not have direct article URLs
const NEWSLETTER_CANONICAL_URLS: Record<string, string> = {
  'techmeme': 'https://techmeme.com',
  'stratechery': 'https://stratechery.com',
  'ben evans': 'https://www.ben-evans.com',
  'benedict evans': 'https://www.ben-evans.com',
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
  // German sources
  'handelsblatt': 'https://www.handelsblatt.com',
  'morning briefing': 'https://www.handelsblatt.com/newsletter',
  'spiegel': 'https://www.spiegel.de',
  'faz': 'https://www.faz.net',
  'zeit': 'https://www.zeit.de',
  'heise': 'https://www.heise.de',
  't3n': 'https://t3n.de',
  'gruenderszene': 'https://www.businessinsider.de/gruenderszene',
  // More international sources
  'wsj': 'https://www.wsj.com',
  'wall street journal': 'https://www.wsj.com',
  'bloomberg': 'https://www.bloomberg.com',
  'medium': 'https://medium.com',
  // Note: No generic 'substack' - we extract specific newsletter URLs below
}

// Extract specific Substack newsletter URL from email
// e.g., "Machine Learning Pills <mlpills@substack.com>" → { name: "Machine Learning Pills", url: "https://mlpills.substack.com" }
function extractSubstackInfo(email: string | null): { name: string; url: string } | null {
  if (!email || !email.includes('@substack.com')) return null

  // Extract subdomain from email (before @substack.com)
  const subdomainMatch = email.match(/([a-z0-9_+-]+)@substack\.com/i)
  if (!subdomainMatch) return null

  // Clean subdomain (remove + variants like "getfivethings+tech")
  const subdomain = subdomainMatch[1].split('+')[0]

  // Extract newsletter name (before the < in email)
  const nameMatch = email.match(/^"?([^"<]+)/)
  const name = nameMatch?.[1]?.trim() || subdomain

  return {
    name,
    url: `https://${subdomain}.substack.com`
  }
}

// Extract newsletter name from email format like "Newsletter Name <email@domain.com>"
// or "\"Newsletter Name\" <email@domain.com>"
function extractNewsletterName(email: string | null): string | null {
  if (!email) return null

  // Try to extract name from quotes or before <
  // Format: "Name" <email> or Name <email>
  const nameMatch = email.match(/^"?([^"<]+)"?\s*</)
  if (nameMatch) {
    const name = nameMatch[1].trim()
    // Skip if name is just an email address
    if (!name.includes('@') && name.length > 0) {
      return name
    }
  }

  return null
}

// Map of known email domains/addresses to canonical newsletter names
const EMAIL_TO_NEWSLETTER: Record<string, string> = {
  // Substack newsletters (name extracted automatically, but some need overrides)
  'thepragmaticengineer': 'The Pragmatic Engineer',
  'lenny': 'Lenny\'s Newsletter',
  'refactoring': 'Refactoring',
  'exponentialview': 'Exponential View',
  'stratechery': 'Stratechery',
  'noahpinion': 'Noahpinion',
  'astralcodexten': 'Astral Codex Ten',

  // Other newsletters (by domain or full email)
  'connie@strictlyvc.com': 'StrictlyVC',
  'casey@platformer.news': 'Platformer',
  'newsletter@techmeme.com': 'Techmeme',
  'info@theinformation.com': 'The Information',
  'hello@theinformation.com': 'The Information',
  'hi@mail.theresanaiforthat.com': 'There\'s An AI For That',
  'futurism@mail.beehiiv.com': 'Futurism',
  'yo@dev.to': 'DEV Community',
  'nytdirect@nytimes.com': 'The New York Times',
  'wallstreetjournal@mail.dowjones.com': 'The Wall Street Journal',
  'morning.briefing.plus@redaktion.handelsblatt.com': 'Handelsblatt',
  'crew@morningbrew.com': 'Morning Brew',
  'dan@tldrnewsletter.com': 'TLDR',
  'theneuron@newsletter.theneurondaily.com': 'The Neuron',
  'news@daily.therundown.ai': 'The Rundown AI',
  'newsletters@technologyreview.com': 'MIT Technology Review',
  'mattes.schrader@oh-so.com': 'Autopreneur',

  // Platform domains (used if specific email not found)
  'mail.beehiiv.com': 'Beehiiv Newsletter',
  'substack.com': 'Substack',
}

// Get newsletter name from source_email using multiple strategies
function getNewsletterName(sourceEmail: string | null): string | null {
  if (!sourceEmail) return null

  // 1. Try to extract full email address and look up in map
  const emailMatch = sourceEmail.match(/<([^>]+)>/)
  const emailAddress = emailMatch ? emailMatch[1].toLowerCase() : sourceEmail.toLowerCase().trim()

  if (EMAIL_TO_NEWSLETTER[emailAddress]) {
    return EMAIL_TO_NEWSLETTER[emailAddress]
  }

  // 2. For Substack, extract subdomain and look up
  const substackMatch = emailAddress.match(/([a-z0-9_+-]+)@substack\.com/i)
  if (substackMatch) {
    const subdomain = substackMatch[1].split('+')[0]
    if (EMAIL_TO_NEWSLETTER[subdomain]) {
      return EMAIL_TO_NEWSLETTER[subdomain]
    }
  }

  // 3. Try to match by domain
  const domainMatch = emailAddress.match(/@([^@]+)$/)
  if (domainMatch) {
    const domain = domainMatch[1]
    if (EMAIL_TO_NEWSLETTER[domain]) {
      return EMAIL_TO_NEWSLETTER[domain]
    }
  }

  // 4. Fall back to extracting name from email format
  const extractedName = extractNewsletterName(sourceEmail)
  if (extractedName) {
    return extractedName
  }

  return null
}

export async function POST(request: NextRequest) {
  // Allow authentication via session OR cron secret (for scheduled tasks on Vercel)
  const session = await getSession()
  const authHeader = request.headers.get('authorization')
  const cronSecretValid = authHeader === `Bearer ${process.env.CRON_SECRET}`

  if (!session && !cronSecretValid) {
    return new Response(JSON.stringify({ error: 'Nicht autorisiert' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' },
    })
  }

  try {
    const body = await request.json()
    const { digestId, promptId, vocabularyIntensity = 50, model: requestedModel } = body

    if (!digestId) {
      return new Response(JSON.stringify({ error: 'Digest ID erforderlich' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      })
    }

    // Validate and default the model
    const model: AIModel = VALID_MODELS.includes(requestedModel) ? requestedModel : 'gemini-2.5-pro'
    console.log(`[Ghostwriter] Requested model: ${requestedModel}, using: ${model}`)

    const supabase = await createClient()

    // Get the digest content
    const { data: digest, error: digestError } = await supabase
      .from('daily_digests')
      .select('*')
      .eq('id', digestId)
      .single()

    if (digestError || !digest) {
      return new Response(JSON.stringify({ error: 'Digest nicht gefunden' }), {
        status: 404,
        headers: { 'Content-Type': 'application/json' },
      })
    }

    // Get original sources for this digest
    // IMPORTANT: Use sources_used if available (matches what syntheses were created for)
    // Otherwise fall back to newsletter_date (legacy behavior)
    let sources: Array<{ title: string; source_url: string | null; source_email: string | null; source_type: string }> | null = null

    if (digest.sources_used && digest.sources_used.length > 0) {
      console.log(`[Ghostwriter] Using ${digest.sources_used.length} items from sources_used`)
      const { data } = await supabase
        .from('daily_repo')
        .select('title, source_url, source_email, source_type')
        .in('id', digest.sources_used)
      sources = data
    } else {
      console.log(`[Ghostwriter] Fallback: Loading items by newsletter_date`)
      const { data } = await supabase
        .from('daily_repo')
        .select('title, source_url, source_email, source_type')
        .eq('newsletter_date', digest.digest_date)
        .order('collected_at', { ascending: true })
      sources = data
    }

    // Build a source reference list for the ghostwriter
    // Use canonical URLs for known newsletters without direct article URLs
    let sourceReference = ''
    let diversityWarning = ''

    if (sources && sources.length > 0) {
      // Analyze source diversity by SPECIFIC newsletter (not platform)
      // Count by the specific sender email address
      const sourceCount: Record<string, number> = {}

      for (const s of sources) {
        if (s.source_email) {
          // Extract email address from format like "Newsletter Name <email@domain.com>"
          const emailMatch = s.source_email.match(/<([^>]+)>/)
          const sourceId = emailMatch ? emailMatch[1].toLowerCase() : s.source_email.toLowerCase().trim()
          sourceCount[sourceId] = (sourceCount[sourceId] || 0) + 1
        } else if (s.source_url) {
          // Fallback to URL domain for articles without email
          try {
            const domain = new URL(s.source_url).hostname.replace('www.', '')
            sourceCount[domain] = (sourceCount[domain] || 0) + 1
          } catch {
            // Invalid URL, skip
          }
        }
      }

      // Check if any SPECIFIC newsletter exceeds 30%
      const threshold = sources.length * 0.3
      const overrepresentedSources: string[] = []

      for (const [sourceId, count] of Object.entries(sourceCount)) {
        if (count > threshold) {
          overrepresentedSources.push(`${sourceId} (${count}/${sources.length} = ${Math.round(count/sources.length*100)}%)`)
        }
      }

      if (overrepresentedSources.length > 0) {
        diversityWarning = '\n\n---\n\n⚠️ **QUELLEN-DIVERSITÄT WARNUNG:**\n'
        diversityWarning += 'Folgende Quellen sind überrepräsentiert (>30%):\n'
        diversityWarning += overrepresentedSources.map(s => `- ${s}`).join('\n')
        diversityWarning += '\n\n**WICHTIG:** Achte darauf, dass im finalen Blog-Post keine Quelle mehr als 30% der News ausmacht. '
        diversityWarning += 'Priorisiere News aus unterrepräsentierten Quellen und kürze ggf. News aus überrepräsentierten Quellen.\n'
      }

      const sourcesWithUrls = sources.map(s => {
        // Always try to get the newsletter name first
        const newsletterName = getNewsletterName(s.source_email)

        // If source has a valid article URL, use it
        if (s.source_url && s.source_url.startsWith('http')) {
          // SECURITY: Skip tracking/redirect URLs and sanitize remaining URLs
          if (isTrackingRedirectUrl(s.source_url)) {
            // Skip - this is a tracking redirect that can't be safely used
          } else {
            const cleanUrl = sanitizeUrl(s.source_url)
            if (cleanUrl) {
              return {
                title: s.title,
                url: cleanUrl,
                sourceName: newsletterName || extractNewsletterName(s.source_email)
              }
            }
          }
        }

        // For Substack newsletters, extract specific newsletter URL
        const substackInfo = extractSubstackInfo(s.source_email)
        if (substackInfo) {
          return {
            title: s.title,
            url: substackInfo.url,
            sourceName: newsletterName || substackInfo.name
          }
        }

        // Try to find a canonical URL based on title or email
        const titleLower = s.title?.toLowerCase() || ''
        const emailLower = s.source_email?.toLowerCase() || ''

        for (const [key, canonicalUrl] of Object.entries(NEWSLETTER_CANONICAL_URLS)) {
          if (titleLower.includes(key) || emailLower.includes(key)) {
            return {
              title: s.title,
              url: canonicalUrl,
              sourceName: newsletterName || key
            }
          }
        }

        // Last resort: return with newsletter name but no URL
        if (newsletterName) {
          return { title: s.title, url: null as string | null, sourceName: newsletterName as string | null }
        }

        return null
      }).filter((s): s is { title: string; url: string | null; sourceName: string | null } => s !== null)

      if (sourcesWithUrls.length > 0) {
        sourceReference = '\n\n---\n\nVERFÜGBARE QUELLEN (nutze den Quellennamen, NICHT den Artikeltitel als Quellenangabe):\n'
        sourceReference += '**WICHTIG:** Wenn du eine News-Quelle nennst, verwende den NEWSLETTER-NAMEN (z.B. "StrictlyVC", "Platformer"), NICHT den Artikeltitel!\n\n'
        sourceReference += sourcesWithUrls.map((item, i) => {
          if (!item) return ''
          const sourceInfo = item.sourceName ? ` [QUELLE: ${item.sourceName}]` : ''
          if (item.url) {
            return `${i + 1}. "${item.title}" → ${item.url}${sourceInfo}`
          } else {
            return `${i + 1}. "${item.title}"${sourceInfo}`
          }
        }).filter(Boolean).join('\n')
      }
    }

    // Get the ghostwriter prompt
    let promptText: string
    if (promptId) {
      const { data: prompt } = await supabase
        .from('ghostwriter_prompts')
        .select('prompt_text')
        .eq('id', promptId)
        .single()
      promptText = prompt?.prompt_text || ''
    } else {
      // Get active prompt
      const { data: activePrompt } = await supabase
        .from('ghostwriter_prompts')
        .select('prompt_text')
        .eq('is_active', true)
        .single()
      promptText = activePrompt?.prompt_text || getDefaultGhostwriterPrompt()
    }

    // Get vocabulary dictionary
    const { data: vocabulary } = await supabase
      .from('vocabulary_dictionary')
      .select('term, preferred_usage, avoid_alternatives, context, category')
      .order('category')

    // Get stylistic rules
    const { data: stylisticRules } = await supabase
      .from('stylistic_rules')
      .select('rule_type, name, description, examples, priority')
      .eq('is_active', true)
      .order('priority', { ascending: false })

    // Get developed syntheses for this digest (if available)
    let synthesisContext = ''
    try {
      const syntheses = await getSynthesesForDigest(digestId)
      if (syntheses && syntheses.length > 0) {
        synthesisContext = '\n\n---\n\n## HINTERGRUND-RECHERCHE FÜR "MATTES SYNTHESE"\n\n'
        synthesisContext += 'Für jeden Artikel wurde eine historische Verbindung recherchiert. '
        synthesisContext += 'Diese Recherche dient als HINTERGRUNDWISSEN für deinen "Mattes Synthese" Kommentar.\n\n'
        synthesisContext += '**WICHTIG:** Übernimm die Recherche NICHT wörtlich! Nutze sie stattdessen als Basis:\n'
        synthesisContext += '- Nimm die historische Verbindung zur Kenntnis\n'
        synthesisContext += '- Reflektiere die aktuelle News vor diesem Hintergrund\n'
        synthesisContext += '- Ordne die News in den größeren Kontext ein\n'
        synthesisContext += '- Formuliere deinen EIGENEN Kommentar im Ghostwriter-Stil\n\n'

        for (const synthesis of syntheses) {
          // Show which article this synthesis belongs to
          if (synthesis.sourceArticleTitle) {
            synthesisContext += `**ARTIKEL:** "${synthesis.sourceArticleTitle.slice(0, 80)}..."\n`
          }
          synthesisContext += `**Recherchierte Verbindung:** ${synthesis.headline}\n`
          synthesisContext += `**Kontext:** ${synthesis.content}\n`
          if (synthesis.historicalReference) {
            synthesisContext += `**Historischer Bezug:** ${synthesis.historicalReference}\n`
          }
          synthesisContext += '\n---\n\n'
        }

        synthesisContext += 'Schreibe zu jedem Artikel mit Recherche-Hintergrund einen "Synthszr Take:", '
        synthesisContext += 'der die aktuelle News im Licht der historischen Verbindung reflektiert und einordnet.'
      }
    } catch (error) {
      console.log('[Ghostwriter] No syntheses available (table may not exist yet)')
    }

    // Build vocabulary context based on intensity (0-100)
    let vocabularyContext = ''
    if (vocabulary && vocabulary.length > 0 && vocabularyIntensity > 0) {
      const intensity = Math.min(100, Math.max(0, vocabularyIntensity))

      // Determine intensity instructions
      let intensityInstruction = ''
      if (intensity <= 25) {
        intensityInstruction = 'Nutze diese Begriffe nur gelegentlich und wenn sie natürlich passen.'
      } else if (intensity <= 50) {
        intensityInstruction = 'Nutze diese Begriffe moderat und achte auf einen natürlichen Lesefluss.'
      } else if (intensity <= 75) {
        intensityInstruction = 'Nutze diese Begriffe aktiv und baue sie bewusst in den Text ein.'
      } else {
        intensityInstruction = 'Nutze diese Begriffe intensiv und durchgängig im gesamten Text. Jeder Absatz sollte mindestens einen Begriff enthalten.'
      }

      vocabularyContext = `\n\nVOKABULAR-RICHTLINIEN (Intensität: ${intensity}%):\n${intensityInstruction}\n\nBegriffe:\n`
      // Group vocabulary by category for better organization
      const vocabByCategory = vocabulary.reduce((acc, v) => {
        const cat = v.category || 'general'
        if (!acc[cat]) acc[cat] = []
        acc[cat].push(v)
        return acc
      }, {} as Record<string, typeof vocabulary>)

      // Prioritize important categories
      const categoryOrder = ['eigener_fachbegriff', 'metapher', 'anglizismus', 'phrase', 'satzkonstruktion', 'fachbegriff']
      const sortedCategories = Object.keys(vocabByCategory).sort((a, b) => {
        const aIdx = categoryOrder.indexOf(a)
        const bIdx = categoryOrder.indexOf(b)
        if (aIdx === -1 && bIdx === -1) return 0
        if (aIdx === -1) return 1
        if (bIdx === -1) return -1
        return aIdx - bIdx
      })

      for (const category of sortedCategories) {
        const items = vocabByCategory[category]
        if (items && items.length > 0) {
          vocabularyContext += `\n**${category.replace(/_/g, ' ').toUpperCase()}:**\n`
          vocabularyContext += items.map(v => {
            let entry = `- "${v.term}"`
            if (v.preferred_usage) entry += `: ${v.preferred_usage}`
            if (v.avoid_alternatives) entry += ` | Vermeide: ${v.avoid_alternatives}`
            return entry
          }).join('\n')
        }
      }
    }

    // Build stylistic rules context
    let stylisticContext = ''
    if (stylisticRules && stylisticRules.length > 0) {
      stylisticContext = '\n\n---\n\nSTILISTISCHE RICHTLINIEN (Matthias Schrader Stil):\n'

      // Group rules by type
      const rulesByType = stylisticRules.reduce((acc, r) => {
        if (!acc[r.rule_type]) acc[r.rule_type] = []
        acc[r.rule_type].push(r)
        return acc
      }, {} as Record<string, typeof stylisticRules>)

      // Sprachregister and core style
      if (rulesByType['sprachregister']) {
        stylisticContext += `\n**SPRACHREGISTER:** ${rulesByType['sprachregister'][0].description}\n`
      }

      // Personal pronouns preference
      if (rulesByType['personalpronomina']) {
        stylisticContext += `\n**PERSPEKTIVE:** ${rulesByType['personalpronomina'][0].description}\n`
      }

      // Punctuation style
      if (rulesByType['interpunktion']) {
        stylisticContext += `\n**INTERPUNKTION:** ${rulesByType['interpunktion'][0].description}\n`
      }

      // Text length preference
      if (rulesByType['textlaenge']) {
        stylisticContext += `\n**SATZSTRUKTUR:** ${rulesByType['textlaenge'][0].description}\n`
      }

      // Metaphor types
      if (rulesByType['metapherntyp'] && rulesByType['metapherntyp'].length > 0) {
        stylisticContext += `\n**BEVORZUGTE METAPHERN-BEREICHE:**\n`
        stylisticContext += rulesByType['metapherntyp'].map(r => `- ${r.description}`).join('\n')
      }

      // Frequently cited authors
      if (rulesByType['autorenzitat'] && rulesByType['autorenzitat'].length > 0) {
        stylisticContext += `\n\n**HÄUFIG ZITIERTE AUTOREN:** ${rulesByType['autorenzitat'].map(r => r.name).join(', ')}\n`
      }

      // General style rules
      if (rulesByType['stilregel']) {
        stylisticContext += `\n**WEITERE STILREGELN:**\n`
        stylisticContext += rulesByType['stilregel'].map(r => `- ${r.description}`).join('\n')
      }
    }

    // Combine prompt with vocabulary and stylistic rules
    const fullPrompt = promptText + vocabularyContext + stylisticContext

    // Build dynamic company lists from the actual data (synced from Glitch Green API)
    const publicCompanyList = Object.keys(KNOWN_COMPANIES).join(', ')
    const premarketCompanyList = Object.keys(KNOWN_PREMARKET_COMPANIES).join(', ')

    // Add explicit enforcement rules that appear at the end of the digest content
    // These are harder for the AI to ignore since they're the last thing it sees before generating
    const enforcementRules = `

---

## QUALITÄTS-CHECKLISTE (MUSS EINGEHALTEN WERDEN):

1. **NEWS-LÄNGE:** Jeder News-Artikel MUSS exakt 5-7 Sätze haben. Nicht 3, nicht 4. Mindestens 5, maximal 7 Sätze.
   - Satz 1-2: Was ist passiert?
   - Satz 3-4: Kontext und Bedeutung
   - Satz 5-7: Einordnung und weiterführender Gedanke

2. **SYNTHSZR TAKE:** Jeder "Synthszr Take:" MUSS MINDESTENS 5 Sätze haben (Ziel: 5-8 Sätze). Ein Take mit 2-3 Sätzen ist ZU KURZ!
   - Analytisch begründete Einordnung, darf positiv oder negativ bewerten
   - Basiert auf der mitgelieferten Hintergrund-Recherche
   - VERBOTENE SATZSTRUKTUREN: Keine Kontrastpaare ("nicht nur... sondern auch", "einerseits... andererseits", "zwar... aber"), keine Parallelkonstruktionen (gleichförmige Satzanfänge), kein "nicht ob X, sondern ob Y"
   - VERBOTENE PHRASEN: "Es bleibt abzuwarten", "Man darf gespannt sein", "Die Zeit wird zeigen", "Besonders bemerkenswert", "Spannend ist dabei", "Das Potenzial ist enorm", "Es zeigt sich", "Letztlich", "Am Ende des Tages", "revolutionär", "bahnbrechend", "wegweisend", "Die wahre [X] ist", "Die eigentliche [X] ist", "Die wirkliche [X] ist", "Die eigentliche Frage ist"
   - VERBOTENE STILMITTEL: Keine rhetorischen Fragen am Ende, kein "Doch" als dramatischer Satzanfang, keine qualifizierenden Relativierungen ("— und das ist erst der Anfang"), keine Pseudo-Mündlichkeit ("Mal ehrlich:", "Seien wir ehrlich:")
   - STATTDESSEN: Konkrete Fakten und Zahlen, aktive Verben, asymmetrische Satzlängen, nüchterne Analystensprache

3. **QUELLEN-DIVERSITÄT:** Keine Quelle darf >30% der News ausmachen.

4. **COMPANY TAGGING (PFLICHT):** Direkt nach dem letzten Satz der News (VOR dem "Synthszr Take:") eine Zeile einfügen: ERST die Tags in geschweiften Klammern, DANN Pfeil und Quellenname. Maximal 3 Tags. Auch setzen wenn das Unternehmen nur im Heading steht.

   **REIHENFOLGE ist fest: ZUERST Tags, DANN Quelle — niemals umgekehrt.**
   **FORMAT:** {TagA} {TagB} → Quellenname
   **FALSCH:** → Quellenname {TagA} {TagB}
   **RICHTIG:** {TagA} {TagB} → Quellenname
   **BEISPIELE (exakt diese Reihenfolge):**
   - {OpenAI} {Anthropic} → Techmeme
   - {Groq} {Cerebras} → The Information
   - {Waymo} {Tesla} → Bloomberg
   - {Vercel} {Supabase} → TechCrunch

   **VERFÜGBARE PUBLIC COMPANIES (börsennotiert):** ${publicCompanyList}

   **VERFÜGBARE PREMARKET COMPANIES (nicht börsennotiert):** ${premarketCompanyList}

   Nur Unternehmen aus diesen Listen taggen — exakt so wie dort geschrieben. Maximal 3 Tags pro News.

5. **EXCERPT FORMAT:** Der EXCERPT im Metadaten-Block MUSS exakt 3 Bullet Points haben:
   - Jeder Bullet beginnt mit • und headlinet pointiert je einen der ersten 3 Artikel
   - Max 65 Zeichen pro Bullet
   - Beispiel:
     EXCERPT:
     • OpenAI lanciert GPT-5.2 mit neuem Reasoning-Modus
     • Nvidia-Aktie bricht nach Quartalszahlen ein
     • EU beschließt härtere KI-Regulierung ab 2027

**WICHTIG:** Diese Regeln haben Priorität. Halte dich strikt daran.
`

    // Combine digest content with source reference, syntheses, and enforcement rules
    const fullDigestContent = digest.analysis_content + diversityWarning + sourceReference + synthesisContext + enforcementRules

    // Stream the response with post-processing for duplicate metaphors
    const encoder = new TextEncoder()
    const stream = new ReadableStream({
      async start(controller) {
        try {
          // Send initial event with model info
          controller.enqueue(encoder.encode(`data: ${JSON.stringify({ model, started: true })}\n\n`))

          // Phase 1: Generate the initial text and collect it
          let generatedText = ''
          for await (const chunk of streamGhostwriter(fullDigestContent, fullPrompt, model)) {
            generatedText += chunk
            controller.enqueue(encoder.encode(`data: ${JSON.stringify({ text: chunk })}\n\n`))
          }

          // Phase 2: Check for duplicate metaphors
          const duplicates = findDuplicateMetaphors(generatedText, vocabulary || undefined)

          if (duplicates.size > 0) {
            // Notify client that deduplication is starting
            const duplicateList = Array.from(duplicates.entries())
              .map(([m, p]) => `${m} (${p.length}x)`)
              .join(', ')
            controller.enqueue(encoder.encode(`data: ${JSON.stringify({
              phase: 'deduplication',
              message: `Prüfe auf wiederholte Metaphern: ${duplicateList}...`
            })}\n\n`))

            // Clear for new content
            controller.enqueue(encoder.encode(`data: ${JSON.stringify({ clear: true })}\n\n`))

            // Phase 3: Stream the deduplicated version
            for await (const chunk of streamMetaphorDeduplication(generatedText, duplicates, model)) {
              controller.enqueue(encoder.encode(`data: ${JSON.stringify({ text: chunk })}\n\n`))
            }

            controller.enqueue(encoder.encode(`data: ${JSON.stringify({
              done: true,
              model,
              deduplicationApplied: true,
              duplicatesFound: duplicateList
            })}\n\n`))
          } else {
            controller.enqueue(encoder.encode(`data: ${JSON.stringify({ done: true, model })}\n\n`))
          }
        } catch (error) {
          controller.enqueue(
            encoder.encode(
              `data: ${JSON.stringify({ error: error instanceof Error ? error.message : 'Ghostwriter fehlgeschlagen' })}\n\n`
            )
          )
        }
        controller.close()
      },
    })

    return new Response(stream, {
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
      },
    })
  } catch (error) {
    console.error('Ghostwriter error:', error)
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : 'Ghostwriter fehlgeschlagen' }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    )
  }
}

function getDefaultGhostwriterPrompt(): string {
  return `Du bist ein erfahrener Tech-Blogger und schreibst für den Synthzr Newsletter.

STIL UND TONALITÄT:
- Schreibe in einem persönlichen, aber professionellen Ton
- Nutze aktive Sprache und direkte Ansprache
- Vermeide Buzzwords und leere Phrasen
- Sei konkret und praxisorientiert

STRUKTUR:
- Beginne mit einem fesselnden Hook
- Gliedere den Artikel in klare Abschnitte
- Nutze Zwischenüberschriften für bessere Lesbarkeit
- Schließe mit einem Call-to-Action oder Ausblick

FORMAT:
- Schreibe auf Deutsch
- Nutze Markdown für Formatierung
- Ziel: 800-1200 Wörter`
}

import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
)

async function generateTestBlogpost() {
  const targetDate = "2026-01-03"

  // 1. Get digest for this date
  const { data: digest } = await supabase
    .from("daily_digests")
    .select("id, sources_used")
    .eq("digest_date", targetDate)
    .single()

  if (!digest) {
    console.log("Kein Digest für", targetDate, "gefunden. Bitte erst einen erstellen.")
    return
  }

  // 2. Get all daily_repo items for this date
  const { data: items } = await supabase
    .from("daily_repo")
    .select("id, title, content, source_email, source_url")
    .eq("newsletter_date", targetDate)
    .order("collected_at", { ascending: true })

  // 3. Get all developed syntheses for this digest
  const { data: syntheses } = await supabase
    .from("developed_syntheses")
    .select(`
      id,
      synthesis_headline,
      synthesis_content,
      historical_reference,
      candidate_id,
      synthesis_candidates!inner(source_item_id)
    `)
    .eq("digest_id", digest.id)

  // Create a map of source_item_id -> synthesis
  const synthesisMap = new Map()
  if (syntheses) {
    for (const s of syntheses) {
      const sourceId = s.synthesis_candidates?.source_item_id
      if (sourceId) {
        synthesisMap.set(sourceId, s)
      }
    }
  }

  // Extract newsletter name from email
  function getNewsletterName(email) {
    if (!email) return "Unbekannt"
    const nameMatch = email.match(/^"?([^"<]+)/)
    return nameMatch?.[1]?.trim() || email.split("@")[0]
  }

  // Output
  console.log("═".repeat(70))
  console.log("📰 SYNTHSZR BLOG POST - " + targetDate)
  console.log("═".repeat(70))
  console.log("")
  console.log("Items gefunden:", items?.length || 0)
  console.log("Synthesen gefunden:", syntheses?.length || 0)
  console.log("")
  console.log("─".repeat(70))
  console.log("")

  if (!items || items.length === 0) {
    console.log("Keine Items gefunden.")
    return
  }

  let newsNumber = 1
  for (const item of items) {
    const synthesis = synthesisMap.get(item.id)
    const newsletterName = getNewsletterName(item.source_email)

    console.log(`## NEWS ${newsNumber}: ${item.title.slice(0, 60)}...`)
    console.log(`📧 Quelle: ${newsletterName}`)
    console.log("")

    // News content (truncated)
    const contentPreview = item.content?.slice(0, 300)?.replace(/\n/g, " ") || "Kein Inhalt"
    console.log(`📝 Inhalt: ${contentPreview}...`)
    console.log("")

    if (synthesis) {
      console.log("🔗 SYNTHESE:")
      console.log(`   Headline: ${synthesis.synthesis_headline}`)
      console.log(`   ${synthesis.synthesis_content?.slice(0, 200)}...`)
      console.log("")
      console.log("💡 MATTES SYNTHESE:")
      console.log(`   > ${synthesis.historical_reference || "Keine historische Referenz"}`)
    } else {
      console.log("⚠️  Keine Synthese für diesen Artikel")
    }

    console.log("")
    console.log("─".repeat(70))
    console.log("")
    newsNumber++

    // Limit output for readability
    if (newsNumber > 8) {
      console.log(`... und ${items.length - 7} weitere Artikel`)
      break
    }
  }

  // Summary
  console.log("")
  console.log("═".repeat(70))
  console.log("📊 ZUSAMMENFASSUNG")
  console.log("═".repeat(70))
  console.log(`Total Items: ${items.length}`)
  console.log(`Mit Synthese: ${synthesisMap.size}`)
  console.log(`Ohne Synthese: ${items.length - synthesisMap.size}`)

  // Show which items have syntheses
  console.log("")
  console.log("Items mit Synthese:")
  for (const [itemId, synth] of synthesisMap) {
    const item = items.find(i => i.id === itemId)
    console.log(`  ✓ ${item?.title?.slice(0, 50) || itemId}`)
  }
}

generateTestBlogpost().catch(console.error)

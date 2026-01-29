import { createClient } from '@supabase/supabase-js'
import * as dotenv from 'dotenv'
dotenv.config({ path: '.env.local' })

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL || '',
  process.env.SUPABASE_SERVICE_ROLE_KEY || ''
)

const postId = '785b8336-bb1b-49f0-87e5-e032de2a4942'

async function restore() {
  // Check current state
  const { data: existing } = await supabase
    .from('post_images')
    .select('id, article_index, source_text, generation_status')
    .eq('post_id', postId)
    .eq('image_type', 'article_thumbnail')
    .order('article_index')

  console.log('Current thumbnails:', existing?.length || 0)
  existing?.forEach(t => {
    console.log(`  [${t.article_index}] ${t.generation_status}: ${t.source_text?.slice(0, 40)}...`)
  })

  if (existing && existing.length > 0) {
    console.log('\nThumbnails exist. To regenerate, open the post in admin and click "Generieren"')
    return
  }

  console.log('\nNo thumbnails found. Creating records...')

  const articles = [
    { index: 0, text: 'OpenAI startet mit einem TPK von 60 EUR' },
    { index: 1, text: 'Google integriert AI Overviews in Gemini-Chat' },
    { index: 2, text: 'Chrome erhält Auto-Browse-Modus mit Gemini' },
    { index: 3, text: 'Claude Code: Ein Werkzeug für Senior-Entwickler' },
    { index: 4, text: 'Illegale Krypto-Ökonomie wird von chinesischen Geldwäschenetzwerken angetrieben' },
    { index: 5, text: 'Halide-Mitgründer Sebastiaan de With wechselt zu Apples Design-Team' },
    { index: 6, text: 'Anthropic erhöht Umsatzprognose für 2026 auf 18 Mrd. USD' }
  ]

  for (const art of articles) {
    const { error } = await supabase
      .from('post_images')
      .insert({
        post_id: postId,
        image_url: '',
        image_type: 'article_thumbnail',
        article_index: art.index,
        source_text: art.text,
        generation_status: 'pending',
        vote_color: '#CCFF00'
      })

    if (error) {
      console.log(`[${art.index}] Error: ${error.message}`)
    } else {
      console.log(`[${art.index}] OK`)
    }
  }

  console.log('\nDone. Open the post in admin and click "Generieren" to create images.')
}

restore()

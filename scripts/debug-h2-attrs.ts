import { createClient } from '@supabase/supabase-js'
import * as dotenv from 'dotenv'
dotenv.config({ path: '.env.local' })

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

async function main() {
  const { data } = await supabase
    .from('generated_posts')
    .select('content')
    .eq('slug', 'claude-kann-jetzte-excel-ai-baut-sich-selber-minnesota-memes')
    .single()

  if (!data) {
    console.log('Not found')
    return
  }

  const content = typeof data.content === 'string' ? JSON.parse(data.content) : data.content

  // Find first H2
  function findH2s(node: any) {
    if (!node) return
    if (node.type === 'heading' && node.attrs?.level === 2) {
      const text = node.content?.map((c: any) => c.text || '').join('') || ''
      console.log('H2 text:', text.slice(0, 40))
      console.log('H2 attrs:', JSON.stringify(node.attrs))
      console.log()
    }
    if (node.content) node.content.forEach(findH2s)
  }
  findH2s(content)
}
main()

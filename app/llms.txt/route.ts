import { LLMS_TXT } from '@/lib/agents/discovery'

/** llms.txt: die Konvention, die KI-Crawler und Agenten zuerst lesen. */
export async function GET() {
  return new Response(LLMS_TXT, {
    headers: { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'public, max-age=3600' },
  })
}

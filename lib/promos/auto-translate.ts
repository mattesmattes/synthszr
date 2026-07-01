import crypto from 'crypto'
import { createAdminClient } from '@/lib/supabase/admin'

const LANGS: Record<string, string> = {
  en: 'English', cs: 'Czech', nds: 'Low German (Plattdeutsch)', fr: 'French',
  nl: 'Dutch', es: 'Spanish', it: 'Italian', pt: 'Portuguese', pl: 'Polish',
}
const TIMEOUT_MS = 120_000

function hashFields(fields: Record<string, string>): string {
  return crypto.createHash('sha1').update(JSON.stringify(fields)).digest('hex').slice(0, 16)
}

/** Übersetzt die DE-Felder in alle Zielsprachen (Sonnet, tool-use). HTML/Namen/URLs bleiben. */
async function translateFields(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  client: any, fields: Record<string, string>,
): Promise<Record<string, Record<string, string>>> {
  const keys = Object.keys(fields)
  const tool = {
    name: 'report',
    description: 'Übersetzungen je Zielsprache',
    input_schema: {
      type: 'object' as const,
      properties: Object.fromEntries(Object.keys(LANGS).map((l) => [l, { type: 'object', properties: Object.fromEntries(keys.map((f) => [f, { type: 'string' }])) }])),
      required: Object.keys(LANGS),
    },
  }
  const prompt = `Übersetze diese Marketing-Felder (Deutsch) in die Zielsprachen. Behalte HTML-Tags (<strong> etc.), Produktnamen (CODE CRASH, synthszr, RAIDAR) und URLs/Pfeile (→, codecrash.ai) unverändert. Natürliche, werbliche Sprache.

Felder:
${JSON.stringify(fields, null, 2)}

Zielsprachen: ${Object.entries(LANGS).map(([k, v]) => `${k}=${v}`).join(', ')}

Rufe report mit einem Objekt pro Sprache.`
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS)
  try {
    const resp = await client.messages.create({
      model: 'claude-sonnet-4-6', max_tokens: 3500,
      tools: [tool], tool_choice: { type: 'tool', name: 'report' },
      messages: [{ role: 'user', content: prompt }],
    }, { signal: controller.signal })
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const b = resp.content.find((x: any) => x.type === 'tool_use')
    return (b?.input ?? {}) as Record<string, Record<string, string>>
  } finally {
    clearTimeout(timer)
  }
}

/**
 * Übersetzt aktive Tip- und Ad-Promos, deren DE-Quelltext sich seit der letzten
 * Übersetzung geändert hat (per translations_hash) oder die noch keine haben.
 * Podcast-Tips werden übersprungen (dynamischer Text). Für den täglichen Cron.
 */
export async function translateStalePromos(): Promise<{ tips: number; ads: number }> {
  if (!process.env.ANTHROPIC_API_KEY) return { tips: 0, ads: 0 }
  const supabase = createAdminClient()
  const Anthropic = (await import('@anthropic-ai/sdk')).default
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const client: any = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

  let tips = 0
  const { data: tipRows } = await supabase.from('tip_promos').select('id, headline, body, cta_label, translations_hash, type').eq('active', true).neq('type', 'podcast')
  for (const t of tipRows ?? []) {
    const fields = { headline: t.headline as string, body: t.body as string, cta_label: t.cta_label as string }
    const h = hashFields(fields)
    if (t.translations_hash === h) continue
    try {
      const tr = await translateFields(client, fields)
      await supabase.from('tip_promos').update({ translations: tr, translations_hash: h }).eq('id', t.id)
      tips++
    } catch (e) { console.error(`[auto-translate] tip ${t.id}:`, e instanceof Error ? e.message : e) }
  }

  let ads = 0
  const { data: adRows } = await supabase.from('ad_promos').select('id, eyebrow, title, body, cta_label, translations_hash').eq('active', true)
  for (const a of adRows ?? []) {
    const fields = { eyebrow: (a.eyebrow as string) ?? '', title: a.title as string, body: a.body as string, cta_label: a.cta_label as string }
    const h = hashFields(fields)
    if (a.translations_hash === h) continue
    try {
      const tr = await translateFields(client, fields)
      await supabase.from('ad_promos').update({ translations: tr, translations_hash: h }).eq('id', a.id)
      ads++
    } catch (e) { console.error(`[auto-translate] ad ${a.id}:`, e instanceof Error ? e.message : e) }
  }

  return { tips, ads }
}

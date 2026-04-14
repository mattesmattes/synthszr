import { NextResponse } from 'next/server'
import sharp from 'sharp'
import { createAdminClient } from '@/lib/supabase/admin'
import { getSession } from '@/lib/auth/session'

export const runtime = 'nodejs'
export const maxDuration = 30

interface DomainStat {
  domain: string
  count: number
  favicon: string
  color: string
}

const FAVICON_FETCH_TIMEOUT_MS = 4000

function faviconUrl(domain: string): string {
  return `https://www.google.com/s2/favicons?domain=${encodeURIComponent(domain)}&sz=64`
}

function rgbToHex(r: number, g: number, b: number): string {
  return (
    '#' +
    [r, g, b]
      .map(v => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0'))
      .join('')
  )
}

/**
 * Returns the dominant (most-saturated-ish) color of a favicon.
 * Strategy: downsample pixels to a small grid, skip near-white/near-black/near-gray,
 * pick the most frequent color bucket. Falls back to the average color.
 */
async function dominantColor(buf: Buffer): Promise<string> {
  const size = 16
  const { data } = await sharp(buf)
    .resize(size, size, { fit: 'cover' })
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true })

  const buckets = new Map<string, { r: number; g: number; b: number; n: number }>()
  let avgR = 0, avgG = 0, avgB = 0, avgN = 0

  for (let i = 0; i < data.length; i += 4) {
    const r = data[i], g = data[i + 1], b = data[i + 2], a = data[i + 3]
    if (a < 200) continue // skip transparent
    avgR += r; avgG += g; avgB += b; avgN++

    // Skip near-white, near-black, very low saturation (Google favicon BGs often are)
    const max = Math.max(r, g, b), min = Math.min(r, g, b)
    const sat = max === 0 ? 0 : (max - min) / max
    if (max > 235 && min > 235) continue // white
    if (max < 25) continue // black
    if (sat < 0.2) continue // gray

    // Bucket by 32-step cube → 512 buckets, enough to find dominant hue
    const key = `${r >> 5}-${g >> 5}-${b >> 5}`
    const prev = buckets.get(key)
    if (prev) {
      prev.r += r; prev.g += g; prev.b += b; prev.n++
    } else {
      buckets.set(key, { r, g, b, n: 1 })
    }
  }

  if (buckets.size > 0) {
    let best: { r: number; g: number; b: number; n: number } | null = null
    for (const v of buckets.values()) {
      if (!best || v.n > best.n) best = v
    }
    if (best) return rgbToHex(best.r / best.n, best.g / best.n, best.b / best.n)
  }

  if (avgN > 0) return rgbToHex(avgR / avgN, avgG / avgN, avgB / avgN)
  return '#CCFF00'
}

async function resolveFavicon(domain: string): Promise<{ favicon: string; color: string }> {
  const url = faviconUrl(domain)
  try {
    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), FAVICON_FETCH_TIMEOUT_MS)
    const res = await fetch(url, { signal: controller.signal })
    clearTimeout(timeoutId)
    if (!res.ok) return { favicon: url, color: '#CCFF00' }
    const buf = Buffer.from(await res.arrayBuffer())
    const color = await dominantColor(buf).catch(() => '#CCFF00')
    return { favicon: url, color }
  } catch {
    return { favicon: url, color: '#CCFF00' }
  }
}

export async function GET() {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'Nicht autorisiert' }, { status: 401 })

  const supabase = createAdminClient()

  const PAGE = 1000
  let from = 0
  const emails: string[] = []
  while (true) {
    const { data, error } = await supabase
      .from('subscribers')
      .select('email')
      .eq('status', 'active')
      .range(from, from + PAGE - 1)
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    if (!data || data.length === 0) break
    emails.push(...data.map(r => r.email).filter(Boolean))
    if (data.length < PAGE) break
    from += PAGE
  }

  const counts = new Map<string, number>()
  for (const email of emails) {
    const at = email.lastIndexOf('@')
    if (at < 0) continue
    const domain = email.slice(at + 1).toLowerCase().trim()
    if (!domain) continue
    counts.set(domain, (counts.get(domain) ?? 0) + 1)
  }

  const top = Array.from(counts.entries())
    .map(([domain, count]) => ({ domain, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 20)

  // Resolve favicons + dominant color in parallel
  const enriched: DomainStat[] = await Promise.all(
    top.map(async t => {
      const { favicon, color } = await resolveFavicon(t.domain)
      return { ...t, favicon, color }
    }),
  )

  return NextResponse.json({ total: emails.length, domains: enriched })
}

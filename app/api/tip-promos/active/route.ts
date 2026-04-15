import { NextResponse } from 'next/server'
import { getActiveTipPromo } from '@/lib/tip-promos/get-active'

export const runtime = 'nodejs'

// Publicly returns the currently active tip-promo (rotating daily), so the
// client-side article renderer can display it. Only non-secret fields.
export async function GET() {
  const promo = await getActiveTipPromo()
  if (!promo) return NextResponse.json({ promo: null })
  return NextResponse.json({
    promo: {
      id: promo.id,
      headline: promo.headline,
      body: promo.body,
      link_url: promo.link_url,
      cta_label: promo.cta_label,
      gradient_from: promo.gradient_from,
      gradient_to: promo.gradient_to,
      gradient_direction: promo.gradient_direction,
      text_color: promo.text_color,
    },
  })
}

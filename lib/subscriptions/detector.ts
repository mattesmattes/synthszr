import type { Interval, UnsubscribeType } from '@/lib/subscriptions/types'

const BILLING_PORTAL_DOMAINS = [
  'stripe.com', 'paypal.com', 'apple.com', 'itunes.com',
  'play.google.com', 'google.com', 'chargebee.com', 'paddle.com',
]

/** Dedup-Schlüssel: lowercase + getrimmt. */
export function deriveProviderKey(providerName: string): string {
  return providerName.trim().toLowerCase()
}

/** Betrag auf Monat normalisieren. one_time/unknown zählen NICHT als laufender Beitrag. */
export function normalizeMonthly(amount: number, interval: Interval): number {
  switch (interval) {
    case 'monthly': return amount
    case 'yearly': return amount / 12
    case 'quarterly': return amount / 3
    case 'weekly': return amount * 52 / 12
    case 'one_time':
    case 'unknown':
    default: return 0
  }
}

/** Extrahiert die erste URL/mailto aus einem List-Unsubscribe-Header-Wert (Format: <url>, <url>). */
function firstBracketed(value: string, scheme: 'https' | 'mailto'): string | null {
  const matches = value.match(/<([^>]+)>/g) || []
  for (const m of matches) {
    const inner = m.slice(1, -1)
    if (scheme === 'https' && inner.startsWith('https:')) return inner
    if (scheme === 'mailto' && inner.startsWith('mailto:')) return inner
  }
  return null
}

/**
 * Klassifiziert den Kündigungsweg deterministisch aus den Mail-Headern.
 * Priorität: One-Click (RFC 8058) > https-Link > mailto > Portal-Domain > unknown.
 */
export function classifyUnsubscribe(
  listUnsubscribe: string | null,
  listUnsubscribePost: string | null,
  senderDomain: string,
): { type: UnsubscribeType; target: string | null } {
  const https = listUnsubscribe ? firstBracketed(listUnsubscribe, 'https') : null
  const mailto = listUnsubscribe ? firstBracketed(listUnsubscribe, 'mailto') : null

  if (https && listUnsubscribePost && /one-click/i.test(listUnsubscribePost)) {
    return { type: 'oneclick', target: https }
  }
  if (https) return { type: 'http', target: https }
  if (mailto) return { type: 'mailto', target: mailto }

  const domainLower = (senderDomain || '').toLowerCase()
  // Label-Grenze beachten: exakte Domain ODER echte Subdomain — sonst matchte
  // "evilstripe.com" auf "stripe.com" (endsWith allein ist grenzenlos).
  if (BILLING_PORTAL_DOMAINS.some((d) => domainLower === d || domainLower.endsWith('.' + d))) {
    return { type: 'login_portal', target: null }
  }
  return { type: 'unknown', target: null }
}

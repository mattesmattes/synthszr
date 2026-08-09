/**
 * Purpose-scoped, hashed subscriber access tokens (SEC-001).
 *
 * Newsletter links used to carry `subscribers.id` - the internal UUID - as
 * the credential for confirming, changing preferences, unsubscribing and
 * viewing referral stats. That single value never expired, could not be
 * revoked, worked for every action at once, and leaked into mail clients,
 * proxy logs, `Referer` headers and localStorage.
 *
 * Each link now carries its own random 256-bit token, scoped to one purpose
 * and one expiry. The database stores only the SHA-256 hash, so read access
 * to `subscriber_action_tokens` yields nothing that can be replayed - the
 * same reason password digests are stored rather than passwords.
 *
 * Server-only: this module uses the service-role client and must never be
 * imported from a client component.
 */

import { createHash, randomBytes } from 'crypto'
import { createAdminClient } from '@/lib/supabase/admin'

// 'comment' seit 2026-08-09: Magic-Link zur Kommentar-Verifizierung und
// Kommentar-Ausweis in Newsletter-Links (mehrfach nutzbar, 7 Tage TTL).
export type SubscriberTokenPurpose = 'confirm' | 'preferences' | 'unsubscribe' | 'referral' | 'comment'

export interface SubscriberTokenRow {
  subscriber_id: string
  purpose: SubscriberTokenPurpose
  token_hash: string
  expires_at: string
}

export interface MintedSubscriberToken {
  /** Goes into the link. Never persisted, never logged. */
  rawToken: string
  /** Exactly what gets inserted - contains the hash, never the raw token. */
  row: SubscriberTokenRow
}

const TOKEN_BYTES = 32 // 256 bit

export function hashSubscriberToken(rawToken: string): string {
  return createHash('sha256').update(rawToken, 'utf8').digest('hex')
}

export function mintSubscriberToken(
  subscriberId: string,
  purpose: SubscriberTokenPurpose,
  expiresAt: Date,
): MintedSubscriberToken {
  const rawToken = randomBytes(TOKEN_BYTES).toString('base64url')
  return {
    rawToken,
    row: {
      subscriber_id: subscriberId,
      purpose,
      token_hash: hashSubscriberToken(rawToken),
      expires_at: expiresAt.toISOString(),
    },
  }
}

/**
 * Lifetimes per purpose. Preferences and referral links stay usable while the
 * issue is current; unsubscribe stays valid far longer, because someone may
 * dig out an old newsletter to get off the list and must not be stranded.
 */
const NEWSLETTER_TOKEN_TTL_DAYS = {
  preferences: 7,
  referral: 30,
  unsubscribe: 90,
  // Kurz, weil der Token in der Artikel-URL steht (?ct=) und damit in
  // Mail-Clients und Referer-Headern landet. Er trägt ohnehin nur das Recht,
  // einen Kommentar ZUR MODERATION einzureichen.
  comment: 7,
} as const

export interface RecipientLinkTokens {
  preferences: MintedSubscriberToken
  unsubscribe: MintedSubscriberToken
  referral: MintedSubscriberToken
  /** „Eure Takes": Artikel-Link trägt ?ct= — aus der Mail heraus kommentieren
   *  ohne weitere Bestätigung. */
  comment: MintedSubscriberToken
}

/**
 * Mint the per-recipient link tokens for one send batch.
 *
 * Returns the raw tokens keyed by subscriber (for building the URLs) plus a
 * flat list of rows, so the whole batch is a single insert: three round trips
 * per recipient would dominate send time, and a partial write would leave
 * recipients with links that resolve to nothing.
 */
export function mintNewsletterLinkTokens(subscriberIds: string[]): {
  bySubscriber: Map<string, RecipientLinkTokens>
  rows: SubscriberTokenRow[]
} {
  const bySubscriber = new Map<string, RecipientLinkTokens>()
  const rows: SubscriberTokenRow[] = []
  const now = Date.now()
  const expiry = (days: number) => new Date(now + days * 24 * 60 * 60 * 1000)

  for (const subscriberId of subscriberIds) {
    const tokens: RecipientLinkTokens = {
      preferences: mintSubscriberToken(subscriberId, 'preferences', expiry(NEWSLETTER_TOKEN_TTL_DAYS.preferences)),
      unsubscribe: mintSubscriberToken(subscriberId, 'unsubscribe', expiry(NEWSLETTER_TOKEN_TTL_DAYS.unsubscribe)),
      referral: mintSubscriberToken(subscriberId, 'referral', expiry(NEWSLETTER_TOKEN_TTL_DAYS.referral)),
      comment: mintSubscriberToken(subscriberId, 'comment', expiry(NEWSLETTER_TOKEN_TTL_DAYS.comment)),
    }
    bySubscriber.set(subscriberId, tokens)
    rows.push(tokens.preferences.row, tokens.unsubscribe.row, tokens.referral.row, tokens.comment.row)
  }

  return { bySubscriber, rows }
}

/**
 * Resolve a raw token to its subscriber, or null. Fails closed on every
 * unexpected condition (unknown token, wrong purpose, expired, already
 * consumed, database error).
 *
 * With `consume: true` the row is marked consumed as part of resolving, and
 * the update is itself conditional on `consumed_at IS NULL`: if a concurrent
 * request got there first, the update matches no row and this call returns
 * null rather than letting a single-use link be used twice.
 */
export async function resolveSubscriberToken(
  rawToken: string,
  purpose: SubscriberTokenPurpose,
  options?: { consume?: boolean },
): Promise<{ subscriberId: string } | null> {
  if (!rawToken) return null

  const supabase = createAdminClient()
  const nowIso = new Date().toISOString()

  const { data: row, error } = await supabase
    .from('subscriber_action_tokens')
    .select('id, subscriber_id')
    .eq('token_hash', hashSubscriberToken(rawToken))
    .eq('purpose', purpose)
    .is('consumed_at', null)
    .gt('expires_at', nowIso)
    .maybeSingle()

  if (error || !row) return null

  if (!options?.consume) {
    return { subscriberId: row.subscriber_id }
  }

  const { data: consumed, error: consumeError } = await supabase
    .from('subscriber_action_tokens')
    .update({ consumed_at: new Date().toISOString() })
    .eq('id', row.id)
    .is('consumed_at', null)
    .select('subscriber_id')
    .maybeSingle()

  if (consumeError || !consumed) return null

  return { subscriberId: row.subscriber_id }
}

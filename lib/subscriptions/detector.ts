import { z } from 'zod'
import type { Interval, UnsubscribeType, DetectionResult, DetectedSubscription, EvidenceMessage } from '@/lib/subscriptions/types'
import type { EmailMessage } from '@/lib/gmail/client'

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

const VALID_INTERVALS: Interval[] = ['monthly', 'yearly', 'quarterly', 'weekly', 'one_time', 'unknown']
const LLM_TIMEOUT_MS = 50_000
const LLM_BATCH_SIZE = 12
const MAX_CANDIDATES = 200

const ResponseSchema = z.object({ results: z.array(z.unknown()) })
const ResultSchema = z.object({
  index: z.number().int(),
  is_paid: z.boolean(),
  provider_name: z.string(),
  amount: z.number().nullable().optional(),
  currency: z.string().nullable().optional(),
  interval: z.string(),
  confidence: z.number(),
})

/** Pure: baut den Klassifikations-Prompt für einen Batch Mails. */
export function buildDetectPrompt(emails: { from: string; subject: string; snippet: string }[]): string {
  const items = emails.map((e, i) => `${i}. Absender: ${e.from}\n   Betreff: ${e.subject}\n   Auszug: ${e.snippet}`).join('\n')
  return `Du klassifizierst E-Mails daraufhin, ob sie zu einem KOSTENPFLICHTIGEN Abonnement gehören (bezahlter Newsletter/Dienst).

REGELN:
- is_paid=true NUR bei echten Zahlungen/Rechnungen/aktiven kostenpflichtigen Abos (Quittung, "receipt", "invoice", "your subscription", Betrag sichtbar).
- Kostenlose Newsletter, Werbung, Terminmails, Login-Codes → is_paid=false.
- provider_name = der Dienst/Newsletter (z. B. "Stratechery"), NICHT der Zahlungsabwickler.
- interval = eines von: monthly, yearly, quarterly, weekly, one_time, unknown.
- amount = Zahl (ohne Währungssymbol) falls erkennbar, sonst null. currency = ISO (EUR/USD/…), sonst null.
- confidence = 0..1.
- Antworte für JEDE Mail mit ihrem Index.

MAILS:
${items}`
}

/** Pure: validiert die LLM-Antwort, liefert nur bezahlte, index-gültige Treffer. */
export function parseDetectResponse(raw: unknown, count: number): Map<number, DetectionResult> {
  const out = new Map<number, DetectionResult>()
  const outer = ResponseSchema.safeParse(raw)
  if (!outer.success) return out
  for (const r of outer.data.results) {
    const parsed = ResultSchema.safeParse(r)
    if (!parsed.success) continue
    const d = parsed.data
    if (d.index < 0 || d.index >= count) continue
    if (!d.is_paid) continue
    const interval = (VALID_INTERVALS as string[]).includes(d.interval) ? (d.interval as Interval) : 'unknown'
    out.set(d.index, {
      isPaid: true,
      providerName: d.provider_name,
      amount: d.amount ?? null,
      currency: d.currency ?? null,
      interval,
      confidence: d.confidence,
    })
  }
  return out
}

/** LLM-Klassifikation eines Batches. Fehler ⇒ leere Map (retrybar). */
async function classifyBatch(emails: { from: string; subject: string; snippet: string }[]): Promise<Map<number, DetectionResult>> {
  if (emails.length === 0) return new Map()
  if (!process.env.ANTHROPIC_API_KEY) return new Map()
  const Anthropic = (await import('@anthropic-ai/sdk')).default
  const { getModelForUseCase } = await import('@/lib/ai/model-config')
  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
  const tool = {
    name: 'classify_subscriptions',
    description: 'Klassifiziere jede Mail als bezahltes Abo (mit Betrag/Intervall) oder nicht',
    input_schema: {
      type: 'object' as const,
      properties: {
        results: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              index: { type: 'integer' }, is_paid: { type: 'boolean' },
              provider_name: { type: 'string' }, amount: { type: ['number', 'null'] },
              currency: { type: ['string', 'null'] }, interval: { type: 'string' },
              confidence: { type: 'number' },
            },
            required: ['index', 'is_paid', 'provider_name', 'interval', 'confidence'],
          },
        },
      },
      required: ['results'],
    },
  }
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), LLM_TIMEOUT_MS)
  try {
    const model = await getModelForUseCase('subscription_detect')
    const resp = await client.messages.create({
      model, max_tokens: 2048, tools: [tool],
      tool_choice: { type: 'tool', name: 'classify_subscriptions' },
      messages: [{ role: 'user', content: buildDetectPrompt(emails) }],
    }, { signal: controller.signal })
    const block = resp.content.find((b) => b.type === 'tool_use')
    return parseDetectResponse(block && 'input' in block ? block.input : null, emails.length)
  } catch {
    return new Map()
  } finally {
    clearTimeout(timer)
  }
}

function extractEmailAddress(from: string): string {
  const m = from.match(/<([^>]+)>/)
  return (m ? m[1] : from).trim().toLowerCase()
}

function domainOf(email: string): string {
  const at = email.lastIndexOf('@')
  return at >= 0 ? email.slice(at + 1) : ''
}

/** Auto-Kündbarkeit als Rangordnung (höher = besser serverseitig kündbar). */
const UNSUB_PRIORITY: Record<UnsubscribeType, number> = {
  oneclick: 4, http: 3, mailto: 2, login_portal: 1, unknown: 0,
}

/** Wählt den auto-kündbarsten Unsubscribe-Weg — unabhängig von der Zahlungs-Recency,
 *  damit ein älterer funktionierender Link nicht von einer jüngeren header-losen
 *  Quittung maskiert wird. */
export function pickBetterUnsubscribe(
  current: { type: UnsubscribeType; target: string | null },
  incoming: { type: UnsubscribeType; target: string | null },
): { type: UnsubscribeType; target: string | null } {
  return UNSUB_PRIORITY[incoming.type] > UNSUB_PRIORITY[current.type] ? incoming : current
}

/**
 * Hybrid-Scan: Gmail-Query holt Kandidaten (letzte 12 Monate), LLM klassifiziert
 * batchweise, Ergebnisse werden pro Anbieter (providerKey) zusammengeführt.
 */
export async function scanSubscriptions(
  refreshToken: string,
): Promise<DetectedSubscription[]> {
  const { GmailClient } = await import('@/lib/gmail/client')
  const gmail = new GmailClient(refreshToken)

  const query = 'newer_than:1y (receipt OR invoice OR "Ihre Rechnung" OR "payment" OR ' +
    '"subscription" OR "Zahlungsbestätigung" OR "renewed" OR from:stripe.com OR from:paypal.com)'
  const candidates: EmailMessage[] = await gmail.searchEmails(query, MAX_CANDIDATES)

  // Batchweise klassifizieren
  const byProvider = new Map<string, DetectedSubscription>()
  for (let i = 0; i < candidates.length; i += LLM_BATCH_SIZE) {
    const batch = candidates.slice(i, i + LLM_BATCH_SIZE)
    const forLlm = batch.map((e) => ({ from: e.from, subject: e.subject, snippet: e.snippet }))
    const results = await classifyBatch(forLlm)
    for (const [idx, det] of results) {
      const email = batch[idx]
      const senderEmail = extractEmailAddress(email.from)
      const senderDomain = domainOf(senderEmail)
      const providerKey = deriveProviderKey(det.providerName)
      const { type, target } = classifyUnsubscribe(email.listUnsubscribe, email.listUnsubscribePost, senderDomain)
      const evidence: EvidenceMessage = {
        id: email.id, subject: email.subject, date: email.date.toISOString(),
        gmailLink: `https://mail.google.com/mail/u/0/#all/${email.id}`,
      }
      const existing = byProvider.get(providerKey)
      if (!existing) {
        byProvider.set(providerKey, {
          providerName: det.providerName, providerKey, senderDomain, senderEmail,
          amount: det.amount, currency: det.currency, interval: det.interval,
          amountMonthly: det.amount != null ? Math.round(normalizeMonthly(det.amount, det.interval) * 100) / 100 : null,
          lastPaymentAt: email.date.toISOString(),
          evidenceMessageIds: [evidence],
          unsubscribeType: type, unsubscribeTarget: target,
        })
      } else {
        existing.evidenceMessageIds.push(evidence)
        // jüngste Zahlung gewinnt für Betrag/Intervall
        if (email.date.toISOString() > existing.lastPaymentAt) {
          existing.lastPaymentAt = email.date.toISOString()
          existing.amount = det.amount
          existing.currency = det.currency
          existing.interval = det.interval
          existing.amountMonthly = det.amount != null ? Math.round(normalizeMonthly(det.amount, det.interval) * 100) / 100 : null
          existing.senderEmail = senderEmail
          existing.senderDomain = senderDomain
        }
        // Kündigungsweg unabhängig von der Zahlungs-Recency wählen (bester über
        // ALLE Belege) — sonst maskiert eine jüngere header-lose Quittung einen
        // älteren funktionierenden One-Click-Link (Review-Finding Task 5).
        const better = pickBetterUnsubscribe(
          { type: existing.unsubscribeType, target: existing.unsubscribeTarget },
          { type, target },
        )
        existing.unsubscribeType = better.type
        existing.unsubscribeTarget = better.target
      }
    }
  }

  // Content-Quellen-Markierung (is_content_source) erfolgt beim Upsert in der Route.
  return Array.from(byProvider.values())
}

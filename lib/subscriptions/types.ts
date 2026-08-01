export type Interval = 'monthly' | 'yearly' | 'quarterly' | 'weekly' | 'one_time' | 'unknown'
export type UnsubscribeType = 'oneclick' | 'http' | 'mailto' | 'login_portal' | 'unknown'

export interface EvidenceMessage {
  id: string
  subject: string
  date: string // ISO
  gmailLink: string
}

/** Ergebnis der LLM-Klassifikation einer einzelnen Mail. */
export interface DetectionResult {
  isPaid: boolean
  providerName: string
  amount: number | null
  currency: string | null
  interval: Interval
  confidence: number
}

/** Ein zusammengeführtes Abo (vor dem Upsert in paid_subscriptions). */
export interface DetectedSubscription {
  providerName: string
  providerKey: string
  senderDomain: string
  senderEmail: string
  amount: number | null
  currency: string | null
  interval: Interval
  amountMonthly: number | null
  lastPaymentAt: string // ISO
  evidenceMessageIds: EvidenceMessage[]
  unsubscribeType: UnsubscribeType
  unsubscribeTarget: string | null
}

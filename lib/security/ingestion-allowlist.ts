/**
 * Optional sender allowlist for untrusted email-triggered ingestion paths
 * (+dailyrepo notes and +synthszr-webcrawler digests).
 *
 * Configure via `ALLOWED_INGESTION_SENDERS` (comma-separated email addresses,
 * case-insensitive). When unset or empty, all senders remain allowed for
 * backwards compatibility with existing inbox workflows.
 */

export function extractEmailAddress(fromHeader: string | null | undefined): string | null {
  if (!fromHeader) return null
  const angleMatch = fromHeader.match(/<([^<>\s]+@[^<>\s]+)>/)
  if (angleMatch) {
    return angleMatch[1].trim().toLowerCase()
  }
  const plainMatch = fromHeader.match(/([^\s<>,"']+@[^\s<>,"']+)/)
  if (plainMatch) {
    return plainMatch[1].trim().toLowerCase()
  }
  return null
}

export function getAllowedIngestionSenders(
  rawEnv: string | undefined = process.env.ALLOWED_INGESTION_SENDERS
): Set<string> | null {
  if (!rawEnv) return null
  const entries = rawEnv
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean)
  return entries.length > 0 ? new Set(entries) : null
}

export function isAllowedIngestionSender(
  fromHeader: string | null | undefined,
  rawEnv: string | undefined = process.env.ALLOWED_INGESTION_SENDERS
): boolean {
  const allowlist = getAllowedIngestionSenders(rawEnv)
  if (!allowlist) return true
  const sender = extractEmailAddress(fromHeader)
  if (!sender) return false
  return allowlist.has(sender)
}

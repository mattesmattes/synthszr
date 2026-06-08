// Pure helper (no DB import) so it's safe in both client and server render paths.

/**
 * Replace the word "TODAY" in a podcast promo headline with the CURRENT date in
 * the Berlin timezone, e.g. "SYNTHSZR PODCAST TODAY" → "SYNTHSZR PODCAST Sunday,
 * June 8". Resolved at render time — for the newsletter that's the send day, for
 * the web that's the view day — NOT when the post/episode was produced. Headline
 * CSS uppercases it. No-op if the headline has no "today".
 */
export function applyDateToHeadline(headline: string): string {
  if (!/today/i.test(headline)) return headline
  const formatted = new Date().toLocaleDateString('en-US', {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    timeZone: 'Europe/Berlin',
  })
  return headline.replace(/today/i, formatted)
}

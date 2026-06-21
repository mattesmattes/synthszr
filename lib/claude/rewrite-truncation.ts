/**
 * Guard against a full-article model rewrite (proofreading, metaphor dedup)
 * silently truncating the article at its max_tokens cap and replacing the
 * complete text with a cut-off version.
 *
 * These passes are length-preserving — they fix spelling/grammar or swap a few
 * metaphors, so the output is ~the same length as the input. An output that is
 * markedly shorter was cut off mid-generation; in that case the caller keeps the
 * complete original instead of emitting the truncated rewrite.
 *
 * Short originals are never flagged: a small article can legitimately shrink and
 * there's nothing meaningful to truncate.
 */
const MIN_LENGTH_TO_GUARD = 2000

export function isLikelyTruncated(
  original: string,
  rewritten: string,
  ratio = 0.85,
): boolean {
  if (original.length < MIN_LENGTH_TO_GUARD) return false
  return rewritten.trim().length < original.length * ratio
}

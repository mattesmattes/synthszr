/**
 * Resolves a base slug to one that doesn't collide with an existing post.
 *
 * The auto-post finalize previously inserted with `generateSlug(title)` directly,
 * which violates idx_generated_posts_slug_unique whenever a post with that slug
 * already exists (e.g. a prior finalize attempt that timed out after insert, or a
 * near-identical title on another day). Appends -2, -3, … until free.
 *
 * `exists` is injected (DB lookup in production, a fake in tests). Capped so a
 * pathological "always taken" case terminates instead of looping forever.
 */
export async function buildUniqueSlug(
  base: string,
  exists: (slug: string) => Promise<boolean>,
  maxAttempts = 100,
): Promise<string> {
  if (!(await exists(base))) return base

  for (let n = 2; n <= maxAttempts; n++) {
    const candidate = `${base}-${n}`
    if (!(await exists(candidate))) return candidate
  }

  // Pathological fallback: a high-entropy suffix that won't realistically collide.
  return `${base}-${Date.now().toString(36)}`
}

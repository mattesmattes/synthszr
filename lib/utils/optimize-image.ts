/**
 * Route a remote image through Vercel's image optimizer (/_next/image)
 * so the browser receives AVIF/WebP via content negotiation instead of
 * the original PNG/JPEG. Saves ~70–80 % on the wire for typical covers.
 *
 * Used selectively for LCP-critical images (post covers) — not for every
 * <img> on the site, to keep image-transformation usage in check.
 */
export function optimizeImageUrl(url: string, width = 1408, quality = 75): string {
  if (!url) return url
  // Already routed, or formats the optimizer can't transform meaningfully.
  if (url.includes("/_next/image") || /\.(svg|gif)(\?|$)/i.test(url)) return url
  return `/_next/image?url=${encodeURIComponent(url)}&w=${width}&q=${quality}`
}

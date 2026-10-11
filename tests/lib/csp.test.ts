/**
 * Content-Security-Policy (SEC-009).
 *
 * The policy lives in one module so the production and development variants
 * cannot drift apart in next.config.mjs, and so the property that matters -
 * no eval in production - is asserted rather than reviewed by eye.
 */
import { describe, expect, it } from 'vitest'
import { buildContentSecurityPolicy } from '@/lib/security/csp.mjs'

function directive(csp: string, name: string): string {
  const part = csp.split(';').map(p => p.trim()).find(p => p.startsWith(name + ' '))
  return part ?? ''
}

const prod = buildContentSecurityPolicy({ development: false })
const dev = buildContentSecurityPolicy({ development: true })

describe('production CSP', () => {
  it('forbids eval in script-src', () => {
    // 'unsafe-eval' turns any string an attacker can place into a sink
    // (JSON.parse fallbacks, template libraries, third-party snippets) into
    // executable code. Nothing in this app needs it at runtime.
    expect(directive(prod, 'script-src')).not.toContain("'unsafe-eval'")
  })

  it('restricts script-src to self plus the two known vercel origins', () => {
    const scriptSrc = directive(prod, 'script-src')
    expect(scriptSrc).toContain("'self'")
    expect(scriptSrc).toContain('https://va.vercel-scripts.com')
    expect(scriptSrc).toContain('https://vercel.live')
    // No wildcards, no https: catch-all.
    expect(scriptSrc).not.toMatch(/\*|https:(?!\/\/)/)
  })

  it("still needs 'unsafe-inline' for script-src, deliberately", () => {
    // Next.js App Router emits ~30 inline scripts per page (flight data,
    // locale bootstrap). Removing this requires either per-request nonces -
    // which forfeit ISR/CDN caching across 21 statically revalidated routes -
    // or hashes of scripts whose content differs per page. Documented as an
    // accepted risk; asserted here so its removal is a conscious act with a
    // failing test, not an accident that breaks hydration in production.
    expect(directive(prod, 'script-src')).toContain("'unsafe-inline'")
  })

  it('keeps the hard restrictions intact', () => {
    expect(prod).toContain("frame-ancestors 'none'")
    expect(prod).toContain("object-src 'none'")
    expect(prod).toContain("base-uri 'self'")
    expect(prod).toContain("form-action 'self'")
    expect(prod).toContain("default-src 'self'")
  })

  it('keeps the sources the app actually needs', () => {
    expect(directive(prod, 'connect-src')).toContain('https://*.supabase.co')
    // Admin-Bild-Uploads (ad-promos, cover-animation, audio-files) laufen
    // über @vercel/blob/client upload(): der Browser PUTtet die Datei direkt
    // an https://vercel.com/api/blob — nicht an *.public.blob.vercel-storage.com,
    // das nur die Download-Hosts abdeckt. Ohne diese Quelle blockiert der
    // Browser den PUT, die Library wiederholt den Netzwerkfehler 10x mit
    // Backoff und der Upload-Spinner hängt minutenlang (Bug 2026-10-11).
    expect(directive(prod, 'connect-src')).toContain('https://vercel.com/api/blob/')
    expect(directive(prod, 'media-src')).toContain('https://*.public.blob.vercel-storage.com')
    expect(directive(prod, 'frame-src')).toContain('https://vercel.live')
    expect(directive(prod, 'img-src')).toContain('data:')
  })
})

describe('development CSP', () => {
  it('allows unsafe-eval only in development', () => {
    // The dev server's HMR runtime evaluates code at runtime.
    expect(directive(dev, 'script-src')).toContain("'unsafe-eval'")
  })

  it('is otherwise the same policy', () => {
    expect(directive(dev, 'frame-ancestors')).toBe(directive(prod, 'frame-ancestors'))
    expect(directive(dev, 'object-src')).toBe(directive(prod, 'object-src'))
  })
})

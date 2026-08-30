/**
 * Content-Security-Policy — single source of truth (SEC-009).
 *
 * Plain .mjs so next.config.mjs can import it without a build step, which is
 * what keeps the development and production variants from drifting apart.
 *
 * WHAT THIS BUYS: 'unsafe-eval' is gone in production. Without it a string an
 * attacker gets into a sink cannot become executable code, which removes an
 * entire class of XSS gadget. Verified that nothing needs it: the codebase
 * contains no eval/new Function call, and the Vercel Analytics script has
 * none either.
 *
 * WHAT IS STILL OPEN: script-src keeps 'unsafe-inline'. The Next.js App
 * Router emits roughly 30 inline scripts per page (flight-data pushes, locale
 * bootstrap, documentElement.lang), none of them nonced. Removing the
 * directive needs one of:
 *
 *   a) per-request nonces from middleware - which force dynamic rendering and
 *      would forfeit ISR/CDN caching on 21 statically revalidated routes. A
 *      nonce baked into a cached HTML response is also no protection at all,
 *      since it is then a constant an attacker can read.
 *   b) hashes of every inline script - but flight-data content differs per
 *      page and per deployment, so a static header cannot enumerate them.
 *   c) Next.js emitting nonces itself for statically cached output.
 *
 * Until (c) exists, 'unsafe-inline' in script-src is an accepted risk. Note
 * that it is far less potent than 'unsafe-eval' here: injected markup still
 * cannot load code from another origin, because the source list below allows
 * only 'self' and two exact Vercel hosts.
 *
 * style-src also keeps 'unsafe-inline' - React writes inline styles - which
 * is tracked separately from this finding.
 */

/**
 * @param {{ development?: boolean }} [options]
 * @returns {string} the header value
 */
export function buildContentSecurityPolicy(options = {}) {
  const development = options.development === true

  const scriptSrc = [
    "'self'",
    "'unsafe-inline'",
    // Development only: the HMR runtime evaluates code at runtime.
    ...(development ? ["'unsafe-eval'"] : []),
    'https://va.vercel-scripts.com',
    'https://vercel.live',
  ]

  return [
    "default-src 'self'",
    `script-src ${scriptSrc.join(' ')}`,
    // React emits inline styles; tracked separately from SEC-009.
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob: https:",
    "font-src 'self' data:",
    // Podcast audio lives on Vercel Blob; without this default-src 'self' applies.
    "media-src 'self' blob: https://*.public.blob.vercel-storage.com",
    // https://*.public.blob.vercel-storage.com: die Korn-Animation im Lexikon
    // laedt ihre Pixel per fetch()+createImageBitmap (nicht per drawImage aus
    // dem sichtbaren <img> — das tainted den Canvas in Safari zuverlaessig,
    // s. korn-canvas.tsx). Gleicher Host wie media-src fuer Podcast-Audio,
    // dort schon erlaubt.
    "connect-src 'self' https://*.supabase.co https://*.public.blob.vercel-storage.com https://va.vercel-scripts.com https://vitals.vercel-insights.com https://vercel.live wss://vercel.live",
    // vercel.live feedback toolbar (preview deployments only) uses an iframe.
    "frame-src 'self' https://vercel.live",
    "frame-ancestors 'none'",
    "base-uri 'self'",
    "object-src 'none'",
    "form-action 'self'",
  ].join('; ')
}

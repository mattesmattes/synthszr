import { buildContentSecurityPolicy } from './lib/security/csp.mjs'

/** @type {import('next').NextConfig} */
const nextConfig = {
  // X-Powered-By: Next.js nicht verraten (Info-Disclosure)
  poweredByHeader: false,
  transpilePackages: ['@chenglou/pretext'],
  // .wgsl-Import fuer die Dither-Animation (lib/dither-animation/warp.wgsl).
  // "as" ist bei vgpu unter Next >= 15.5 Pflichtfeld. webpack-Regel bleibt
  // daneben stehen (vgpu-Doku: beide Bloecke koexistieren), falls ein Build
  // je auf den Webpack-Pfad zurueckfaellt statt Turbopack zu nutzen.
  turbopack: {
    rules: {
      '*.wgsl': { loaders: ['@vgpu/wgsl/loader-webpack'], as: '*.js' },
    },
  },
  webpack(config) {
    config.module.rules.push({ test: /\.wgsl$/, loader: '@vgpu/wgsl/loader-webpack' })
    return config
  },
  images: {
    // Next Image Optimization aktiv (AVIF/WebP on-the-fly statt 1408px-PNG).
    // Einzige Remote-Quelle für Cover/Thumbnails ist Vercel Blob
    // (post_images.image_url — per DB-Check der einzige Host). Der
    // Google-Favicon-Service läuft über rohe <img>-Tags, nicht next/image.
    formats: ['image/avif', 'image/webp'],
    qualities: [80],
    remotePatterns: [
      { protocol: 'https', hostname: 'lbrzdn804nhy3kox.public.blob.vercel-storage.com' },
    ],
  },

  // 301 redirects for deleted posts
  async redirects() {
    return [
      {
        source: '/de/posts/ai-powerhouses-at-a-dead-end-and-the-new-world-disorder',
        destination: '/de/archive',
        permanent: true,
      },
      {
        source: '/de/posts/anthropic-openai-apple-a-matter-of-compromise',
        destination: '/de/archive',
        permanent: true,
      },
    ]
  },

  // Security headers
  async headers() {
    return [
      {
        // Nicht-Produktions-Hosts (*.vercel.app: Produktions-Alias UND alle
        // Preview-Deployments) auf noindex — verhindert Duplicate-Content-
        // Indexierung neben www.synthszr.com. Previews bleiben voll nutzbar.
        source: '/:path*',
        has: [{ type: 'host', value: '.*\\.vercel\\.app' }],
        headers: [
          {
            key: 'X-Robots-Tag',
            value: 'noindex, nofollow',
          },
        ],
      },
      {
        source: '/:path*',
        headers: [
          {
            // HSTS: erzwingt HTTPS für 2 Jahre inkl. Subdomains (Preload-fähig).
            // Schützt vor Protocol-Downgrade / SSL-Stripping.
            key: 'Strict-Transport-Security',
            value: 'max-age=63072000; includeSubDomains; preload',
          },
          {
            // Content-Security-Policy — zentral in lib/security/csp.mjs
            // (SEC-009). Produktiv ohne 'unsafe-eval'; die verbleibende
            // 'unsafe-inline'-Ausnahme für script-src ist dort begründet.
            key: 'Content-Security-Policy',
            value: buildContentSecurityPolicy({
              development: process.env.NODE_ENV !== 'production',
            }),
          },
          {
            key: 'X-Content-Type-Options',
            value: 'nosniff',
          },
          {
            key: 'X-Frame-Options',
            value: 'DENY',
          },
          {
            key: 'X-XSS-Protection',
            value: '1; mode=block',
          },
          {
            key: 'Referrer-Policy',
            value: 'strict-origin-when-cross-origin',
          },
          {
            key: 'Permissions-Policy',
            value: 'camera=(), microphone=(), geolocation=()',
          },
        ],
      },
    ]
  },
}

export default nextConfig

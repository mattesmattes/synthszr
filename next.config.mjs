/** @type {import('next').NextConfig} */
const nextConfig = {
  // X-Powered-By: Next.js nicht verraten (Info-Disclosure)
  poweredByHeader: false,
  transpilePackages: ['@chenglou/pretext'],
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
            // Content-Security-Policy (Defense-in-Depth gegen XSS/Injection).
            // Quellen aus dem Code ermittelt: Vercel Analytics
            // (va.vercel-scripts.com / vitals.vercel-insights.com), Supabase
            // (Browser-Client der Admin-why-Seite), Favicons/Blob (img).
            // script-src braucht 'unsafe-inline'/'unsafe-eval' (Next.js-Hydration
            // ohne Nonce-Setup); externe Script-Quellen bleiben so trotzdem
            // blockiert. frame-ancestors/object-src/base-uri hart restriktiv.
            key: 'Content-Security-Policy',
            value: [
              "default-src 'self'",
              "script-src 'self' 'unsafe-inline' 'unsafe-eval' https://va.vercel-scripts.com",
              "style-src 'self' 'unsafe-inline'",
              "img-src 'self' data: blob: https:",
              "font-src 'self' data:",
              "connect-src 'self' https://*.supabase.co https://va.vercel-scripts.com https://vitals.vercel-insights.com",
              "frame-ancestors 'none'",
              "base-uri 'self'",
              "object-src 'none'",
              "form-action 'self'",
            ].join('; '),
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

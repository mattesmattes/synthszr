/** @type {import('next').NextConfig} */
const nextConfig = {
  transpilePackages: ['@chenglou/pretext'],
  images: {
    unoptimized: true,
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
        source: '/:path*',
        headers: [
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

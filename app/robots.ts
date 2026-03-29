import { MetadataRoute } from 'next'

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: '*',
        allow: '/',
        disallow: ['/admin/', '/api/', '/login', '/newsletter/', '/_next/static/', '/_next/image/'],
      },
    ],
    sitemap: 'https://www.synthszr.com/sitemap.xml',
  }
}

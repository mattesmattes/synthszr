import { MetadataRoute } from 'next'

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: '*',
        allow: '/',
        disallow: ['/admin/', '/api/', '/login', '/newsletter/'],
      },
    ],
    sitemap: 'https://synthszr.com/sitemap.xml',
  }
}

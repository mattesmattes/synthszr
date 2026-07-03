import { MetadataRoute } from 'next'

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: '*',
        allow: '/',
        // Kein /_next/-Disallow: Googlebot braucht CSS/JS zum Rendern und
        // /_next/image für Google Images. Kein /newsletter/-Disallow: die
        // Seiten tragen noindex (Layout-Metadata) — das Signal wirkt nur,
        // wenn Google die Seite crawlen darf.
        disallow: ['/admin/', '/api/', '/login'],
      },
    ],
    sitemap: 'https://www.synthszr.com/sitemap.xml',
  }
}

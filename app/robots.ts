import { MetadataRoute } from 'next'

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: '*',
        allow: ['/', '/api/agents/', '/api/mcp', '/api/glossary/'],
        // Kein /_next/-Disallow: Googlebot braucht CSS/JS zum Rendern und
        // /_next/image für Google Images. Kein /newsletter/-Disallow: die
        // Seiten tragen noindex (Layout-Metadata) — das Signal wirkt nur,
        // wenn Google die Seite crawlen darf. /api/agents/ und /api/mcp sind
        // explizit erlaubt, damit regelkonforme KI-Agenten sie abrufen dürfen.
        disallow: ['/admin/', '/api/', '/login'],
      },
    ],
    sitemap: 'https://www.synthszr.com/sitemap.xml',
  }
}

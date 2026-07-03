import type React from "react"
import type { Metadata } from "next"
import { IBM_Plex_Serif, Space_Mono } from "next/font/google"
import { Analytics } from "@/components/analytics"
import { ConsentBanner } from "@/components/consent-banner"
import { NewsletterPopup } from "@/components/newsletter-popup"
import { PageTracker } from "@/components/analytics/page-tracker"
import { safeJsonLd } from "@/lib/seo/site"
import "./globals.css"

const ibmPlexSerif = IBM_Plex_Serif({
  weight: ["400", "500", "600", "700"],
  subsets: ["latin"],
  variable: "--font-serif",
})

const spaceMono = Space_Mono({
  weight: ["400", "700"],
  subsets: ["latin"],
  variable: "--font-mono",
})

export const metadata: Metadata = {
  metadataBase: new URL('https://www.synthszr.com'),
  title: "Synthszr — AI is about Synthesis not Efficiency.",
  description: "Exploring the intersection of business, design and technology in the age of AI",
  icons: {
    icon: [
      { url: "/favicon.ico", sizes: "32x32" },
      { url: "/favicon-16x16.png", sizes: "16x16", type: "image/png" },
      { url: "/favicon-32x32.png", sizes: "32x32", type: "image/png" },
      { url: "/icon.svg", type: "image/svg+xml" },
    ],
    apple: "/apple-touch-icon.png",
  },
  openGraph: {
    title: 'Synthszr — AI is about Synthesis not Efficiency.',
    description: 'Exploring the intersection of business, design and technology in the age of AI',
    url: 'https://www.synthszr.com',
    siteName: 'Synthszr',
    images: [
      {
        url: 'https://www.synthszr.com/og-image-v2.jpg',
        width: 1200,
        height: 630,
        alt: 'Synthszr — AI is about Synthesis not Efficiency.',
      },
    ],
    locale: 'de_DE',
    type: 'website',
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Synthszr — AI is about Synthesis not Efficiency.',
    description: 'Exploring the intersection of business, design and technology in the age of AI',
    images: ['https://www.synthszr.com/og-image-v2.jpg'],
  },
}

// Site-weite Organization-Entity — Grundlage für Publisher-Verknüpfung in
// Article-/Breadcrumb-Schemas (Posts) und Brand-Erkennung.
const orgLd = {
  '@context': 'https://schema.org',
  '@type': 'Organization',
  name: 'Synthszr',
  url: 'https://www.synthszr.com',
  logo: 'https://www.synthszr.com/apple-touch-icon.png',
  sameAs: ['https://www.linkedin.com/in/mattes/'],
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  return (
    <html lang="de">
      <head>
        <link rel="preconnect" href="https://zadrjbyszvsusukajsbp.supabase.co" />
        <link rel="dns-prefetch" href="https://zadrjbyszvsusukajsbp.supabase.co" />
        {/* Cover images live on Vercel Blob — preconnect saves the
            DNS + TLS handshake (~200–500 ms) before the LCP fetch. */}
        <link rel="preconnect" href="https://lbrzdn804nhy3kox.public.blob.vercel-storage.com" crossOrigin="anonymous" />
        <link rel="dns-prefetch" href="https://lbrzdn804nhy3kox.public.blob.vercel-storage.com" />
        <link rel="alternate" type="application/rss+xml" title="Synthszr RSS" href="https://www.synthszr.com/feed.xml" />
      </head>
      <body className={`${ibmPlexSerif.variable} ${spaceMono.variable} font-serif antialiased`}>
        {children}
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: safeJsonLd(orgLd) }}
        />
        <PageTracker />
        <Analytics />
        <ConsentBanner />
        <NewsletterPopup />
      </body>
    </html>
  )
}

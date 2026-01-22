import type React from "react"
import type { Metadata } from "next"
import { IBM_Plex_Serif, Space_Mono } from "next/font/google"
import { Analytics } from "@/components/analytics"
import { ConsentBanner } from "@/components/consent-banner"
import { NewsletterPopup } from "@/components/newsletter-popup"
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
  title: "Synthszr — AI is about Synthesis not Efficiency.",
  description: "Exploring the intersection of business, design and technology in the age of AI",
  generator: "v0.app",
  icons: {
    icon: [
      { url: "/favicon.ico", sizes: "32x32" },
      { url: "/favicon-16x16.png", sizes: "16x16", type: "image/png" },
      { url: "/favicon-32x32.png", sizes: "32x32", type: "image/png" },
      { url: "/icon.svg", type: "image/svg+xml" },
    ],
    apple: "/apple-touch-icon.png",
  },
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  return (
    <html lang="en">
      <body className={`${ibmPlexSerif.variable} ${spaceMono.variable} font-serif antialiased`}>
        {children}
        <Analytics />
        <ConsentBanner />
        <NewsletterPopup />
      </body>
    </html>
  )
}

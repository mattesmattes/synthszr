import type React from "react"
import type { Metadata } from "next"
import { IBM_Plex_Serif, Space_Mono } from "next/font/google"
import { Analytics } from "@/components/analytics"
import { ConsentBanner } from "@/components/consent-banner"
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
  title: "Synthszr — Digital Synthesis",
  description: "Exploring the intersection of technology, design, and digital synthesis",
  generator: "v0.app",
  icons: {
    icon: "/icon.svg",
    apple: "/icon.svg",
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
      </body>
    </html>
  )
}

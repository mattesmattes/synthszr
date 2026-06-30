"use client"

import { useState } from "react"

interface ReferralShareProps {
  url: string
  shareText: string
  copyLabel: string
  copiedLabel: string
}

/** Empfehlungslink-Box mit Kopieren-Button + Teilen-Optionen (E-Mail, X, LinkedIn, WhatsApp). */
export function ReferralShare({ url, shareText, copyLabel, copiedLabel }: ReferralShareProps) {
  const [copied, setCopied] = useState(false)
  const enc = encodeURIComponent

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(url)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {}
  }

  const links = [
    { label: "E-Mail", href: `mailto:?subject=${enc("Synthszr")}&body=${enc(`${shareText}\n\n${url}`)}` },
    { label: "X", href: `https://twitter.com/intent/tweet?text=${enc(shareText)}&url=${enc(url)}` },
    { label: "LinkedIn", href: `https://www.linkedin.com/sharing/share-offsite/?url=${enc(url)}` },
    { label: "WhatsApp", href: `https://wa.me/?text=${enc(`${shareText} ${url}`)}` },
  ]

  return (
    <div className="space-y-3">
      <div className="flex items-stretch gap-2">
        <input
          readOnly
          value={url}
          onFocus={(e) => e.currentTarget.select()}
          className="flex-1 min-w-0 rounded-lg border border-border px-3 py-2 text-sm bg-muted/30"
        />
        <button
          onClick={copy}
          className="shrink-0 rounded-lg bg-foreground px-4 py-2 text-sm font-semibold text-background hover:opacity-90 transition-opacity"
        >
          {copied ? copiedLabel : copyLabel}
        </button>
      </div>
      <div className="flex flex-wrap gap-3 text-sm">
        {links.map((l) => (
          <a
            key={l.label}
            href={l.href}
            target="_blank"
            rel="noopener noreferrer"
            className="rounded-full border border-border px-3 py-1 hover:border-accent hover:text-accent transition-colors"
          >
            {l.label}
          </a>
        ))}
      </div>
    </div>
  )
}

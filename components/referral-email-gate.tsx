"use client"

import type React from "react"
import { useState } from "react"

interface ReferralEmailGateLabels {
  prompt: string
  placeholder: string
  cta: string
  sending: string
  sent: string
}

/** E-Mail-Eingabe für den Direktaufruf ohne ?sid: fordert einen Magic-Link zur
 *  persönlichen Übersicht an. Antwort ist immer „gesendet" (Anti-Enumeration). */
export function ReferralEmailGate({ lang, labels }: { lang: string; labels: ReferralEmailGateLabels }) {
  const [email, setEmail] = useState("")
  const [sent, setSent] = useState(false)
  const [loading, setLoading] = useState(false)

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!email) return
    setLoading(true)
    try {
      await fetch("/api/referral/magic-link", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, lang }),
      })
    } catch {}
    setSent(true)
    setLoading(false)
  }

  if (sent) {
    return (
      <p className="mt-8 rounded-lg border border-border bg-muted/30 p-4 text-sm">{labels.sent}</p>
    )
  }

  return (
    <form onSubmit={submit} className="mt-8 space-y-3">
      <p className="text-sm text-muted-foreground">{labels.prompt}</p>
      <div className="flex items-stretch gap-2">
        <input
          type="email"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder={labels.placeholder}
          className="flex-1 min-w-0 rounded-lg border border-border px-3 py-2 text-sm"
        />
        <button
          type="submit"
          disabled={loading}
          className="shrink-0 rounded-lg bg-foreground px-4 py-2 text-sm font-semibold text-background hover:opacity-90 transition-opacity disabled:opacity-60"
        >
          {loading ? labels.sending : labels.cta}
        </button>
      </div>
    </form>
  )
}

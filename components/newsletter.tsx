"use client"

import type React from "react"
import { useState } from "react"
import { Loader2, CheckCircle2, AlertCircle } from "lucide-react"
import type { LanguageCode } from "@/lib/types"

type SubscribeStatus = 'idle' | 'loading' | 'success' | 'error'

interface NewsletterProps {
  locale?: LanguageCode
}

export function Newsletter({ locale = 'de' }: NewsletterProps) {
  const [email, setEmail] = useState("")
  const [status, setStatus] = useState<SubscribeStatus>('idle')
  const [message, setMessage] = useState("")

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()

    if (!email) return

    setStatus('loading')
    setMessage("")

    try {
      const res = await fetch('/api/newsletter/subscribe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, language: locale }),
      })

      const data = await res.json()

      if (res.ok) {
        setStatus('success')
        setMessage(data.message || 'Confirmation email sent!')
        setEmail("")
      } else {
        setStatus('error')
        setMessage(data.error || 'An error occurred')
      }
    } catch {
      setStatus('error')
      setMessage('Network error. Please try again.')
    }
  }

  return (
    <>
      {/* Podcast block */}
      <section className="mt-20 pt-16">
        <div className="mx-auto max-w-2xl text-center">
          {/* Headline image */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src="/podcast_hl.png"
            alt="The daily synthszr podcast"
            className="mx-auto mb-4 max-w-sm w-full h-auto"
          />
          {/* Platform badges */}
          <div className="flex items-center justify-center gap-6">
            <a href="https://open.spotify.com/show/0FJkPjKXvobgqI8U881yiF?si=wMJJ-CQxQdyuW18VXQZQOQ" target="_blank" rel="noopener noreferrer">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src="/podcast_spotify.png" alt="Listen on Spotify" className="h-9 w-auto" />
            </a>
            <a href="https://podcasts.apple.com/de/podcast/synthszr/id1879733990" target="_blank" rel="noopener noreferrer">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src="/podcast_apple.png" alt="Listen on Apple Podcasts" className="h-9 w-auto" />
            </a>
            <a href="https://synthszr.com" target="_blank" rel="noopener noreferrer">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src="/podcast_synthszr.png" alt="synthszr.com" className="h-9 w-auto" />
            </a>
          </div>
        </div>
      </section>

      <section className="mt-8 pt-0">
      <div className="mx-auto max-w-2xl bg-cyan-vivid p-8 rounded-lg">
        <h2 className="font-mono text-2xl font-bold md:text-lg text-black">Subscribe free. Unsubscribe the second it sucks.</h2>
        <p className="mt-4 text-black/70">
          High-signal news across AI, business, UX, and tech. Every morning.
        </p>

        {status === 'success' ? (
          <div className="mt-6 flex items-center gap-3 rounded-sm bg-white/80 px-4 py-3">
            <CheckCircle2 className="h-5 w-5 text-green-600 shrink-0" />
            <p className="text-sm text-green-800">{message}</p>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="mt-6 flex flex-col gap-3 sm:flex-row">
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="your@email.com"
              required
              disabled={status === 'loading'}
              className="flex-1 rounded-sm border border-border bg-background px-4 py-3 text-sm focus:border-ring focus:outline-none focus:ring-1 focus:ring-ring disabled:opacity-50"
            />
            <button
              type="submit"
              disabled={status === 'loading'}
              className="rounded-sm bg-primary px-6 py-3 text-sm font-medium text-primary-foreground hover:bg-primary/90 transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
            >
              {status === 'loading' ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Sending...
                </>
              ) : (
                'Subscribe'
              )}
            </button>
          </form>
        )}

        {status === 'error' && message && (
          <div className="mt-3 flex items-center gap-2 text-sm text-red-600 dark:text-red-400">
            <AlertCircle className="h-4 w-4 shrink-0" />
            <p>{message}</p>
          </div>
        )}
      </div>
      </section>
    </>
  )
}

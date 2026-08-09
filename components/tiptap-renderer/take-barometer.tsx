'use client'

/**
 * Take-Barometer: „Sehe ich auch so" / „Sehe ich anders" unter jedem
 * Synthszr Take (Design 2026-08-09).
 *
 * Ein Klick, anonym — die Hürde liegt bewusst bei null, weil dieses Signal nie
 * ins Schema-Markup wandert. Nach dem Voten zeigt der Balken die Verteilung:
 * der Social-Proof-Moment, man will wissen, wo man steht.
 *
 * Eigenes Votum in localStorage: der Server dedupliziert über den
 * httpOnly-Cookie, aber die UI muss beim nächsten Besuch wissen, was sie
 * hervorheben soll — der Cookie ist für JS unlesbar (und soll es bleiben).
 */
import { useEffect, useState } from 'react'

interface TakeBarometerProps {
  postSource: 'posts' | 'generated_posts'
  postId: string
  anchor: string
  /** Abschnitts-Headline — wandert per CustomEvent als Chip in die Kommentarbox. */
  headline?: string
  /** Aggregat vom Eltern-Fetch — ein Request für alle Takes des Artikels. */
  initialCounts?: { agree: number; disagree: number }
  locale?: string
}

const STORAGE_KEY = 'synthszr_tb_votes'

function readOwnVote(postId: string, anchor: string): 'agree' | 'disagree' | null {
  try {
    const store = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}')
    const v = store[`${postId}:${anchor}`]
    return v === 'agree' || v === 'disagree' ? v : null
  } catch {
    return null
  }
}

function writeOwnVote(postId: string, anchor: string, vote: 'agree' | 'disagree') {
  try {
    const store = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}')
    store[`${postId}:${anchor}`] = vote
    localStorage.setItem(STORAGE_KEY, JSON.stringify(store))
  } catch {
    // localStorage gesperrt (Private Mode) — dann fehlt nur die Hervorhebung.
  }
}

export function TakeBarometer({ postSource, postId, anchor, headline, initialCounts, locale = 'de' }: TakeBarometerProps) {
  const [counts, setCounts] = useState(initialCounts ?? { agree: 0, disagree: 0 })
  const [ownVote, setOwnVote] = useState<'agree' | 'disagree' | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    setOwnVote(readOwnVote(postId, anchor))
  }, [postId, anchor])
  useEffect(() => {
    if (initialCounts) setCounts(initialCounts)
  }, [initialCounts])

  async function vote(v: 'agree' | 'disagree') {
    if (busy || ownVote === v) return
    setBusy(true)
    // Optimistisch: Umstimmen verschiebt, Erststimme addiert.
    setCounts((c) => ({
      agree: c.agree + (v === 'agree' ? 1 : 0) - (ownVote === 'agree' ? 1 : 0),
      disagree: c.disagree + (v === 'disagree' ? 1 : 0) - (ownVote === 'disagree' ? 1 : 0),
    }))
    setOwnVote(v)
    writeOwnVote(postId, anchor, v)
    try {
      const res = await fetch('/api/take-feedback', {
        method: 'POST',
        credentials: 'include',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ postSource, postId, sectionAnchor: anchor, vote: v }),
      })
      const data = await res.json().catch(() => null)
      if (res.ok && data && typeof data.agree === 'number') {
        setCounts({ agree: data.agree, disagree: data.disagree })
      }
    } catch {
      // Netzwerkfehler: die optimistische Zahl bleibt — beim nächsten Laden
      // korrigiert das Aggregat.
    } finally {
      setBusy(false)
    }
  }

  const total = counts.agree + counts.disagree
  const pct = total > 0 ? Math.round((counts.agree / total) * 100) : null
  const de = locale === 'de'
  const agreeLabel = de ? 'Sehe ich auch so' : 'Agree'
  const disagreeLabel = de ? 'Sehe ich anders' : 'Disagree'

  return (
    <div className="my-3 rounded-md border border-border bg-muted/30 px-3 py-2 font-sans">
      <div className="flex flex-wrap items-center gap-2 text-xs">
        <button
          type="button"
          onClick={() => vote('agree')}
          disabled={busy}
          className={`rounded px-2 py-1 transition-colors ${
            ownVote === 'agree'
              ? 'bg-foreground text-background'
              : 'border border-border hover:border-foreground'
          }`}
        >
          {agreeLabel}
        </button>
        <button
          type="button"
          onClick={() => vote('disagree')}
          disabled={busy}
          className={`rounded px-2 py-1 transition-colors ${
            ownVote === 'disagree'
              ? 'bg-foreground text-background'
              : 'border border-border hover:border-foreground'
          }`}
        >
          {disagreeLabel}
        </button>
        {/* Brücke zur Kommentarbox: setzt den Abschnitts-Bezug und scrollt
            hin. CustomEvent, weil Barometer (Portal im Renderer-Baum) und
            Kommentarbox (eigener Baum) keinen gemeinsamen State haben. */}
        <button
          type="button"
          className="text-muted-foreground underline-offset-2 hover:underline"
          onClick={() => {
            window.dispatchEvent(new CustomEvent('synthszr:comment-ref', {
              detail: { anchor, headline: headline ?? '' },
            }))
          }}
        >
          {locale === 'de' ? 'Deinen Take dazu schreiben →' : 'Write your take →'}
        </button>
        {/* Verteilung erst NACH eigener Stimme oder ab 5 Voten: eine 100%-Zahl
            aus einer einzigen Stimme sähe nach Manipulation aus. */}
        {pct !== null && (ownVote !== null || total >= 5) && (
          <span className="ml-auto flex items-center gap-2 text-muted-foreground">
            <span className="inline-block h-1.5 w-24 overflow-hidden rounded-full bg-border">
              <span className="block h-full bg-foreground" style={{ width: `${pct}%` }} />
            </span>
            {de
              ? `${pct} % stimmen dem Take zu`
              : `${pct}% agree with the take`}
          </span>
        )}
      </div>
    </div>
  )
}

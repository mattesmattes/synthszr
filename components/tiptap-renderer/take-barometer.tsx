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
import { ThumbsUp, ThumbsDown } from 'lucide-react'

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
  const hasVotes = total > 0
  const tie = hasVotes && counts.agree === counts.disagree
  const de = locale === 'de'
  const agreeLabel = de ? 'Sehe ich auch so' : 'Agree'
  const disagreeLabel = de ? 'Sehe ich anders' : 'Disagree'

  // Farb-/Füll-Logik (Betreiber-Wunsch 2026-08-09):
  //  - keine Votes: beide Thumbs als Outline (nur Rahmen).
  //  - Votes vorhanden: gefüllt — Daumen hoch grün, runter rot.
  //  - Gleichstand: beide gelb.
  // Der eigene Vote bekommt zusätzlich einen Ring, damit erkennbar bleibt, was
  // man selbst gewählt hat.
  const thumbClass = (kind: 'up' | 'down') => {
    const base = 'inline-flex items-center gap-1 rounded px-2 py-1 transition-colors'
    const own = ownVote === (kind === 'up' ? 'agree' : 'disagree')
      ? ' ring-2 ring-offset-1 ring-foreground'
      : ''
    if (!hasVotes) return `${base} border border-border text-muted-foreground hover:border-foreground${own}`
    if (tie) return `${base} border border-transparent bg-yellow-400 text-black${own}`
    return kind === 'up'
      ? `${base} border border-transparent bg-green-600 text-white${own}`
      : `${base} border border-transparent bg-red-600 text-white${own}`
  }

  return (
    <div className="my-3 rounded-md border border-border bg-muted/30 px-3 py-2 font-sans">
      <div className="flex flex-wrap items-center gap-2 text-xs">
        <button
          type="button"
          onClick={() => vote('agree')}
          disabled={busy}
          aria-label={agreeLabel}
          aria-pressed={ownVote === 'agree'}
          className={thumbClass('up')}
        >
          <ThumbsUp className="h-4 w-4" fill={hasVotes ? 'currentColor' : 'none'} />
          {/* Zahlen nur, wenn mindestens eine Stimme abgegeben wurde. */}
          {hasVotes && <span className="tabular-nums">({counts.agree})</span>}
        </button>
        <button
          type="button"
          onClick={() => vote('disagree')}
          disabled={busy}
          aria-label={disagreeLabel}
          aria-pressed={ownVote === 'disagree'}
          className={thumbClass('down')}
        >
          <ThumbsDown className="h-4 w-4" fill={hasVotes ? 'currentColor' : 'none'} />
          {hasVotes && <span className="tabular-nums">({counts.disagree})</span>}
        </button>
        {/* „Deinen Take dazu schreiben" erscheint ERST nach dem Voten — das
            Abstimmen ist die Eintrittskarte zum eigenen Take. Öffnet das
            Kommentar-Overlay per CustomEvent (Barometer und Kommentarbereich
            sind getrennte React-Bäume). */}
        {ownVote !== null && (
          <button
            type="button"
            className="text-muted-foreground underline-offset-2 hover:underline"
            onClick={() => {
              window.dispatchEvent(new CustomEvent('synthszr:comment-ref', {
                detail: { anchor, headline: headline ?? '' },
              }))
            }}
          >
            {de ? 'Deinen Take dazu schreiben →' : 'Write your take →'}
          </button>
        )}
      </div>
    </div>
  )
}

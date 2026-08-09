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
  const de = locale === 'de'
  const agreeLabel = de ? 'Sehe ich auch so' : 'Agree'
  const disagreeLabel = de ? 'Sehe ich anders' : 'Disagree'

  // KEIN Button-Kasten (Betreiber-Wunsch): nur Emoji + Zahl, transparent.
  const btnBase = 'inline-flex items-center gap-1 py-1 leading-none transition-opacity hover:opacity-70'

  const thumbButton = (kind: 'up' | 'down', count: number | null) => {
    const isUp = kind === 'up'
    return (
      <button
        type="button"
        onClick={() => vote(isUp ? 'agree' : 'disagree')}
        disabled={busy}
        aria-label={isUp ? agreeLabel : disagreeLabel}
        aria-pressed={ownVote === (isUp ? 'agree' : 'disagree')}
        className={btnBase}
      >
        {/* Echtes Emoji statt SVG-Icon: immer eindeutig als Daumen erkennbar,
            keine Färbungs- oder Kragen-Probleme (Betreiber-Wunsch 2026-08-09). */}
        <span className="text-base" aria-hidden="true">{isUp ? '👍' : '👎'}</span>
        {count !== null && <span className="tabular-nums text-muted-foreground">({count})</span>}
      </button>
    )
  }

  return (
    // INLINE direkt hinter dem letzten Satz des Takes (Betreiber-Wunsch): span
    // statt div, damit es gültiges HTML im <p> bleibt. Kleiner Abstand links.
    // Emoji-Thumbs immer sichtbar; Zahlen erst bei Stimmen, bei 0 leicht gedimmt.
    <span
      className={`ml-2 inline-flex flex-wrap items-center gap-2 align-middle text-xs font-sans ${total === 0 ? 'opacity-60' : ''}`}
    >
      {thumbButton('up', total > 0 ? counts.agree : null)}
      {thumbButton('down', total > 0 ? counts.disagree : null)}

      {/* „Deinen Take dazu schreiben" erst NACH dem Voten. Öffnet das
          Kommentar-Overlay per CustomEvent. */}
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
    </span>
  )
}

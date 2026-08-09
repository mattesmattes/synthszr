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

  const lead: 'up' | 'down' | 'tie' = counts.agree > counts.disagree
    ? 'up'
    : counts.disagree > counts.agree ? 'down' : 'tie'
  const de = locale === 'de'
  const agreeLabel = de ? 'Sehe ich auch so' : 'Agree'
  const disagreeLabel = de ? 'Sehe ich anders' : 'Disagree'

  // KEIN Button-Kasten (Betreiber-Wunsch): nur Icon + Zahl, transparent auf dem
  // Seitenhintergrund.
  const btnBase = 'inline-flex items-center gap-1 py-1 transition-opacity hover:opacity-70'
  // Gefüllte Hand: solide Farbe, aber der STROKE bleibt in Hintergrundfarbe.
  // Dadurch bleibt die Kragen-Linie (Trennung Hemdkragen/Hand) als Aussparung
  // sichtbar — sonst wird das gefüllte Icon ein unlesbarer Klumpen. Die äußere
  // Kontur in Hintergrundfarbe verschwindet auf dem Seitenhintergrund.
  // WICHTIG: fill/stroke als inline-STYLE, nicht als Attribut — var(--background)
  // wird in SVG-Präsentationsattributen NICHT aufgelöst (nur in CSS-Properties).
  const filledIconProps = { strokeWidth: 2, style: { fill: 'currentColor', stroke: 'var(--background)' } }
  const outlineIconProps = { fill: 'none' as const }

  const thumbButton = (kind: 'up' | 'down', colorClass: string, filled: boolean, count: number | null) => {
    const isUp = kind === 'up'
    return (
      <button
        type="button"
        onClick={() => vote(isUp ? 'agree' : 'disagree')}
        disabled={busy}
        aria-label={isUp ? agreeLabel : disagreeLabel}
        aria-pressed={ownVote === (isUp ? 'agree' : 'disagree')}
        className={`${btnBase} ${colorClass}`}
      >
        {isUp
          ? <ThumbsUp className="h-5 w-5" {...(filled ? filledIconProps : outlineIconProps)} />
          : <ThumbsDown className="h-5 w-5" {...(filled ? filledIconProps : outlineIconProps)} />}
        {count !== null && <span className="tabular-nums">({count})</span>}
      </button>
    )
  }

  const MUTED = 'text-muted-foreground'
  const GREEN = 'text-green-600 dark:text-green-400'
  const RED = 'text-red-600 dark:text-red-400'
  const YELLOW = 'text-yellow-500 dark:text-yellow-400'

  return (
    // Transparent auf dem Seitenhintergrund — kein grauer Kasten.
    <div className="my-3 font-sans">
      <div className="flex flex-wrap items-center gap-3 text-xs">
        {/* VOR der eigenen Stimme: beide Outline-Thumbs zum Abstimmen, keine
            Zahlen. NACH der Stimme: nur der Mehrheits-Thumb (👍 grün bei mehr
            Positiven, 👎 rot bei mehr Negativen); bei Gleichstand beide gelb.
            (Betreiber-Wunsch 2026-08-09: „bei 0 outline, bei up/down zeigen wir
            den Mehrheits-Thumb mit Zahl".) */}
        {ownVote === null ? (
          <>
            {thumbButton('up', MUTED, false, null)}
            {thumbButton('down', MUTED, false, null)}
          </>
        ) : lead === 'tie' ? (
          <>
            {thumbButton('up', YELLOW, true, counts.agree)}
            {thumbButton('down', YELLOW, true, counts.disagree)}
          </>
        ) : lead === 'up' ? (
          thumbButton('up', GREEN, true, counts.agree)
        ) : (
          thumbButton('down', RED, true, counts.disagree)
        )}

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
      </div>
    </div>
  )
}

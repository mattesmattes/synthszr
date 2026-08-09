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
  // Führende Seite bestimmt die Färbung.
  const lead: 'up' | 'down' | 'tie' | 'none' = !hasVotes
    ? 'none'
    : counts.agree > counts.disagree ? 'up'
    : counts.disagree > counts.agree ? 'down'
    : 'tie'
  const de = locale === 'de'
  const agreeLabel = de ? 'Sehe ich auch so' : 'Agree'
  const disagreeLabel = de ? 'Sehe ich anders' : 'Disagree'

  // Betreiber-Wunsch 2026-08-09: NUR die Hand (das Icon) wird eingefärbt, der
  // Button bleibt immer eine transparente Outline. Eingefärbt wird die FÜHRENDE
  // Seite (Daumen hoch grün, runter rot); bei Gleichstand beide gelb; die
  // unterlegene bzw. votelose Seite bleibt Outline (nur Rahmen). Die Zahl in
  // Klammern steht an beiden Thumbs, sobald überhaupt eine Stimme da ist.
  const thumb = (kind: 'up' | 'down'): { text: string; filled: boolean } => {
    if (lead === 'tie') return { text: 'text-yellow-500 dark:text-yellow-400', filled: true }
    if (lead === kind) {
      return kind === 'up'
        ? { text: 'text-green-600 dark:text-green-400', filled: true }
        : { text: 'text-red-600 dark:text-red-400', filled: true }
    }
    return { text: 'text-muted-foreground', filled: false }
  }
  const up = thumb('up')
  const down = thumb('down')
  // KEIN Button-Kasten mehr (Betreiber-Wunsch): nur Icon + Zahl, transparent.
  const btnBase = 'inline-flex items-center gap-1 py-1 transition-opacity hover:opacity-70'
  // Gefüllte Hand: solide Farbe, aber der STROKE bleibt in Hintergrundfarbe.
  // Dadurch bleibt die Kragen-Linie (Trennung Hemdkragen/Hand) als
  // Aussparung sichtbar — sonst wird das gefüllte Icon ein unlesbarer Klumpen.
  // Die äußere Kontur in Hintergrundfarbe verschwindet auf dem Seitenhintergrund.
  //
  // WICHTIG: stroke/fill als inline-STYLE, nicht als Attribut — var(--background)
  // wird in SVG-Präsentationsattributen NICHT aufgelöst (nur in CSS-Properties).
  const filledIconProps = { strokeWidth: 2, style: { fill: 'currentColor', stroke: 'var(--background)' } }
  const outlineIconProps = { fill: 'none' as const }

  return (
    // Transparent auf dem Seitenhintergrund — kein grauer Kasten mehr. Ohne
    // Votes stehen die beiden Outline-Thumbs unauffällig da.
    <div className="my-3 font-sans">
      <div className="flex flex-wrap items-center gap-3 text-xs">
        <button
          type="button"
          onClick={() => vote('agree')}
          disabled={busy}
          aria-label={agreeLabel}
          aria-pressed={ownVote === 'agree'}
          className={`${btnBase} ${up.text}`}
        >
          <ThumbsUp className="h-5 w-5" {...(up.filled ? filledIconProps : outlineIconProps)} />
          {/* Zahlen nur, wenn mindestens eine Stimme abgegeben wurde. */}
          {hasVotes && <span className="tabular-nums">({counts.agree})</span>}
        </button>
        <button
          type="button"
          onClick={() => vote('disagree')}
          disabled={busy}
          aria-label={disagreeLabel}
          aria-pressed={ownVote === 'disagree'}
          className={`${btnBase} ${down.text}`}
        >
          <ThumbsDown className="h-5 w-5" {...(down.filled ? filledIconProps : outlineIconProps)} />
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

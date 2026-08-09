'use client'

/**
 * „Eure Takes" — der Kommentarbereich am Artikelende (Design 2026-08-09).
 *
 * Gepoolt statt pro Abschnitt (kritische Masse), aber mit Abschnitts-Chip:
 * das Barometer unter einem Take kann per CustomEvent hierher verlinken und
 * den Bezug setzen — zwei getrennte React-Bäume (Portal-Widgets im Renderer,
 * diese Sektion daneben), das Event ist die entkoppelte Brücke.
 *
 * Der Server rendert die SSR-Liste (Crawler sehen die Kommentare im HTML);
 * diese Komponente übernimmt sie als Startzustand und frischt nach der
 * Hydration live auf — dieselbe Auswahl wie das SSR, nur ohne Cache-Verzug.
 *
 * IDENTITÄT IST HIER UNSICHTBAR: der Reader-Cookie ist httpOnly, der Client
 * kann ihn nicht lesen. Deshalb wird optimistisch ohne E-Mail abgeschickt —
 * antwortet der Server `email_required`, klappt das E-Mail-Feld auf. Kein
 * Zustand, der lügen kann.
 *
 * Der ?ct=-Token (Newsletter-Link) wird NACH der Hydration aus
 * window.location gelesen, NICHT über useSearchParams. Grund (Review-Befund 7):
 * useSearchParams erzwingt im statischen Prerender einen Bailout auf den
 * Suspense-Fallback — die komplette Kommentar-Sektion samt SSR-Liste fiele
 * dann aus dem statischen HTML, und genau diese Liste ist der SEO-Sinn des
 * Features. window.location im useEffect ist client-only, ohne Prerender-
 * Bailout: die Liste steht im HTML, der Token wird erst zur Laufzeit gelesen.
 */
import { FormEvent, useEffect, useRef, useState } from 'react'
import type { PublicComment } from '@/lib/comments/service'

interface EureTakesSectionProps {
  postSource: 'posts' | 'generated_posts'
  postId: string
  locale: string
  initialComments: PublicComment[]
}

/** Event, mit dem das Take-Barometer den Abschnitts-Bezug setzt. */
export interface CommentSectionRefEvent {
  anchor: string
  headline: string
}

const NAME_KEY = 'synthszr_display_name'

export function EureTakesSection({ postSource, postId, locale, initialComments }: EureTakesSectionProps) {
  const [commentToken, setCommentToken] = useState<string | null>(null)

  const [comments, setComments] = useState<PublicComment[]>(initialComments)
  const [body, setBody] = useState('')
  const [displayName, setDisplayName] = useState('')
  const [email, setEmail] = useState('')
  const [needsEmail, setNeedsEmail] = useState(false)
  const [sectionRef, setSectionRef] = useState<CommentSectionRefEvent | null>(null)
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState<{ kind: 'ok' | 'info' | 'error'; text: string } | null>(null)
  const formRef = useRef<HTMLDivElement>(null)

  const de = locale === 'de'

  // Namen aus dem letzten Besuch vorbelegen und ?ct=-Token aus der URL lesen —
  // beides client-only nach der Hydration, damit die Sektion statisch bleibt.
  useEffect(() => {
    try {
      const saved = localStorage.getItem(NAME_KEY)
      if (saved) setDisplayName(saved)
    } catch { /* Private Mode */ }
    const ct = new URLSearchParams(window.location.search).get('ct')
    if (ct) setCommentToken(ct)
  }, [])

  // Live-Auffrischung nach der Hydration: das SSR-HTML kann bis zu ~6 Minuten
  // alt sein (ISR + Edge-Cache) — die Leser sollen den aktuellen Stand sehen.
  useEffect(() => {
    let cancelled = false
    fetch(`/api/comments?source=${postSource}&postId=${postId}`)
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (!cancelled && Array.isArray(data?.comments)) setComments(data.comments)
      })
      .catch(() => {})
    return () => { cancelled = true }
  }, [postSource, postId])

  // Brücke vom Take-Barometer: Abschnitts-Bezug setzen und zur Box scrollen.
  useEffect(() => {
    function onRef(e: Event) {
      const detail = (e as CustomEvent<CommentSectionRefEvent>).detail
      if (detail?.anchor) {
        setSectionRef(detail)
        formRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' })
      }
    }
    window.addEventListener('synthszr:comment-ref', onRef)
    return () => window.removeEventListener('synthszr:comment-ref', onRef)
  }, [])

  async function submit(e: FormEvent) {
    e.preventDefault()
    if (busy || !body.trim() || !displayName.trim()) return
    setBusy(true)
    setNotice(null)
    try {
      localStorage.setItem(NAME_KEY, displayName.trim())
    } catch { /* Private Mode */ }
    try {
      const res = await fetch('/api/comments', {
        method: 'POST',
        credentials: 'include',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          postSource,
          postId,
          body: body.trim(),
          displayName: displayName.trim(),
          sectionAnchor: sectionRef?.anchor ?? null,
          sectionHeadline: sectionRef?.headline ?? null,
          ...(needsEmail && email ? { email: email.trim() } : {}),
          ...(commentToken ? { commentToken } : {}),
          website: '', // Honeypot — bleibt bei Menschen leer.
        }),
      })
      const data = await res.json().catch(() => null)

      if (res.status === 401 && data?.error === 'email_required') {
        setNeedsEmail(true)
        setNotice({
          kind: 'info',
          text: de
            ? 'Kommentieren ist ein Abo-Privileg: Trag deine Newsletter-Adresse ein — du bekommst einen Bestätigungslink.'
            : 'Commenting is a subscriber perk: enter your newsletter address to receive a confirmation link.',
        })
        return
      }
      if (!res.ok) {
        setNotice({ kind: 'error', text: data?.error ?? (de ? 'Nicht gespeichert — bitte nochmal.' : 'Not saved — please retry.') })
        return
      }

      if (data.status === 'published') {
        // Sofort sichtbar machen — die Server-Liste zieht beim nächsten Fetch nach.
        setComments((prev) => [{
          id: `local-${Date.now()}`,
          displayName: displayName.trim(),
          body: body.trim(),
          sectionHeadline: sectionRef?.headline ?? null,
          publishedAt: new Date().toISOString(),
        }, ...prev])
        setNotice({ kind: 'ok', text: de ? 'Dein Take ist live.' : 'Your take is live.' })
      } else if (data.status === 'pending') {
        setNotice({ kind: 'info', text: de ? 'Dein Take ist in der Redaktionsprüfung und erscheint nach Freigabe.' : 'Your take is under review and will appear once approved.' })
      } else if (data.status === 'verify_sent') {
        setNotice({ kind: 'info', text: de ? 'Prüf dein Postfach: Ein Klick auf den Link, und dein Take geht in die Veröffentlichung.' : 'Check your inbox: one click on the link publishes your take.' })
      } else {
        setNotice({ kind: 'info', text: de ? 'Dein Take ist eingegangen.' : 'Your take was received.' })
      }
      setBody('')
      setSectionRef(null)
      setNeedsEmail(false)
    } catch {
      setNotice({ kind: 'error', text: de ? 'Netzwerkfehler — bitte nochmal.' : 'Network error — please retry.' })
    } finally {
      setBusy(false)
    }
  }

  return (
    <section id="eure-takes" className="mt-16 border-t border-border pt-8">
      <h2 className="font-mono text-xs uppercase tracking-wide text-muted-foreground">
        {de ? 'Eure Takes' : 'Your Takes'}
      </h2>
      <p className="mt-2 text-sm text-muted-foreground">
        {de
          ? 'Der Synthszr hat eine Haltung. Jetzt bist du dran.'
          : 'The Synthszr has an opinion. Your turn.'}
      </p>

      <div ref={formRef} className="mt-6">
        <form onSubmit={submit} className="space-y-3">
          {sectionRef && (
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <span className="rounded-full border border-border px-2 py-0.5">
                {de ? 'zu' : 're'}: {sectionRef.headline.slice(0, 80)}
              </span>
              <button type="button" className="underline" onClick={() => setSectionRef(null)}>
                {de ? 'entfernen' : 'remove'}
              </button>
            </div>
          )}
          <textarea
            value={body}
            onChange={(e) => setBody(e.target.value)}
            placeholder={de ? 'Was ist dein Take?' : 'What is your take?'}
            rows={4}
            maxLength={4000}
            className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
          />
          {/* Honeypot: für Menschen unsichtbar, Bots füllen es. */}
          <input
            type="text"
            name="website"
            tabIndex={-1}
            autoComplete="off"
            aria-hidden="true"
            className="absolute -left-[9999px] h-0 w-0 opacity-0"
            onChange={() => { /* absichtlich ignoriert */ }}
          />
          <div className="flex flex-wrap items-center gap-2">
            <input
              type="text"
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              placeholder={de ? 'Dein Name' : 'Your name'}
              maxLength={80}
              className="w-44 rounded-md border border-border bg-background px-3 py-1.5 text-sm"
            />
            {needsEmail && (
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder={de ? 'Newsletter-Adresse' : 'Newsletter address'}
                maxLength={320}
                className="w-64 rounded-md border border-border bg-background px-3 py-1.5 text-sm"
              />
            )}
            <button
              type="submit"
              disabled={busy || !body.trim() || !displayName.trim() || (needsEmail && !email.trim())}
              className="rounded-md bg-foreground px-4 py-1.5 text-sm text-background disabled:opacity-50"
            >
              {busy ? (de ? 'Sende…' : 'Sending…') : (de ? 'Take abgeben' : 'Post take')}
            </button>
          </div>
          {notice && (
            <p className={`text-xs ${notice.kind === 'error' ? 'text-red-600' : notice.kind === 'ok' ? 'text-green-700' : 'text-muted-foreground'}`}>
              {notice.text}
            </p>
          )}
        </form>
      </div>

      {comments.length > 0 && (
        <ol className="mt-8 space-y-6">
          {comments.map((c) => (
            <li key={c.id} className="text-sm">
              <div className="flex flex-wrap items-baseline gap-2">
                <span className="font-medium">{c.displayName}</span>
                {c.sectionHeadline && (
                  <span className="rounded-full border border-border px-2 py-0.5 text-xs text-muted-foreground">
                    {de ? 'zu' : 're'}: {c.sectionHeadline.slice(0, 60)}
                  </span>
                )}
                <time dateTime={c.publishedAt} className="font-mono text-xs text-muted-foreground">
                  {/* Feste timeZone: die Liste rendert server- UND client-seitig
                      (Review-Befund 7 behoben) — ohne sie driften SSR und
                      Hydration je nach Server-Zeitzone auseinander. */}
                  {new Date(c.publishedAt).toLocaleDateString(de ? 'de-DE' : 'en-US', { day: '2-digit', month: '2-digit', year: 'numeric', timeZone: 'Europe/Berlin' })}
                </time>
              </div>
              {/* Plain-Text: React escaped — und gespeichert wird ohnehin kein
                  Markup. whitespace-pre-line erhält Absätze. */}
              <p className="mt-1 whitespace-pre-line leading-relaxed">{c.body}</p>
            </li>
          ))}
        </ol>
      )}
    </section>
  )
}

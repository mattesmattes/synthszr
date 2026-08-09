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
import { createPortal } from 'react-dom'

interface EureTakesSectionProps {
  postSource: 'posts' | 'generated_posts'
  postId: string
  locale: string
}

/** Event, mit dem das Take-Barometer den Abschnitts-Bezug setzt. */
export interface CommentSectionRefEvent {
  anchor: string
  headline: string
}

const NAME_KEY = 'synthszr_display_name'

/**
 * Schreib-Overlay für „Eure Takes" — reiner Modal-Host (Betreiber-Wunsch
 * 2026-08-09: die veröffentlichten Takes hängen jetzt direkt unter dem
 * jeweiligen Abschnitt via <SectionComments>, NICHT mehr gepoolt hier).
 *
 * Diese Komponente rendert nichts Sichtbares außer dem Modal: sie lauscht auf
 * `synthszr:comment-ref` (öffnet das Overlay mit Abschnitts-Bezug) und feuert
 * nach dem Veröffentlichen `synthszr:comment-published`, damit der passende
 * Abschnitts-Block den neuen Take sofort zeigt.
 */
export function EureTakesSection({ postSource, postId, locale }: EureTakesSectionProps) {
  const [commentToken, setCommentToken] = useState<string | null>(null)

  const [body, setBody] = useState('')
  const [displayName, setDisplayName] = useState('')
  const [email, setEmail] = useState('')
  const [needsEmail, setNeedsEmail] = useState(false)
  const [sectionRef, setSectionRef] = useState<CommentSectionRefEvent | null>(null)
  const [modalOpen, setModalOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  // Nach erfolgreichem Absenden zeigt das Modal NUR noch die zentrierte Meldung
  // (kein Formular mehr) — Betreiber-Wunsch.
  const [submitted, setSubmitted] = useState(false)
  const [notice, setNotice] = useState<{ kind: 'ok' | 'info' | 'error'; text: string } | null>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)

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

  // (Die veröffentlichten Takes lädt jetzt jeder Abschnitts-Block selbst.)

  // Brücke vom Take-Barometer: Klick auf „Deinen Take dazu schreiben" öffnet das
  // Schreib-Overlay mit dem Abschnitts-Bezug.
  //
  // REDESIGN 2026-08-09: Früher wurde ~9400px zur Box am Seitenende gescrollt —
  // fragil (Smooth-Drosselung, Layout-Shift, Fokus-Wettstreit mit dem
  // ProseMirror-Editor, in dem der Button sitzt) und für den Nutzer verwirrend.
  // Jetzt öffnet sich ein Overlay direkt dort, wo man ist. Kein Scrollen, keine
  // Distanz, keine Fokus-Konkurrenz (das Modal hängt an document.body, außerhalb
  // des Editors).
  useEffect(() => {
    function onRef(e: Event) {
      const detail = (e as CustomEvent<CommentSectionRefEvent>).detail
      if (!detail?.anchor) return
      setSectionRef(detail)
      setNotice(null)
      setSubmitted(false)
      setModalOpen(true)
    }
    window.addEventListener('synthszr:comment-ref', onRef)
    return () => window.removeEventListener('synthszr:comment-ref', onRef)
  }, [])

  // Modal-Verhalten: Textarea fokussieren (jetzt zuverlässig, weil außerhalb des
  // Editors), Body-Scroll sperren, Escape schließt.
  useEffect(() => {
    if (!modalOpen) return
    const prevOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    const t = window.setTimeout(() => textareaRef.current?.focus(), 40)
    function onKey(e: KeyboardEvent) { if (e.key === 'Escape') setModalOpen(false) }
    window.addEventListener('keydown', onKey)
    return () => {
      document.body.style.overflow = prevOverflow
      window.clearTimeout(t)
      window.removeEventListener('keydown', onKey)
    }
  }, [modalOpen])

  async function submit(e: FormEvent) {
    e.preventDefault()
    if (busy) return
    // Kein stiller Abbruch mehr: fehlende Pflichtfelder werden als Hinweis
    // gemeldet, statt den Button nur zu deaktivieren. Sonst passierte beim Klick
    // scheinbar nichts (Betreiber-Befund: „anonym klicke passiert nichts").
    if (!body.trim()) {
      setNotice({ kind: 'info', text: de ? 'Schreib zuerst deinen Take.' : 'Write your take first.' })
      return
    }
    if (!displayName.trim()) {
      setNotice({ kind: 'info', text: de ? 'Gib noch deinen Namen an.' : 'Add your name.' })
      return
    }
    if (needsEmail && !email.trim()) {
      setNotice({ kind: 'info', text: de ? 'Gib deine Newsletter-Adresse ein.' : 'Enter your newsletter address.' })
      return
    }
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
            ? 'Kommentieren ist Newsletter-Abonnent:innen vorbehalten. Trag deine Abo-Adresse ein — du bekommst einen Login-Link, und dein Take geht dann live. Noch kein Abo? Dann melde dich zuerst zum Newsletter an.'
            : 'Commenting is for newsletter subscribers. Enter your subscription email — you get a login link and your take goes live. Not subscribed yet? Sign up for the newsletter first.',
        })
        return
      }
      if (!res.ok) {
        setNotice({ kind: 'error', text: data?.error ?? (de ? 'Nicht gespeichert — bitte nochmal.' : 'Not saved — please retry.') })
        return
      }

      if (data.status === 'published') {
        // Sofort sichtbar machen: den passenden Abschnitts-Block per Event
        // informieren, damit der neue Take direkt dort unter dem Take erscheint.
        if (sectionRef?.anchor) {
          window.dispatchEvent(new CustomEvent('synthszr:comment-published', {
            detail: {
              anchor: sectionRef.anchor,
              comment: {
                id: `local-${Date.now()}`,
                displayName: displayName.trim(),
                body: body.trim(),
                sectionAnchor: sectionRef.anchor,
                sectionHeadline: sectionRef.headline ?? null,
                publishedAt: new Date().toISOString(),
              },
            },
          }))
        }
        setNotice({ kind: 'ok', text: de ? 'Dein Take ist live.' : 'Your take is live.' })
      } else if (data.status === 'pending') {
        setNotice({ kind: 'info', text: de ? 'Dein Take ist in der Redaktionsprüfung und erscheint nach Freigabe.' : 'Your take is under review and will appear once approved.' })
      } else if (data.status === 'verify_sent') {
        setNotice({ kind: 'info', text: de ? 'Prüf dein Postfach: Ein Klick auf den Link, und dein Take geht in die Veröffentlichung.' : 'Check your inbox: one click on the link publishes your take.' })
      } else {
        setNotice({ kind: 'info', text: de ? 'Dein Take ist eingegangen.' : 'Your take was received.' })
      }
      // Erfolg (published / pending / verify_sent / eingegangen): Formular
      // ausblenden, nur noch die zentrierte Meldung zeigen.
      setSubmitted(true)
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
    <>
      {/* Schreib-Overlay als echter Top-Layer (Portal an document.body, außerhalb
          des Artikel-/Editor-DOM). Nur clientseitig gerendert (modalOpen startet
          false, wird per Nutzeraktion gesetzt). */}
      {modalOpen && typeof document !== 'undefined' && createPortal(
        <div
          role="dialog"
          aria-modal="true"
          aria-label={de ? 'Deinen Take schreiben' : 'Write your take'}
          className="fixed inset-0 z-[9999] flex items-center justify-center p-4 font-sans"
        >
          {/* Hintergrund abdunkeln UND blurren, eingeblendet. */}
          <div
            className="absolute inset-0 bg-black/50 backdrop-blur-sm animate-in fade-in-0"
            onClick={() => setModalOpen(false)}
          />
          {/* Box faded + zoomt leicht rein. */}
          <div className="relative z-10 w-full max-w-lg rounded-lg border border-border bg-background p-5 shadow-xl animate-in fade-in-0 zoom-in-95 duration-200">
            <div className="flex items-start justify-between gap-4">
              {/* Nach dem Absenden: Titel visuell weg (nur die zentrierte
                  Meldung soll bleiben), bleibt aber für Screenreader erhalten. */}
              <h2 className={submitted ? 'sr-only' : 'text-lg font-bold tracking-tight'}>
                {de ? 'Dein Take' : 'Your take'}
              </h2>
              <button
                type="button"
                onClick={() => setModalOpen(false)}
                aria-label={de ? 'Schließen' : 'Close'}
                className="-mr-1 -mt-1 rounded p-1 text-muted-foreground hover:text-foreground"
              >
                ✕
              </button>
            </div>

            {submitted ? (
              /* Nach erfolgreichem Absenden: NUR die zentrierte Meldung, sonst
                 nichts (Betreiber-Wunsch). */
              <p className="px-2 py-8 text-center text-sm text-foreground">
                {notice?.text}
              </p>
            ) : (
              <>
            {/* Von Anfang an klar, dass Kommentieren an ein Newsletter-Abo
                gebunden ist — damit anonyme Leser:innen nicht erst nach dem
                Absenden davon erfahren. */}
            <p className="mt-2 text-xs text-muted-foreground">
              {de
                ? 'Kommentieren ist Newsletter-Abonnent:innen vorbehalten. Anonym abstimmen kannst du jederzeit über das Barometer.'
                : 'Commenting is for newsletter subscribers. You can always vote anonymously via the barometer.'}
            </p>

            <form onSubmit={submit} className="mt-3 space-y-3">
              {/* Reiner Kontext-Hinweis, KEIN „entfernen": wer über „Deinen Take
                  dazu schreiben" reinkommt, kommentiert genau zu diesem Abschnitt
                  — den Bezug zu lösen wäre sinnlos. Ohne Bezug (Button unten am
                  Bereich) erscheint der Chip gar nicht. */}
              {sectionRef && (
                <div className="text-xs text-muted-foreground">
                  <span className="inline-block rounded-full border border-border px-2 py-0.5">
                    {de ? 'zu' : 're'}: {sectionRef.headline.slice(0, 80)}
                  </span>
                </div>
              )}
              <textarea
                ref={textareaRef}
                value={body}
                onChange={(e) => setBody(e.target.value)}
                placeholder={de ? 'Was ist dein Take?' : 'What is your take?'}
                rows={5}
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
                {/* Unterstrich-Linie statt Kasten (Betreiber-Wunsch): nur eine
                    Schreiblinie, kein quadratisches Feld. */}
                <input
                  type="text"
                  value={displayName}
                  onChange={(e) => setDisplayName(e.target.value)}
                  placeholder={de ? 'Dein Name' : 'Your name'}
                  maxLength={80}
                  className="w-44 appearance-none rounded-none border-0 border-b border-border bg-transparent px-1 py-1 text-sm focus:border-foreground focus:outline-none"
                />
                {needsEmail && (
                  <input
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder={de ? 'Newsletter-Adresse' : 'Newsletter address'}
                    maxLength={320}
                    className="w-64 appearance-none rounded-none border-0 border-b border-border bg-transparent px-1 py-1 text-sm focus:border-foreground focus:outline-none"
                  />
                )}
                <button
                  type="submit"
                  disabled={busy}
                  className="ml-auto rounded-md bg-foreground px-4 py-1.5 text-sm text-background disabled:opacity-50"
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
              </>
            )}
          </div>
        </div>,
        document.body,
      )}
    </>
  )
}

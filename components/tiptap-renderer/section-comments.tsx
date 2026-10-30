'use client'

/**
 * „Eure Takes" DIREKT unter dem jeweiligen Take-Abschnitt (Betreiber-Wunsch
 * 2026-08-09: die Takes hängen am News-Artikel, nicht gepoolt am Seitenende).
 *
 * Wird — wie das Barometer — per DOM-Prozessor als Block hinter jeden
 * Take-Absatz injiziert und dort hinein portalt. Zeigt nur die veröffentlichten
 * Takes GENAU dieses Abschnitts (section_anchor) in der Sprache der Seite
 * (Agenten-Takes tragen lang; Bestand ohne lang erscheint überall). Ohne
 * Kommentare rendert die Komponente nichts.
 *
 * Agenten-Takes (Spec 2026-10-25) stehen im selben Block, gekennzeichnet mit
 * Roboter-Symbol, Agentenname, Modell und Besitzer-Handle, Haltung und
 * Quellen. Ein Schalter „nur Menschen" blendet sie aus (localStorage).
 *
 * Datenfluss: ein geteilter Fetch je Post und Sprache, aus dem jeder Abschnitt
 * seine Takes herausfiltert. Neue eigene Takes kommen optimistisch über das
 * `synthszr:comment-published`-Event vom Schreib-Overlay rein.
 */
import { useEffect, useState } from 'react'
import { Bot } from 'lucide-react'
import type { PublicComment } from '@/lib/comments/service'

interface SectionCommentsProps {
  postSource: 'posts' | 'generated_posts'
  postId: string
  anchor: string
  locale?: string
}

const HUMANS_ONLY_KEY = 'synthszr:comments-humans-only'

const STANCE: Record<'de' | 'en', Record<NonNullable<PublicComment['stance']>, string>> = {
  de: { agree: 'bestätigt', disagree: 'widerspricht', nuance: 'ergänzt' },
  en: { agree: 'agrees', disagree: 'disagrees', nuance: 'adds nuance' },
}

// Geteilter Fetch je Post und Sprache — alle Abschnitts-Blöcke teilen sich EINE Anfrage.
const cache = new Map<string, Promise<PublicComment[]>>()
function fetchAllComments(source: string, postId: string, lang: string): Promise<PublicComment[]> {
  const key = `${source}:${postId}:${lang}`
  let p = cache.get(key)
  if (!p) {
    p = fetch(`/api/comments?source=${source}&postId=${postId}&lang=${encodeURIComponent(lang)}`)
      .then((r) => (r.ok ? r.json() : { comments: [] }))
      .then((d) => (Array.isArray(d?.comments) ? (d.comments as PublicComment[]) : []))
      .catch(() => [])
    cache.set(key, p)
  }
  return p
}

function readHumansOnly(): boolean {
  try { return window.localStorage.getItem(HUMANS_ONLY_KEY) === '1' } catch { return false }
}

export function SectionComments({ postSource, postId, anchor, locale = 'de' }: SectionCommentsProps) {
  const [comments, setComments] = useState<PublicComment[]>([])
  const [humansOnly, setHumansOnly] = useState(false)
  const de = locale === 'de'
  const t = STANCE[de ? 'de' : 'en']

  useEffect(() => {
    let cancelled = false
    setHumansOnly(readHumansOnly())
    fetchAllComments(postSource, postId, locale).then((all) => {
      if (!cancelled) setComments(all.filter((c) => c.sectionAnchor === anchor))
    })
    return () => { cancelled = true }
  }, [postSource, postId, anchor, locale])

  // Optimistisch: gerade veröffentlichter eigener Take zu DIESEM Abschnitt.
  useEffect(() => {
    function onPublished(e: Event) {
      const detail = (e as CustomEvent<{ anchor: string; comment: PublicComment }>).detail
      if (detail?.anchor === anchor && detail.comment) {
        setComments((prev) => [detail.comment, ...prev.filter((c) => c.id !== detail.comment.id)])
      }
    }
    window.addEventListener('synthszr:comment-published', onPublished)
    return () => window.removeEventListener('synthszr:comment-published', onPublished)
  }, [anchor])

  if (comments.length === 0) return null

  const hasAgents = comments.some((c) => c.authorKind === 'agent')
  const visible = humansOnly ? comments.filter((c) => c.authorKind !== 'agent') : comments

  function toggleHumansOnly() {
    const next = !humansOnly
    setHumansOnly(next)
    try { window.localStorage.setItem(HUMANS_ONLY_KEY, next ? '1' : '0') } catch { /* nur Komfort */ }
  }

  return (
    <div className="my-4 border-l-2 border-border pl-4 font-sans">
      <div className="mb-3 flex items-baseline justify-between gap-3">
        <p className="font-mono text-[11px] uppercase tracking-wide text-muted-foreground">
          {de ? 'Eure Takes' : 'Your takes'}
        </p>
        {hasAgents && (
          <button
            type="button"
            onClick={toggleHumansOnly}
            className="font-mono text-[11px] text-muted-foreground underline underline-offset-2 hover:text-foreground"
          >
            {humansOnly ? (de ? 'auch Agenten zeigen' : 'show agents too') : (de ? 'nur Menschen' : 'humans only')}
          </button>
        )}
      </div>
      {visible.length === 0 ? (
        <p className="text-xs text-muted-foreground">{de ? 'Nur Agenten-Takes in diesem Abschnitt.' : 'Only agent takes in this section.'}</p>
      ) : (
        <ol className="space-y-4">
          {visible.map((c) => (
            <li key={c.id} className="text-sm">
              <div className="flex flex-wrap items-baseline gap-2">
                {c.authorKind === 'agent' ? (
                  <>
                    <Bot className="h-3.5 w-3.5 translate-y-0.5 text-muted-foreground" aria-label={de ? 'KI-Agent' : 'AI agent'} />
                    <span className="font-medium">{c.agentName ?? c.displayName}</span>
                    {c.agentModel && <span className="font-mono text-xs text-muted-foreground">{c.agentModel}</span>}
                    {c.stance && (
                      <span className="rounded border border-border px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wide text-muted-foreground">
                        {t[c.stance]}
                      </span>
                    )}
                  </>
                ) : (
                  <span className="font-medium">{c.displayName}</span>
                )}
                <time dateTime={c.publishedAt} className="font-mono text-xs text-muted-foreground">
                  {new Date(c.publishedAt).toLocaleDateString(de ? 'de-DE' : 'en-US', {
                    day: '2-digit', month: '2-digit', year: 'numeric', timeZone: 'Europe/Berlin',
                  })}
                </time>
              </div>
              {/* Plain-Text: React escaped; whitespace-pre-line erhält Absätze. */}
              <p className="mt-1 whitespace-pre-line leading-relaxed">{c.body}</p>
              {c.authorKind === 'agent' && c.sources.length > 0 && (
                <p className="mt-1 text-xs text-muted-foreground">
                  {de ? 'Quellen: ' : 'Sources: '}
                  {c.sources.map((s, i) => (
                    <span key={s.url}>
                      {i > 0 && ', '}
                      <a href={s.url} target="_blank" rel="nofollow noopener noreferrer" className="underline underline-offset-2">{s.title}</a>
                    </span>
                  ))}
                </p>
              )}
            </li>
          ))}
        </ol>
      )}
    </div>
  )
}

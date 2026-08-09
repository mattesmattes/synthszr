'use client'

/**
 * „Eure Takes" DIREKT unter dem jeweiligen Take-Abschnitt (Betreiber-Wunsch
 * 2026-08-09: die Takes hängen am News-Artikel, nicht gepoolt am Seitenende).
 *
 * Wird — wie das Barometer — per DOM-Prozessor als Block hinter jeden
 * Take-Absatz injiziert und dort hinein portalt. Zeigt nur die veröffentlichten
 * Takes GENAU dieses Abschnitts (section_anchor). Ohne Kommentare rendert die
 * Komponente nichts, damit nicht unter jedem Take ein leerer Block steht.
 *
 * Datenfluss: ein geteilter Fetch je Post (alle veröffentlichten Takes), aus
 * dem jeder Abschnitt seine herausfiltert — so genau EIN Request statt einer
 * je Take. Neue eigene Takes kommen optimistisch über das
 * `synthszr:comment-published`-Event vom Schreib-Overlay rein.
 */
import { useEffect, useState } from 'react'
import type { PublicComment } from '@/lib/comments/service'

interface SectionCommentsProps {
  postSource: 'posts' | 'generated_posts'
  postId: string
  anchor: string
  locale?: string
}

// Geteilter Fetch je Post — alle Abschnitts-Blöcke teilen sich EINE Anfrage.
const cache = new Map<string, Promise<PublicComment[]>>()
function fetchAllComments(source: string, postId: string): Promise<PublicComment[]> {
  const key = `${source}:${postId}`
  let p = cache.get(key)
  if (!p) {
    p = fetch(`/api/comments?source=${source}&postId=${postId}`)
      .then((r) => (r.ok ? r.json() : { comments: [] }))
      .then((d) => (Array.isArray(d?.comments) ? (d.comments as PublicComment[]) : []))
      .catch(() => [])
    cache.set(key, p)
  }
  return p
}

export function SectionComments({ postSource, postId, anchor, locale = 'de' }: SectionCommentsProps) {
  const [comments, setComments] = useState<PublicComment[]>([])
  const de = locale === 'de'

  useEffect(() => {
    let cancelled = false
    fetchAllComments(postSource, postId).then((all) => {
      if (!cancelled) setComments(all.filter((c) => c.sectionAnchor === anchor))
    })
    return () => { cancelled = true }
  }, [postSource, postId, anchor])

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

  return (
    <div className="my-4 border-l-2 border-border pl-4 font-sans">
      <p className="mb-3 font-mono text-[11px] uppercase tracking-wide text-muted-foreground">
        {de ? 'Eure Takes' : 'Your takes'}
      </p>
      <ol className="space-y-4">
        {comments.map((c) => (
          <li key={c.id} className="text-sm">
            <div className="flex flex-wrap items-baseline gap-2">
              <span className="font-medium">{c.displayName}</span>
              <time dateTime={c.publishedAt} className="font-mono text-xs text-muted-foreground">
                {new Date(c.publishedAt).toLocaleDateString(de ? 'de-DE' : 'en-US', {
                  day: '2-digit', month: '2-digit', year: 'numeric', timeZone: 'Europe/Berlin',
                })}
              </time>
            </div>
            {/* Plain-Text: React escaped; whitespace-pre-line erhält Absätze. */}
            <p className="mt-1 whitespace-pre-line leading-relaxed">{c.body}</p>
          </li>
        ))}
      </ol>
    </div>
  )
}

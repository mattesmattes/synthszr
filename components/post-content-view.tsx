import { Suspense } from "react"
import { TiptapRenderer } from "@/components/tiptap-renderer"
import { renderStaticArticleHtml } from "@/lib/tiptap/render-static-html"

interface PostContentViewProps {
  content: Record<string, unknown>
  postId?: string
  queueItemIds?: string[]
  originalContent?: Record<string, unknown> // Original German content for company detection in translations
}

/**
 * Hybrid-Renderer: server-gerendertes statisches HTML (crawlbar, sofort
 * lesbar) + TiptapRenderer, der nach Hydration übernimmt (Badges,
 * Produkt-Links, Thumbnails) und den statischen Block entfernt.
 * Server Component — kein 'use client'.
 *
 * Die INNERE Suspense-Boundary ist Pflicht: TiptapRenderer nutzt
 * useSearchParams — beim statischen Prerender (ISR) bail-outet React bis
 * zur nächsten Suspense-Boundary. Ohne innere Boundary fiele das statische
 * DIV mit aus dem Prerender-HTML (genau der Bug, den dieser Hybrid fixt).
 */
export function PostContentView({ content, postId, queueItemIds, originalContent }: PostContentViewProps) {
  const staticHtml = renderStaticArticleHtml(content)
  const ssrId = postId ? `post-ssr-${postId}` : `post-ssr-static`
  return (
    <>
      {staticHtml && (
        <div
          id={ssrId}
          // Gleiche Typo-Klassen wie der Editor (tiptap-renderer.tsx editorProps)
          className="prose prose-neutral max-w-none font-serif text-base md:text-sm leading-relaxed tiptap-content"
          dangerouslySetInnerHTML={{ __html: staticHtml }}
        />
      )}
      <Suspense fallback={null}>
        <TiptapRenderer
          content={content}
          postId={postId}
          queueItemIds={queueItemIds}
          originalContent={originalContent}
          ssrFallbackId={staticHtml ? ssrId : undefined}
        />
      </Suspense>
    </>
  )
}

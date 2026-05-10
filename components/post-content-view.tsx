import { TiptapRenderer } from "@/components/tiptap-renderer"

interface PostContentViewProps {
  content: Record<string, unknown>
  postId?: string
  queueItemIds?: string[]
  originalContent?: Record<string, unknown> // Original German content for company detection in translations
}

/**
 * Renders post content as rich HTML via TiptapRenderer. The previous
 * Human/Machine (HTML/Markdown) view toggle has been removed — the
 * Markdown variant was experimental and unused.
 */
export function PostContentView({ content, postId, queueItemIds, originalContent }: PostContentViewProps) {
  return (
    <TiptapRenderer
      content={content}
      postId={postId}
      queueItemIds={queueItemIds}
      originalContent={originalContent}
    />
  )
}

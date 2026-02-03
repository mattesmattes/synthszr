"use client"

import { useState, useMemo, useEffect } from "react"
import { createPortal } from "react-dom"
import { TiptapRenderer } from "@/components/tiptap-renderer"
import { HumanMachineToggle } from "@/components/human-machine-toggle"
import { convertTiptapToMarkdown, parseTiptapContent } from "@/lib/utils/tiptap-to-markdown"

interface PostContentViewProps {
  content: Record<string, unknown>
  postId?: string
  queueItemIds?: string[]
  originalContent?: Record<string, unknown> // Original German content for company detection in translations
}

/**
 * Post content view with Human/Machine toggle
 * Human: Rich HTML via TiptapRenderer
 * Machine: Plain Markdown text
 */
export function PostContentView({ content, postId, queueItemIds, originalContent }: PostContentViewProps) {
  const [viewMode, setViewMode] = useState<'human' | 'machine'>('human')
  const [isMounted, setIsMounted] = useState(false)

  useEffect(() => {
    setIsMounted(true)
  }, [])

  // Memoize Markdown conversion to avoid recalculating on every render
  const markdown = useMemo(() => {
    const doc = parseTiptapContent(content)
    if (!doc) return '*Content could not be converted to Markdown*'
    return convertTiptapToMarkdown(doc)
  }, [content])

  return (
    <>
      {viewMode === 'human' ? (
        <TiptapRenderer content={content} postId={postId} queueItemIds={queueItemIds} originalContent={originalContent} />
      ) : (
        <div className="font-mono text-sm bg-muted/30 p-6 rounded-lg border-l-4 border-[#CCFF00] whitespace-pre-wrap overflow-x-auto">
          {markdown}
        </div>
      )}
      {isMounted && createPortal(
        <HumanMachineToggle mode={viewMode} onToggle={setViewMode} />,
        document.body
      )}
    </>
  )
}

"use client"

import { useEditor, EditorContent } from "@tiptap/react"
import StarterKit from "@tiptap/starter-kit"

interface TiptapRendererProps {
  content: Record<string, unknown>
}

export function TiptapRenderer({ content }: TiptapRendererProps) {
  const editor = useEditor({
    extensions: [StarterKit],
    content: content,
    editable: false,
    editorProps: {
      attributes: {
        class: "prose prose-neutral max-w-none font-serif text-lg leading-relaxed",
      },
    },
  })

  if (!editor) {
    return null
  }

  return <EditorContent editor={editor} />
}

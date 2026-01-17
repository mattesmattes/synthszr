"use client"

import { useEffect, useState, useCallback } from "react"
import { useEditor, EditorContent } from "@tiptap/react"
import StarterKit from "@tiptap/starter-kit"
import Link from "@tiptap/extension-link"
import Placeholder from "@tiptap/extension-placeholder"
import { Bold, Italic, List, ListOrdered, Heading1, Heading2, Quote, Undo, Redo, Link as LinkIcon, Unlink } from "lucide-react"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"

interface TiptapEditorProps {
  content: Record<string, unknown>
  onChange: (content: Record<string, unknown>) => void
}

export function TiptapEditor({ content, onChange }: TiptapEditorProps) {
  const [linkDialogOpen, setLinkDialogOpen] = useState(false)
  const [linkUrl, setLinkUrl] = useState("")

  const editor = useEditor({
    extensions: [
      StarterKit,
      Link.configure({
        openOnClick: false,
        HTMLAttributes: {
          class: 'text-primary underline',
        },
      }),
      Placeholder.configure({
        placeholder: "Start writing...",
      }),
    ],
    content: content,
    onUpdate: ({ editor }) => {
      onChange(editor.getJSON())
    },
    editorProps: {
      attributes: {
        class: "prose prose-neutral min-h-[400px] max-w-none p-4 focus:outline-none font-serif",
      },
    },
  })

  // Update editor content when prop changes (e.g., when opening edit dialog)
  useEffect(() => {
    if (editor && content) {
      // Only update if content is different to avoid cursor jumping
      const currentContent = JSON.stringify(editor.getJSON())
      const newContent = JSON.stringify(content)
      if (currentContent !== newContent) {
        editor.commands.setContent(content)
      }
    }
  }, [editor, content])

  // Open link dialog - pre-fill with existing link URL if cursor is on a link
  const openLinkDialog = useCallback(() => {
    if (!editor) return
    const previousUrl = editor.getAttributes("link").href || ""
    setLinkUrl(previousUrl)
    setLinkDialogOpen(true)
  }, [editor])

  // Set or update link
  const setLink = useCallback(() => {
    if (!editor) return

    // Empty URL removes the link
    if (linkUrl === "") {
      editor.chain().focus().extendMarkRange("link").unsetLink().run()
    } else {
      // Ensure URL has protocol
      const url = linkUrl.startsWith("http://") || linkUrl.startsWith("https://")
        ? linkUrl
        : `https://${linkUrl}`
      editor.chain().focus().extendMarkRange("link").setLink({ href: url }).run()
    }

    setLinkDialogOpen(false)
    setLinkUrl("")
  }, [editor, linkUrl])

  // Remove link
  const removeLink = useCallback(() => {
    if (!editor) return
    editor.chain().focus().extendMarkRange("link").unsetLink().run()
  }, [editor])

  if (!editor) {
    return null
  }

  return (
    <div className="border border-border">
      <div className="sticky top-0 z-10 flex flex-wrap gap-1 border-b border-border bg-secondary/30 p-2">
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={() => editor.chain().focus().toggleBold().run()}
          className={cn(editor.isActive("bold") && "bg-secondary")}
        >
          <Bold className="h-4 w-4" />
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={() => editor.chain().focus().toggleItalic().run()}
          className={cn(editor.isActive("italic") && "bg-secondary")}
        >
          <Italic className="h-4 w-4" />
        </Button>
        <div className="mx-1 w-px bg-border" />
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={() => editor.chain().focus().toggleHeading({ level: 1 }).run()}
          className={cn(editor.isActive("heading", { level: 1 }) && "bg-secondary")}
        >
          <Heading1 className="h-4 w-4" />
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()}
          className={cn(editor.isActive("heading", { level: 2 }) && "bg-secondary")}
        >
          <Heading2 className="h-4 w-4" />
        </Button>
        <div className="mx-1 w-px bg-border" />
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={() => editor.chain().focus().toggleBulletList().run()}
          className={cn(editor.isActive("bulletList") && "bg-secondary")}
        >
          <List className="h-4 w-4" />
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={() => editor.chain().focus().toggleOrderedList().run()}
          className={cn(editor.isActive("orderedList") && "bg-secondary")}
        >
          <ListOrdered className="h-4 w-4" />
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={() => editor.chain().focus().toggleBlockquote().run()}
          className={cn(editor.isActive("blockquote") && "bg-secondary")}
        >
          <Quote className="h-4 w-4" />
        </Button>
        <div className="mx-1 w-px bg-border" />
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={openLinkDialog}
          className={cn(editor.isActive("link") && "bg-secondary")}
          title="Link hinzufügen/bearbeiten"
        >
          <LinkIcon className="h-4 w-4" />
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={removeLink}
          disabled={!editor.isActive("link")}
          title="Link entfernen"
        >
          <Unlink className="h-4 w-4" />
        </Button>
        <div className="mx-1 w-px bg-border" />
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={() => editor.chain().focus().undo().run()}
          disabled={!editor.can().undo()}
        >
          <Undo className="h-4 w-4" />
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={() => editor.chain().focus().redo().run()}
          disabled={!editor.can().redo()}
        >
          <Redo className="h-4 w-4" />
        </Button>
      </div>
      <EditorContent editor={editor} />

      {/* Link Dialog */}
      <Dialog open={linkDialogOpen} onOpenChange={setLinkDialogOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Link bearbeiten</DialogTitle>
          </DialogHeader>
          <div className="grid gap-4 py-4">
            <div className="grid gap-2">
              <Label htmlFor="link-url">URL</Label>
              <Input
                id="link-url"
                placeholder="https://example.com"
                value={linkUrl}
                onChange={(e) => setLinkUrl(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault()
                    setLink()
                  }
                }}
              />
            </div>
          </div>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => setLinkDialogOpen(false)}
            >
              Abbrechen
            </Button>
            <Button type="button" onClick={setLink}>
              Speichern
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

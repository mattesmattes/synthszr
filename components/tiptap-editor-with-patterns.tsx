"use client"

import { useEffect, useState, useCallback, useRef } from "react"
import { useEditor, EditorContent } from "@tiptap/react"
import StarterKit from "@tiptap/starter-kit"
import Link from "@tiptap/extension-link"
import Placeholder from "@tiptap/extension-placeholder"
import {
  Bold,
  Italic,
  List,
  ListOrdered,
  Heading1,
  Heading2,
  Quote,
  Undo,
  Redo,
  Link as LinkIcon,
  Unlink,
  Sparkles,
  Check,
  X,
  Ban,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog"
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Badge } from "@/components/ui/badge"
import { PatternHighlightMark } from "@/lib/tiptap/pattern-highlight-mark"
import type { LearnedPattern } from "@/lib/edit-learning/retrieval"

interface AppliedPatternData {
  id: string
  patternId: string
  from: number
  to: number
  pattern: LearnedPattern
  userAccepted: boolean | null
}

interface TiptapEditorWithPatternsProps {
  content: Record<string, unknown>
  onChange: (content: Record<string, unknown>) => void
  appliedPatterns?: AppliedPatternData[]
  onPatternFeedback?: (
    appliedPatternId: string,
    action: "accept" | "reject" | "deactivate"
  ) => void
}

export function TiptapEditorWithPatterns({
  content,
  onChange,
  appliedPatterns = [],
  onPatternFeedback,
}: TiptapEditorWithPatternsProps) {
  const [linkDialogOpen, setLinkDialogOpen] = useState(false)
  const [linkUrl, setLinkUrl] = useState("")
  const [activePatternPopover, setActivePatternPopover] = useState<string | null>(null)
  const editorRef = useRef<HTMLDivElement>(null)

  const editor = useEditor({
    extensions: [
      StarterKit,
      Link.configure({
        openOnClick: false,
        HTMLAttributes: {
          class: "text-primary underline",
        },
      }),
      Placeholder.configure({
        placeholder: "Start writing...",
      }),
      PatternHighlightMark,
    ],
    content: content,
    onUpdate: ({ editor }) => {
      onChange(editor.getJSON())
    },
    editorProps: {
      attributes: {
        class:
          "prose prose-neutral min-h-[60vh] max-w-none p-4 focus:outline-none font-serif",
      },
    },
  })

  // Update editor content when prop changes
  useEffect(() => {
    if (editor && content) {
      const currentContent = JSON.stringify(editor.getJSON())
      const newContent = JSON.stringify(content)
      if (currentContent !== newContent) {
        editor.commands.setContent(content)
      }
    }
  }, [editor, content])

  // Apply pattern highlights when patterns change
  useEffect(() => {
    if (!editor || appliedPatterns.length === 0) return

    // Apply highlights for each pattern
    const { state, view } = editor
    const tr = state.tr

    for (const ap of appliedPatterns) {
      if (ap.userAccepted !== null) continue // Skip already reviewed

      try {
        // Ensure positions are within document bounds
        const docSize = state.doc.content.size
        const from = Math.min(ap.from, docSize)
        const to = Math.min(ap.to, docSize)

        if (from < to && from >= 0) {
          tr.addMark(
            from,
            to,
            state.schema.marks.patternHighlight.create({
              patternId: ap.patternId,
              originalForm: ap.pattern.original_form,
              preferredForm: ap.pattern.preferred_form,
              confidence: ap.pattern.confidence_score,
            })
          )
        }
      } catch (err) {
        console.error("[PatternHighlight] Failed to apply mark:", err)
      }
    }

    if (tr.docChanged) {
      view.dispatch(tr)
    }
  }, [editor, appliedPatterns])

  // Handle clicks on highlighted text
  useEffect(() => {
    if (!editorRef.current) return

    const handleClick = (e: MouseEvent) => {
      const target = e.target as HTMLElement
      if (target.hasAttribute("data-pattern-highlight")) {
        const patternId = target.getAttribute("data-pattern-id")
        if (patternId) {
          setActivePatternPopover(patternId)
        }
      }
    }

    editorRef.current.addEventListener("click", handleClick)
    return () => {
      editorRef.current?.removeEventListener("click", handleClick)
    }
  }, [])

  // Link dialog handlers
  const openLinkDialog = useCallback(() => {
    if (!editor) return
    const previousUrl = editor.getAttributes("link").href || ""
    setLinkUrl(previousUrl)
    setLinkDialogOpen(true)
  }, [editor])

  const setLink = useCallback(() => {
    if (!editor) return

    if (linkUrl === "") {
      editor.chain().focus().extendMarkRange("link").unsetLink().run()
    } else {
      const url =
        linkUrl.startsWith("http://") || linkUrl.startsWith("https://")
          ? linkUrl
          : `https://${linkUrl}`
      editor.chain().focus().extendMarkRange("link").setLink({ href: url }).run()
    }

    setLinkDialogOpen(false)
    setLinkUrl("")
  }, [editor, linkUrl])

  const removeLink = useCallback(() => {
    if (!editor) return
    editor.chain().focus().extendMarkRange("link").unsetLink().run()
  }, [editor])

  // Get active pattern for popover
  const activePattern = appliedPatterns.find(
    (ap) => ap.patternId === activePatternPopover
  )

  if (!editor) {
    return null
  }

  return (
    <div className="border rounded-lg overflow-hidden bg-background">
      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-1 p-2 border-b bg-muted/50">
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={() => editor.chain().focus().toggleBold().run()}
          className={cn(editor.isActive("bold") && "bg-accent")}
        >
          <Bold className="h-4 w-4" />
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={() => editor.chain().focus().toggleItalic().run()}
          className={cn(editor.isActive("italic") && "bg-accent")}
        >
          <Italic className="h-4 w-4" />
        </Button>
        <div className="w-px h-6 bg-border mx-1" />
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={() => editor.chain().focus().toggleHeading({ level: 1 }).run()}
          className={cn(editor.isActive("heading", { level: 1 }) && "bg-accent")}
        >
          <Heading1 className="h-4 w-4" />
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()}
          className={cn(editor.isActive("heading", { level: 2 }) && "bg-accent")}
        >
          <Heading2 className="h-4 w-4" />
        </Button>
        <div className="w-px h-6 bg-border mx-1" />
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={() => editor.chain().focus().toggleBulletList().run()}
          className={cn(editor.isActive("bulletList") && "bg-accent")}
        >
          <List className="h-4 w-4" />
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={() => editor.chain().focus().toggleOrderedList().run()}
          className={cn(editor.isActive("orderedList") && "bg-accent")}
        >
          <ListOrdered className="h-4 w-4" />
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={() => editor.chain().focus().toggleBlockquote().run()}
          className={cn(editor.isActive("blockquote") && "bg-accent")}
        >
          <Quote className="h-4 w-4" />
        </Button>
        <div className="w-px h-6 bg-border mx-1" />
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={openLinkDialog}
          className={cn(editor.isActive("link") && "bg-accent")}
        >
          <LinkIcon className="h-4 w-4" />
        </Button>
        {editor.isActive("link") && (
          <Button type="button" variant="ghost" size="sm" onClick={removeLink}>
            <Unlink className="h-4 w-4" />
          </Button>
        )}
        <div className="flex-1" />
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

        {/* Pattern indicator */}
        {appliedPatterns.filter((ap) => ap.userAccepted === null).length > 0 && (
          <>
            <div className="w-px h-6 bg-border mx-1" />
            <div className="flex items-center gap-1 text-xs text-muted-foreground">
              <Sparkles className="h-3 w-3 text-yellow-500" />
              <span>
                {appliedPatterns.filter((ap) => ap.userAccepted === null).length}{" "}
                Verbesserungen
              </span>
            </div>
          </>
        )}
      </div>

      {/* Editor Content */}
      <div ref={editorRef}>
        <EditorContent editor={editor} />
      </div>

      {/* Pattern Feedback Popover */}
      {activePattern && (
        <Popover
          open={!!activePatternPopover}
          onOpenChange={(open) => !open && setActivePatternPopover(null)}
        >
          <PopoverTrigger asChild>
            <span />
          </PopoverTrigger>
          <PopoverContent className="w-80" align="start">
            <div className="space-y-3">
              <div className="flex items-center gap-2">
                <Sparkles className="h-4 w-4 text-yellow-500" />
                <span className="font-medium text-sm">Gelernte Verbesserung</span>
                <Badge variant="secondary" className="text-xs ml-auto">
                  {Math.round(activePattern.pattern.confidence_score * 100)}%
                </Badge>
              </div>

              {activePattern.pattern.original_form &&
                activePattern.pattern.preferred_form && (
                  <div className="text-sm">
                    <span className="line-through text-red-600">
                      {activePattern.pattern.original_form}
                    </span>
                    {" → "}
                    <span className="text-green-600 font-medium">
                      {activePattern.pattern.preferred_form}
                    </span>
                  </div>
                )}

              {activePattern.pattern.context_description && (
                <p className="text-xs text-muted-foreground">
                  {activePattern.pattern.context_description}
                </p>
              )}

              <div className="flex gap-2 pt-2 border-t">
                <Button
                  size="sm"
                  variant="outline"
                  className="flex-1 text-green-600 hover:bg-green-50"
                  onClick={() => {
                    onPatternFeedback?.(activePattern.id, "accept")
                    setActivePatternPopover(null)
                  }}
                >
                  <Check className="h-3 w-3 mr-1" />
                  Behalten
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  className="flex-1 text-red-600 hover:bg-red-50"
                  onClick={() => {
                    onPatternFeedback?.(activePattern.id, "reject")
                    setActivePatternPopover(null)
                  }}
                >
                  <X className="h-3 w-3 mr-1" />
                  Ablehnen
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  className="text-muted-foreground hover:text-destructive"
                  onClick={() => {
                    onPatternFeedback?.(activePattern.id, "deactivate")
                    setActivePatternPopover(null)
                  }}
                >
                  <Ban className="h-3 w-3" />
                </Button>
              </div>
            </div>
          </PopoverContent>
        </Popover>
      )}

      {/* Link Dialog */}
      <Dialog open={linkDialogOpen} onOpenChange={setLinkDialogOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Link einfügen</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="link-url">URL</Label>
              <Input
                id="link-url"
                value={linkUrl}
                onChange={(e) => setLinkUrl(e.target.value)}
                placeholder="https://example.com"
                onKeyDown={(e) => e.key === "Enter" && setLink()}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setLinkDialogOpen(false)}>
              Abbrechen
            </Button>
            <Button onClick={setLink}>Speichern</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Styles for pattern highlights */}
      <style jsx global>{`
        .pattern-highlight {
          background-color: rgba(250, 204, 21, 0.3);
          border-bottom: 2px solid rgb(250, 204, 21);
          cursor: help;
          transition: background-color 0.2s;
        }
        .pattern-highlight:hover {
          background-color: rgba(250, 204, 21, 0.5);
        }
      `}</style>
    </div>
  )
}

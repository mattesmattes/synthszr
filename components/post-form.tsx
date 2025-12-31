"use client"

import type React from "react"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { Switch } from "@/components/ui/switch"
import { TiptapEditor } from "@/components/tiptap-editor"
import { createClient } from "@/lib/supabase/client"
import type { Post } from "@/lib/types"
import { ArrowLeft, Loader2 } from "lucide-react"

interface PostFormProps {
  post?: Post
}

export function PostForm({ post }: PostFormProps) {
  const router = useRouter()
  const [loading, setLoading] = useState(false)
  const [title, setTitle] = useState(post?.title ?? "")
  const [slug, setSlug] = useState(post?.slug ?? "")
  const [excerpt, setExcerpt] = useState(post?.excerpt ?? "")
  const [category, setCategory] = useState(post?.category ?? "general")
  const [published, setPublished] = useState(post?.published ?? false)
  const [content, setContent] = useState<Record<string, unknown>>(post?.content ?? {})

  const generateSlug = (title: string) => {
    return title
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/(^-|-$)/g, "")
  }

  const handleTitleChange = (value: string) => {
    setTitle(value)
    if (!post) {
      setSlug(generateSlug(value))
    }
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoading(true)

    const supabase = createClient()

    const postData = {
      title,
      slug,
      excerpt: excerpt || null,
      content,
      category,
      published,
      updated_at: new Date().toISOString(),
    }

    let error = null
    if (post) {
      const result = await supabase.from("posts").update(postData).eq("id", post.id)
      error = result.error
      console.log("[v0] Update result:", result)
    } else {
      const result = await supabase.from("posts").insert(postData)
      error = result.error
      console.log("[v0] Insert result:", result)
    }

    if (error) {
      console.log("[v0] Error:", error)
      alert(`Error saving post: ${error.message}`)
      setLoading(false)
      return
    }

    setLoading(false)
    router.push("/admin")
    router.refresh()
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-8">
      <div className="flex items-center justify-between">
        <Button type="button" variant="ghost" onClick={() => router.push("/admin")} className="gap-2">
          <ArrowLeft className="h-4 w-4" />
          Back
        </Button>
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-2">
            <Switch id="published" checked={published} onCheckedChange={setPublished} />
            <Label htmlFor="published" className="font-mono text-xs">
              {published ? "Published" : "Draft"}
            </Label>
          </div>
          <Button type="submit" disabled={loading || !title || !slug}>
            {loading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            {post ? "Update" : "Create"} Post
          </Button>
        </div>
      </div>

      <div className="grid gap-6 md:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor="title" className="font-mono text-xs">
            Title
          </Label>
          <Input
            id="title"
            value={title}
            onChange={(e) => handleTitleChange(e.target.value)}
            placeholder="Post title"
            className="text-lg"
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="slug" className="font-mono text-xs">
            Slug
          </Label>
          <Input
            id="slug"
            value={slug}
            onChange={(e) => setSlug(e.target.value)}
            placeholder="post-slug"
            className="font-mono"
          />
        </div>
      </div>

      <div className="grid gap-6 md:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor="excerpt" className="font-mono text-xs">
            Excerpt
          </Label>
          <Textarea
            id="excerpt"
            value={excerpt}
            onChange={(e) => setExcerpt(e.target.value)}
            placeholder="Short description..."
            rows={3}
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="category" className="font-mono text-xs">
            Category
          </Label>
          <Input id="category" value={category} onChange={(e) => setCategory(e.target.value)} placeholder="Category" />
        </div>
      </div>

      <div className="space-y-2">
        <Label className="font-mono text-xs">Content</Label>
        <TiptapEditor content={content} onChange={setContent} />
      </div>
    </form>
  )
}

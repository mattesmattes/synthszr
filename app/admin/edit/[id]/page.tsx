import { notFound } from "next/navigation"
import { createClient } from "@/lib/supabase/server"
import { PostForm } from "@/components/post-form"

export default async function EditPostPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params

  const supabase = await createClient()
  const { data: post } = await supabase.from("posts").select("*").eq("id", id).single()

  if (!post) {
    notFound()
  }

  return (
    <div className="min-h-screen bg-background">
      <main className="mx-auto max-w-4xl px-4 py-8">
        <h1 className="mb-8 text-3xl font-bold tracking-tighter">Edit Post</h1>
        <PostForm post={post} />
      </main>
    </div>
  )
}

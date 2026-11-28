import { notFound } from "next/navigation"
import { createAdminClient } from "@/lib/supabase/admin"
import { PostForm } from "@/components/post-form"

export default async function EditPostPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params

  const supabase = createAdminClient()
  const { data: post } = await supabase.from("posts").select("*").eq("id", id).single()

  if (!post) {
    notFound()
  }

  return (
    <div className="min-h-screen bg-background">
      <main className="mx-auto max-w-4xl p-4 md:p-6 lg:p-8">
        <h1 className="mb-6 text-2xl font-bold tracking-tight">Edit Post</h1>
        <PostForm post={post} />
      </main>
    </div>
  )
}

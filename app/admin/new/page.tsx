import { PostForm } from "@/components/post-form"

export default function NewPostPage() {
  return (
    <div className="min-h-screen bg-background">
      <main className="mx-auto max-w-4xl px-4 py-8">
        <h1 className="mb-8 text-3xl font-bold tracking-tighter">New Post</h1>
        <PostForm />
      </main>
    </div>
  )
}

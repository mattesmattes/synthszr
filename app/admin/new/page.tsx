import { PostForm } from "@/components/post-form"

export default function NewPostPage() {
  return (
    <div className="min-h-screen bg-background">
      <main className="mx-auto max-w-4xl p-4 md:p-6 lg:p-8">
        <h1 className="mb-6 text-2xl font-bold tracking-tight">New Post</h1>
        <PostForm />
      </main>
    </div>
  )
}

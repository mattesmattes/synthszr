import Link from "next/link"
import { createClient } from "@/lib/supabase/server"
import { Button } from "@/components/ui/button"
import { Plus, Edit, Eye, EyeOff } from "lucide-react"
import type { Post } from "@/lib/types"

export default async function AdminPage() {
  const supabase = await createClient()
  const { data: posts } = await supabase.from("posts").select("*").order("created_at", { ascending: false })

  return (
    <div className="p-8">
      <div className="mb-8 flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tighter">Blog Posts</h1>
          <p className="mt-1 text-muted-foreground">Verwalte deine Blog-Artikel</p>
        </div>
        <Button asChild>
          <Link href="/admin/new" className="gap-2">
            <Plus className="h-4 w-4" />
            Neuer Post
          </Link>
        </Button>
      </div>

      <div>
        {!posts || posts.length === 0 ? (
          <div className="py-20 text-center">
            <p className="text-muted-foreground">No posts yet.</p>
            <Button asChild className="mt-4">
              <Link href="/admin/new">Create your first post</Link>
            </Button>
          </div>
        ) : (
          <div className="divide-y divide-border border border-border">
            {posts.map((post: Post) => (
              <div key={post.id} className="flex items-center justify-between p-4 hover:bg-secondary/30">
                <div className="flex-1">
                  <div className="flex items-center gap-3">
                    <h2 className="font-bold">{post.title}</h2>
                    {post.published ? (
                      <span className="flex items-center gap-1 font-mono text-xs text-muted-foreground">
                        <Eye className="h-3 w-3" /> Published
                      </span>
                    ) : (
                      <span className="flex items-center gap-1 font-mono text-xs text-muted-foreground">
                        <EyeOff className="h-3 w-3" /> Draft
                      </span>
                    )}
                  </div>
                  <p className="mt-1 font-mono text-xs text-muted-foreground">
                    /{post.slug} • {post.category} • {new Date(post.created_at).toLocaleDateString()}
                  </p>
                </div>
                <Button variant="ghost" size="sm" asChild>
                  <Link href={`/admin/edit/${post.id}`}>
                    <Edit className="h-4 w-4" />
                  </Link>
                </Button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

export interface Post {
  id: string
  title: string
  slug: string
  excerpt: string | null
  content: Record<string, unknown>
  category: string
  published: boolean
  created_at: string
  updated_at: string
}

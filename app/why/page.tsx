import Link from "next/link"
import { createClient } from "@/lib/supabase/server"
import { TiptapRenderer } from "@/components/tiptap-renderer"
import { Newsletter } from "@/components/newsletter"
import { ArrowLeft } from "lucide-react"

export const dynamic = 'force-dynamic'

export default async function WhyPage() {
  const supabase = await createClient()

  const { data: page } = await supabase
    .from("static_pages")
    .select("*")
    .eq("slug", "why")
    .single()

  // Default content if page doesn't exist yet
  const title = page?.title || "Feed the Soul. Run the System."
  const content = page?.content || {
    type: "doc",
    content: [
      {
        type: "paragraph",
        content: [{ type: "text", text: "Die News Synthese zum Start in den Tag." }]
      }
    ]
  }

  return (
    <div className="min-h-screen bg-background text-foreground">
      <main className="mx-auto max-w-3xl px-6 py-12 md:py-20">
        <article>
          <header className="mb-12 border-b border-border pb-8">
            <Link
              href="/"
              className="inline-flex items-center gap-2 text-xs text-muted-foreground hover:text-foreground transition-colors mb-6"
            >
              <ArrowLeft className="h-3 w-3" />
              Zurück zur Startseite
            </Link>
            <h1 className="text-3xl font-bold tracking-tight md:text-2xl">{title}</h1>
          </header>

          <div className="prose-headings:font-bold prose-headings:tracking-tight prose-h1:text-xl prose-h2:text-lg prose-h2:mt-8 prose-h2:mb-3 prose-p:mb-5 prose-blockquote:border-l-2 prose-blockquote:border-accent prose-blockquote:pl-6 prose-blockquote:italic">
            <div className="prose-article">
              <TiptapRenderer content={content} />
            </div>
          </div>
        </article>

        <Newsletter />
      </main>

      <footer className="border-t border-border">
        <div className="mx-auto max-w-5xl px-6 py-12">
          <div className="flex flex-col gap-8 md:flex-row md:items-center md:justify-between">
            <a href="https://oh-so.com" target="_blank" rel="noopener noreferrer" className="hover:opacity-80 transition-opacity">
              <img src="/oh-so-logo.svg" alt="OH-SO" className="h-9" />
            </a>
            <div className="flex gap-6 text-xs">
              <a href="https://www.linkedin.com/in/mattes/" target="_blank" rel="noopener noreferrer" className="hover:text-accent transition-colors">
                LinkedIn
              </a>
              <a href="/impressum" className="hover:text-accent transition-colors">
                Impressum
              </a>
              <a href="/datenschutz" className="hover:text-accent transition-colors">
                Datenschutz
              </a>
            </div>
          </div>
        </div>
      </footer>
    </div>
  )
}

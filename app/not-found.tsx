import Link from 'next/link'

export default function NotFound() {
  return (
    <div className="min-h-screen bg-background text-foreground flex items-center justify-center">
      <div className="text-center px-6">
        <h1 className="text-6xl font-bold tracking-tight mb-4">404</h1>
        <p className="text-lg text-muted-foreground mb-8">
          Diese Seite existiert nicht.
        </p>
        <div className="flex gap-4 justify-center">
          <Link
            href="/de"
            className="inline-flex items-center gap-2 rounded border border-border px-4 py-2 font-mono text-xs transition-colors hover:bg-secondary"
          >
            ← Startseite
          </Link>
          <Link
            href="/de/archive"
            className="inline-flex items-center gap-2 rounded border border-border px-4 py-2 font-mono text-xs transition-colors hover:bg-secondary"
          >
            Alle Artikel →
          </Link>
        </div>
      </div>
    </div>
  )
}

import Link from 'next/link'
import { getSession } from '@/lib/auth/session'
import { redirect } from 'next/navigation'
import { AdminNav } from '@/components/admin/admin-nav'
import { LogoutButton } from '@/components/admin/logout-button'

export default async function AdminLayout({
  children
}: {
  children: React.ReactNode
}) {
  const session = await getSession()

  // Check for valid admin session (both existence and isAdmin flag)
  // This ensures consistency with API route checks
  if (!session?.isAdmin) {
    redirect('/login')
  }

  return (
    <div className="flex min-h-screen bg-background" style={{ fontFamily: 'var(--font-sf-pro)' }}>
      {/* Sidebar */}
      <aside className="fixed left-0 top-0 z-40 h-screen w-64 border-r border-border bg-card">
        <div className="flex h-full flex-col">
          {/* Logo */}
          <div className="border-b border-border p-4">
            <Link href="/admin" className="flex items-center gap-2">
              <span className="font-mono text-lg font-bold">Synthszr</span>
              <span className="rounded bg-primary/10 px-1.5 py-0.5 font-mono text-xs text-primary">
                Admin
              </span>
            </Link>
          </div>

          {/* Navigation */}
          <nav className="flex-1 overflow-y-auto p-4">
            <AdminNav />
          </nav>

          {/* Footer */}
          <div className="border-t border-border p-4">
            <div className="flex items-center justify-between">
              <Link
                href="/"
                className="text-sm text-muted-foreground hover:text-foreground"
              >
                Zur Website
              </Link>
              <LogoutButton />
            </div>
          </div>
        </div>
      </aside>

      {/* Main Content */}
      <main className="ml-64 flex-1">
        {children}
      </main>
    </div>
  )
}

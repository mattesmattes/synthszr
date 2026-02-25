'use client'

import { useState, useEffect } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { Menu, X } from 'lucide-react'
import { cn } from '@/lib/utils'
import { AdminNav } from './admin-nav'
import { LogoutButton } from './logout-button'

export function AdminSidebar() {
  const [mobileOpen, setMobileOpen] = useState(false)
  const pathname = usePathname()

  // Close drawer on route change
  useEffect(() => {
    setMobileOpen(false)
  }, [pathname])

  const sidebarInner = (
    <div className="flex h-full flex-col">
      <div className="border-b border-border p-4">
        <Link href="/admin" className="flex items-center gap-2">
          <span className="font-mono text-lg font-bold">Synthszr</span>
          <span className="rounded bg-primary/10 px-1.5 py-0.5 font-mono text-xs text-primary">
            Admin
          </span>
        </Link>
      </div>
      <nav className="flex-1 overflow-y-auto p-4">
        <AdminNav onNavigate={() => setMobileOpen(false)} />
      </nav>
      <div className="border-t border-border p-4">
        <div className="flex items-center justify-between">
          <Link href="/" className="text-sm text-muted-foreground hover:text-foreground">
            Zur Website
          </Link>
          <LogoutButton />
        </div>
      </div>
    </div>
  )

  return (
    <>
      {/* Desktop sidebar — always visible on md+ */}
      <aside className="hidden md:flex md:fixed md:left-0 md:top-0 md:z-40 md:h-screen md:w-64 md:flex-col md:border-r md:border-border md:bg-card">
        {sidebarInner}
      </aside>

      {/* Mobile top header */}
      <header className="md:hidden fixed top-0 left-0 right-0 z-50 flex h-14 items-center justify-between border-b border-border bg-card px-4">
        <Link href="/admin" className="flex items-center gap-2">
          <span className="font-mono text-base font-bold">Synthszr</span>
          <span className="rounded bg-primary/10 px-1.5 py-0.5 font-mono text-xs text-primary">
            Admin
          </span>
        </Link>
        <button
          onClick={() => setMobileOpen((v) => !v)}
          className="rounded-md p-2 text-muted-foreground hover:bg-secondary hover:text-foreground"
          aria-label={mobileOpen ? 'Menü schließen' : 'Menü öffnen'}
        >
          {mobileOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
        </button>
      </header>

      {/* Mobile overlay */}
      <div
        className={cn(
          'md:hidden fixed inset-0 z-40 bg-black/50 transition-opacity duration-300',
          mobileOpen ? 'opacity-100 pointer-events-auto' : 'opacity-0 pointer-events-none'
        )}
        onClick={() => setMobileOpen(false)}
        aria-hidden="true"
      />

      {/* Mobile drawer */}
      <aside
        className={cn(
          'md:hidden fixed left-0 top-0 z-50 h-screen w-72 flex-col border-r border-border bg-card transition-transform duration-300 ease-in-out',
          mobileOpen ? 'translate-x-0' : '-translate-x-full'
        )}
      >
        {sidebarInner}
      </aside>
    </>
  )
}

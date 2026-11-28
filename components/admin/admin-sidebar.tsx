'use client'

import { useState, useEffect } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { ChevronsLeft, ChevronsRight, ExternalLink, Menu, Search, X } from 'lucide-react'
import { cn } from '@/lib/utils'
import { AdminNav } from './admin-nav'
import { LogoutButton } from './logout-button'

interface AdminSidebarProps {
  /** Desktop: nur Icons (4 rem) statt voller Leiste (16 rem); der mobile Drawer bleibt immer voll. */
  collapsed?: boolean
  onToggle?: () => void
  onOpenCommand?: () => void
}

export function AdminSidebar({ collapsed = false, onToggle, onOpenCommand }: AdminSidebarProps) {
  const [mobileOpen, setMobileOpen] = useState(false)
  const pathname = usePathname()

  // Close drawer on route change
  useEffect(() => {
    setMobileOpen(false)
  }, [pathname])

  const toggleButton = (isCollapsed: boolean) => (
    <button
      type="button"
      onClick={onToggle}
      className="rounded-md p-1.5 text-muted-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground transition-colors"
      aria-label={isCollapsed ? 'Navigation ausklappen' : 'Navigation einklappen'}
      title={isCollapsed ? 'Navigation ausklappen' : 'Navigation einklappen'}
    >
      {isCollapsed ? <ChevronsRight className="h-4 w-4" /> : <ChevronsLeft className="h-4 w-4" />}
    </button>
  )

  // isCollapsed: Icon-Modus (nur Desktop); showToggle: der Umschalter gehört nur in die Desktop-Leiste.
  const sidebarInner = (isCollapsed: boolean, showToggle: boolean) => (
    <div className="flex h-full flex-col">
      {isCollapsed ? (
        <div className="flex flex-col items-center gap-1.5 border-b border-sidebar-border p-2.5">
          {toggleButton(true)}
          {onOpenCommand && (
            <button
              type="button"
              onClick={onOpenCommand}
              className="rounded-md p-2 text-muted-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground transition-colors"
              aria-label="Schnellsuche öffnen (⌘K)"
              title="Schnellsuche (⌘K)"
            >
              <Search className="h-4 w-4" />
            </button>
          )}
        </div>
      ) : (
        <div className="border-b border-sidebar-border px-4 py-3.5 space-y-3">
          <div className="flex items-center justify-between">
            <Link href="/admin" className="flex items-center gap-2 group">
              <span className="font-mono text-base font-bold tracking-tight text-foreground">Synthszr</span>
              <span className="rounded-md bg-[#CCFF00] px-1.5 py-0.5 font-mono text-[10px] font-bold uppercase tracking-wider text-black">
                Admin
              </span>
            </Link>
            {showToggle && toggleButton(false)}
          </div>
          {onOpenCommand && (
            <button
              type="button"
              onClick={() => {
                setMobileOpen(false)
                onOpenCommand()
              }}
              className="flex w-full items-center gap-2 rounded-lg border border-border/80 bg-card px-2.5 py-1.5 text-xs text-muted-foreground shadow-xs hover:border-foreground/20 hover:text-foreground transition-all"
            >
              <Search className="h-3.5 w-3.5 shrink-0 opacity-70" />
              <span className="flex-1 text-left">Schnellsuche…</span>
              <kbd className="rounded border border-border/80 bg-muted/70 px-1.5 py-0.5 font-mono text-[10px] font-medium text-muted-foreground">
                ⌘K
              </kbd>
            </button>
          )}
        </div>
      )}
      <nav className={cn('flex-1 overflow-y-auto', isCollapsed ? 'p-2' : 'px-3 py-3')}>
        <AdminNav onNavigate={() => setMobileOpen(false)} collapsed={isCollapsed} />
      </nav>
      {isCollapsed ? (
        <div className="flex flex-col items-center gap-1 border-t border-sidebar-border p-2">
          <Link
            href="/"
            className="rounded-md p-2 text-muted-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground transition-colors"
            aria-label="Zur Website"
            title="Zur Website"
          >
            <ExternalLink className="h-4 w-4" />
          </Link>
          <LogoutButton />
        </div>
      ) : (
        <div className="border-t border-sidebar-border px-4 py-3">
          <div className="flex items-center justify-between">
            <Link
              href="/"
              className="inline-flex items-center gap-1.5 text-xs font-medium text-muted-foreground hover:text-foreground transition-colors"
            >
              <ExternalLink className="h-3.5 w-3.5" />
              Zur Website
            </Link>
            <LogoutButton />
          </div>
        </div>
      )}
    </div>
  )

  return (
    <>
      {/* Desktop sidebar — always visible on md+, collapsible to an icon rail */}
      <aside
        className={cn(
          'hidden md:flex md:fixed md:left-0 md:top-0 md:z-40 md:h-screen md:flex-col md:border-r md:border-sidebar-border md:bg-sidebar md:text-sidebar-foreground transition-[width] duration-300',
          collapsed ? 'md:w-16' : 'md:w-64',
        )}
      >
        {sidebarInner(collapsed, true)}
      </aside>

      {/* Mobile top header */}
      <header className="md:hidden fixed top-0 left-0 right-0 z-50 flex h-14 items-center justify-between border-b border-sidebar-border bg-sidebar text-sidebar-foreground px-4">
        <Link href="/admin" className="flex items-center gap-2">
          <span className="font-mono text-base font-bold tracking-tight">Synthszr</span>
          <span className="rounded-md bg-[#CCFF00] px-1.5 py-0.5 font-mono text-[10px] font-bold uppercase tracking-wider text-black">
            Admin
          </span>
        </Link>
        <div className="flex items-center gap-1">
          {onOpenCommand && (
            <button
              type="button"
              onClick={onOpenCommand}
              className="rounded-md p-2 text-muted-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground transition-colors"
              aria-label="Schnellsuche öffnen"
            >
              <Search className="h-5 w-5" />
            </button>
          )}
          <button
            type="button"
            onClick={() => setMobileOpen((v) => !v)}
            className="rounded-md p-2 text-muted-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground transition-colors"
            aria-label={mobileOpen ? 'Menü schließen' : 'Menü öffnen'}
          >
            {mobileOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
          </button>
        </div>
      </header>

      {/* Mobile overlay */}
      <div
        className={cn(
          'md:hidden fixed inset-0 z-40 bg-black/50 transition-opacity duration-300',
          mobileOpen ? 'opacity-100 pointer-events-auto' : 'opacity-0 pointer-events-none',
        )}
        onClick={() => setMobileOpen(false)}
        aria-hidden="true"
      />

      {/* Mobile drawer */}
      <aside
        className={cn(
          'md:hidden fixed left-0 top-0 z-50 h-screen w-72 flex-col border-r border-border bg-card transition-transform duration-300 ease-in-out',
          mobileOpen ? 'translate-x-0' : '-translate-x-full',
        )}
      >
        {sidebarInner(false, false)}
      </aside>
    </>
  )
}

'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useEffect, useState } from 'react'
import { ChevronDown, ChevronRight } from 'lucide-react'
import { cn } from '@/lib/utils'
import { ADMIN_NAV_GROUPS, type AdminNavItem } from '@/lib/admin/nav-config'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'

const OPEN_GROUPS_STORAGE_KEY = 'admin-nav-open-groups'

function isItemActive(pathname: string, item: AdminNavItem): boolean {
  if (item.external) return false
  if (item.exact) return pathname === item.href
  return pathname.startsWith(item.href)
}

interface AdminNavProps {
  onNavigate?: () => void
  /** Icon-Modus der eingeklappten Desktop-Leiste: nur Icons mit Tooltip, Gruppen als Trennlinien. */
  collapsed?: boolean
}

export function AdminNav({ onNavigate, collapsed = false }: AdminNavProps) {
  const pathname = usePathname()

  const [openGroups, setOpenGroups] = useState<Record<string, boolean>>(() => {
    const initial: Record<string, boolean> = {}
    for (const group of ADMIN_NAV_GROUPS) {
      if (group.collapsible) {
        initial[group.id] = group.defaultOpen ?? false
      }
    }
    return initial
  })

  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(OPEN_GROUPS_STORAGE_KEY)
      if (!raw) return
      const parsed = JSON.parse(raw)
      if (parsed && typeof parsed === 'object') {
        setOpenGroups((prev) => ({ ...prev, ...parsed }))
      }
    } catch {
      // ignore invalid storage
    }
  }, [])

  // Auto-open collapsible group if current route lives inside it.
  useEffect(() => {
    setOpenGroups((prev) => {
      let changed = false
      const next = { ...prev }
      for (const group of ADMIN_NAV_GROUPS) {
        if (group.collapsible && group.items.some((item) => isItemActive(pathname, item))) {
          if (!next[group.id]) {
            next[group.id] = true
            changed = true
          }
        }
      }
      return changed ? next : prev
    })
  }, [pathname])

  const toggleGroup = (id: string) => {
    setOpenGroups((prev) => {
      const next = { ...prev, [id]: !prev[id] }
      try {
        window.localStorage.setItem(OPEN_GROUPS_STORAGE_KEY, JSON.stringify(next))
      } catch {
        // ignore storage failure
      }
      return next
    })
  }

  // Zahl der Kommentare in der Freigabe-Queue → rot blinkendes „Eure Takes"-Icon.
  // Poll alle 60s; bei jedem Navigieren (pathname-Wechsel) frisch, damit die Zahl
  // nach dem Bearbeiten der Queue sofort stimmt.
  const [pendingComments, setPendingComments] = useState(0)
  useEffect(() => {
    let cancelled = false
    const load = () => {
      fetch('/api/admin/comments/pending-count', { credentials: 'include' })
        .then((r) => (r.ok ? r.json() : null))
        .then((d) => { if (!cancelled && typeof d?.count === 'number') setPendingComments(d.count) })
        .catch(() => {})
    }
    load()
    const id = window.setInterval(load, 60_000)
    return () => { cancelled = true; window.clearInterval(id) }
  }, [pathname])

  return (
    <TooltipProvider delayDuration={150}>
      <div className={collapsed ? 'space-y-2' : 'space-y-4'}>
        {ADMIN_NAV_GROUPS.map((group, groupIndex) => {
          const hasActiveItem = group.items.some((item) => isItemActive(pathname, item))
          const isOpen = collapsed || !group.collapsible || Boolean(openGroups[group.id]) || hasActiveItem

          return (
            <div key={group.id}>
              {collapsed ? (
                groupIndex > 0 && <div className="mx-1 mb-2 border-t border-sidebar-border" aria-hidden="true" />
              ) : group.collapsible ? (
                <button
                  type="button"
                  onClick={() => toggleGroup(group.id)}
                  aria-expanded={isOpen}
                  className="mb-1 flex w-full items-center justify-between rounded-md px-2 py-1 text-left font-mono text-[10px] font-semibold uppercase tracking-[0.08em] text-muted-foreground/75 hover:bg-sidebar-accent/70 hover:text-foreground transition-colors"
                >
                  <span>{group.label}</span>
                  {isOpen ? (
                    <ChevronDown className="h-3.5 w-3.5 opacity-70" />
                  ) : (
                    <ChevronRight className="h-3.5 w-3.5 opacity-70" />
                  )}
                </button>
              ) : (
                <h3 className="mb-1 px-2 font-mono text-[10px] font-semibold uppercase tracking-[0.08em] text-muted-foreground/75">
                  {group.label}
                </h3>
              )}

              {isOpen && (
                <ul className="space-y-0.5">
                  {group.items.map((item) => {
                    const isExternal = item.external === true
                    const isActive = isItemActive(pathname, item)
                    const alertsPending = item.href === '/admin/comments' && pendingComments > 0

                    const linkEl = (
                      <Link
                        href={item.href}
                        target={isExternal ? '_blank' : undefined}
                        rel={isExternal ? 'noopener noreferrer' : undefined}
                        onClick={onNavigate}
                        className={cn(
                          'relative flex items-center gap-2.5 rounded-lg px-2 py-1.5 text-[13px] transition-all',
                          collapsed && 'justify-center px-0 py-2',
                          isActive
                            ? collapsed
                              ? 'bg-card font-medium text-foreground shadow-xs ring-1 ring-[#CCFF00]/80 dark:bg-sidebar-accent'
                              : 'bg-card font-medium text-foreground shadow-xs ring-1 ring-border/70 dark:bg-sidebar-accent dark:ring-border/60'
                            : 'text-muted-foreground hover:bg-sidebar-accent/70 hover:text-foreground',
                        )}
                      >
                        {isActive && !collapsed && (
                          <span
                            className="absolute left-0 top-1.5 bottom-1.5 w-[3px] rounded-r-full bg-[#CCFF00]"
                            aria-hidden="true"
                          />
                        )}
                        <span
                          className={cn(
                            'relative flex h-6 w-6 shrink-0 items-center justify-center rounded-md',
                            item.highlight && 'bg-[#CCFF00] text-black shadow-xs',
                            alertsPending && 'animate-pulse bg-red-600 text-white',
                          )}
                        >
                          <item.icon className="h-4 w-4" />
                          {alertsPending && collapsed && (
                            <span className="absolute -top-1 -right-1 flex h-3.5 min-w-3.5 items-center justify-center rounded-full bg-red-600 px-0.5 text-[9px] font-bold leading-none text-white ring-1 ring-card">
                              {pendingComments > 9 ? '9+' : pendingComments}
                            </span>
                          )}
                        </span>
                        {!collapsed && <span className="truncate">{item.label}</span>}
                        {alertsPending && !collapsed && (
                          <span className="ml-auto animate-pulse rounded-full bg-red-600 px-1.5 py-0.5 text-[10px] font-semibold leading-none text-white">
                            {pendingComments}
                          </span>
                        )}
                        {isExternal && !collapsed && (
                          <span className="ml-auto text-xs text-muted-foreground">↗</span>
                        )}
                      </Link>
                    )

                    if (collapsed) {
                      return (
                        <li key={item.href}>
                          <Tooltip>
                            <TooltipTrigger asChild>{linkEl}</TooltipTrigger>
                            <TooltipContent side="right">
                              {alertsPending ? `${item.label} (${pendingComments})` : item.label}
                            </TooltipContent>
                          </Tooltip>
                        </li>
                      )
                    }

                    return <li key={item.href}>{linkEl}</li>
                  })}
                </ul>
              )}
            </div>
          )
        })}
      </div>
    </TooltipProvider>
  )
}

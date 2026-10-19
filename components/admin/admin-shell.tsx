'use client'

import { useEffect, useState } from 'react'
import { cn } from '@/lib/utils'
import { AdminSidebar } from './admin-sidebar'

/** Merkt den Zustand nur im Browser des Betreibers (Komfort, keine fachliche Einstellung). */
const STORAGE_KEY = 'admin-sidebar-collapsed'

/**
 * Einklappbare Admin-Navigation (2026-10-19): hält den Zustand für Seitenleiste
 * UND Inhaltsabstand, weil beide Breiten zusammenpassen müssen und das
 * Server-Layout (Auth) keinen Zustand tragen kann. Startet ausgeklappt und
 * übernimmt den gemerkten Zustand erst nach dem Mount — sonst stritten sich
 * Server- und Client-Markup beim Hydrieren.
 */
export function AdminShell({ children }: { children: React.ReactNode }) {
  const [collapsed, setCollapsed] = useState(false)

  useEffect(() => {
    try {
      if (window.localStorage.getItem(STORAGE_KEY) === '1') setCollapsed(true)
    } catch {
      // privates Fenster o. ä. — dann eben nicht gemerkt
    }
  }, [])

  const toggle = () => {
    const next = !collapsed
    setCollapsed(next)
    try {
      window.localStorage.setItem(STORAGE_KEY, next ? '1' : '0')
    } catch {
      // s. o.
    }
  }

  return (
    <>
      <AdminSidebar collapsed={collapsed} onToggle={toggle} />
      {/* pt-14 auf Mobil für den festen Kopf, links Platz für die Leiste auf Desktop */}
      <main className={cn('flex-1 pt-14 md:pt-0 transition-[margin] duration-300', collapsed ? 'md:ml-16' : 'md:ml-64')}>
        {children}
      </main>
    </>
  )
}

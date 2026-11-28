'use client'

import { useEffect, useState } from 'react'
import { cn } from '@/lib/utils'
import { AdminSidebar } from './admin-sidebar'
import { AdminFeedbackProvider } from './admin-feedback'
import { AdminCommandPalette } from './admin-command-palette'
import { SystemAlertBanner } from './system-alert-banner'

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
  const [commandOpen, setCommandOpen] = useState(false)

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
    <AdminFeedbackProvider>
      <AdminSidebar
        collapsed={collapsed}
        onToggle={toggle}
        onOpenCommand={() => setCommandOpen(true)}
      />
      <AdminCommandPalette open={commandOpen} onOpenChange={setCommandOpen} />
      {/* pt-14 auf Mobil für den festen Kopf, links Platz für die Leiste auf Desktop */}
      <main
        className={cn(
          'flex-1 min-w-0 pt-14 md:pt-0 transition-[margin] duration-300',
          collapsed ? 'md:ml-16' : 'md:ml-64',
        )}
      >
        <SystemAlertBanner className="mx-4 mt-4 md:mx-6 lg:mx-8 mb-0" />
        {children}
      </main>
    </AdminFeedbackProvider>
  )
}

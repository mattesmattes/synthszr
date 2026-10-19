/**
 * Einklappbare Admin-Navigation (2026-10-19): eingeklappt zeigt die Leiste nur
 * Icons mit Tooltip, keine Gruppenüberschriften und keine Fußzeile; der
 * Umschalt-Button trägt die passende Beschriftung. Serverseitig gerendert —
 * die Interaktion selbst ist ein useState-Toggle in AdminShell. Als .ts mit
 * createElement, weil vitest nur tests/**\/*.test.ts einsammelt.
 */
import { describe, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { createElement as h } from 'react'

vi.mock('next/navigation', () => ({ usePathname: () => '/admin/settings', useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }))
vi.mock('next/link', () => ({ default: ({ href, children, ...rest }: any) => h('a', { href, ...rest }, children) }))

import { AdminNav } from '@/components/admin/admin-nav'
import { AdminSidebar } from '@/components/admin/admin-sidebar'

describe('AdminNav collapsed', () => {
  it('ausgeklappt: Gruppenüberschriften und Labels sichtbar', () => {
    const html = renderToStaticMarkup(h(AdminNav))
    expect(html).toContain('Content')
    expect(html).toContain('>Blog Posts<')
    expect(html).not.toContain('title="Blog Posts"')
  })

  it('eingeklappt: nur Icons mit title, keine Überschriften, keine Label-Texte', () => {
    const html = renderToStaticMarkup(h(AdminNav, { collapsed: true } as any))
    expect(html).toContain('title="Blog Posts"')
    expect(html).not.toContain('>Blog Posts<')
    expect(html).not.toMatch(/<h3[^>]*>Content<\/h3>/)
    expect(html).toContain('title="Einstellungen"')
  })
})

describe('AdminSidebar collapsed', () => {
  it('ausgeklappt: Logo, Fußzeile und Button „Navigation einklappen“', () => {
    const html = renderToStaticMarkup(h(AdminSidebar, { collapsed: false, onToggle: () => {} } as any))
    expect(html).toContain('aria-label="Navigation einklappen"')
    expect(html).toContain('Zur Website')
    expect(html).toContain('md:w-64')
  })

  it('eingeklappt: schmale Leiste, Button „Navigation ausklappen“, keine Fußzeile im Desktop-Teil', () => {
    const html = renderToStaticMarkup(h(AdminSidebar, { collapsed: true, onToggle: () => {} } as any))
    expect(html).toContain('aria-label="Navigation ausklappen"')
    expect(html).toContain('md:w-16')
    // Der mobile Drawer bleibt immer ausgeklappt (eigener Baum), deshalb nur den Desktop-Block prüfen.
    const desktop = html.split('<header')[0]
    expect(desktop).not.toContain('Zur Website')
  })
})

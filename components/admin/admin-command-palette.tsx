'use client'

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/components/ui/command'
import { ADMIN_NAV_GROUPS } from '@/lib/admin/nav-config'

interface AdminCommandPaletteProps {
  open: boolean
  onOpenChange: (open: boolean) => void
}

export function AdminCommandPalette({ open, onOpenChange }: AdminCommandPaletteProps) {
  const router = useRouter()

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        onOpenChange(!open)
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [open, onOpenChange])

  const handleSelect = (href: string, external?: boolean) => {
    onOpenChange(false)
    if (external) {
      window.open(href, '_blank', 'noopener,noreferrer')
      return
    }
    router.push(href)
  }

  return (
    <CommandDialog
      open={open}
      onOpenChange={onOpenChange}
      title="Admin-Schnellsuche"
      description="Zwischen Admin-Bereichen wechseln"
    >
      <CommandInput placeholder="Admin-Bereich suchen… (z. B. News Queue, Übersetzungen, Lexikon)" />
      <CommandList>
        <CommandEmpty>Kein passender Bereich gefunden.</CommandEmpty>
        {ADMIN_NAV_GROUPS.map((group) => (
          <CommandGroup key={group.id} heading={group.label}>
            {group.items.map((item) => (
              <CommandItem
                key={item.href}
                value={[item.label, group.label, ...(item.keywords ?? [])].join(' ')}
                onSelect={() => handleSelect(item.href, item.external)}
              >
                <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-muted/70 text-muted-foreground">
                  <item.icon className="h-3.5 w-3.5" />
                </span>
                <span>{item.label}</span>
                {item.external && (
                  <span className="ml-auto text-xs text-muted-foreground">↗</span>
                )}
              </CommandItem>
            ))}
          </CommandGroup>
        ))}
      </CommandList>
      <div className="hidden sm:flex items-center justify-between border-t border-border/70 bg-muted/30 px-3 py-2 text-[11px] text-muted-foreground">
        <div className="flex items-center gap-3">
          <span className="inline-flex items-center gap-1">
            <kbd className="rounded border border-border/80 bg-card px-1.5 py-0.5 font-mono text-[10px]">↑↓</kbd>
            Navigieren
          </span>
          <span className="inline-flex items-center gap-1">
            <kbd className="rounded border border-border/80 bg-card px-1.5 py-0.5 font-mono text-[10px]">↵</kbd>
            Öffnen
          </span>
        </div>
        <span className="inline-flex items-center gap-1">
          <kbd className="rounded border border-border/80 bg-card px-1.5 py-0.5 font-mono text-[10px]">ESC</kbd>
          Schließen
        </span>
      </div>
    </CommandDialog>
  )
}

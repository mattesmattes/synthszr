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
                <item.icon className="h-4 w-4 text-muted-foreground" />
                <span>{item.label}</span>
                {item.external && (
                  <span className="ml-auto text-xs text-muted-foreground">↗</span>
                )}
              </CommandItem>
            ))}
          </CommandGroup>
        ))}
      </CommandList>
    </CommandDialog>
  )
}

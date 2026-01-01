'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { cn } from '@/lib/utils'
import {
  FileText,
  Mail,
  Key,
  MessageSquare,
  Database,
  Sparkles,
  Settings,
  PenTool,
  BookOpen,
  Wand2
} from 'lucide-react'

const navGroups = [
  {
    label: 'Content',
    items: [
      {
        label: 'Blog Posts',
        href: '/admin',
        icon: FileText,
        exact: true
      },
      {
        label: 'Neuer Post',
        href: '/admin/new',
        icon: FileText
      },
      {
        label: 'AI Artikel erstellen',
        href: '/admin/create-article',
        icon: Wand2
      },
      {
        label: 'Generierte Artikel',
        href: '/admin/generated-articles',
        icon: FileText
      }
    ]
  },
  {
    label: 'Newsletter Aggregator',
    items: [
      {
        label: 'Newsletter-Quellen',
        href: '/admin/newsletters',
        icon: Mail
      },
      {
        label: 'Daily Repo',
        href: '/admin/daily-repo',
        icon: Database
      },
      {
        label: 'Digests',
        href: '/admin/digests',
        icon: Sparkles
      }
    ]
  },
  {
    label: 'Ghostwriter',
    items: [
      {
        label: 'Ghostwriter-Prompts',
        href: '/admin/ghostwriter',
        icon: PenTool
      },
      {
        label: 'Vokabular',
        href: '/admin/vocabulary',
        icon: BookOpen
      }
    ]
  },
  {
    label: 'Einstellungen',
    items: [
      {
        label: 'Analyse-Prompts',
        href: '/admin/prompts',
        icon: MessageSquare
      },
      {
        label: 'Paywall-Credentials',
        href: '/admin/credentials',
        icon: Key
      },
      {
        label: 'Einstellungen',
        href: '/admin/settings',
        icon: Settings
      }
    ]
  }
]

export function AdminNav() {
  const pathname = usePathname()

  return (
    <div className="space-y-6">
      {navGroups.map((group) => (
        <div key={group.label}>
          <h3 className="mb-2 px-2 font-mono text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            {group.label}
          </h3>
          <ul className="space-y-1">
            {group.items.map((item) => {
              const isActive = item.exact
                ? pathname === item.href
                : pathname.startsWith(item.href)

              return (
                <li key={item.href}>
                  <Link
                    href={item.href}
                    className={cn(
                      'flex items-center gap-3 rounded-md px-2 py-2 text-sm transition-colors',
                      isActive
                        ? 'bg-primary/10 text-primary'
                        : 'text-muted-foreground hover:bg-secondary hover:text-foreground'
                    )}
                  >
                    <item.icon className="h-4 w-4" />
                    {item.label}
                  </Link>
                </li>
              )
            })}
          </ul>
        </div>
      ))}
    </div>
  )
}

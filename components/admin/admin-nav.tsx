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
  Wand2,
  ImageIcon,
  Lightbulb,
  Users,
  Send,
  HelpCircle,
  FileCode,
  TrendingUp,
  ListTodo,
  Globe,
  Headphones
} from 'lucide-react'
import { LucideIcon } from 'lucide-react'

interface NavItem {
  label: string
  href: string
  icon: LucideIcon
  exact?: boolean
  external?: boolean
}

interface NavGroup {
  label: string
  items: NavItem[]
}

const navGroups: NavGroup[] = [
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
        label: 'Ghostwriter-Prompts',
        href: '/admin/ghostwriter',
        icon: PenTool
      },
      {
        label: 'Bild-Prompts',
        href: '/admin/image-prompts',
        icon: ImageIcon
      },
      {
        label: 'Vokabular',
        href: '/admin/vocabulary',
        icon: BookOpen
      },
      {
        label: 'Why',
        href: '/admin/why',
        icon: HelpCircle
      },
      {
        label: 'Sprachen',
        href: '/admin/languages',
        icon: Globe
      },
      {
        label: 'Übersetzungen',
        href: '/admin/translations',
        icon: Globe
      },
      {
        label: 'Podcast Studio',
        href: '/admin/audio',
        icon: Headphones
      }
    ]
  },
  {
    label: 'News & Synthese',
    items: [
      {
        label: 'News',
        href: '/admin/digests',
        icon: Sparkles
      },
      {
        label: 'News Queue',
        href: '/admin/news-queue',
        icon: ListTodo
      },
      {
        label: 'Analyse-Prompts',
        href: '/admin/prompts',
        icon: MessageSquare
      },
      {
        label: 'Synthese-Prompts',
        href: '/admin/synthesis',
        icon: Lightbulb
      }
    ]
  },
  {
    label: 'Premarket',
    items: [
      {
        label: 'AI Synthesen',
        href: '/admin/premarket',
        icon: TrendingUp
      }
    ]
  },
  {
    label: 'Repo',
    items: [
      {
        label: 'Daily Repo',
        href: '/admin/daily-repo',
        icon: Database
      },
      {
        label: 'Newsletter-Quellen',
        href: '/admin/newsletters',
        icon: Mail
      },
      {
        label: 'Paywall-Credentials',
        href: '/admin/credentials',
        icon: Key
      }
    ]
  },
  {
    label: 'Newsletter',
    items: [
      {
        label: 'Subscriber',
        href: '/admin/subscribers',
        icon: Users
      },
      {
        label: 'Versenden',
        href: '/admin/newsletter-send',
        icon: Send
      }
    ]
  },
  {
    label: 'Einstellungen',
    items: [
      {
        label: 'Einstellungen',
        href: '/admin/settings',
        icon: Settings
      },
      {
        label: 'Architecture',
        href: '/admin/docs/architecture',
        icon: FileCode
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
              const isExternal = item.external === true
              const isActive = isExternal
                ? false
                : item.exact === true
                  ? pathname === item.href
                  : pathname.startsWith(item.href)

              return (
                <li key={item.href}>
                  <Link
                    href={item.href}
                    target={isExternal ? '_blank' : undefined}
                    rel={isExternal ? 'noopener noreferrer' : undefined}
                    className={cn(
                      'flex items-center gap-3 rounded-md px-2 py-2 text-sm transition-colors',
                      isActive
                        ? 'bg-primary/10 text-primary'
                        : 'text-muted-foreground hover:bg-secondary hover:text-foreground'
                    )}
                  >
                    <item.icon className="h-4 w-4" />
                    {item.label}
                    {isExternal && (
                      <span className="ml-auto text-xs text-muted-foreground">↗</span>
                    )}
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

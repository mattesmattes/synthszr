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
  Headphones,
  Megaphone,
  ClipboardEdit
} from 'lucide-react'
import { LucideIcon } from 'lucide-react'

interface NavItem {
  label: string
  href: string
  icon: LucideIcon
  exact?: boolean
  external?: boolean
  highlight?: boolean
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
        icon: Wand2,
        highlight: true
      },
      {
        label: 'Ghostwriter-Prompts',
        href: '/admin/ghostwriter',
        icon: PenTool
      },
      {
        label: 'Editor-in-Chief-Prompts',
        href: '/admin/editor-in-chief',
        icon: ClipboardEdit
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
        icon: Globe,
        highlight: true
      },
      {
        label: 'Podcast Studio',
        href: '/admin/audio',
        icon: Headphones,
        highlight: true
      },
      {
        label: 'Ad Promos',
        href: '/admin/ad-promos',
        icon: Megaphone
      },
      {
        label: 'Tip Promos',
        href: '/admin/tip-promos',
        icon: Lightbulb
      }
    ]
  },
  {
    label: 'News & Synthese',
    items: [
      {
        label: 'News',
        href: '/admin/digests',
        icon: Sparkles,
        highlight: true
      },
      {
        label: 'News Queue',
        href: '/admin/news-queue',
        icon: ListTodo,
        highlight: true
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
        icon: Database,
        highlight: true
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
        icon: Send,
        highlight: true
      }
    ]
  },
  {
    label: 'Analytics',
    items: [
      {
        label: 'Statistics',
        href: '/admin/statistics',
        icon: TrendingUp
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
        href: '/docs/architecture',
        icon: FileCode,
        external: true
      }
    ]
  }
]

interface AdminNavProps {
  onNavigate?: () => void
}

export function AdminNav({ onNavigate }: AdminNavProps) {
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
                    onClick={onNavigate}
                    className={cn(
                      'flex items-center gap-3 rounded-md px-2 py-2 text-sm transition-colors',
                      isActive
                        ? 'bg-primary/10 text-primary'
                        : 'text-muted-foreground hover:bg-secondary hover:text-foreground'
                    )}
                  >
                    <span
                      className={cn(
                        'flex h-6 w-6 shrink-0 items-center justify-center rounded',
                        item.highlight && 'bg-[#CCFF00] text-black'
                      )}
                    >
                      <item.icon className="h-4 w-4" />
                    </span>
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

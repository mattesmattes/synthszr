import type { LucideIcon } from 'lucide-react'
import {
  Award,
  BarChart3,
  BookOpen,
  BookText,
  Bot,
  CalendarRange,
  ClipboardEdit,
  ClipboardList,
  Coins,
  Database,
  FileCode,
  FilePlus2,
  FileText,
  Globe,
  Headphones,
  HelpCircle,
  ImageIcon,
  Key,
  Languages,
  Library,
  Lightbulb,
  LineChart,
  ListTodo,
  Mail,
  Megaphone,
  MessageSquare,
  PenTool,
  Send,
  Settings,
  SlidersHorizontal,
  Sparkles,
  Trophy,
  Users,
  Wallet,
  Wand2,
} from 'lucide-react'

export interface AdminNavItem {
  label: string
  href: string
  icon: LucideIcon
  exact?: boolean
  external?: boolean
  highlight?: boolean
  keywords?: string[]
}

export interface AdminNavGroup {
  id: string
  label: string
  collapsible?: boolean
  defaultOpen?: boolean
  items: AdminNavItem[]
}

export const ADMIN_NAV_GROUPS: AdminNavGroup[] = [
  {
    id: 'editorial',
    label: 'Redaktion',
    collapsible: false,
    defaultOpen: true,
    items: [
      {
        label: 'Daily Repo',
        href: '/admin/daily-repo',
        icon: Database,
        highlight: true,
        keywords: ['repo', 'newsletter', 'artikel', 'webcrawl'],
      },
      {
        label: 'News',
        href: '/admin/digests',
        icon: Sparkles,
        highlight: true,
        keywords: ['synthese', 'digest', 'analyse'],
      },
      {
        label: 'Morgenkonferenz',
        href: '/admin/curation',
        icon: ClipboardList,
        keywords: ['curation', 'kuration'],
      },
      {
        label: 'News Queue',
        href: '/admin/news-queue',
        icon: ListTodo,
        highlight: true,
        keywords: ['queue', 'auswahl', 'ranking'],
      },
      {
        label: 'AI Artikel erstellen',
        href: '/admin/create-article',
        icon: Wand2,
        highlight: true,
        keywords: ['ghostwriter', 'entwurf', 'erstellen'],
      },
      {
        label: 'Blog Posts',
        href: '/admin',
        icon: FileText,
        exact: true,
        keywords: ['posts', 'artikel', 'übersicht', 'dashboard'],
      },
      {
        label: 'Neuer Post',
        href: '/admin/new',
        icon: FilePlus2,
        keywords: ['manuell', 'schreiben'],
      },
      {
        label: 'AI-Week Wrap-up',
        href: '/admin/week-wrapup',
        icon: CalendarRange,
        keywords: ['wochenrückblick', 'wrapup'],
      },
      {
        label: 'Übersetzungen',
        href: '/admin/translations',
        icon: Languages,
        highlight: true,
        keywords: ['translations', 'i18n', 'queue'],
      },
      {
        label: 'Podcast Studio',
        href: '/admin/audio',
        icon: Headphones,
        highlight: true,
        keywords: ['audio', 'podcast', 'tts', 'intro', 'outro'],
      },
      {
        label: 'Versenden',
        href: '/admin/newsletter-send',
        icon: Send,
        highlight: true,
        keywords: ['newsletter', 'versand', 'send'],
      },
    ],
  },
  {
    id: 'community',
    label: 'Community & Distribution',
    collapsible: false,
    defaultOpen: true,
    items: [
      {
        label: 'Eure Takes',
        href: '/admin/comments',
        icon: MessageSquare,
        keywords: ['kommentare', 'moderation', 'takes'],
      },
      {
        label: 'Agenten-Takes',
        href: '/admin/agents',
        icon: Bot,
        keywords: ['agents', 'bots', 'takes'],
      },
      {
        label: 'Subscriber',
        href: '/admin/subscribers',
        icon: Users,
        keywords: ['abonnenten', 'newsletter', 'csv'],
      },
      {
        label: 'Ad Promos',
        href: '/admin/ad-promos',
        icon: Megaphone,
        keywords: ['werbung', 'promo', 'banner'],
      },
      {
        label: 'Tip Promos',
        href: '/admin/tip-promos',
        icon: Lightbulb,
        keywords: ['tipp', 'promo'],
      },
    ],
  },
  {
    id: 'knowledge',
    label: 'Wissen & Daten',
    collapsible: false,
    defaultOpen: true,
    items: [
      {
        label: 'Lexikon',
        href: '/admin/glossary',
        icon: Library,
        keywords: ['glossary', 'begriffe'],
      },
      {
        label: 'Produkt-Rankings',
        href: '/admin/rankings',
        icon: Award,
        keywords: ['charts', 'momentum', 'rankings'],
      },
      {
        label: 'AI Synthesen',
        href: '/admin/premarket',
        icon: LineChart,
        keywords: ['premarket', 'aktien', 'glitch'],
      },
      {
        label: 'Why',
        href: '/admin/why',
        icon: HelpCircle,
        keywords: ['über', 'warum'],
      },
    ],
  },
  {
    id: 'analytics',
    label: 'Analytics & Kosten',
    collapsible: false,
    defaultOpen: true,
    items: [
      {
        label: 'Statistics',
        href: '/admin/statistics',
        icon: BarChart3,
        keywords: ['statistik', 'zugriffe', 'analytics'],
      },
      {
        label: 'Top Sources',
        href: '/admin/top-sources',
        icon: Trophy,
        keywords: ['quellen', 'ranking'],
      },
      {
        label: 'KI-Kosten',
        href: '/admin/llm-costs',
        icon: Coins,
        keywords: ['llm', 'tokens', 'ausgaben'],
      },
      {
        label: 'Abo-Kosten',
        href: '/admin/subscriptions',
        icon: Wallet,
        keywords: ['abos', 'kündigen', 'ausgaben'],
      },
    ],
  },
  {
    id: 'ai-config',
    label: 'KI-Konfiguration',
    collapsible: true,
    defaultOpen: false,
    items: [
      {
        label: 'Analyse-Prompts',
        href: '/admin/prompts',
        icon: SlidersHorizontal,
        keywords: ['prompt', 'synthese', 'analyse'],
      },
      {
        label: 'Ghostwriter-Prompts',
        href: '/admin/ghostwriter',
        icon: PenTool,
        keywords: ['prompt', 'ghostwriter'],
      },
      {
        label: 'Enrich-Prompts',
        href: '/admin/enrich-prompts',
        icon: ClipboardEdit,
        keywords: ['prompt', 'enrich'],
      },
      {
        label: 'Bild-Prompts',
        href: '/admin/image-prompts',
        icon: ImageIcon,
        keywords: ['prompt', 'bilder', 'dithering'],
      },
      {
        label: 'Vokabular',
        href: '/admin/vocabulary',
        icon: BookOpen,
        keywords: ['sprache', 'stil', 'begriffe'],
      },
      {
        label: 'Mattes-Korpus',
        href: '/admin/mattes',
        icon: BookText,
        keywords: ['korpus', 'stil', 'referenz'],
      },
      {
        label: 'Sprachen',
        href: '/admin/languages',
        icon: Globe,
        keywords: ['i18n', 'locales', 'modelle'],
      },
    ],
  },
  {
    id: 'system',
    label: 'System & Quellen',
    collapsible: true,
    defaultOpen: false,
    items: [
      {
        label: 'Newsletter-Quellen',
        href: '/admin/newsletters',
        icon: Mail,
        keywords: ['gmail', 'absender', 'quellen'],
      },
      {
        label: 'Paywall-Credentials',
        href: '/admin/credentials',
        icon: Key,
        keywords: ['login', 'passwort', 'paywall'],
      },
      {
        label: 'Allgemein',
        href: '/admin/settings',
        icon: Settings,
        keywords: ['einstellungen', 'modelle', 'cron', 'settings'],
      },
      {
        label: 'Architecture',
        href: '/docs/architecture',
        icon: FileCode,
        external: true,
        keywords: ['doku', 'architektur'],
      },
    ],
  },
]

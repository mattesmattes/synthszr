'use client'

import { useEffect, useState } from 'react'
import { Database, Calendar, Mail, FileText, Link2, Loader2, ExternalLink, Hash } from 'lucide-react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from '@/components/ui/accordion'
import { createClient } from '@/lib/supabase/client'
import { FetchProgress } from '@/components/admin/fetch-progress'

interface DailyRepoItem {
  id: string
  source_type: string
  source_email: string | null
  source_url: string | null
  title: string
  content: string
  newsletter_date: string
  collected_at: string
  metadata: {
    links?: Array<{ url: string; text: string; type: string }>
    article_urls?: string[]
  } | null
}

export default function DailyRepoPage() {
  const [items, setItems] = useState<DailyRepoItem[]>([])
  const [loading, setLoading] = useState(true)
  const [selectedDate, setSelectedDate] = useState<string>(
    new Date().toISOString().split('T')[0]
  )

  const supabase = createClient()

  useEffect(() => {
    fetchItems()
  }, [selectedDate])

  async function fetchItems() {
    setLoading(true)
    const { data, error } = await supabase
      .from('daily_repo')
      .select('*')
      .eq('newsletter_date', selectedDate)
      .order('collected_at', { ascending: false })

    if (error) {
      console.error('Error fetching items:', error)
    } else {
      setItems(data || [])
    }
    setLoading(false)
  }

  const today = new Date().toLocaleDateString('de-DE', {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric'
  })

  const sourceTypeIcon = (type: string) => {
    switch (type) {
      case 'newsletter':
        return <Mail className="h-4 w-4" />
      case 'article':
        return <FileText className="h-4 w-4" />
      case 'pdf':
        return <FileText className="h-4 w-4" />
      default:
        return <Link2 className="h-4 w-4" />
    }
  }

  return (
    <div className="p-8">
      <div className="mb-8">
        <h1 className="text-3xl font-bold tracking-tighter">Daily Repo</h1>
        <p className="mt-1 text-muted-foreground">
          Alle gesammelten Inhalte aus Newslettern, Artikeln und PDFs
        </p>
      </div>

      {/* Fetch Progress Component */}
      <div className="mb-8">
        <FetchProgress onComplete={fetchItems} />
      </div>

      <div className="mb-6 flex items-center gap-4">
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Calendar className="h-4 w-4" />
          {today}
        </div>
        <input
          type="date"
          value={selectedDate}
          onChange={(e) => setSelectedDate(e.target.value)}
          className="rounded-md border px-3 py-1 text-sm"
        />
      </div>

      {/* Statistics Summary */}
      {!loading && items.length > 0 && (
        <Card className="mb-6">
          <CardContent className="pt-6">
            <div className="grid grid-cols-4 gap-4">
              <div className="text-center">
                <div className="flex items-center justify-center gap-1.5 text-2xl font-bold text-foreground">
                  <Database className="h-5 w-5" />
                  {items.length}
                </div>
                <div className="text-xs text-muted-foreground">Gesamt</div>
              </div>
              <div className="text-center">
                <div className="flex items-center justify-center gap-1.5 text-2xl font-bold text-blue-600">
                  <Mail className="h-5 w-5" />
                  {items.filter(i => i.source_type === 'newsletter').length}
                </div>
                <div className="text-xs text-muted-foreground">Newsletter</div>
              </div>
              <div className="text-center">
                <div className="flex items-center justify-center gap-1.5 text-2xl font-bold text-green-600">
                  <FileText className="h-5 w-5" />
                  {items.filter(i => i.source_type === 'article').length}
                </div>
                <div className="text-xs text-muted-foreground">Artikel</div>
              </div>
              <div className="text-center">
                <div className="flex items-center justify-center gap-1.5 text-2xl font-bold text-purple-600">
                  <Hash className="h-5 w-5" />
                  {(items.reduce((sum, i) => sum + (i.content?.length || 0), 0) / 1000).toFixed(1)}k
                </div>
                <div className="text-xs text-muted-foreground">Zeichen</div>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {loading ? (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
        </div>
      ) : items.length === 0 ? (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Database className="h-5 w-5" />
              Noch keine Inhalte
            </CardTitle>
            <CardDescription>
              Für diesen Tag wurden noch keine Inhalte gesammelt.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-muted-foreground">
              Das Daily Repo sammelt automatisch:
            </p>
            <ul className="mt-2 list-inside list-disc text-sm text-muted-foreground">
              <li>Newsletter-Inhalte von whitelisted Absendern</li>
              <li>Vollständige Artikel hinter Teaser-Links</li>
              <li>PDFs von Paywall-geschützten Quellen</li>
            </ul>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-4">
          <p className="text-sm text-muted-foreground">
            {items.length} Inhalte für {new Date(selectedDate).toLocaleDateString('de-DE')}
          </p>
          <Accordion type="single" collapsible className="space-y-2">
            {items.map((item) => (
              <AccordionItem
                key={item.id}
                value={item.id}
                className="rounded-lg border bg-card px-4"
              >
                <AccordionTrigger className="hover:no-underline">
                  <div className="flex items-center gap-3 text-left">
                    {sourceTypeIcon(item.source_type)}
                    <div>
                      <div className="font-medium">{item.title}</div>
                      <div className="flex items-center gap-2 text-sm text-muted-foreground">
                        <Badge variant="secondary" className="text-xs">
                          {item.source_type}
                        </Badge>
                        {item.source_email && (
                          <span className="font-mono text-xs">{item.source_email}</span>
                        )}
                      </div>
                    </div>
                  </div>
                </AccordionTrigger>
                <AccordionContent>
                  <div className="space-y-4 pt-2">
                    {/* Content Preview */}
                    <div>
                      <h4 className="mb-2 text-sm font-medium">Inhalt (Auszug)</h4>
                      <p className="whitespace-pre-wrap text-sm text-muted-foreground line-clamp-6">
                        {item.content?.slice(0, 500)}
                        {item.content?.length > 500 && '...'}
                      </p>
                    </div>

                    {/* Extracted Links */}
                    {item.metadata?.article_urls && item.metadata.article_urls.length > 0 && (
                      <div>
                        <h4 className="mb-2 text-sm font-medium">
                          Erkannte Artikel-Links ({item.metadata.article_urls.length})
                        </h4>
                        <ul className="space-y-1">
                          {item.metadata.article_urls.slice(0, 5).map((url, i) => (
                            <li key={i} className="flex items-center gap-2">
                              <ExternalLink className="h-3 w-3 text-muted-foreground" />
                              <a
                                href={url}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="truncate text-sm text-blue-600 hover:underline"
                              >
                                {url}
                              </a>
                            </li>
                          ))}
                          {item.metadata.article_urls.length > 5 && (
                            <li className="text-sm text-muted-foreground">
                              ... und {item.metadata.article_urls.length - 5} weitere
                            </li>
                          )}
                        </ul>
                      </div>
                    )}

                    {/* Metadata */}
                    <div className="text-xs text-muted-foreground">
                      Gesammelt: {new Date(item.collected_at).toLocaleString('de-DE')}
                    </div>
                  </div>
                </AccordionContent>
              </AccordionItem>
            ))}
          </Accordion>
        </div>
      )}
    </div>
  )
}

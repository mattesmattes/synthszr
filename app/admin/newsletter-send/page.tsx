'use client'

import { useEffect, useState, useCallback } from 'react'
import { Send, FileText, Mail, Loader2, CheckCircle, AlertCircle, Clock, Users, History, Settings, FileEdit, Globe, AlertTriangle, Image } from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Switch } from '@/components/ui/switch'
import { createClient } from '@/lib/supabase/client'

interface Post {
  id: string
  title: string
  slug: string
  status: string
  created_at: string
}

interface NewsletterSend {
  id: string
  subject: string
  recipient_count: number
  status: string
  sent_at: string
  generated_posts: {
    title: string
    slug: string
  } | null
}

interface CronSettings {
  enabled: boolean
  hour: number
  minute: number
}

interface EmailTemplateSettings {
  subjectTemplate: string
  footerText: string
}

const DEFAULT_TEMPLATE: EmailTemplateSettings = {
  subjectTemplate: '{{title}}',
  footerText: 'Du erhältst diese E-Mail, weil du den Synthszr Newsletter abonniert hast.',
}

export default function NewsletterSendPage() {
  const [posts, setPosts] = useState<Post[]>([])
  const [sends, setSends] = useState<NewsletterSend[]>([])
  const [selectedPostId, setSelectedPostId] = useState<string>('')
  const [testEmail, setTestEmail] = useState('')
  const [loading, setLoading] = useState(true)
  const [sending, setSending] = useState(false)
  const [sendingTest, setSendingTest] = useState(false)
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null)
  const [activeSubscriberCount, setActiveSubscriberCount] = useState(0)
  const [showProtokoll, setShowProtokoll] = useState(false)

  // Cron settings state
  const [cronSettings, setCronSettings] = useState<CronSettings>({ enabled: false, hour: 9, minute: 0 })
  const [savingCron, setSavingCron] = useState(false)

  // Template settings state
  const [templateSettings, setTemplateSettings] = useState<EmailTemplateSettings>(DEFAULT_TEMPLATE)
  const [savingTemplate, setSavingTemplate] = useState(false)
  const [showTemplateEditor, setShowTemplateEditor] = useState(false)

  // Translation warning state
  const [translationStatus, setTranslationStatus] = useState<{
    pending: number
    completed: number
    total: number
    languages: string[]
  } | null>(null)
  const [showTranslationWarning, setShowTranslationWarning] = useState(false)
  const [checkingTranslations, setCheckingTranslations] = useState(false)

  // Thumbnail validation state
  const [thumbnailStatus, setThumbnailStatus] = useState<{
    articlesInContent: number
    thumbnailsFound: number
    matched: number
    mismatched: number
    orphaned: number
    missing: number
    valid: boolean
  } | null>(null)
  const [checkingThumbnails, setCheckingThumbnails] = useState(false)

  const supabase = createClient()

  useEffect(() => {
    fetchData()
  }, [])

  async function fetchData() {
    setLoading(true)

    // Fetch published posts
    const { data: postsData } = await supabase
      .from('generated_posts')
      .select('id, title, slug, status, created_at')
      .eq('status', 'published')
      .order('created_at', { ascending: false })
      .limit(20)

    if (postsData) {
      setPosts(postsData)
      if (postsData.length > 0 && !selectedPostId) {
        setSelectedPostId(postsData[0].id)
      }
    }

    // Fetch recent sends
    const sendsRes = await fetch('/api/admin/newsletter-send')
    if (sendsRes.ok) {
      const sendsData = await sendsRes.json()
      setSends(sendsData.sends || [])
    }

    // Fetch active subscriber count
    const subscribersRes = await fetch('/api/admin/subscribers?status=active&limit=1')
    if (subscribersRes.ok) {
      const subData = await subscribersRes.json()
      setActiveSubscriberCount(subData.counts?.active || 0)
    }

    // Fetch cron settings
    const { data: settingsData } = await supabase
      .from('newsletter_settings')
      .select('value')
      .eq('key', 'cron_schedule')
      .single()

    if (settingsData?.value) {
      setCronSettings(settingsData.value as CronSettings)
    }

    // Fetch template settings
    const { data: templateData } = await supabase
      .from('newsletter_settings')
      .select('value')
      .eq('key', 'email_template')
      .single()

    if (templateData?.value) {
      setTemplateSettings(templateData.value as EmailTemplateSettings)
    }

    setLoading(false)
  }

  async function saveTemplateSettings(newSettings: EmailTemplateSettings) {
    setSavingTemplate(true)
    try {
      const res = await fetch('/api/admin/newsletter-settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ key: 'email_template', value: newSettings }),
      })

      if (res.ok) {
        setTemplateSettings(newSettings)
        setMessage({ type: 'success', text: 'E-Mail-Template gespeichert' })
        setShowTemplateEditor(false)
      } else {
        setMessage({ type: 'error', text: 'Fehler beim Speichern' })
      }
    } catch {
      setMessage({ type: 'error', text: 'Netzwerkfehler' })
    } finally {
      setSavingTemplate(false)
      setTimeout(() => setMessage(null), 3000)
    }
  }

  async function saveCronSettings(newSettings: CronSettings) {
    setSavingCron(true)
    try {
      const res = await fetch('/api/admin/newsletter-settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ key: 'cron_schedule', value: newSettings }),
      })

      if (res.ok) {
        setCronSettings(newSettings)
        setMessage({ type: 'success', text: 'Cron-Einstellungen gespeichert' })
      } else {
        setMessage({ type: 'error', text: 'Fehler beim Speichern' })
      }
    } catch {
      setMessage({ type: 'error', text: 'Netzwerkfehler' })
    } finally {
      setSavingCron(false)
      setTimeout(() => setMessage(null), 3000)
    }
  }

  // Check thumbnail order for selected post
  const checkThumbnailStatus = useCallback(async (postId: string) => {
    setCheckingThumbnails(true)
    try {
      // Get post content
      const { data: post } = await supabase
        .from('generated_posts')
        .select('content')
        .eq('id', postId)
        .single()

      if (!post?.content) {
        setThumbnailStatus({ articlesInContent: 0, thumbnailsFound: 0, matched: 0, mismatched: 0, orphaned: 0, missing: 0, valid: true })
        return
      }

      // Parse content and extract H2 headings (articles)
      let content: Record<string, unknown>
      try {
        content = typeof post.content === 'string' ? JSON.parse(post.content) : post.content
      } catch {
        setThumbnailStatus({ articlesInContent: 0, thumbnailsFound: 0, matched: 0, mismatched: 0, orphaned: 0, missing: 0, valid: true })
        return
      }

      // Extract article headings
      const articles: Array<{ heading: string; queueItemId?: string }> = []
      const traverse = (node: Record<string, unknown>) => {
        if (!node) return
        if (node.type === 'heading' && (node.attrs as Record<string, unknown>)?.level === 2) {
          const extractText = (n: Record<string, unknown>): string => {
            if (n.type === 'text') return (n.text as string) || ''
            if (Array.isArray(n.content)) return (n.content as Record<string, unknown>[]).map(extractText).join('')
            return ''
          }
          const headingText = extractText(node)
          const lowerText = headingText.toLowerCase()
          if (!lowerText.includes('mattes synthese') && !lowerText.includes("mattes' synthese") && !lowerText.includes('synthszr take')) {
            const attrs = node.attrs as Record<string, unknown> | undefined
            articles.push({ heading: headingText, queueItemId: attrs?.queueItemId as string | undefined })
          }
        }
        if (Array.isArray(node.content)) {
          for (const child of node.content as Record<string, unknown>[]) traverse(child)
        }
      }
      traverse(content)

      // Get thumbnails
      const { data: thumbnails } = await supabase
        .from('post_images')
        .select('id, article_index, article_queue_item_id')
        .eq('post_id', postId)
        .eq('image_type', 'article_thumbnail')

      if (!thumbnails || thumbnails.length === 0) {
        setThumbnailStatus({
          articlesInContent: articles.length,
          thumbnailsFound: 0,
          matched: 0,
          mismatched: 0,
          orphaned: 0,
          missing: articles.length,
          valid: articles.length === 0
        })
        return
      }

      // Check matches
      let matched = 0
      let mismatched = 0
      let orphaned = 0

      for (const thumb of thumbnails) {
        if (thumb.article_queue_item_id) {
          const matchIdx = articles.findIndex(a => a.queueItemId === thumb.article_queue_item_id)
          if (matchIdx === thumb.article_index) {
            matched++
          } else if (matchIdx === -1) {
            orphaned++
          } else {
            mismatched++
          }
        } else if (thumb.article_index !== null && thumb.article_index < articles.length) {
          matched++ // Assume index-based match is correct
        } else {
          orphaned++
        }
      }

      const missing = Math.max(0, articles.length - thumbnails.length)
      const valid = mismatched === 0 && orphaned === 0

      setThumbnailStatus({
        articlesInContent: articles.length,
        thumbnailsFound: thumbnails.length,
        matched,
        mismatched,
        orphaned,
        missing,
        valid
      })
    } catch (err) {
      console.error('Error checking thumbnail status:', err)
      setThumbnailStatus(null)
    } finally {
      setCheckingThumbnails(false)
    }
  }, [supabase])

  // Check translation status for selected post
  const checkTranslationStatus = useCallback(async (postId: string) => {
    setCheckingTranslations(true)
    try {
      // Get all active languages
      const { data: languages } = await supabase
        .from('languages')
        .select('code, name')
        .eq('is_active', true)
        .eq('is_default', false)

      if (!languages || languages.length === 0) {
        setTranslationStatus({ pending: 0, completed: 0, total: 0, languages: [] })
        return
      }

      // Get existing translations for this post
      const { data: translations } = await supabase
        .from('content_translations')
        .select('language_code, translation_status')
        .eq('generated_post_id', postId)

      // Get pending queue items for this post
      const { data: queueItems } = await supabase
        .from('translation_queue')
        .select('target_language, status')
        .eq('content_type', 'generated_post')
        .eq('content_id', postId)
        .in('status', ['pending', 'processing'])

      const completedLanguages = new Set(
        translations?.filter(t => t.translation_status === 'completed').map(t => t.language_code) || []
      )
      const pendingLanguages = languages.filter(l => !completedLanguages.has(l.code))

      setTranslationStatus({
        pending: pendingLanguages.length + (queueItems?.length || 0),
        completed: completedLanguages.size,
        total: languages.length,
        languages: pendingLanguages.map(l => l.name),
      })
    } catch (err) {
      console.error('Error checking translation status:', err)
    } finally {
      setCheckingTranslations(false)
    }
  }, [supabase])

  // Check translations and thumbnails when post selection changes
  useEffect(() => {
    if (selectedPostId) {
      checkTranslationStatus(selectedPostId)
      checkThumbnailStatus(selectedPostId)
    }
  }, [selectedPostId, checkTranslationStatus, checkThumbnailStatus])

  async function sendTestEmail() {
    if (!selectedPostId || !testEmail) return

    setSendingTest(true)
    setMessage(null)

    try {
      const res = await fetch('/api/admin/newsletter-send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ postId: selectedPostId, testEmail }),
      })

      const data = await res.json()

      if (res.ok) {
        setMessage({ type: 'success', text: data.message })
      } else {
        setMessage({ type: 'error', text: data.error || 'Fehler beim Senden' })
      }
    } catch {
      setMessage({ type: 'error', text: 'Netzwerkfehler' })
    } finally {
      setSendingTest(false)
    }
  }

  async function sendToAll(bypassWarning = false) {
    if (!selectedPostId) return

    // Check if there are pending translations
    if (!bypassWarning && translationStatus && translationStatus.pending > 0) {
      setShowTranslationWarning(true)
      return
    }

    if (!confirm(`Newsletter wirklich an ${activeSubscriberCount} Subscriber senden?`)) {
      return
    }

    setSending(true)
    setMessage(null)
    setShowTranslationWarning(false)

    try {
      const res = await fetch('/api/admin/newsletter-send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ postId: selectedPostId }),
      })

      const data = await res.json()

      if (res.ok) {
        setMessage({ type: 'success', text: data.message })
        fetchData() // Refresh sends list
      } else {
        setMessage({ type: 'error', text: data.error || 'Fehler beim Senden' })
      }
    } catch {
      setMessage({ type: 'error', text: 'Netzwerkfehler' })
    } finally {
      setSending(false)
    }
  }

  const selectedPost = posts.find(p => p.id === selectedPostId)

  return (
    <div className="p-4 md:p-6 max-w-full">
      <div className="mb-4 flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold tracking-tight flex items-center gap-2">
            <Send className="h-5 w-5" />
            Newsletter versenden
          </h1>
          <p className="text-xs text-muted-foreground">
            {activeSubscriberCount} aktive Subscriber
          </p>
        </div>
        <div className="flex gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => setShowTemplateEditor(true)}
            className="gap-1.5"
          >
            <FileEdit className="h-4 w-4" />
            Templates
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setShowProtokoll(true)}
            className="gap-1.5"
          >
            <History className="h-4 w-4" />
            Protokoll
          </Button>
        </div>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-8">
          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {/* Left: Send Newsletter */}
          <div className="space-y-4">
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm flex items-center gap-2">
                  <FileText className="h-4 w-4" />
                  Artikel auswählen
                </CardTitle>
              </CardHeader>
              <CardContent>
                <select
                  value={selectedPostId}
                  onChange={(e) => setSelectedPostId(e.target.value)}
                  className="w-full rounded border px-3 py-2 text-sm"
                >
                  {posts.map(post => (
                    <option key={post.id} value={post.id}>
                      {post.title}
                    </option>
                  ))}
                </select>

                {selectedPost && (
                  <div className="mt-3 p-3 bg-muted/50 rounded text-xs">
                    <div className="font-medium">{selectedPost.title}</div>
                    <div className="text-muted-foreground mt-1">
                      Veröffentlicht: {new Date(selectedPost.created_at).toLocaleDateString('de-DE')}
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm flex items-center gap-2">
                  <Mail className="h-4 w-4" />
                  Test-E-Mail senden
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="flex gap-2">
                  <input
                    type="email"
                    value={testEmail}
                    onChange={(e) => setTestEmail(e.target.value)}
                    placeholder="test@example.com"
                    className="flex-1 rounded border px-3 py-2 text-sm"
                  />
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={sendTestEmail}
                    disabled={!selectedPostId || !testEmail || sendingTest}
                    className="gap-1.5"
                  >
                    {sendingTest ? (
                      <Loader2 className="h-3 w-3 animate-spin" />
                    ) : (
                      <Send className="h-3 w-3" />
                    )}
                    Test
                  </Button>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm flex items-center gap-2">
                  <Users className="h-4 w-4" />
                  An alle senden
                </CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-xs text-muted-foreground mb-3">
                  Newsletter wird an {activeSubscriberCount} aktive Subscriber gesendet.
                </p>

                {/* Translation Status Indicator */}
                {translationStatus && (
                  <div className={`mb-3 p-2 rounded text-xs flex items-center gap-2 ${
                    translationStatus.pending > 0
                      ? 'bg-amber-50 text-amber-800 dark:bg-amber-950 dark:text-amber-200'
                      : 'bg-green-50 text-green-800 dark:bg-green-950 dark:text-green-200'
                  }`}>
                    {checkingTranslations ? (
                      <Loader2 className="h-3 w-3 animate-spin" />
                    ) : translationStatus.pending > 0 ? (
                      <AlertTriangle className="h-3 w-3" />
                    ) : (
                      <Globe className="h-3 w-3" />
                    )}
                    <span>
                      {checkingTranslations
                        ? 'Prüfe Übersetzungen...'
                        : translationStatus.pending > 0
                          ? `${translationStatus.pending} Übersetzungen ausstehend`
                          : `Alle ${translationStatus.total} Übersetzungen fertig`}
                    </span>
                  </div>
                )}

                {/* Thumbnail Status Indicator */}
                {thumbnailStatus && (
                  <div className={`mb-3 p-2 rounded text-xs flex items-center gap-2 ${
                    !thumbnailStatus.valid
                      ? 'bg-red-50 text-red-800 dark:bg-red-950 dark:text-red-200'
                      : thumbnailStatus.missing > 0
                        ? 'bg-amber-50 text-amber-800 dark:bg-amber-950 dark:text-amber-200'
                        : 'bg-green-50 text-green-800 dark:bg-green-950 dark:text-green-200'
                  }`}>
                    {checkingThumbnails ? (
                      <Loader2 className="h-3 w-3 animate-spin" />
                    ) : !thumbnailStatus.valid ? (
                      <AlertCircle className="h-3 w-3" />
                    ) : thumbnailStatus.missing > 0 ? (
                      <AlertTriangle className="h-3 w-3" />
                    ) : (
                      <Image className="h-3 w-3" />
                    )}
                    <span>
                      {checkingThumbnails
                        ? 'Prüfe Thumbnails...'
                        : !thumbnailStatus.valid
                          ? `Thumbnail-Reihenfolge stimmt nicht (${thumbnailStatus.mismatched} falsch, ${thumbnailStatus.orphaned} verwaist)`
                          : thumbnailStatus.missing > 0
                            ? `${thumbnailStatus.missing} von ${thumbnailStatus.articlesInContent} Thumbnails fehlen`
                            : `Alle ${thumbnailStatus.thumbnailsFound} Thumbnails korrekt zugeordnet`}
                    </span>
                  </div>
                )}

                <Button
                  onClick={() => sendToAll(false)}
                  disabled={!selectedPostId || sending || activeSubscriberCount === 0}
                  className="w-full gap-2"
                >
                  {sending ? (
                    <>
                      <Loader2 className="h-4 w-4 animate-spin" />
                      Wird gesendet...
                    </>
                  ) : (
                    <>
                      <Send className="h-4 w-4" />
                      An alle {activeSubscriberCount} Subscriber senden
                    </>
                  )}
                </Button>
              </CardContent>
            </Card>

            {message && (
              <div className={`flex items-center gap-2 p-3 rounded text-sm ${
                message.type === 'success'
                  ? 'bg-green-50 text-green-800 dark:bg-green-950 dark:text-green-200'
                  : 'bg-red-50 text-red-800 dark:bg-red-950 dark:text-red-200'
              }`}>
                {message.type === 'success' ? (
                  <CheckCircle className="h-4 w-4 shrink-0" />
                ) : (
                  <AlertCircle className="h-4 w-4 shrink-0" />
                )}
                {message.text}
              </div>
            )}
          </div>

          {/* Right: Cron Settings */}
          <div className="space-y-4">
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm flex items-center gap-2">
                  <Settings className="h-4 w-4" />
                  Automatischer Versand
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="flex items-center justify-between">
                  <div>
                    <div className="text-sm font-medium">Cron-Job aktivieren</div>
                    <div className="text-xs text-muted-foreground">
                      Täglicher Versand der aktuellen News
                    </div>
                  </div>
                  <Switch
                    checked={cronSettings.enabled}
                    onCheckedChange={(checked) => {
                      const newSettings = { ...cronSettings, enabled: checked }
                      saveCronSettings(newSettings)
                    }}
                    disabled={savingCron}
                  />
                </div>

                <div className="pt-2 border-t">
                  <label className="text-xs text-muted-foreground block mb-2">
                    Versandzeit (täglich)
                  </label>
                  <div className="flex items-center gap-2">
                    <select
                      value={cronSettings.hour}
                      onChange={(e) => {
                        const newSettings = { ...cronSettings, hour: parseInt(e.target.value) }
                        setCronSettings(newSettings)
                      }}
                      className="rounded border px-3 py-2 text-sm w-20"
                      disabled={!cronSettings.enabled}
                    >
                      {Array.from({ length: 24 }, (_, i) => (
                        <option key={i} value={i}>
                          {i.toString().padStart(2, '0')}
                        </option>
                      ))}
                    </select>
                    <span className="text-lg">:</span>
                    <select
                      value={cronSettings.minute}
                      onChange={(e) => {
                        const newSettings = { ...cronSettings, minute: parseInt(e.target.value) }
                        setCronSettings(newSettings)
                      }}
                      className="rounded border px-3 py-2 text-sm w-20"
                      disabled={!cronSettings.enabled}
                    >
                      {[0, 15, 30, 45].map(m => (
                        <option key={m} value={m}>
                          {m.toString().padStart(2, '0')}
                        </option>
                      ))}
                    </select>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => saveCronSettings(cronSettings)}
                      disabled={!cronSettings.enabled || savingCron}
                      className="ml-2"
                    >
                      {savingCron ? (
                        <Loader2 className="h-3 w-3 animate-spin" />
                      ) : (
                        'Speichern'
                      )}
                    </Button>
                  </div>
                </div>

                {cronSettings.enabled && (
                  <div className="text-xs text-muted-foreground bg-muted/50 p-2 rounded">
                    <Clock className="h-3 w-3 inline mr-1" />
                    Nächster Versand: täglich um {cronSettings.hour.toString().padStart(2, '0')}:{cronSettings.minute.toString().padStart(2, '0')} Uhr
                  </div>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm flex items-center gap-2">
                  <Clock className="h-4 w-4" />
                  Letzte Versendungen
                </CardTitle>
              </CardHeader>
              <CardContent className="p-0">
                {sends.length === 0 ? (
                  <div className="p-4 text-center text-xs text-muted-foreground">
                    Noch keine Newsletter versendet
                  </div>
                ) : (
                  <div className="divide-y max-h-[200px] overflow-y-auto">
                    {sends.slice(0, 5).map(send => (
                      <div key={send.id} className="px-3 py-2 hover:bg-muted/50">
                        <div className="flex items-center justify-between gap-2">
                          <div className="text-xs font-medium truncate">{send.subject}</div>
                          <Badge variant="outline" className="text-[10px] shrink-0">
                            {send.recipient_count}
                          </Badge>
                        </div>
                        <div className="text-[10px] text-muted-foreground mt-0.5">
                          {new Date(send.sent_at).toLocaleString('de-DE')}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          </div>
        </div>
      )}

      {/* Protokoll Modal */}
      {showProtokoll && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-background rounded-lg shadow-xl max-w-lg w-full max-h-[80vh] overflow-hidden">
            <div className="p-4 border-b flex items-center justify-between">
              <h2 className="text-lg font-semibold flex items-center gap-2">
                <History className="h-5 w-5" />
                Versand-Protokoll
              </h2>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setShowProtokoll(false)}
              >
                &times;
              </Button>
            </div>
            <div className="overflow-y-auto max-h-[60vh]">
              {sends.length === 0 ? (
                <div className="p-8 text-center text-muted-foreground">
                  Noch keine Newsletter versendet
                </div>
              ) : (
                <table className="w-full text-sm">
                  <thead className="bg-muted/50 sticky top-0">
                    <tr>
                      <th className="text-left p-3 font-medium">Datum</th>
                      <th className="text-left p-3 font-medium">Betreff</th>
                      <th className="text-right p-3 font-medium">Empfänger</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y">
                    {sends.slice(0, 10).map(send => (
                      <tr key={send.id} className="hover:bg-muted/30">
                        <td className="p-3 text-xs text-muted-foreground whitespace-nowrap">
                          {new Date(send.sent_at).toLocaleDateString('de-DE')}
                        </td>
                        <td className="p-3 text-xs font-medium truncate max-w-[200px]">
                          {send.subject}
                        </td>
                        <td className="p-3 text-right">
                          <Badge variant="secondary" className="text-xs">
                            {send.recipient_count}
                          </Badge>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
            <div className="p-3 border-t bg-muted/30 text-xs text-muted-foreground text-center">
              Zeigt die letzten 10 Aussendungen
            </div>
          </div>
        </div>
      )}

      {/* Template Editor Modal */}
      {showTemplateEditor && (
        <TemplateEditorModal
          settings={templateSettings}
          onSave={saveTemplateSettings}
          onClose={() => setShowTemplateEditor(false)}
          saving={savingTemplate}
          selectedPostTitle={selectedPost?.title}
        />
      )}

      {/* Translation Warning Modal */}
      {showTranslationWarning && translationStatus && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-background rounded-lg shadow-xl max-w-md w-full">
            <div className="p-4 border-b flex items-center gap-3">
              <div className="p-2 rounded-full bg-amber-100 dark:bg-amber-900">
                <AlertTriangle className="h-5 w-5 text-amber-600 dark:text-amber-400" />
              </div>
              <div>
                <h2 className="text-lg font-semibold">Übersetzungen ausstehend</h2>
                <p className="text-sm text-muted-foreground">
                  Nicht alle Übersetzungen sind fertig
                </p>
              </div>
            </div>

            <div className="p-4 space-y-3">
              <p className="text-sm">
                Für diesen Artikel fehlen noch <strong>{translationStatus.pending}</strong> von{' '}
                <strong>{translationStatus.total}</strong> Übersetzungen:
              </p>

              {translationStatus.languages.length > 0 && (
                <div className="bg-muted/50 p-3 rounded text-xs space-y-1">
                  {translationStatus.languages.slice(0, 5).map((lang, i) => (
                    <div key={i} className="flex items-center gap-2">
                      <span className="w-2 h-2 rounded-full bg-amber-500" />
                      {lang}
                    </div>
                  ))}
                  {translationStatus.languages.length > 5 && (
                    <div className="text-muted-foreground">
                      ... und {translationStatus.languages.length - 5} weitere
                    </div>
                  )}
                </div>
              )}

              <p className="text-xs text-muted-foreground">
                Du kannst trotzdem senden - Subscriber mit fehlenden Sprachen erhalten den deutschen Newsletter.
              </p>
            </div>

            <div className="p-4 border-t flex justify-end gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => setShowTranslationWarning(false)}
              >
                Abbrechen
              </Button>
              <Button
                size="sm"
                variant="default"
                onClick={() => sendToAll(true)}
                className="gap-1.5"
              >
                <Send className="h-3 w-3" />
                Trotzdem senden
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

// Template Editor Modal Component
function TemplateEditorModal({
  settings,
  onSave,
  onClose,
  saving,
  selectedPostTitle,
}: {
  settings: EmailTemplateSettings
  onSave: (settings: EmailTemplateSettings) => void
  onClose: () => void
  saving: boolean
  selectedPostTitle?: string
}) {
  const [localSettings, setLocalSettings] = useState(settings)

  // Preview the subject with variables replaced
  const previewSubject = localSettings.subjectTemplate.replace(
    /\{\{title\}\}/g,
    selectedPostTitle || '[Artikel-Titel]'
  )

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-background rounded-lg shadow-xl max-w-lg w-full max-h-[80vh] overflow-hidden">
        <div className="p-4 border-b flex items-center justify-between">
          <h2 className="text-lg font-semibold flex items-center gap-2">
            <FileEdit className="h-5 w-5" />
            E-Mail Templates
          </h2>
          <Button variant="ghost" size="sm" onClick={onClose}>
            &times;
          </Button>
        </div>

        <div className="p-4 space-y-4 overflow-y-auto max-h-[60vh]">
          {/* Subject Template */}
          <div className="space-y-2">
            <label className="text-sm font-medium block">
              Betreff-Template
            </label>
            <input
              type="text"
              value={localSettings.subjectTemplate}
              onChange={(e) =>
                setLocalSettings({ ...localSettings, subjectTemplate: e.target.value })
              }
              className="w-full rounded border px-3 py-2 text-sm"
              placeholder="{{title}}"
            />
            <div className="text-xs text-muted-foreground">
              Verfügbare Variablen: <code className="bg-muted px-1 rounded">{'{{title}}'}</code> = Artikel-Titel
            </div>
            {/* Preview */}
            <div className="bg-muted/50 p-2 rounded text-xs">
              <span className="text-muted-foreground">Vorschau: </span>
              <span className="font-medium">{previewSubject}</span>
            </div>
          </div>

          {/* Footer Text */}
          <div className="space-y-2">
            <label className="text-sm font-medium block">
              E-Mail Footer
            </label>
            <textarea
              value={localSettings.footerText}
              onChange={(e) =>
                setLocalSettings({ ...localSettings, footerText: e.target.value })
              }
              rows={3}
              className="w-full rounded border px-3 py-2 text-sm resize-none"
              placeholder="Footer-Text..."
            />
            <div className="text-xs text-muted-foreground">
              Dieser Text erscheint am Ende jeder Newsletter-E-Mail.
            </div>
          </div>
        </div>

        <div className="p-4 border-t flex justify-end gap-2">
          <Button variant="outline" size="sm" onClick={onClose}>
            Abbrechen
          </Button>
          <Button
            size="sm"
            onClick={() => onSave(localSettings)}
            disabled={saving}
            className="gap-1.5"
          >
            {saving ? (
              <Loader2 className="h-3 w-3 animate-spin" />
            ) : (
              <CheckCircle className="h-3 w-3" />
            )}
            Speichern
          </Button>
        </div>
      </div>
    </div>
  )
}

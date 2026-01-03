'use client'

import { useEffect, useState } from 'react'
import { Send, FileText, Mail, Loader2, CheckCircle, AlertCircle, Clock, Users } from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { createClient } from '@/lib/supabase/client'

interface Post {
  id: string
  title: string
  slug: string
  published: boolean
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

  const supabase = createClient()

  useEffect(() => {
    fetchData()
  }, [])

  async function fetchData() {
    setLoading(true)

    // Fetch published posts
    const { data: postsData } = await supabase
      .from('generated_posts')
      .select('id, title, slug, published, created_at')
      .eq('published', true)
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

    setLoading(false)
  }

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

  async function sendToAll() {
    if (!selectedPostId) return

    if (!confirm(`Newsletter wirklich an ${activeSubscriberCount} Subscriber senden?`)) {
      return
    }

    setSending(true)
    setMessage(null)

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
      <div className="mb-4">
        <h1 className="text-xl font-bold tracking-tight flex items-center gap-2">
          <Send className="h-5 w-5" />
          Newsletter versenden
        </h1>
        <p className="text-xs text-muted-foreground">
          {activeSubscriberCount} aktive Subscriber
        </p>
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
                <Button
                  onClick={sendToAll}
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

          {/* Right: Send History */}
          <div>
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm flex items-center gap-2">
                  <Clock className="h-4 w-4" />
                  Versand-Historie
                </CardTitle>
              </CardHeader>
              <CardContent className="p-0">
                {sends.length === 0 ? (
                  <div className="p-4 text-center text-xs text-muted-foreground">
                    Noch keine Newsletter versendet
                  </div>
                ) : (
                  <div className="divide-y max-h-[400px] overflow-y-auto">
                    {sends.map(send => (
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
    </div>
  )
}

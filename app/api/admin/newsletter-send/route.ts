import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { getSession } from '@/lib/auth/session'
import { getResend, FROM_EMAIL, BASE_URL } from '@/lib/resend/client'
import { NewsletterEmail } from '@/lib/resend/templates/newsletter'
import { render } from '@react-email/components'

// Lazy initialization to avoid build-time errors
function getSupabase() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  )
}

// Check admin auth (via session or cron secret header for Vercel cron jobs)
async function isAuthenticated(request?: NextRequest): Promise<boolean> {
  // Check for cron secret in header (for scheduled tasks on Vercel)
  if (request) {
    const authHeader = request.headers.get('authorization')
    if (authHeader === `Bearer ${process.env.CRON_SECRET}`) {
      return true
    }
  }

  // Check for session
  const session = await getSession()
  return !!session
}

// GET: List newsletter sends
export async function GET() {
  const session = await getSession()
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const supabase = getSupabase()

    const { data, error } = await supabase
      .from('newsletter_sends')
      .select('*, generated_posts(title, slug)')
      .order('sent_at', { ascending: false })
      .limit(50)

    if (error) {
      console.error('Fetch newsletter sends error:', error)
      return NextResponse.json({ error: 'Failed to fetch sends' }, { status: 500 })
    }

    return NextResponse.json({ sends: data })
  } catch (error) {
    console.error('Newsletter sends GET error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

// POST: Send newsletter
export async function POST(request: NextRequest) {
  if (!(await isAuthenticated(request))) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const supabase = getSupabase()

    const body = await request.json()
    const { postId, testEmail } = body

    if (!postId) {
      return NextResponse.json({ error: 'Post ID required' }, { status: 400 })
    }

    // Fetch the post with cover image
    const { data: post, error: postError } = await supabase
      .from('generated_posts')
      .select('*, post_images!cover_image_id(image_url)')
      .eq('id', postId)
      .single()

    if (postError || !post) {
      return NextResponse.json({ error: 'Post not found' }, { status: 404 })
    }

    // Extract cover image URL
    const coverImageUrl = (post.post_images as { image_url?: string } | null)?.image_url || null

    // Fetch email template settings
    const { data: templateSettings } = await supabase
      .from('newsletter_settings')
      .select('value')
      .eq('key', 'email_template')
      .single()

    const templates = templateSettings?.value as { subjectTemplate?: string; footerText?: string } || {}
    const subjectTemplate = templates.subjectTemplate || '{{title}}'
    const footerText = templates.footerText || 'Du erhältst diese E-Mail, weil du den Synthszr Newsletter abonniert hast.'

    // Apply template variables
    const subject = subjectTemplate.replace(/\{\{title\}\}/g, post.title)
    const previewText = post.excerpt || ''
    const postUrl = `${BASE_URL}/posts/${post.slug}`
    const postDate = post.created_at

    // If testEmail, send only to that address
    if (testEmail) {
      const html = await render(
        NewsletterEmail({
          subject,
          previewText,
          content: generateEmailContent(post),
          postUrl,
          unsubscribeUrl: `${BASE_URL}/newsletter/unsubscribe?id=test`,
          footerText,
          coverImageUrl,
          postDate,
          baseUrl: BASE_URL,
        })
      )

      await getResend().emails.send({
        from: FROM_EMAIL,
        to: testEmail,
        subject: `[TEST] ${subject}`,
        html,
      })

      return NextResponse.json({
        success: true,
        message: `Test-E-Mail an ${testEmail} gesendet`,
      })
    }

    // Get all active subscribers
    const { data: subscribers, error: subError } = await supabase
      .from('subscribers')
      .select('id, email')
      .eq('status', 'active')

    if (subError || !subscribers || subscribers.length === 0) {
      return NextResponse.json({
        error: 'Keine aktiven Subscriber gefunden',
      }, { status: 400 })
    }

    // Send to all subscribers using Resend batch
    const emailPromises = subscribers.map(async (subscriber) => {
      const unsubscribeUrl = `${BASE_URL}/api/newsletter/unsubscribe?id=${subscriber.id}`
      const html = await render(
        NewsletterEmail({
          subject,
          previewText,
          content: generateEmailContent(post),
          postUrl,
          unsubscribeUrl,
          footerText,
          coverImageUrl,
          postDate,
          baseUrl: BASE_URL,
        })
      )

      return getResend().emails.send({
        from: FROM_EMAIL,
        to: subscriber.email,
        subject,
        html,
      })
    })

    const results = await Promise.allSettled(emailPromises)
    const successCount = results.filter(r => r.status === 'fulfilled').length
    const failCount = results.filter(r => r.status === 'rejected').length

    // Log the send
    await supabase.from('newsletter_sends').insert({
      post_id: postId,
      subject,
      preview_text: previewText,
      recipient_count: successCount,
      status: failCount === 0 ? 'sent' : (successCount === 0 ? 'failed' : 'sent'),
    })

    return NextResponse.json({
      success: true,
      message: `Newsletter an ${successCount} Subscriber gesendet`,
      successCount,
      failCount,
    })
  } catch (error) {
    console.error('Newsletter send error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

// Convert post content to email-friendly HTML
function generateEmailContent(post: { content?: unknown; excerpt?: string }): string {
  const rawContent = post.content

  // If content is a JSON string, parse it first
  if (typeof rawContent === 'string') {
    try {
      const parsed = JSON.parse(rawContent)
      if (parsed && typeof parsed === 'object' && parsed.type === 'doc') {
        return convertTiptapToHtml(parsed as TiptapDoc)
      }
    } catch {
      // Not JSON, might be HTML string - use as is
      return rawContent
    }
    // If we couldn't parse it and it's a string, return as is
    return rawContent
  }

  // If content is TipTap JSON object, convert to basic HTML
  if (rawContent && typeof rawContent === 'object') {
    return convertTiptapToHtml(rawContent as TiptapDoc)
  }

  // Fallback to excerpt
  return post.excerpt || ''
}

interface TiptapNode {
  type: string
  content?: TiptapNode[]
  text?: string
  marks?: Array<{ type: string; attrs?: Record<string, string> }>
  attrs?: Record<string, string>
}

interface TiptapDoc {
  type: string
  content?: TiptapNode[]
}

function convertTiptapToHtml(doc: TiptapDoc): string {
  if (!doc.content) return ''

  return doc.content.map((node: TiptapNode) => {
    switch (node.type) {
      case 'paragraph':
        return `<p>${renderContent(node.content)}</p>`
      case 'heading':
        const level = node.attrs?.level || 2
        return `<h${level}>${renderContent(node.content)}</h${level}>`
      case 'bulletList':
        return `<ul>${node.content?.map(li => `<li>${renderContent(li.content?.[0]?.content)}</li>`).join('')}</ul>`
      case 'orderedList':
        return `<ol>${node.content?.map(li => `<li>${renderContent(li.content?.[0]?.content)}</li>`).join('')}</ol>`
      case 'blockquote':
        return `<blockquote>${renderContent(node.content)}</blockquote>`
      case 'horizontalRule':
        return '<hr />'
      default:
        return renderContent(node.content)
    }
  }).join('\n')
}

function renderContent(content?: TiptapNode[]): string {
  if (!content) return ''

  return content.map(node => {
    if (node.type === 'text') {
      let text = node.text || ''

      // Apply marks
      if (node.marks) {
        for (const mark of node.marks) {
          switch (mark.type) {
            case 'bold':
              text = `<strong>${text}</strong>`
              break
            case 'italic':
              text = `<em>${text}</em>`
              break
            case 'link':
              text = `<a href="${mark.attrs?.href || '#'}">${text}</a>`
              break
          }
        }
      }

      return text
    }

    return ''
  }).join('')
}

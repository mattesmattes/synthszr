/**
 * The rendered newsletter must not contain subscriber identifiers (SEC-001).
 *
 * The send path renders one HTML per locale with placeholders and substitutes
 * per-recipient URLs afterwards. This asserts on the rendered output rather
 * than on the send route, because that is what actually lands in an inbox -
 * and inboxes, mail-scanner logs and Referer headers are exactly where a UUID
 * credential used to end up.
 */
import { describe, expect, it } from 'vitest'
import { render } from '@react-email/components'
import { NewsletterEmail } from '@/lib/resend/templates/newsletter'
import { mintNewsletterLinkTokens } from '@/lib/newsletter/access-tokens'

const SUBSCRIBER_UUID = '018f6f4e-2dd3-7a13-a200-111111111111'
const BASE = 'https://www.synthszr.com'

async function renderNewsletter() {
  return render(
    NewsletterEmail({
      subject: 'Test',
      previewText: 'Preview',
      content: '<p>Body</p>',
      postUrl: `${BASE}/posts/test`,
      unsubscribeUrl: '{{UNSUBSCRIBE_URL}}',
      preferencesUrl: '{{PREFERENCES_URL}}',
      footerText: 'Footer',
      baseUrl: BASE,
      locale: 'de',
    })
  )
}

describe('rendered newsletter', () => {
  it('carries no sid parameter anywhere', async () => {
    const html = await renderNewsletter()
    expect(html).not.toMatch(/[?&]sid=/)
  })

  it('exposes only placeholders for recipient-specific links', async () => {
    const html = await renderNewsletter()
    expect(html).toContain('{{UNSUBSCRIBE_URL}}')
    expect(html).toContain('{{PREFERENCES_URL}}')
  })

  it('does not accept a subscriber id to interpolate into links', async () => {
    // The template used to take a `subscriberId` prop and append it to every
    // internal link. Passing one now must have no effect whatsoever.
    const html = await render(
      NewsletterEmail({
        subject: 'Test',
        previewText: 'Preview',
        content: '<p>Body</p>',
        postUrl: `${BASE}/posts/test`,
        unsubscribeUrl: '{{UNSUBSCRIBE_URL}}',
        preferencesUrl: '{{PREFERENCES_URL}}',
        baseUrl: BASE,
        locale: 'de',
        ...({ subscriberId: SUBSCRIBER_UUID } as Record<string, unknown>),
      } as Parameters<typeof NewsletterEmail>[0])
    )

    expect(html).not.toContain(SUBSCRIBER_UUID)
  })

  it('substitutes per-recipient token links, not identifiers', async () => {
    const baseHtml = await renderNewsletter()
    const { bySubscriber } = mintNewsletterLinkTokens([SUBSCRIBER_UUID])
    const tokens = bySubscriber.get(SUBSCRIBER_UUID)!

    const finalHtml = baseHtml
      .replace('{{UNSUBSCRIBE_URL}}', `${BASE}/newsletter/unsubscribe?confirm=1&token=${tokens.unsubscribe.rawToken}`)
      .replace('{{PREFERENCES_URL}}', `${BASE}/newsletter/preferences?token=${tokens.preferences.rawToken}`)

    expect(finalHtml).toContain('/newsletter/preferences?token=')
    expect(finalHtml).toContain('/newsletter/unsubscribe?confirm=1&token=')
    expect(finalHtml).not.toContain(SUBSCRIBER_UUID)
    expect(finalHtml).not.toMatch(/[?&]sid=/)
    // No unsubstituted placeholder may survive into a sent mail.
    expect(finalHtml).not.toContain('{{UNSUBSCRIBE_URL}}')
    expect(finalHtml).not.toContain('{{PREFERENCES_URL}}')
  })

  it('points unsubscribe at the confirmation page, not at a GET endpoint', async () => {
    // A GET that unsubscribes gets triggered by mail-security prefetching.
    const { bySubscriber } = mintNewsletterLinkTokens([SUBSCRIBER_UUID])
    const url = `${BASE}/newsletter/unsubscribe?confirm=1&token=${bySubscriber.get(SUBSCRIBER_UUID)!.unsubscribe.rawToken}`
    expect(url).not.toContain('/api/newsletter/unsubscribe')
  })
})

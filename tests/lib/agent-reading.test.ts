import { describe, expect, it } from 'vitest'
import { JSDOM } from 'jsdom'
import { render } from '@react-email/components'
import { ALL_LOCALES } from '@/lib/i18n/config'
import { SITE_URL } from '@/lib/seo/site'
import { agentReadingCopy, agentReadingMarkdown, agentReadingPageUrl } from '@/lib/agents/reading'
import { NewsletterEmail } from '@/lib/resend/templates/newsletter'

describe('localized public agent guide', () => {
  it.each(ALL_LOCALES)('has a translated guide and public links for %s', (locale) => {
    const copy = agentReadingCopy(locale)
    expect(agentReadingPageUrl(locale)).toBe(`${SITE_URL}/${locale}/agents`)
    if (locale !== 'en') expect(copy.title).not.toBe(agentReadingCopy('en').title)
    expect(copy.example).not.toMatch(/\{(?:editionUrl|skillUrl)\}/)
    expect(copy.example).toContain(`${SITE_URL}/agents/skill.md`)
    expect(agentReadingMarkdown(locale)).toContain(`# ${copy.title}`)
    expect(agentReadingMarkdown(locale)).toContain(`${SITE_URL}/agents/skill.md?src=agentpage`)
  })

  it.each(['../../example.com', 'en?ct=private', '//example.com', '__proto__', 'constructor'])('keeps invalid locale %s out of public URLs and prompts', (locale) => {
    expect(agentReadingPageUrl(locale)).toBe(`${SITE_URL}/de/agents`)
    expect(agentReadingCopy(locale)).toEqual(agentReadingCopy('de'))
    expect(agentReadingMarkdown(locale)).toBe(agentReadingMarkdown('de'))
  })

  it.each(ALL_LOCALES)('links to the guide only in the %s newsletter footer without sharing recipient credentials', async (locale) => {
    const html = await render(NewsletterEmail({
      subject: 'Public edition',
      content: '<p>Public news</p>',
      postUrl: `${SITE_URL}/de/posts/example?ct=PRIVATE_COMMENT_TOKEN`,
      unsubscribeUrl: `${SITE_URL}/newsletter/unsubscribe?token=PRIVATE_UNSUB_TOKEN`,
      preferencesUrl: `${SITE_URL}/newsletter/preferences?token=PRIVATE_PREF_TOKEN`,
      baseUrl: SITE_URL,
      locale,
    }))
    const dom = new JSDOM(html)
    try {
      const doc = dom.window.document
      expect(doc.querySelector('#agent-reading')).toBeNull()
      const guideLinks = doc.querySelectorAll(`a[href="${agentReadingPageUrl(locale)}"]`)
      expect(guideLinks).toHaveLength(1)
      const guideLink = guideLinks[0]
      expect(guideLink.closest('#newsletter-footer')).not.toBeNull()
      expect(guideLink.textContent).toBe(agentReadingCopy(locale).navLabel)
      expect(doc.body.textContent).not.toContain(agentReadingCopy(locale).title)
      expect(doc.body.textContent).not.toContain('npx skills add')
      for (const token of ['PRIVATE_COMMENT_TOKEN', 'PRIVATE_UNSUB_TOKEN', 'PRIVATE_PREF_TOKEN']) {
        expect(html).toContain(token)
        expect(guideLink.outerHTML).not.toContain(token)
      }
    } finally {
      dom.window.close()
    }
  })
})

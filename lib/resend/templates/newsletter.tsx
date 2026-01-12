import * as React from 'react'
import {
  Html,
  Head,
  Body,
  Container,
  Section,
  Text,
  Button,
  Hr,
  Link,
  Heading,
  Img,
  Preview,
} from '@react-email/components'

interface NewsletterEmailProps {
  subject: string
  previewText?: string
  content: string
  postUrl: string
  unsubscribeUrl: string
  preferencesUrl?: string
  footerText?: string
  coverImageUrl?: string | null
  postDate?: string
  baseUrl?: string
}

export function NewsletterEmail({
  subject,
  previewText,
  content,
  postUrl,
  unsubscribeUrl,
  preferencesUrl,
  footerText = 'Du erhältst diese E-Mail, weil du den Synthszr Newsletter abonniert hast.',
  coverImageUrl,
  postDate,
  baseUrl = 'https://synthszr.vercel.app',
}: NewsletterEmailProps) {
  const formattedDate = postDate
    ? new Date(postDate).toLocaleDateString('de-DE', {
        weekday: 'long',
        day: '2-digit',
        month: '2-digit',
        year: 'numeric',
      })
    : null

  return (
    <Html>
      <Head>
        <meta name="viewport" content="width=device-width, initial-scale=1.0" />
        <meta name="x-apple-disable-message-reformatting" />
        <style>
          {`
            @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=Source+Serif+4:ital,wght@0,400;0,600;1,400&display=swap');

            .content-area h2 {
              font-family: 'Inter', -apple-system, BlinkMacSystemFont, sans-serif;
              font-size: 48px !important;
              font-weight: 600;
              color: #1a1a1a;
              margin-top: 48px;
              margin-bottom: 20px;
              line-height: 1.15;
            }

            .content-area h3 {
              font-family: 'Inter', -apple-system, BlinkMacSystemFont, sans-serif;
              font-size: 44px !important;
              font-weight: 600;
              color: #1a1a1a;
              margin-top: 40px;
              margin-bottom: 16px;
              line-height: 1.2;
            }

            .content-area p {
              font-family: 'Source Serif 4', Georgia, serif;
              font-size: 40px !important;
              line-height: 1.45;
              color: #374151;
              margin-bottom: 24px;
            }

            .content-area ul, .content-area ol {
              font-family: 'Source Serif 4', Georgia, serif;
              font-size: 40px !important;
              line-height: 1.45;
              color: #374151;
              margin-bottom: 24px;
              padding-left: 40px;
            }

            .content-area li {
              margin-bottom: 16px;
            }

            .content-area blockquote {
              border-left: 5px solid #CCFF00;
              padding-left: 24px;
              margin: 40px 0;
              font-style: italic;
              color: #4b5563;
              font-size: 40px !important;
            }

            .content-area a {
              color: #1a1a1a;
              text-decoration: underline;
            }

            .content-area strong {
              font-weight: 600;
              color: #1a1a1a;
            }
          `}
        </style>
      </Head>
      {previewText && <Preview>{previewText}</Preview>}
      <Body style={main}>
        <Container style={container}>
          {/* Header with Logo */}
          <Section style={headerSection}>
            <Img
              src={`${baseUrl}/logo-nl.png`}
              alt="Synthszr"
              width="100"
              height="29"
              style={logo}
            />
          </Section>

          {/* Cover Image - 1:1 square, same width as text column */}
          {coverImageUrl && (
            <Section style={coverSection}>
              <Img
                src={coverImageUrl}
                alt={subject}
                width="327"
                height="327"
                style={coverImage}
              />
            </Section>
          )}

          {/* Main Content */}
          <Section style={contentSection}>
            {/* Date Tag */}
            {formattedDate && (
              <Text style={dateTag}>
                Update vom {formattedDate}
              </Text>
            )}

            {/* Title */}
            <Heading style={heading}>{subject}</Heading>

            {/* Excerpt */}
            {previewText && <Text style={excerpt}>{previewText}</Text>}

            <Hr style={hr} />

            {/* Article Content */}
            <div
              className="content-area"
              style={contentStyle}
              dangerouslySetInnerHTML={{ __html: content }}
            />

            <Hr style={hr} />

            {/* CTA Button */}
            <Button style={button} href={postUrl}>
              Artikel auf synthszr.com lesen
            </Button>
          </Section>

          {/* Footer */}
          <Section style={footerSection}>
            <Link href="https://oh-so.com">
              <Img
                src={`${baseUrl}/oh-so-logo.png`}
                alt="OH-SO"
                width="32"
                height="32"
                style={footerLogo}
              />
            </Link>
            <Text style={footer}>
              {footerText}
            </Text>
            <Text style={footerLinks}>
              <Link href={unsubscribeUrl} style={footerLink}>
                Abmelden
              </Link>
              {preferencesUrl && (
                <>
                  <span style={footerDivider}>•</span>
                  <Link href={preferencesUrl} style={footerLink}>
                    Sprache ändern
                  </Link>
                </>
              )}
              <span style={footerDivider}>•</span>
              <Link href={`${baseUrl}/impressum`} style={footerLink}>
                Impressum
              </Link>
            </Text>
          </Section>
        </Container>
      </Body>
    </Html>
  )
}

// Styles matching the blog design
const main = {
  backgroundColor: '#f8f9fa',
  fontFamily: "'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
}

const container = {
  backgroundColor: '#ffffff',
  margin: '0 auto',
  maxWidth: '375px',
}

const headerSection = {
  padding: '24px 24px 20px',
  textAlign: 'center' as const,
}

const logo = {
  margin: '0 auto',
}

const coverSection = {
  padding: '0 24px', // Same horizontal padding as content section
}

const coverImage = {
  display: 'block',
  width: '100%',
  height: 'auto',
}

const contentSection = {
  padding: '24px',
}

const dateTag = {
  display: 'inline-block',
  backgroundColor: '#CCFF00',
  color: '#000000',
  fontFamily: "'SF Mono', Monaco, monospace",
  fontSize: '13px',
  fontWeight: '500',
  letterSpacing: '0.5px',
  padding: '6px 12px',
  marginBottom: '16px',
}

const heading = {
  fontFamily: "'Inter', -apple-system, BlinkMacSystemFont, sans-serif",
  fontSize: '52px',
  fontWeight: '700',
  color: '#1a1a1a',
  lineHeight: '1.1',
  margin: '0 0 20px',
}

const excerpt = {
  fontFamily: "'Source Serif 4', Georgia, serif",
  fontSize: '36px',
  lineHeight: '1.4',
  color: '#6b7280',
  fontStyle: 'italic',
  margin: '0 0 28px',
}

const contentStyle = {
  fontFamily: "'Source Serif 4', Georgia, serif",
  fontSize: '40px',
  lineHeight: '1.45',
  color: '#374151',
}

const button = {
  backgroundColor: '#000000',
  borderRadius: '0',
  color: '#ffffff',
  fontFamily: "'Inter', -apple-system, BlinkMacSystemFont, sans-serif",
  fontSize: '16px',
  fontWeight: '600',
  textDecoration: 'none',
  textAlign: 'center' as const,
  display: 'block',
  width: '100%',
  padding: '16px 0',
  marginTop: '24px',
}

const hr = {
  borderColor: '#e5e7eb',
  borderTop: '1px solid #e5e7eb',
  margin: '24px 0',
}

const footerSection = {
  padding: '32px',
  backgroundColor: '#f8f9fa',
  textAlign: 'center' as const,
}

const footerLogo = {
  margin: '0 auto 16px',
  opacity: 0.6,
}

const footer = {
  fontFamily: "'Inter', -apple-system, BlinkMacSystemFont, sans-serif",
  fontSize: '14px',
  color: '#9ca3af',
  lineHeight: '1.5',
  margin: '0 0 8px',
}

const footerLinks = {
  fontFamily: "'Inter', -apple-system, BlinkMacSystemFont, sans-serif",
  fontSize: '14px',
  color: '#9ca3af',
  margin: '0',
}

const footerLink = {
  color: '#9ca3af',
  textDecoration: 'underline',
}

const footerDivider = {
  margin: '0 8px',
  color: '#d1d5db',
}

export default NewsletterEmail

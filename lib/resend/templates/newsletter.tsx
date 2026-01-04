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
        <style>
          {`
            @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=Source+Serif+4:ital,wght@0,400;0,600;1,400&display=swap');

            .content-area h2 {
              font-family: 'Inter', -apple-system, BlinkMacSystemFont, sans-serif;
              font-size: 18px;
              font-weight: 600;
              color: #1a1a1a;
              margin-top: 32px;
              margin-bottom: 12px;
              line-height: 1.3;
            }

            .content-area h3 {
              font-family: 'Inter', -apple-system, BlinkMacSystemFont, sans-serif;
              font-size: 16px;
              font-weight: 600;
              color: #1a1a1a;
              margin-top: 24px;
              margin-bottom: 8px;
            }

            .content-area p {
              font-family: 'Source Serif 4', Georgia, serif;
              font-size: 16px;
              line-height: 1.7;
              color: #374151;
              margin-bottom: 16px;
            }

            .content-area ul, .content-area ol {
              font-family: 'Source Serif 4', Georgia, serif;
              font-size: 16px;
              line-height: 1.7;
              color: #374151;
              margin-bottom: 16px;
              padding-left: 24px;
            }

            .content-area li {
              margin-bottom: 8px;
            }

            .content-area blockquote {
              border-left: 3px solid #CCFF00;
              padding-left: 16px;
              margin: 24px 0;
              font-style: italic;
              color: #4b5563;
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
              src={`${baseUrl}/synthszr-logo.svg`}
              alt="Synthszr"
              width="120"
              height="32"
              style={logo}
            />
          </Section>

          {/* Cover Image with centered logo overlay */}
          {coverImageUrl && (
            <Section style={coverSection}>
              <div style={coverImageContainer}>
                <Img
                  src={coverImageUrl}
                  alt={subject}
                  width="600"
                  style={coverImage}
                />
              </div>
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
            <Img
              src={`${baseUrl}/oh-so-logo.svg`}
              alt="OH-SO"
              width="80"
              height="32"
              style={footerLogo}
            />
            <Text style={footer}>
              {footerText}
            </Text>
            <Link href={unsubscribeUrl} style={unsubscribeLink}>
              Newsletter abbestellen
            </Link>
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
  maxWidth: '600px',
}

const headerSection = {
  padding: '32px 32px 24px',
  textAlign: 'center' as const,
}

const logo = {
  margin: '0 auto',
}

const coverSection = {
  padding: '0',
}

const coverImageContainer = {
  backgroundColor: '#CCFF00',
  width: '100%',
}

const coverImage = {
  width: '100%',
  height: 'auto',
  display: 'block',
}

const contentSection = {
  padding: '32px',
}

const dateTag = {
  display: 'inline-block',
  backgroundColor: '#CCFF00',
  color: '#000000',
  fontFamily: "'SF Mono', Monaco, monospace",
  fontSize: '11px',
  fontWeight: '500',
  letterSpacing: '0.5px',
  padding: '6px 10px',
  marginBottom: '16px',
}

const heading = {
  fontFamily: "'Inter', -apple-system, BlinkMacSystemFont, sans-serif",
  fontSize: '28px',
  fontWeight: '700',
  color: '#1a1a1a',
  lineHeight: '1.2',
  margin: '0 0 16px',
}

const excerpt = {
  fontFamily: "'Source Serif 4', Georgia, serif",
  fontSize: '18px',
  lineHeight: '1.6',
  color: '#6b7280',
  fontStyle: 'italic',
  margin: '0 0 24px',
}

const contentStyle = {
  fontFamily: "'Source Serif 4', Georgia, serif",
  fontSize: '16px',
  lineHeight: '1.7',
  color: '#374151',
}

const button = {
  backgroundColor: '#000000',
  borderRadius: '0',
  color: '#ffffff',
  fontFamily: "'Inter', -apple-system, BlinkMacSystemFont, sans-serif",
  fontSize: '14px',
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
  fontSize: '12px',
  color: '#9ca3af',
  lineHeight: '1.5',
  margin: '0 0 8px',
}

const unsubscribeLink = {
  fontFamily: "'Inter', -apple-system, BlinkMacSystemFont, sans-serif",
  fontSize: '12px',
  color: '#9ca3af',
  textDecoration: 'underline',
}

export default NewsletterEmail

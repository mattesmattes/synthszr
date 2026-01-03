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
} from '@react-email/components'

interface NewsletterEmailProps {
  subject: string
  previewText?: string
  content: string
  postUrl: string
  unsubscribeUrl: string
}

export function NewsletterEmail({
  subject,
  previewText,
  content,
  postUrl,
  unsubscribeUrl,
}: NewsletterEmailProps) {
  return (
    <Html>
      <Head />
      <Body style={main}>
        <Container style={container}>
          <Section style={section}>
            <Text style={brand}>Synthszr</Text>
            <Heading style={heading}>{subject}</Heading>
            {previewText && <Text style={preview}>{previewText}</Text>}
            <Hr style={hr} />
            <div
              style={contentStyle}
              dangerouslySetInnerHTML={{ __html: content }}
            />
            <Hr style={hr} />
            <Button style={button} href={postUrl}>
              Vollständigen Artikel lesen
            </Button>
          </Section>
          <Section style={footerSection}>
            <Text style={footer}>
              Du erhältst diese E-Mail, weil du den Synthszr Newsletter abonniert hast.
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

// Styles
const main = {
  backgroundColor: '#f6f9fc',
  fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
}

const container = {
  backgroundColor: '#ffffff',
  margin: '0 auto',
  padding: '20px 0 48px',
  marginBottom: '64px',
  maxWidth: '600px',
}

const section = {
  padding: '0 48px',
}

const brand = {
  fontSize: '14px',
  fontWeight: '600',
  color: '#666666',
  letterSpacing: '0.5px',
  textTransform: 'uppercase' as const,
  marginBottom: '8px',
}

const heading = {
  fontSize: '28px',
  fontWeight: '700',
  color: '#1a1a1a',
  lineHeight: '36px',
  margin: '16px 0 24px',
}

const preview = {
  fontSize: '16px',
  lineHeight: '24px',
  color: '#666666',
  fontStyle: 'italic',
}

const contentStyle = {
  fontSize: '16px',
  lineHeight: '26px',
  color: '#404040',
}

const button = {
  backgroundColor: '#000000',
  borderRadius: '4px',
  color: '#ffffff',
  fontSize: '16px',
  fontWeight: '600',
  textDecoration: 'none',
  textAlign: 'center' as const,
  display: 'block',
  width: '100%',
  padding: '14px 0',
  marginTop: '24px',
}

const hr = {
  borderColor: '#e6ebf1',
  margin: '24px 0',
}

const footerSection = {
  padding: '24px 48px',
  backgroundColor: '#f6f9fc',
}

const footer = {
  fontSize: '12px',
  color: '#8898aa',
  lineHeight: '16px',
  margin: '0 0 8px',
}

const unsubscribeLink = {
  fontSize: '12px',
  color: '#8898aa',
  textDecoration: 'underline',
}

export default NewsletterEmail

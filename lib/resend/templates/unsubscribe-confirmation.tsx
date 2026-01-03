import * as React from 'react'
import {
  Html,
  Head,
  Body,
  Container,
  Section,
  Text,
  Hr,
  Link,
} from '@react-email/components'

interface UnsubscribeConfirmationEmailProps {
  resubscribeUrl?: string
}

export function UnsubscribeConfirmationEmail({ resubscribeUrl }: UnsubscribeConfirmationEmailProps) {
  return (
    <Html>
      <Head />
      <Body style={main}>
        <Container style={container}>
          <Section style={section}>
            <Text style={heading}>Synthszr Newsletter</Text>
            <Text style={paragraph}>
              Du hast dich erfolgreich vom Synthszr Newsletter abgemeldet.
            </Text>
            <Text style={paragraph}>
              Wir haben deine E-Mail-Adresse aus unserer Liste entfernt.
              Du wirst keine weiteren Newsletter von uns erhalten.
            </Text>
            <Hr style={hr} />
            <Text style={smallText}>
              Hast du dich versehentlich abgemeldet? Du kannst dich jederzeit
              wieder anmelden:
            </Text>
            {resubscribeUrl && (
              <Link href={resubscribeUrl} style={link}>
                Erneut anmelden
              </Link>
            )}
            <Hr style={hr} />
            <Text style={footer}>
              Falls du Fragen hast, antworte einfach auf diese E-Mail.
            </Text>
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
}

const section = {
  padding: '0 48px',
}

const heading = {
  fontSize: '24px',
  fontWeight: '700',
  color: '#1a1a1a',
  margin: '30px 0',
}

const paragraph = {
  fontSize: '16px',
  lineHeight: '26px',
  color: '#404040',
}

const smallText = {
  fontSize: '14px',
  color: '#666666',
  marginTop: '16px',
}

const link = {
  fontSize: '14px',
  color: '#0066cc',
  textDecoration: 'underline',
}

const hr = {
  borderColor: '#e6ebf1',
  margin: '30px 0',
}

const footer = {
  fontSize: '12px',
  color: '#8898aa',
  lineHeight: '16px',
}

export default UnsubscribeConfirmationEmail

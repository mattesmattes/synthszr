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
} from '@react-email/components'

interface ConfirmationEmailProps {
  confirmationUrl: string
}

export function ConfirmationEmail({ confirmationUrl }: ConfirmationEmailProps) {
  return (
    <Html>
      <Head />
      <Body style={main}>
        <Container style={container}>
          <Section style={section}>
            <Text style={heading}>Synthszr Newsletter</Text>
            <Text style={paragraph}>
              Danke für deine Anmeldung zum Synthszr Newsletter!
            </Text>
            <Text style={paragraph}>
              Bitte bestätige deine E-Mail-Adresse, um den Newsletter zu erhalten:
            </Text>
            <Button style={button} href={confirmationUrl}>
              E-Mail bestätigen
            </Button>
            <Text style={smallText}>
              Oder kopiere diesen Link in deinen Browser:
            </Text>
            <Link href={confirmationUrl} style={link}>
              {confirmationUrl}
            </Link>
            <Hr style={hr} />
            <Text style={footer}>
              Falls du diese E-Mail nicht angefordert hast, kannst du sie ignorieren.
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
  padding: '12px 0',
  marginTop: '24px',
  marginBottom: '24px',
}

const smallText = {
  fontSize: '12px',
  color: '#666666',
  marginTop: '16px',
}

const link = {
  fontSize: '12px',
  color: '#0066cc',
  wordBreak: 'break-all' as const,
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

export default ConfirmationEmail

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

type Locale = 'de' | 'en' | 'cs' | string

interface ConfirmationEmailProps {
  confirmationUrl: string
  locale?: Locale
}

// Translations for confirmation email
const translations: Record<string, {
  heading: string
  thanks: string
  confirm: string
  button: string
  copyLink: string
  ignore: string
  subject: string
}> = {
  de: {
    heading: 'Synthszr Newsletter',
    thanks: 'Danke für deine Anmeldung zum Synthszr Newsletter!',
    confirm: 'Bitte bestätige deine E-Mail-Adresse, um den Newsletter zu erhalten:',
    button: 'E-Mail bestätigen',
    copyLink: 'Oder kopiere diesen Link in deinen Browser:',
    ignore: 'Falls du diese E-Mail nicht angefordert hast, kannst du sie ignorieren.',
    subject: 'Bestätige deine Newsletter-Anmeldung',
  },
  en: {
    heading: 'Synthszr Newsletter',
    thanks: 'Thank you for signing up for the Synthszr Newsletter!',
    confirm: 'Please confirm your email address to receive the newsletter:',
    button: 'Confirm Email',
    copyLink: 'Or copy this link into your browser:',
    ignore: 'If you did not request this email, you can ignore it.',
    subject: 'Confirm your newsletter subscription',
  },
  cs: {
    heading: 'Synthszr Newsletter',
    thanks: 'Děkujeme za přihlášení k odběru Synthszr Newsletteru!',
    confirm: 'Potvrďte prosím svou e-mailovou adresu pro příjem newsletteru:',
    button: 'Potvrdit e-mail',
    copyLink: 'Nebo zkopírujte tento odkaz do prohlížeče:',
    ignore: 'Pokud jste o tento e-mail nežádali, můžete ho ignorovat.',
    subject: 'Potvrďte odběr newsletteru',
  },
}

export function getConfirmationSubject(locale: Locale = 'de'): string {
  return translations[locale]?.subject || translations.de.subject
}

export function ConfirmationEmail({ confirmationUrl, locale = 'de' }: ConfirmationEmailProps) {
  const t = translations[locale] || translations.de

  return (
    <Html>
      <Head />
      <Body style={main}>
        <Container style={container}>
          <Section style={section}>
            <Text style={heading}>{t.heading}</Text>
            <Text style={paragraph}>
              {t.thanks}
            </Text>
            <Text style={paragraph}>
              {t.confirm}
            </Text>
            <Button style={button} href={confirmationUrl}>
              {t.button}
            </Button>
            <Text style={smallText}>
              {t.copyLink}
            </Text>
            <Link href={confirmationUrl} style={link}>
              {confirmationUrl}
            </Link>
            <Hr style={hr} />
            <Text style={footer}>
              {t.ignore}
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

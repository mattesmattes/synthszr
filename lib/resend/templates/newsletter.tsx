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
import { formatUpdateDate } from '@/lib/i18n/config'
import type { LanguageCode } from '@/lib/types'

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
  locale?: LanguageCode
}

// Localized UI strings
const UI_STRINGS: Record<LanguageCode, {
  footer: string
  readArticle: string
  changeLanguage: string
  unsubscribe: string
  imprint: string
  privacy: string
  listenPodcast: string
}> = {
  de: {
    footer: 'Du erhältst diese E-Mail, weil du den Synthszr Newsletter abonniert hast.',
    readArticle: 'Artikel auf synthszr.com lesen',
    changeLanguage: 'Sprache ändern',
    unsubscribe: 'Abbestellen',
    imprint: 'Impressum',
    privacy: 'Datenschutz',
    listenPodcast: 'Podcast anhören',
  },
  en: {
    footer: 'You are receiving this email because you subscribed to the Synthszr Newsletter.',
    readArticle: 'Read article on synthszr.com',
    changeLanguage: 'Change language',
    unsubscribe: 'Unsubscribe',
    imprint: 'Imprint',
    privacy: 'Privacy',
    listenPodcast: 'Listen to podcast',
  },
  fr: {
    footer: 'Vous recevez cet e-mail car vous êtes abonné à la newsletter Synthszr.',
    readArticle: 'Lire l\'article sur synthszr.com',
    changeLanguage: 'Changer de langue',
    unsubscribe: 'Se désabonner',
    imprint: 'Mentions légales',
    privacy: 'Confidentialité',
    listenPodcast: 'Écouter le podcast',
  },
  es: {
    footer: 'Recibes este correo porque te suscribiste al boletín de Synthszr.',
    readArticle: 'Leer artículo en synthszr.com',
    changeLanguage: 'Cambiar idioma',
    unsubscribe: 'Cancelar suscripción',
    imprint: 'Aviso legal',
    privacy: 'Privacidad',
    listenPodcast: 'Escuchar podcast',
  },
  it: {
    footer: 'Ricevi questa email perché sei iscritto alla newsletter di Synthszr.',
    readArticle: 'Leggi l\'articolo su synthszr.com',
    changeLanguage: 'Cambia lingua',
    unsubscribe: 'Annulla iscrizione',
    imprint: 'Note legali',
    privacy: 'Privacy',
    listenPodcast: 'Ascolta il podcast',
  },
  pt: {
    footer: 'Você está recebendo este e-mail porque assinou a newsletter Synthszr.',
    readArticle: 'Ler artigo em synthszr.com',
    changeLanguage: 'Mudar idioma',
    unsubscribe: 'Cancelar inscrição',
    imprint: 'Informações legais',
    privacy: 'Privacidade',
    listenPodcast: 'Ouvir podcast',
  },
  nl: {
    footer: 'Je ontvangt deze e-mail omdat je je hebt aangemeld voor de Synthszr nieuwsbrief.',
    readArticle: 'Lees artikel op synthszr.com',
    changeLanguage: 'Taal wijzigen',
    unsubscribe: 'Afmelden',
    imprint: 'Impressum',
    privacy: 'Privacy',
    listenPodcast: 'Luister naar podcast',
  },
  pl: {
    footer: 'Otrzymujesz ten e-mail, ponieważ subskrybujesz newsletter Synthszr.',
    readArticle: 'Przeczytaj artykuł na synthszr.com',
    changeLanguage: 'Zmień język',
    unsubscribe: 'Wypisz się',
    imprint: 'Impressum',
    privacy: 'Prywatność',
    listenPodcast: 'Słuchaj podcastu',
  },
  cs: {
    footer: 'Tento e-mail vám přišel, protože jste přihlášeni k odběru newsletteru Synthszr.',
    readArticle: 'Přečíst článek na synthszr.com',
    changeLanguage: 'Změnit jazyk',
    unsubscribe: 'Odhlásit odběr',
    imprint: 'Impressum',
    privacy: 'Ochrana soukromí',
    listenPodcast: 'Poslechnout podcast',
  },
  nds: {
    footer: 'Du kriggst disse E-Mail, wiel du den Synthszr Newsletter abonneert hest.',
    readArticle: 'Artikel op synthszr.com lesen',
    changeLanguage: 'Spraak ännern',
    unsubscribe: 'Afmellen',
    imprint: 'Impressum',
    privacy: 'Datenschutz',
    listenPodcast: 'Podcast anhören',
  },
}

export function NewsletterEmail({
  subject,
  previewText,
  content,
  postUrl,
  unsubscribeUrl,
  preferencesUrl,
  footerText,
  coverImageUrl,
  postDate,
  baseUrl = 'https://synthszr.vercel.app',
  locale = 'de',
}: NewsletterEmailProps) {
  const formattedDate = postDate ? formatUpdateDate(postDate, locale) : null
  const strings = UI_STRINGS[locale] || UI_STRINGS.de
  const actualFooterText = footerText || strings.footer

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
          {/* Cover Image with Logo - clicks to article with autoplay */}
          {coverImageUrl && (
            <>
              <Section style={coverSection}>
                <Link href={`${postUrl}?autoplay=true`} style={{ textDecoration: 'none' }}>
                  <div style={coverImageContainer}>
                    <Img
                      src={`${baseUrl}/api/newsletter/cover-image?url=${encodeURIComponent(coverImageUrl)}&size=604&logo=true&skipTransform=true`}
                      alt={subject}
                      width="302"
                      height="302"
                      style={coverImage}
                    />
                  </div>
                </Link>
              </Section>

              {/* Audio Player Pill */}
              <Section style={playerPillSection}>
                <Link href={`${postUrl}?autoplay=true`} style={{ textDecoration: 'none' }}>
                  <div style={playerPill}>
                    <div style={playerCircle}>
                      <span style={playerCircleIcon}>&#9654;</span>
                    </div>
                    <span style={playerText}>{strings.listenPodcast}</span>
                  </div>
                </Link>
              </Section>
            </>
          )}

          {/* Main Content */}
          <Section style={contentSection}>
            {/* Date Tag */}
            {formattedDate && (
              <Text style={dateTag}>
                {formattedDate}
              </Text>
            )}

            {/* Title */}
            <Heading style={heading}>{subject}</Heading>

            {/* Excerpt */}
            {previewText && (
              previewText.includes('•') ? (
                <>
                  {(() => {
                    const bullets = previewText.split('\n').filter(l => l.trim().startsWith('•'))
                    return bullets.map((line, i) => (
                      <Text key={i} style={i < bullets.length - 1 ? excerptBulletLine : excerpt}>{line.trim()}</Text>
                    ))
                  })()}
                </>
              ) : (
                <Text style={excerpt}>{previewText}</Text>
              )
            )}

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
              {strings.readArticle}
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
              {actualFooterText}
            </Text>
            <Text style={footerLinks}>
              {preferencesUrl && (
                <>
                  <Link href={preferencesUrl} style={unsubscribeLink}>
                    {strings.changeLanguage}
                  </Link>
                  <span style={linkSeparator}>•</span>
                </>
              )}
              <Link href={unsubscribeUrl} style={unsubscribeLink}>
                {strings.unsubscribe}
              </Link>
              <span style={linkSeparator}>•</span>
              <Link href={`${baseUrl}/${locale === 'de' ? 'impressum' : `${locale}/impressum`}`} style={unsubscribeLink}>
                {strings.imprint}
              </Link>
              <span style={linkSeparator}>•</span>
              <Link href={`${baseUrl}/${locale === 'de' ? 'datenschutz' : `${locale}/datenschutz`}`} style={unsubscribeLink}>
                {strings.privacy}
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
  maxWidth: '600px',
}

const coverSection = {
  padding: '0',
  textAlign: 'center' as const,
}

const coverImageContainer = {
  backgroundColor: '#CCFF00',
  width: '302px',
  height: '302px',
  overflow: 'hidden' as const,
  margin: '0 auto',
  borderRadius: '0',
}

const coverImage = {
  width: '302px',
  height: '302px',
  display: 'block',
  objectFit: 'cover' as const,
}

const playerPillSection = {
  padding: '16px 32px 0',
  textAlign: 'center' as const,
}

const playerPill = {
  display: 'inline-block',
  backgroundColor: '#ffffff',
  border: '1px solid #e5e7eb',
  borderRadius: '28px',
  padding: '6px 24px 6px 6px',
  textDecoration: 'none',
}

const playerCircle = {
  display: 'inline-block',
  width: '40px',
  height: '40px',
  backgroundColor: '#000000',
  borderRadius: '50%',
  textAlign: 'center' as const,
  lineHeight: '42px',
  verticalAlign: 'middle',
  marginRight: '12px',
}

const playerCircleIcon = {
  color: '#ffffff',
  fontSize: '16px',
  paddingLeft: '3px',
}

const playerText = {
  fontFamily: "'Inter', -apple-system, BlinkMacSystemFont, sans-serif",
  fontSize: '14px',
  fontWeight: '500' as const,
  color: '#374151',
  verticalAlign: 'middle',
  letterSpacing: '0.2px',
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

const excerptBulletLine = {
  ...excerpt,
  margin: '0 0 4px',
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

const footerLinks = {
  margin: '0',
}

const unsubscribeLink = {
  fontFamily: "'Inter', -apple-system, BlinkMacSystemFont, sans-serif",
  fontSize: '12px',
  color: '#9ca3af',
  textDecoration: 'underline',
}

const linkSeparator = {
  color: '#9ca3af',
  margin: '0 8px',
}

export default NewsletterEmail

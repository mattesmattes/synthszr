import { Metadata } from 'next'
import Link from 'next/link'
import { ArrowLeft } from 'lucide-react'
import { ConsentSettingsButton } from '@/components/consent-banner'

export const metadata: Metadata = {
  title: 'Datenschutz | Synthszr',
  description: 'Datenschutzerklärung und Informationen zur Datenverarbeitung',
}

export default function DatenschutzPage() {
  return (
    <main className="min-h-screen bg-background">
      <div className="container mx-auto px-4 py-8 max-w-3xl">
        <Link
          href="/"
          className="inline-flex items-center gap-2 text-xs text-muted-foreground hover:text-foreground transition-colors mb-6"
        >
          <ArrowLeft className="h-3 w-3" />
          Zurück zur Startseite
        </Link>

        <h1 className="text-2xl font-bold tracking-tight mb-6">Datenschutzerklärung</h1>

        <div className="prose prose-sm dark:prose-invert max-w-none space-y-6">
          <section>
            <h2 className="text-lg font-semibold mb-2">1. Verantwortlicher</h2>
            <p className="text-sm">
              <strong>OH–SO Digital GmbH</strong><br />
              Kaiser-Wilhelm-Straße 83<br />
              20355 Hamburg<br />
              E-Mail: <a href="mailto:hi@oh-so.com" className="text-primary hover:underline">hi@oh-so.com</a>
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold mb-2">2. Erhobene Daten</h2>

            <h3 className="text-sm font-semibold mt-4 mb-1">2.1 Technisch notwendige Daten</h3>
            <p className="text-xs text-muted-foreground">
              Bei jedem Zugriff auf unsere Website werden automatisch folgende Daten erhoben:
            </p>
            <ul className="text-xs text-muted-foreground list-disc pl-4 mt-1 space-y-1">
              <li>IP-Adresse (anonymisiert)</li>
              <li>Datum und Uhrzeit des Zugriffs</li>
              <li>Aufgerufene Seiten</li>
              <li>Browser-Typ und -Version</li>
              <li>Betriebssystem</li>
            </ul>
            <p className="text-xs text-muted-foreground mt-2">
              Rechtsgrundlage: Art. 6 Abs. 1 lit. f DSGVO (berechtigtes Interesse an der technischen Bereitstellung der Website).
            </p>

            <h3 className="text-sm font-semibold mt-4 mb-1">2.2 Web Analytics (Vercel Analytics)</h3>
            <p className="text-xs text-muted-foreground">
              Mit Ihrer Einwilligung nutzen wir Vercel Analytics zur Analyse der Website-Nutzung. Dabei werden folgende Daten erfasst:
            </p>
            <ul className="text-xs text-muted-foreground list-disc pl-4 mt-1 space-y-1">
              <li>Seitenaufrufe und Verweildauer</li>
              <li>Referrer (woher Sie kommen)</li>
              <li>Geräte- und Browser-Informationen</li>
              <li>Geografischer Standort (Land/Region)</li>
            </ul>
            <p className="text-xs text-muted-foreground mt-2">
              <strong>Wichtig:</strong> Vercel Analytics ist datenschutzfreundlich konzipiert. Es werden keine Cookies gesetzt und keine personenbezogenen Daten wie IP-Adressen gespeichert.
            </p>
            <p className="text-xs text-muted-foreground mt-1">
              Rechtsgrundlage: Art. 6 Abs. 1 lit. a DSGVO (Einwilligung).
            </p>

            <h3 className="text-sm font-semibold mt-4 mb-1">2.3 Newsletter</h3>
            <p className="text-xs text-muted-foreground">
              Wenn Sie sich für unseren Newsletter anmelden, erheben wir:
            </p>
            <ul className="text-xs text-muted-foreground list-disc pl-4 mt-1 space-y-1">
              <li>E-Mail-Adresse (erforderlich)</li>
              <li>Zeitpunkt der Anmeldung und Bestätigung</li>
            </ul>
            <p className="text-xs text-muted-foreground mt-2">
              Wir verwenden das Double-Opt-In-Verfahren: Nach der Anmeldung erhalten Sie eine E-Mail mit einem Bestätigungslink. Erst nach Klick auf diesen Link ist die Anmeldung abgeschlossen.
            </p>
            <p className="text-xs text-muted-foreground mt-1">
              Der Versand erfolgt über <strong>Resend</strong> (resend.com). Ihre E-Mail-Adresse wird auf Servern in der EU/USA verarbeitet.
            </p>
            <p className="text-xs text-muted-foreground mt-1">
              Rechtsgrundlage: Art. 6 Abs. 1 lit. a DSGVO (Einwilligung). Sie können den Newsletter jederzeit über den Abmeldelink in jeder E-Mail abbestellen.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold mb-2">3. Lokale Speicherung</h2>
            <p className="text-xs text-muted-foreground">
              Wir speichern Ihre Datenschutz-Einstellungen im Local Storage Ihres Browsers. Diese Daten verbleiben auf Ihrem Gerät und werden nicht an uns übertragen.
            </p>
            <ul className="text-xs text-muted-foreground list-disc pl-4 mt-1 space-y-1">
              <li><code className="bg-muted px-1 rounded">synthszr_consent</code> – Ihre Cookie-/Tracking-Einstellungen</li>
            </ul>
          </section>

          <section>
            <h2 className="text-lg font-semibold mb-2">4. Ihre Rechte</h2>
            <p className="text-xs text-muted-foreground">
              Sie haben folgende Rechte bezüglich Ihrer personenbezogenen Daten:
            </p>
            <ul className="text-xs text-muted-foreground list-disc pl-4 mt-1 space-y-1">
              <li><strong>Auskunft</strong> (Art. 15 DSGVO)</li>
              <li><strong>Berichtigung</strong> (Art. 16 DSGVO)</li>
              <li><strong>Löschung</strong> (Art. 17 DSGVO)</li>
              <li><strong>Einschränkung der Verarbeitung</strong> (Art. 18 DSGVO)</li>
              <li><strong>Datenübertragbarkeit</strong> (Art. 20 DSGVO)</li>
              <li><strong>Widerspruch</strong> (Art. 21 DSGVO)</li>
              <li><strong>Widerruf der Einwilligung</strong> (Art. 7 Abs. 3 DSGVO)</li>
            </ul>
            <p className="text-xs text-muted-foreground mt-2">
              Zur Ausübung Ihrer Rechte kontaktieren Sie uns bitte unter{' '}
              <a href="mailto:hi@oh-so.com" className="text-primary hover:underline">hi@oh-so.com</a>.
            </p>
            <p className="text-xs text-muted-foreground mt-1">
              Sie haben außerdem das Recht, sich bei einer Aufsichtsbehörde zu beschweren (Art. 77 DSGVO).
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold mb-2">5. Einstellungen ändern</h2>
            <p className="text-xs text-muted-foreground mb-3">
              Sie können Ihre Datenschutz-Einstellungen jederzeit ändern:
            </p>
            <ConsentSettingsButton />
          </section>

          <section>
            <h2 className="text-lg font-semibold mb-2">6. Hosting</h2>
            <p className="text-xs text-muted-foreground">
              Diese Website wird bei <strong>Vercel Inc.</strong> (340 S Lemon Ave #4133, Walnut, CA 91789, USA) gehostet.
              Vercel verarbeitet Daten gemäß den EU-Standardvertragsklauseln.
            </p>
            <p className="text-xs text-muted-foreground mt-1">
              Weitere Informationen: <a href="https://vercel.com/legal/privacy-policy" target="_blank" rel="noopener noreferrer" className="text-primary hover:underline">vercel.com/legal/privacy-policy</a>
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold mb-2">7. Änderungen</h2>
            <p className="text-xs text-muted-foreground">
              Wir behalten uns vor, diese Datenschutzerklärung bei Bedarf zu aktualisieren. Die aktuelle Version finden Sie stets auf dieser Seite.
            </p>
          </section>
        </div>

        <div className="mt-8 pt-6 border-t text-xs text-muted-foreground">
          <p>Stand: Januar 2026</p>
        </div>
      </div>
    </main>
  )
}

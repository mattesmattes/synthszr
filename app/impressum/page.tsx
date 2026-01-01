import { Metadata } from 'next'
import Link from 'next/link'
import { ArrowLeft } from 'lucide-react'

export const metadata: Metadata = {
  title: 'Impressum | Synthszr',
  description: 'Impressum und rechtliche Informationen',
}

export default function ImpressumPage() {
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

        <h1 className="text-2xl font-bold tracking-tight mb-6">Impressum</h1>

        <div className="prose prose-sm dark:prose-invert max-w-none space-y-6">
          <section>
            <h2 className="text-lg font-semibold mb-2">Angaben gemäß § 5 TMG</h2>
            <p className="text-sm">
              <strong>OH–SO Digital GmbH</strong><br />
              Kaiser-Wilhelm-Straße 83<br />
              20355 Hamburg<br />
              Deutschland
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold mb-2">Vertreten durch</h2>
            <p className="text-sm">
              Geschäftsführer: Axel Averdung, Florian Langmack, Holger Blank, Matthias Schrader, Philipp Kafkoulas, Pia Schott
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold mb-2">Kontakt</h2>
            <p className="text-sm">
              E-Mail: <a href="mailto:hi@oh-so.com" className="text-primary hover:underline">hi@oh-so.com</a>
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold mb-2">Registereintrag</h2>
            <p className="text-sm">
              Registergericht: Amtsgericht Hamburg<br />
              Registernummer: HRB 18 1942
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold mb-2">Umsatzsteuer-ID</h2>
            <p className="text-sm">
              Umsatzsteuer-Identifikationsnummer gemäß § 27 a Umsatzsteuergesetz:<br />
              DE364225367
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold mb-2">Verantwortlich für den Inhalt nach § 55 Abs. 2 RStV</h2>
            <p className="text-sm">
              Florian Langmack<br />
              Kaiser-Wilhelm-Straße 83<br />
              20355 Hamburg
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold mb-2">Haftungsausschluss</h2>

            <h3 className="text-sm font-semibold mt-4 mb-1">Haftung für Inhalte</h3>
            <p className="text-xs text-muted-foreground">
              Die Inhalte unserer Seiten wurden mit größter Sorgfalt erstellt. Für die Richtigkeit, Vollständigkeit und Aktualität der Inhalte können wir jedoch keine Gewähr übernehmen.
            </p>

            <h3 className="text-sm font-semibold mt-4 mb-1">Haftung für Links</h3>
            <p className="text-xs text-muted-foreground">
              Unser Angebot enthält Links zu externen Webseiten Dritter, auf deren Inhalte wir keinen Einfluss haben. Deshalb können wir für diese fremden Inhalte auch keine Gewähr übernehmen. Für die Inhalte der verlinkten Seiten ist stets der jeweilige Anbieter oder Betreiber der Seiten verantwortlich.
            </p>

            <h3 className="text-sm font-semibold mt-4 mb-1">Urheberrecht</h3>
            <p className="text-xs text-muted-foreground">
              Die durch die Seitenbetreiber erstellten Inhalte und Werke auf diesen Seiten unterliegen dem deutschen Urheberrecht. Die Vervielfältigung, Bearbeitung, Verbreitung und jede Art der Verwertung außerhalb der Grenzen des Urheberrechtes bedürfen der schriftlichen Zustimmung des jeweiligen Autors bzw. Erstellers.
            </p>
          </section>
        </div>

        <div className="mt-8 pt-6 border-t text-xs text-muted-foreground">
          <p>Stand: Januar 2025</p>
        </div>
      </div>
    </main>
  )
}

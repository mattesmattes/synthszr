-- Seed Impressum and Datenschutz pages for translation support

-- Impressum
INSERT INTO static_pages (slug, title, content)
VALUES (
  'impressum',
  'Impressum',
  '{
    "type": "doc",
    "content": [
      {
        "type": "heading",
        "attrs": {"level": 2},
        "content": [{"type": "text", "text": "Angaben gemäß § 5 TMG"}]
      },
      {
        "type": "paragraph",
        "content": [
          {"type": "text", "marks": [{"type": "bold"}], "text": "OH–SO Digital GmbH"},
          {"type": "hardBreak"},
          {"type": "text", "text": "Kaiser-Wilhelm-Straße 83"},
          {"type": "hardBreak"},
          {"type": "text", "text": "20355 Hamburg"},
          {"type": "hardBreak"},
          {"type": "text", "text": "Deutschland"}
        ]
      },
      {
        "type": "heading",
        "attrs": {"level": 2},
        "content": [{"type": "text", "text": "Vertreten durch"}]
      },
      {
        "type": "paragraph",
        "content": [
          {"type": "text", "text": "Geschäftsführer: Axel Averdung, Florian Langmack, Holger Blank, Matthias Schrader, Philipp Kafkoulas, Pia Schott"}
        ]
      },
      {
        "type": "heading",
        "attrs": {"level": 2},
        "content": [{"type": "text", "text": "Kontakt"}]
      },
      {
        "type": "paragraph",
        "content": [
          {"type": "text", "text": "E-Mail: hi@oh-so.com"}
        ]
      },
      {
        "type": "heading",
        "attrs": {"level": 2},
        "content": [{"type": "text", "text": "Registereintrag"}]
      },
      {
        "type": "paragraph",
        "content": [
          {"type": "text", "text": "Registergericht: Amtsgericht Hamburg"},
          {"type": "hardBreak"},
          {"type": "text", "text": "Registernummer: HRB 18 1942"}
        ]
      },
      {
        "type": "heading",
        "attrs": {"level": 2},
        "content": [{"type": "text", "text": "Umsatzsteuer-ID"}]
      },
      {
        "type": "paragraph",
        "content": [
          {"type": "text", "text": "Umsatzsteuer-Identifikationsnummer gemäß § 27 a Umsatzsteuergesetz:"},
          {"type": "hardBreak"},
          {"type": "text", "text": "DE364225367"}
        ]
      },
      {
        "type": "heading",
        "attrs": {"level": 2},
        "content": [{"type": "text", "text": "Verantwortlich für den Inhalt nach § 55 Abs. 2 RStV"}]
      },
      {
        "type": "paragraph",
        "content": [
          {"type": "text", "text": "Matthias \"Mattes\" Schrader"},
          {"type": "hardBreak"},
          {"type": "text", "text": "Kaiser-Wilhelm-Straße 83"},
          {"type": "hardBreak"},
          {"type": "text", "text": "20355 Hamburg"}
        ]
      },
      {
        "type": "heading",
        "attrs": {"level": 2},
        "content": [{"type": "text", "text": "Haftungsausschluss"}]
      },
      {
        "type": "heading",
        "attrs": {"level": 3},
        "content": [{"type": "text", "text": "Haftung für Inhalte"}]
      },
      {
        "type": "paragraph",
        "content": [
          {"type": "text", "text": "Die Inhalte unserer Seiten wurden mit größter Sorgfalt erstellt. Für die Richtigkeit, Vollständigkeit und Aktualität der Inhalte können wir jedoch keine Gewähr übernehmen."}
        ]
      },
      {
        "type": "heading",
        "attrs": {"level": 3},
        "content": [{"type": "text", "text": "Haftung für Links"}]
      },
      {
        "type": "paragraph",
        "content": [
          {"type": "text", "text": "Unser Angebot enthält Links zu externen Webseiten Dritter, auf deren Inhalte wir keinen Einfluss haben. Deshalb können wir für diese fremden Inhalte auch keine Gewähr übernehmen. Für die Inhalte der verlinkten Seiten ist stets der jeweilige Anbieter oder Betreiber der Seiten verantwortlich."}
        ]
      },
      {
        "type": "heading",
        "attrs": {"level": 3},
        "content": [{"type": "text", "text": "Urheberrecht"}]
      },
      {
        "type": "paragraph",
        "content": [
          {"type": "text", "text": "Die durch die Seitenbetreiber erstellten Inhalte und Werke auf diesen Seiten unterliegen dem deutschen Urheberrecht. Die Vervielfältigung, Bearbeitung, Verbreitung und jede Art der Verwertung außerhalb der Grenzen des Urheberrechtes bedürfen der schriftlichen Zustimmung des jeweiligen Autors bzw. Erstellers."}
        ]
      }
    ]
  }'::jsonb
)
ON CONFLICT (slug) DO UPDATE SET
  title = EXCLUDED.title,
  content = EXCLUDED.content,
  updated_at = NOW();

-- Datenschutz
INSERT INTO static_pages (slug, title, content)
VALUES (
  'datenschutz',
  'Datenschutzerklärung',
  '{
    "type": "doc",
    "content": [
      {
        "type": "heading",
        "attrs": {"level": 2},
        "content": [{"type": "text", "text": "1. Verantwortlicher"}]
      },
      {
        "type": "paragraph",
        "content": [
          {"type": "text", "marks": [{"type": "bold"}], "text": "OH–SO Digital GmbH"},
          {"type": "hardBreak"},
          {"type": "text", "text": "Kaiser-Wilhelm-Straße 83"},
          {"type": "hardBreak"},
          {"type": "text", "text": "20355 Hamburg"},
          {"type": "hardBreak"},
          {"type": "text", "text": "E-Mail: hi@oh-so.com"}
        ]
      },
      {
        "type": "heading",
        "attrs": {"level": 2},
        "content": [{"type": "text", "text": "2. Erhobene Daten"}]
      },
      {
        "type": "heading",
        "attrs": {"level": 3},
        "content": [{"type": "text", "text": "2.1 Technisch notwendige Daten"}]
      },
      {
        "type": "paragraph",
        "content": [
          {"type": "text", "text": "Bei jedem Zugriff auf unsere Website werden automatisch folgende Daten erhoben: IP-Adresse (anonymisiert), Datum und Uhrzeit des Zugriffs, aufgerufene Seiten, Browser-Typ und -Version, Betriebssystem."}
        ]
      },
      {
        "type": "paragraph",
        "content": [
          {"type": "text", "text": "Rechtsgrundlage: Art. 6 Abs. 1 lit. f DSGVO (berechtigtes Interesse an der technischen Bereitstellung der Website)."}
        ]
      },
      {
        "type": "heading",
        "attrs": {"level": 3},
        "content": [{"type": "text", "text": "2.2 Web Analytics (Vercel Analytics)"}]
      },
      {
        "type": "paragraph",
        "content": [
          {"type": "text", "text": "Mit Ihrer Einwilligung nutzen wir Vercel Analytics zur Analyse der Website-Nutzung. Dabei werden Seitenaufrufe, Verweildauer, Referrer und geografischer Standort erfasst. Vercel Analytics ist datenschutzfreundlich konzipiert – es werden keine Cookies gesetzt und keine personenbezogenen Daten wie IP-Adressen gespeichert."}
        ]
      },
      {
        "type": "paragraph",
        "content": [
          {"type": "text", "text": "Rechtsgrundlage: Art. 6 Abs. 1 lit. a DSGVO (Einwilligung)."}
        ]
      },
      {
        "type": "heading",
        "attrs": {"level": 3},
        "content": [{"type": "text", "text": "2.3 Newsletter"}]
      },
      {
        "type": "paragraph",
        "content": [
          {"type": "text", "text": "Wenn Sie sich für unseren Newsletter anmelden, erheben wir Ihre E-Mail-Adresse und den Zeitpunkt der Anmeldung. Wir verwenden das Double-Opt-In-Verfahren. Der Versand erfolgt über Resend (resend.com)."}
        ]
      },
      {
        "type": "paragraph",
        "content": [
          {"type": "text", "text": "Rechtsgrundlage: Art. 6 Abs. 1 lit. a DSGVO (Einwilligung). Sie können den Newsletter jederzeit abbestellen."}
        ]
      },
      {
        "type": "heading",
        "attrs": {"level": 2},
        "content": [{"type": "text", "text": "3. Lokale Speicherung"}]
      },
      {
        "type": "paragraph",
        "content": [
          {"type": "text", "text": "Wir speichern Ihre Datenschutz-Einstellungen im Local Storage Ihres Browsers (synthszr_consent). Diese Daten verbleiben auf Ihrem Gerät."}
        ]
      },
      {
        "type": "heading",
        "attrs": {"level": 2},
        "content": [{"type": "text", "text": "4. Ihre Rechte"}]
      },
      {
        "type": "paragraph",
        "content": [
          {"type": "text", "text": "Sie haben folgende Rechte: Auskunft (Art. 15 DSGVO), Berichtigung (Art. 16 DSGVO), Löschung (Art. 17 DSGVO), Einschränkung der Verarbeitung (Art. 18 DSGVO), Datenübertragbarkeit (Art. 20 DSGVO), Widerspruch (Art. 21 DSGVO), Widerruf der Einwilligung (Art. 7 Abs. 3 DSGVO)."}
        ]
      },
      {
        "type": "paragraph",
        "content": [
          {"type": "text", "text": "Kontaktieren Sie uns unter hi@oh-so.com. Sie haben außerdem das Recht, sich bei einer Aufsichtsbehörde zu beschweren (Art. 77 DSGVO)."}
        ]
      },
      {
        "type": "heading",
        "attrs": {"level": 2},
        "content": [{"type": "text", "text": "5. Hosting"}]
      },
      {
        "type": "paragraph",
        "content": [
          {"type": "text", "text": "Diese Website wird bei Vercel Inc. (340 S Lemon Ave #4133, Walnut, CA 91789, USA) gehostet. Vercel verarbeitet Daten gemäß den EU-Standardvertragsklauseln."}
        ]
      },
      {
        "type": "heading",
        "attrs": {"level": 2},
        "content": [{"type": "text", "text": "6. Änderungen"}]
      },
      {
        "type": "paragraph",
        "content": [
          {"type": "text", "text": "Wir behalten uns vor, diese Datenschutzerklärung bei Bedarf zu aktualisieren. Die aktuelle Version finden Sie stets auf dieser Seite."}
        ]
      }
    ]
  }'::jsonb
)
ON CONFLICT (slug) DO UPDATE SET
  title = EXCLUDED.title,
  content = EXCLUDED.content,
  updated_at = NOW();

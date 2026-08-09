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
      },
      {
        "type": "heading",
        "attrs": {"level": 2},
        "content": [{"type": "text", "text": "7. Nutzergenerierte Inhalte: Kommentare und Take-Bewertungen"}]
      },
      {
        "type": "heading",
        "attrs": {"level": 3},
        "content": [{"type": "text", "text": "7.1 Kommentare (Eure Takes)"}]
      },
      {
        "type": "paragraph",
        "content": [{"type": "text", "text": "Als angemeldete Newsletter-Abonnentin oder -Abonnent können Sie unter unseren Artikeln Kommentare (\"Eure Takes\") veröffentlichen. Dabei verarbeiten wir den von Ihnen gewählten Anzeigenamen, den Kommentartext, Ihre E-Mail-Adresse (zur einmaligen Bestätigung über Ihren bestehenden Abonnenten-Datensatz) sowie den Zeitpunkt der Übermittlung. Anzeigename und Kommentartext sind nach der Freigabe öffentlich auf der jeweiligen Artikelseite sichtbar."}]
      },
      {
        "type": "paragraph",
        "content": [{"type": "text", "text": "Rechtsgrundlage: Art. 6 Abs. 1 lit. a DSGVO (Einwilligung durch das Absenden des Kommentars). Sie können die Löschung Ihrer Kommentare jederzeit unter hi@oh-so.com verlangen (Art. 17 DSGVO)."}]
      },
      {
        "type": "heading",
        "attrs": {"level": 3},
        "content": [{"type": "text", "text": "7.2 Automatisierte Moderation (Anthropic)"}]
      },
      {
        "type": "paragraph",
        "content": [{"type": "text", "text": "Zum Schutz vor Spam, Beleidigungen und rechtswidrigen Inhalten prüfen wir jeden Kommentar automatisiert, bevor er veröffentlicht wird. Hierzu übermitteln wir ausschließlich den Kommentartext und den Titel des betreffenden Artikels an Anthropic PBC (548 Market Street, PMB 90375, San Francisco, CA 94104, USA) als Auftragsverarbeiter. Ihr Name und Ihre E-Mail-Adresse werden dabei nicht übermittelt."}]
      },
      {
        "type": "paragraph",
        "content": [{"type": "text", "text": "Die Übermittlung in die USA erfolgt auf Grundlage der EU-Standardvertragsklauseln. Rechtsgrundlage: Art. 6 Abs. 1 lit. f DSGVO (berechtigtes Interesse am Schutz vor missbräuchlichen und rechtswidrigen Inhalten)."}]
      },
      {
        "type": "heading",
        "attrs": {"level": 3},
        "content": [{"type": "text", "text": "7.3 Take-Bewertungen (Take-Barometer)"}]
      },
      {
        "type": "paragraph",
        "content": [{"type": "text", "text": "Unter jedem \"Synthszr Take\" können Sie anonym mit \"Sehe ich auch so\" oder \"Sehe ich anders\" abstimmen. Dabei werden keine personenbezogenen Daten erhoben. Zur Vermeidung von Mehrfachabstimmungen speichern wir eine zufällige, nicht auf Sie zurückführbare Kennung in einem Cookie (siehe Abschnitt 7.4)."}]
      },
      {
        "type": "heading",
        "attrs": {"level": 3},
        "content": [{"type": "text", "text": "7.4 Cookies und lokale Speicherung für diese Funktionen"}]
      },
      {
        "type": "paragraph",
        "content": [{"type": "text", "text": "Für die Kommentar- und Bewertungsfunktion setzen wir folgende technisch erforderliche Cookies und lokale Speicherungen ein:"}]
      },
      {
        "type": "paragraph",
        "content": [{"type": "text", "marks": [{"type": "bold"}], "text": "synthszr_reader"}, {"type": "text", "text": " (Cookie, Laufzeit 90 Tage, httpOnly): ermöglicht Ihnen nach einmaliger Bestätigung das Kommentieren, ohne sich erneut verifizieren zu müssen."}]
      },
      {
        "type": "paragraph",
        "content": [{"type": "text", "marks": [{"type": "bold"}], "text": "synthszr_tb"}, {"type": "text", "text": " (Cookie, Laufzeit 365 Tage): verhindert Mehrfachabstimmungen beim Take-Barometer."}]
      },
      {
        "type": "paragraph",
        "content": [{"type": "text", "marks": [{"type": "bold"}], "text": "synthszr_display_name, synthszr_tb_votes"}, {"type": "text", "text": " (Local Storage): merken sich Ihren zuletzt verwendeten Anzeigenamen und Ihre eigenen Bewertungen ausschließlich auf Ihrem Gerät."}]
      },
      {
        "type": "paragraph",
        "content": [{"type": "text", "text": "Rechtsgrundlage: Art. 6 Abs. 1 lit. b und lit. f DSGVO (Bereitstellung der von Ihnen angeforderten Funktion sowie berechtigtes Interesse an deren technischem Betrieb)."}]
      }
    ]
  }'::jsonb
)
ON CONFLICT (slug) DO UPDATE SET
  title = EXCLUDED.title,
  content = EXCLUDED.content,
  updated_at = NOW();

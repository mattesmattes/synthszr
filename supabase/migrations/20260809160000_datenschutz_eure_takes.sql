-- Datenschutzerklärung um „Eure Takes" (Kommentare + Take-Barometer) ergänzen.
--
-- ⚠ RECHTSTEXT — VOR VERÖFFENTLICHUNG JURISTISCH PRÜFEN. Diese Fassung ist
-- fachlich sauber (deckt die drei meldepflichtigen Punkte des Features ab:
-- Kommentartext-Übermittlung an Anthropic als US-Auftragsverarbeiter,
-- öffentlicher Anzeigename, neue technisch erforderliche Cookies/Local Storage),
-- ersetzt aber keine anwaltliche Prüfung.
--
-- ⚠ Manuell im SQL-Editor ausführen (CLI-Historie nicht synchron).
--
-- NICHT-DESTRUKTIV + IDEMPOTENT: hängt einen neuen Abschnitt an das bestehende
-- content->'content'-Array an (bestehende Klauseln bleiben unangetastet) und
-- läuft dank NOT LIKE-Guard mehrfach ohne Duplikat. `updated_at` wird gebumpt,
-- damit die Übersetzungs-Pipeline (source_updated_at) die fremdsprachigen
-- Fassungen als veraltet erkennt — sie müssen anschließend neu erzeugt werden
-- (Admin → Übersetzungen → für die Datenschutz-Seite auslösen). Bis dahin
-- fallen /en, /cs, /nds, /fr auf den vollständigen deutschen Text zurück; die
-- englische Fassung wird hier direkt mitgeliefert.

-- ---------------------------------------------------------------------------
-- Deutsch (maßgeblich)
-- ---------------------------------------------------------------------------
update static_pages
set
  content = jsonb_set(
    content,
    '{content}',
    (content->'content') || '[
      {"type":"heading","attrs":{"level":2},"content":[{"type":"text","text":"7. Nutzergenerierte Inhalte: Kommentare und Take-Bewertungen"}]},

      {"type":"heading","attrs":{"level":3},"content":[{"type":"text","text":"7.1 Kommentare (Eure Takes)"}]},
      {"type":"paragraph","content":[{"type":"text","text":"Als angemeldete Newsletter-Abonnentin oder -Abonnent können Sie unter unseren Artikeln Kommentare (\"Eure Takes\") veröffentlichen. Dabei verarbeiten wir den von Ihnen gewählten Anzeigenamen, den Kommentartext, Ihre E-Mail-Adresse (zur einmaligen Bestätigung über Ihren bestehenden Abonnenten-Datensatz) sowie den Zeitpunkt der Übermittlung. Anzeigename und Kommentartext sind nach der Freigabe öffentlich auf der jeweiligen Artikelseite sichtbar."}]},
      {"type":"paragraph","content":[{"type":"text","text":"Rechtsgrundlage: Art. 6 Abs. 1 lit. a DSGVO (Einwilligung durch das Absenden des Kommentars). Sie können die Löschung Ihrer Kommentare jederzeit unter hi@oh-so.com verlangen (Art. 17 DSGVO)."}]},

      {"type":"heading","attrs":{"level":3},"content":[{"type":"text","text":"7.2 Automatisierte Moderation (Anthropic)"}]},
      {"type":"paragraph","content":[{"type":"text","text":"Zum Schutz vor Spam, Beleidigungen und rechtswidrigen Inhalten prüfen wir jeden Kommentar automatisiert, bevor er veröffentlicht wird. Hierzu übermitteln wir ausschließlich den Kommentartext und den Titel des betreffenden Artikels an Anthropic PBC (548 Market Street, PMB 90375, San Francisco, CA 94104, USA) als Auftragsverarbeiter. Ihr Name und Ihre E-Mail-Adresse werden dabei nicht übermittelt."}]},
      {"type":"paragraph","content":[{"type":"text","text":"Die Übermittlung in die USA erfolgt auf Grundlage der EU-Standardvertragsklauseln. Rechtsgrundlage: Art. 6 Abs. 1 lit. f DSGVO (berechtigtes Interesse am Schutz vor missbräuchlichen und rechtswidrigen Inhalten)."}]},

      {"type":"heading","attrs":{"level":3},"content":[{"type":"text","text":"7.3 Take-Bewertungen (Take-Barometer)"}]},
      {"type":"paragraph","content":[{"type":"text","text":"Unter jedem \"Synthszr Take\" können Sie anonym mit \"Sehe ich auch so\" oder \"Sehe ich anders\" abstimmen. Dabei werden keine personenbezogenen Daten erhoben. Zur Vermeidung von Mehrfachabstimmungen speichern wir eine zufällige, nicht auf Sie zurückführbare Kennung in einem Cookie (siehe Abschnitt 7.4)."}]},

      {"type":"heading","attrs":{"level":3},"content":[{"type":"text","text":"7.4 Cookies und lokale Speicherung für diese Funktionen"}]},
      {"type":"paragraph","content":[{"type":"text","text":"Für die Kommentar- und Bewertungsfunktion setzen wir folgende technisch erforderliche Cookies und lokale Speicherungen ein:"}]},
      {"type":"paragraph","content":[{"type":"text","marks":[{"type":"bold"}],"text":"synthszr_reader"},{"type":"text","text":" (Cookie, Laufzeit 90 Tage, httpOnly): ermöglicht Ihnen nach einmaliger Bestätigung das Kommentieren, ohne sich erneut verifizieren zu müssen."}]},
      {"type":"paragraph","content":[{"type":"text","marks":[{"type":"bold"}],"text":"synthszr_tb"},{"type":"text","text":" (Cookie, Laufzeit 365 Tage): verhindert Mehrfachabstimmungen beim Take-Barometer."}]},
      {"type":"paragraph","content":[{"type":"text","marks":[{"type":"bold"}],"text":"synthszr_display_name, synthszr_tb_votes"},{"type":"text","text":" (Local Storage): merken sich Ihren zuletzt verwendeten Anzeigenamen und Ihre eigenen Bewertungen ausschließlich auf Ihrem Gerät."}]},
      {"type":"paragraph","content":[{"type":"text","text":"Rechtsgrundlage: Art. 6 Abs. 1 lit. b und lit. f DSGVO (Bereitstellung der von Ihnen angeforderten Funktion sowie berechtigtes Interesse an deren technischem Betrieb)."}]}
    ]'::jsonb
  ),
  updated_at = now()
where slug = 'datenschutz'
  and content::text not like '%Nutzergenerierte Inhalte%';

-- ---------------------------------------------------------------------------
-- Englische Übersetzung (direkt mitgeliefert, damit /en nicht auf DE zurückfällt)
-- ---------------------------------------------------------------------------
update content_translations ct
set
  content = jsonb_set(
    ct.content,
    '{content}',
    (ct.content->'content') || '[
      {"type":"heading","attrs":{"level":2},"content":[{"type":"text","text":"7. User-Generated Content: Comments and Take Ratings"}]},

      {"type":"heading","attrs":{"level":3},"content":[{"type":"text","text":"7.1 Comments (Eure Takes)"}]},
      {"type":"paragraph","content":[{"type":"text","text":"As a registered newsletter subscriber, you can post comments (\"Eure Takes\") below our articles. We process the display name you choose, the comment text, your email address (for one-time confirmation via your existing subscriber record), and the time of submission. Once approved, your display name and comment text are publicly visible on the respective article page."}]},
      {"type":"paragraph","content":[{"type":"text","text":"Legal basis: Art. 6(1)(a) GDPR (consent given by submitting the comment). You may request deletion of your comments at any time at hi@oh-so.com (Art. 17 GDPR)."}]},

      {"type":"heading","attrs":{"level":3},"content":[{"type":"text","text":"7.2 Automated Moderation (Anthropic)"}]},
      {"type":"paragraph","content":[{"type":"text","text":"To protect against spam, abuse, and unlawful content, every comment is checked automatically before it is published. For this purpose we transmit only the comment text and the title of the relevant article to Anthropic PBC (548 Market Street, PMB 90375, San Francisco, CA 94104, USA) as a processor. Your name and email address are not transmitted."}]},
      {"type":"paragraph","content":[{"type":"text","text":"The transfer to the USA takes place on the basis of the EU Standard Contractual Clauses. Legal basis: Art. 6(1)(f) GDPR (legitimate interest in protection against abusive and unlawful content)."}]},

      {"type":"heading","attrs":{"level":3},"content":[{"type":"text","text":"7.3 Take Ratings (Take Barometer)"}]},
      {"type":"paragraph","content":[{"type":"text","text":"Below each \"Synthszr Take\" you can vote anonymously with \"Sehe ich auch so\" (agree) or \"Sehe ich anders\" (disagree). No personal data is collected. To prevent multiple votes, we store a random identifier that cannot be traced back to you in a cookie (see section 7.4)."}]},

      {"type":"heading","attrs":{"level":3},"content":[{"type":"text","text":"7.4 Cookies and Local Storage for These Features"}]},
      {"type":"paragraph","content":[{"type":"text","text":"For the comment and rating features we use the following technically necessary cookies and local storage entries:"}]},
      {"type":"paragraph","content":[{"type":"text","marks":[{"type":"bold"}],"text":"synthszr_reader"},{"type":"text","text":" (cookie, 90-day lifetime, httpOnly): lets you comment after a one-time confirmation without having to verify again."}]},
      {"type":"paragraph","content":[{"type":"text","marks":[{"type":"bold"}],"text":"synthszr_tb"},{"type":"text","text":" (cookie, 365-day lifetime): prevents multiple votes on the Take Barometer."}]},
      {"type":"paragraph","content":[{"type":"text","marks":[{"type":"bold"}],"text":"synthszr_display_name, synthszr_tb_votes"},{"type":"text","text":" (local storage): remember your most recently used display name and your own ratings, stored only on your device."}]},
      {"type":"paragraph","content":[{"type":"text","text":"Legal basis: Art. 6(1)(b) and (f) GDPR (provision of the feature you requested and legitimate interest in its technical operation)."}]}
    ]'::jsonb
  ),
  updated_at = now()
from static_pages sp
where ct.static_page_id = sp.id
  and sp.slug = 'datenschutz'
  and ct.language_code = 'en'
  and ct.content::text not like '%User-Generated Content%';

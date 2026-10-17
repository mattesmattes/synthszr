# Betreiber-Regeln der Morgenkonferenz

**Status: getestet am 2026-10-17 (Label `bt-rules-20261017`, 20 Tage 27.09.–16.10.) — verschlechterte den Unit-Recall@20 um 0,055 [−0,108, −0,006] gegenüber demselben Arm ohne Regeln, Precision@10 fiel unter die Hand-Referenz. Nicht in Produktion setzen; Befund im Spec-Protokoll v4.2 → v4.3.**

Stand 2026-10-17, Fassung 1 für die Backtest-Iteration (Spec v4.3, Weg 2). Quelle für `settings.curation_operator_rules` (`{"text": …}`). Abgeleitet aus dem Backtest precedents-only/full: Treffer, verpasste Abschnitte und nie gewählte Setzlisten-Einheiten über 53 Tage.

## Regeln

1. **Blickwinkel.** Die Leser sind Entwickler, Produktleute und Entscheider in Deutschland, die mit KI bauen. Vorrang hat, was sie heute benutzen, ausprobieren oder bezahlen müssen: neue Modelle und Agenten, Coding-Tools (Claude Code, Codex, Cursor, OpenClaw), APIs, Limits, Preise, Open-Source-Releases, Benchmarks mit Kosten. Eine Meldung mit konkreter Zahl (Preis, Limit, Prozent, Benchmark) schlägt dieselbe Meldung ohne Zahl.

2. **Geld, Gerichte und Infrastruktur-PR nur mit Produktfolge.** Finanzierungsrunden, Bewertungen, IPO-Termine, Quartalszahlen, Aktienkurse, Klagen, Bußgelder, Vergleiche, Ermittlungen und Gesetzentwürfe kommen nur in die Setzliste, wenn sie unmittelbar ändern, was Nutzer bekommen oder zahlen, oder wenn sie die Strategie eines großen Labors verschieben. Ja: OpenAI sperrt Cursor aus, Nvidia kauft Hugging Face. Nein: Subpoena in Alabama, Uber-Strafe, Broadcom-Quartal, Series C eines Chip-Startups, Urteil zu Googles Ad-Tech. Pressemitteilungen aus Firmen-Newsrooms zu Chips, Rechenzentren, Produktionsstarts und Partnerschaften (Nvidia Newsroom, SK hynix, Huawei, Broadcom, Qualcomm) nicht als eigene Einheit. Höchstens eine Geld- oder Gerichtsmeldung pro Tag, nie als cover_story.

3. **Agenten-Sicherheit ist Kernthema.** Agenten, die hacken, täuschen, Sandboxes verlassen, Skills stehlen oder fremden Code einschleusen; neue Angriffswege auf Coding-Agenten, MCP und Skills; Vorfallberichte der Labore. Allgemeine IT-Sicherheit ohne KI-Bezug (Patchdays, Datenlecks, Security-Aktien) nicht.

4. **Jede Geschichte nur einmal.** Sie läuft an dem Tag, an dem sie passiert. Reaktionen, Interviews, X-Posts, Postmortems und „inside stories“ zu einer Geschichte, die schon lief, höchstens als eine recap-Einheit pro Tag und nur mit neuem Fakt. Eine Geschichte, die seit Tagen in den Cards steht und nie veröffentlicht wurde, nicht erneut als topic oder cover_story vorschlagen.

5. **Deutschland und Europa heben eine Meldung um eine Stufe.** Deutsche Firmen und Startups (Berlin, München), Bundesregierung, EU-Regeln mit direkter Wirkung, Mistral, Aleph Alpha, n8n, SAP, Deutsche Bank, deutsche Entwickler-Communities. Auch kleinere Nachrichten mit diesem Bezug gehören in die Setzliste.

6. **Stimmen mit These.** Einordnungen bekannter Autoren und Praktiker (Ben Thompson, Benedict Evans, Simon Willison, Ethan Mollick, Steven Sinofsky, Azeem Azhar, Lenny Rachitsky, Every, Zvi Mowshowitz, Noah Smith, a16z-Partner, Gründer und CTOs) als deep_dive oder recap, wenn sie eine klare These aufstellen oder einer widersprechen. Nacherzählungen von Nachrichten in Newslettern sind keine Stimme.

7. **Politik nur von den Hauptakteuren.** US-Präsident, Xi, EU-Kommission, Bundesregierung, Chefs der großen Labore (Altman, Amodei, Musk, Huang, Zuckerberg, Pichai) und beschlossene Maßnahmen. Appelle, Briefe und Statements von Gouverneuren, Bürgermeistern, Abgeordneten, Royals, Verbänden, PR-Koalitionen oder Beratungen (McKinsey) nicht.

8. **Arbeit und Organisation mit KI.** Wie Firmen und Teams mit KI arbeiten: Produktivitätsstudien, neue Rollen und Titel, Einstellungsregeln, Umbau ganzer Abteilungen, Erfahrungsberichte von Gründern (UBS, Goldman, Shopify, Glassdoor-Stimmung, „zwei Engineers mit Agentenflotte“). Auch wenn die Quelle kein Tech-Medium ist.

## Belege (Backtest 25.08.–16.10.)

- Treffer kamen vor allem aus Reuters (16), The Verge (13), CNBC (11), The New Stack (10), VentureBeat (9), Anthropic (8). Verpasst trotz Pool: Techpresso (15), Linas's Newsletter (7), MyClaw (6), The Deep View (6), AI Weekly Espresso (5), The Decoder (4). Nie gewählt trotz Setzliste: Techpresso (33), Reuters (30), CNBC (26), WSJ (15), AI Weekly Espresso (14), The Information (13).
- Regel 1/8: verpasst u. a. Codex-Fünf-Stunden-Limit, Playwright-CLI für Agenten, AGENTS.md in Claude Code, Perplexity lokal, Nvidia-Router fürs Heimnetz, Vercel „Is Agentic“, Google-Videopreis 3 Cent, DeepSeek-Preiserhöhung, Shopify-Chef Lütke, Julie Zhuo, Notion/Snowflake.
- Regel 2: nie gewählt u. a. Hugging-Face-Bewertung, Alabama-Subpoena, Uber-Strafe, Meta-Vergleich, Sony/Warner-Klage, Broadcom- und Oracle-Quartal, Cognition 48 Mrd., Crusoe, Positron, Nvidia Newsroom Groq 3 LPX (zweimal), SK hynix, Huawei.
- Regel 3: veröffentlicht u. a. DeepSeek-Angreifer, Agenten-Skills-Diebstahl, Fake-Maintainer auf GitHub, Sandbox-Ausbruch, Fortune-500-Code; nie gewählt: Microsoft-Patchday, IDScan-Leck, CrowdStrike-Rally.
- Regel 4: die Hugging-Face-Hack-Geschichte und der Nvidia-Kauf standen an sechs bzw. fünf Tagen in der Setzliste, veröffentlicht wurde je einmal.
- Regel 5: veröffentlicht n8n-Chef, RobCo, Deutsche Bank, Merkel, Berliner Verwaltungsdaten, SAP, Scalable, Münchner Putzroboter, Mistral, Cohere/Aleph Alpha, EU-DSA.
- Regel 6/7: veröffentlicht Benedict Evans, Sinofsky, Thompson, Mollick, a16z, Every/Lenny; nie gewählt Governor Spanberger, Mayor Mamdani, King Charles, „Political world erupts“, Lawmakers blast, McKinsey Highlights (zweimal).

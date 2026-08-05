# Briefing: Lexikonseiten beschleunigen (708 KB JS)

Stand 2026-08-05, letzter Commit `a3bfc4b`. Alles unten Gemessene stammt von
`www.synthszr.com`, nicht von einem Dev-Server.

## Die Aufgabe

Die Lexikonseiten (`/[lang]/glossary/[slug]`) fühlen sich langsam an. Die Messung
zeigt: **nicht der Server ist das Problem, sondern das JavaScript.**

| Größe | Wert | Bewertung |
|---|---|---|
| TTFB, gecacht | 86–129 ms | unauffällig |
| TTFB, Cache umgangen | 91 ms | unauffällig |
| HTML | 93 KB (davon 21 KB RSC-Payload) | grenzwertig, nicht kritisch |
| Illustrationsbild | 22 KB PNG | unauffällig |
| **JavaScript** | **708 KB in 12 Chunks** | **der Engpass** |

Zum Vergleich: die Artikelseite liefert ihr HTML in 280 ms, ist also *langsamer*
im TTFB — die Lexikonseite ist serverseitig schon gut. Die wahrgenommene
Langsamkeit liegt vollständig im Herunterladen, Parsen und Ausführen des Bundles.

## Warum das strukturell ist

Die Seite rendert ihren Inhalt **serverseitig** über
`lib/tiptap/render-static-html.ts` (`generateHTML` aus `@tiptap/html`) — zieht
aber über ihre Client-Komponenten den Editor-Stack mit. Für eine Seite, die im
Kern statischer Text ist, zahlt sie den Preis einer Editor-Anwendung.

Kandidaten, absteigend nach vermuteter Größe:

1. **TipTap/ProseMirror** — `renderStaticArticleHtml` importiert StarterKit und
   alle Marks (`GlossaryLinkMark`, Link, …). Wenn dieser Import in den
   Client-Graph gerät, kommt der halbe Editor mit, obwohl auf der Seite kein
   Editor läuft. **Das ist die erste Hypothese und muss zuerst belegt werden.**
2. **Root-Layout** (`app/layout.tsx`): `SearchOverlay`, `NewsletterPopup`,
   `ConsentBanner`, `Analytics`, `PageTracker` laden auf JEDER Seite mit, obwohl
   sie erst bei Interaktion gebraucht werden.
3. **Produktkarten** unter dem Text — zeigen Logo, Name, Score, also statischen
   Inhalt, brauchen aber derzeit Client-Komponenten.
4. `BloomLanguageSwitcher` (Sprachwechsel, Client).

## Vorgehen

1. **Messen, nicht raten.** `@next/bundle-analyzer` oder `next build --profile`,
   dann feststellen, welche Chunks die Lexikonseite tatsächlich lädt und woher
   ProseMirror kommt. Erst danach entscheiden.
2. **TipTap serverseitig isolieren**, falls die Hypothese trägt: `server-only`
   auf dem Renderer, oder das HTML im Loader erzeugen statt in der Seite.
3. **Root-Layout entlasten**: `next/dynamic` mit `ssr: false` für die
   interaktionsgetriebenen Komponenten.
4. **Nach jedem Schritt neu messen** — 708 KB ist der Ausgangswert.

## Fallen in diesem Projekt (teuer gelernt)

- **Vercel ignoriert `revalidate` ohne `generateStaticParams`.** Ein leeres
  `generateStaticParams()` aktiviert ISR bei dynamischen Segmenten.
- **Vercel baut mit pnpm** — das Lockfile muss passen.
- **`.next` liegt in Dropbox.** Der Sync hält Dateien und lässt `rm -rf .next`
  mit `ENOTEMPTY` scheitern; `mv .next <scratchpad>` funktioniert immer.
- **Kein lokaler Dev-Server für Verifikation.** Immer gegen Prod prüfen (`curl`),
  so will es der Betreiber.
- **Lokale Keys sind teils veraltet**: `OPENAI_API_KEY` antwortet mit 401 (also
  keine Bildgenerierung lokal), `ANTHROPIC_API_KEY` funktioniert. Prod-Keys per
  `vercel env pull --environment=production`.
- **`supabase-js` parst den Select-String zur Compile-Zeit.** Ein Ternär darin
  ergibt `ParserError`; Cast auf das breitere Literal.
- **PostgREST kappt still bei 1000 Zeilen** ohne `range()`. Hat hier schon 34 %
  Datenverlust verursacht.
- **Egress:** niemals `includeHistory=true` in Renderpfaden — das `history`-JSONB
  war die Ursache einer 359-GB-Overage.

## Offene Punkte aus der Vorsession

### 1. Anführungszeichen: Umbau auf Blockebene (klar umrissen)

`lib/typography/quotes.ts` setzt landessprachliche Anführungszeichen und ist in
**allen drei** Renderpfaden eingebunden (SSR, Client-ProseMirror, E-Mail). Zwei
Fehler bleiben, an einer echten Seite gesehen
(`/de/glossary/transformer`): `Titel "Attention Is All You Need„` und `Das “T"`.

Ursachen, beide belegt:

- **Der Zustandsautomat läuft pro Textknoten**, ein Zitat läuft aber über
  Knotengrenzen — die Mark-Injektion teilt den Knoten auf, wenn sie einen Begriff
  im Zitat verlinkt. Öffnendes und schließendes Zeichen liegen dann in
  verschiedenen Knoten, und „ist offen" beginnt in jedem neu.
- **Das Modell liefert schon gemischte Zeichen** (`"`, `“`, `„`). Ersetzt werden
  nur die geraden — dadurch entsteht die Mischung erst.

Fix: `applyTypographicQuotes` pro **Block** (`paragraph`, `listItem`, …) statt pro
Textknoten — Text aller Kindknoten einsammeln, Paare über die Gesamtlänge
bestimmen, Ersetzungen zurückverteilen. Davor `[“”„‟«»]` → `"` normalisieren.
Tests für: Zitat über zwei Knoten, Zitat um einen Link, bereits typografischer
Text, unpaariges `24"`.

### 2. Nachverlinkung des Bestands nachziehen

Drei Änderungen an der Verlinkungslogik wirken erst beim nächsten Durchgang auf
die 220 bestehenden Artikel:

- Flexionsendungen (`Grafikkarten` statt `[Grafikkarte]n`)
- Überschriften werden übersprungen (Begriff wandert in den Fließtext)
- Dubletten bereinigt (33 mehrdeutige Namen → 0, 93 Begriffe)

Auslösen über Admin → Lexikon → **Artikel-Crawl** → Datum früh setzen →
„Artikel nachverlinken". Läuft ohne Modell, kostet nichts.

### 3. Illustrationen des heutigen Artikels

Der Begriffslauf hat alle **48 fehlenden Texte erzeugt** (0 gescheitert) und 24
Begriffe im Artikel verlinkt. Die **Bilder fehlen**, weil der lokale
OpenAI-Key mit 401 antwortet — ein Klick auf „Alle fehlenden Illustrationen
erzeugen" im Crawl-Tab holt sie nach (läuft in Runden, Fenster offen lassen).

### 4. Kleinere Reste

- **E-Mail-Pfad**: Anführungszeichen sind eingebunden, aber im Versand nie
  verifiziert — beim nächsten Newsletter gegenprüfen.
- **`{lex:}`-Tags** zu noch nicht erzeugten Begriffen bleiben als Text sichtbar,
  bis der Begriff existiert. Der DOM-Prozessor löst sie inzwischen korrekt auf
  (`lib/tiptap/dom-processors/company-tags.ts`), aber ein Tag ohne Begriff hat
  kein Ziel.
- **`fetchpriority="high"`** erscheint trotz `priority` nicht im HTML der
  Lexikonseite; `loading="lazy"` ist weg, der LCP-Blocker also behoben.

## Wo die Wahrheit steht

- Verlinkung: `lib/glossary/inject-marks.ts`, `lib/glossary/mentions.ts`
- Nachverlinkung Bestand: `lib/glossary/backfill.ts`
- Begriffserzeugung: `lib/glossary/generate.ts`, `lib/glossary/draft-writer.ts`
- Crawl und Warteschlange: `lib/glossary/crawl.ts`
- Renderpfade: `lib/tiptap/render-static-html.ts` (SSR),
  `components/tiptap-renderer/` (Client), `lib/email/tiptap-to-html.ts` (E-Mail)
- Typografie: `lib/typography/quotes.ts`

Suite: 959 Tests, alle grün. `tsc` clean, `npm run build` exit 0.

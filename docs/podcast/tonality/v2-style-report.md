# Podcast-Tonalität v2: Stilbericht (2026-11-14)

Auftrag (Betreiber 2026-11-14): Die bisherige Tonalität archivieren
(`v1-archive-2026-11-14.md`) und das Skript so umstellen, dass der HOST (Emma)
in Tonlage und Gesprächsführung der Co-Moderatorin und der GUEST (Synthesizer)
dem Co-Moderator eines bekannten US-Tech-Business-Podcasts entspricht, geprüft
an drei vollständigen Transkripten dieser Sendung (HappyScribe, maschinell).
Die Vorlagen beschreiben nur Merkmale; Namen, Sendung und Schlagworte stehen
nirgends im Prompt (Test `tests/lib/podcast-voice-style.test.ts`).

## Was geändert ist

- `lib/podcast/voice-style.ts`: neue Stimmen (VOICE_STYLE_EN/DE) und
  Folgenaufbau mit Self-Check (EPISODE_SHAPE_EN/DE), eingesetzt über die
  Platzhalter `{voiceStyle}` und `{episodeShape}`.
- `lib/podcast/script-templates.ts`: die beiden Vorlagen, aus der Route
  ausgelagert. Gestrichen: Rollen-Zweizeiler, Quoten-Realismus (genau 3
  Missverständnisse, genau 2 Meinungsverschiedenheiten), 4-Block-Struktur.
  Beispiel-Sprechanweisungen in der neuen Tonlage.
- `lib/podcast/dialogue-style.ts`: Regeln 4, 7, 8, 9 (Unterbrechungen vor
  allem durch den HOST; zweigeteilte Zeilenlängen mit zwei bis drei Riffs von
  120 bis 200 Wörtern; HOST-Einstieg mit Urteil; GUEST mit These, Vergleich
  und Prognose) und ein neues, unordentlicheres Beispiel.
- `lib/podcast/personality.ts`: Die Beziehungsgeschichte bleibt, klingt aber
  wie langjährige Co-Hosts statt wie ein Melodram (Klang-Regel, Stufe 4 mit
  1-2 statt 2-3 Momenten, keine wehmütigen Beispielsätze mehr, Schluss mit
  einem ernsten Satz, sofort gebrochen).
- `lib/podcast/intermezzo.ts`: Ton des Reflexionsblocks an die Stimmen
  angepasst.
- `scripts/podcast-style-dryrun.ts`: baut System- und User-Prompt aus Dateien
  wie die Route (ohne Wochen-Modi, Gedächtnis, Smalltalk); mit `--call` und
  `ANTHROPIC_API_KEY` auch der echte Modellaufruf.

## Vorgehen beim Test

Prompts aus dem Post vom 14.11.2026 (`5bd522fa-…`, englische Übersetzung,
2.818 Wörter) und dem Persönlichkeitsstand vor Folge 376 gebaut. Das Skript
schrieb jeweils ein Stellvertreter-Lauf mit exakt diesen Prompts (für den
Produktionsaufruf `podcast_script`; ohne API-Schlüssel in dieser Umgebung). Bewertet hat ein unabhängiger Prüf-Lauf, der die
Transkripte, den Post und das Skript liest und fünf Dimensionen von 1 bis 10
benotet (10 = in Ton und Mechanik nicht von den Vorbildern zu unterscheiden),
plus Prüfungen auf reale Namen, erfundene Fakten und Format. Ab Runde 6 kannte
der Prüfer die bewussten Produktgrenzen (15 Minuten mit zehn Geschichten statt
70 Minuten, nur leichte Flüche, keine erfundenen Insider-Quellen).

## Noten (HOST / GUEST / Dynamik / Humor / Gesamteindruck)

| Lauf | HOST | GUEST | Dynamik | Humor | Gesamt | Mittel |
|---|---|---|---|---|---|---|
| v1 (Skript 14.11.) | 4 | 4 | 4 | 2 | 3 | 3,4 |
| v2 Runde 1 | 6 | 6 | 6 | 5 | 5,5 | 5,7 |
| v2 Runde 2 | 6 | 7 | 6 | 6 | 6 | 6,2 |
| v2 Runde 3 | 7 | 6,5 | 7 | 7 | 6,5 | 6,8 |
| v2 Runde 4 | 7 | 7 | 7 | 7 | 7 | 7,0 |
| v2 Runde 5 | 7 | 7,5 | 7 | 6,5 | 7 | 7,0 |
| v2 Runde 6 | 7 | 7 | 7 | 7,5 | 7 | 7,1 |
| v2 Runde 7 (Stand im Code) | 7 | 7,5 | 6,5 | 6,5 | 7 | 6,9 |

Ziel „sehr hohe Deckung“ war: jede Dimension mindestens 8, Gesamteindruck
mindestens 8,5. Erreicht ist es nicht; seit Runde 4 liegt die Bewertung stabil
bei etwa 7, die Streuung des Prüfers liegt bei etwa ±0,5.

## Messwerte (HOST / GUEST)

Wörter je Turn (Median), Anteil Turns mit höchstens drei Wörtern, Anteil Turns
mit 60 und mehr Wörtern, 90. Perzentil der Turnlänge, Redeanteil, Anteil
Turns mit Frage. Aufeinanderfolgende Zeilen derselben Stimme zählen als ein
Turn, wie im Transkript.

| Quelle | Median | ≤ 3 Wörter | ≥ 60 Wörter | p90 | Redeanteil | Fragen |
|---|---|---|---|---|---|---|
| Referenz A (Transkript) | 8 / 16 | 0.25 / 0.11 | 0.16 / 0.25 | 94 / 111 | 0.43 / 0.57 | 0.20 / 0.24 |
| Referenz B (Transkript) | 9 / 7.5 | 0.34 / 0.36 | 0.20 / 0.19 | 162 / 178 | 0.51 / 0.49 | 0.23 / 0.17 |
| v1 (Skript 14.11.) | 13 / 22 | 0.08 / 0.05 | 0.02 / 0.00 | 52 / 38 | 0.48 / 0.52 | 0.43 / 0.08 |
| v2 Runde 1 | 7 / 13 | 0.10 / 0.04 | 0.18 / 0.22 | 79 / 88 | 0.43 / 0.57 | 0.35 / 0.14 |
| v2 Runde 2 | 7 / 21 | 0.35 / 0.10 | 0.16 / 0.16 | 75 / 81 | 0.40 / 0.60 | 0.06 / 0.12 |
| v2 Runde 3 | 8 / 17 | 0.25 / 0.08 | 0.17 / 0.05 | 72 / 56 | 0.49 / 0.51 | 0.05 / 0.12 |
| v2 Runde 4 | 5 / 16 | 0.27 / 0.14 | 0.10 / 0.10 | 59 / 58 | 0.43 / 0.57 | 0.21 / 0.14 |
| v2 Runde 5 | 7.5 / 16 | 0.19 / 0.16 | 0.10 / 0.12 | 68 / 63 | 0.40 / 0.60 | 0.17 / 0.12 |
| v2 Runde 6 | 7 / 12 | 0.20 / 0.17 | 0.07 / 0.08 | 57 / 59 | 0.44 / 0.56 | 0.18 / 0.15 |
| v2 Runde 7 | 8 / 11 | 0.28 / 0.12 | 0.14 / 0.14 | 83 / 65 | 0.49 / 0.51 | 0.14 / 0.11 |

Runde 7 liegt bei den Messwerten im Bereich der Vorlagen; die Lücke, die der
Prüfer sieht, ist Textur, nicht Statistik.

## Was der Prüfer zuletzt noch vermisst

- Zu poliert: Pointen und Aphorismen fast in jedem Wechsel, eine
  Sitcom-Kadenz statt loser, abschweifender Rede.
- Kurze Zeilen sind meist Pointen, kaum schlichte Rückmeldungen.
- Wiederkehrende Übergabe-Muster trotz der Regel „kein Muster mehr als zweimal“.
- Vereinzelt leichte Faktenunschärfen (eine Funktion falsch zugeordnet,
  „viele“ aufgerundet); die Regel dazu steht im Prompt.

## Warum es bei etwa 7 stehen bleibt

1. **Dichte:** Zehn Geschichten in 15 Minuten lassen keinen Raum für das
   Abschweifen, das die Vorbilder in 70 Minuten mit wenigen Themen haben.
2. **Geschrieben statt gesprochen:** Ein Skript in einem Durchgang wird glatter
   als ein mitgeschnittenes Gespräch. Jede vorgeschriebene „Unordnung“ wurde in
   den Tests selbst zur Schablone (z. B. dreimal dieselbe gespielte
   Selbstkorrektur in Runde 3).
3. **Bewusste Grenzen:** keine erfundenen Insider-Geschichten der Moderatorin,
   nur leichte Flüche, die Takes des Artikels als Inhalt des GUEST.

## Hebel, falls mehr Deckung gewünscht ist (Entscheidung des Betreibers)

- Weniger Geschichten pro Folge oder längere Folgen.
- Derbere Sprache zulassen.
- Ein zweiter Durchgang, der nur die Textur überarbeitet (Pointen streichen,
  Rückmeldungen einstreuen), wie der Take-Durchgang im Ghostwriter.

## Nachtrag: Tagesregie, Texturdurchgang und Fünf-Folgen-Test (2026-11-14)

Umgesetzt sind die drei Hebel oben, soweit der Betreiber sie freigegeben hat:
derbere Sprache bis zum F-Wort (je Folge über die Regie geregelt), ein
zweiter Durchgang nur für die Textur und gegen die Schablone ein Generator,
der jede Folge anders ausrichtet. Er besteht aus der Tagesregie mit sieben
Achsen (Form, Temperatur, Stilmittel, Bildwelt, Segment, Derbheit, Schluss)
und einem Fingerabdruck der letzten Folgen. Technik und Dateien stehen in
CLAUDE.md, „Podcast: Tagesregie, Fingerabdruck, Texturdurchgang, derbe
Sprache“.

### Testaufbau

Fünf echte Posts vom 10. bis 14.11.2026, jede Stufe wie in der Route:
Sampler mit fortgeschriebener Historie, Regisseur, Skript, Texturdurchgang,
harte Prüfung. Die Modellaufrufe übernahmen Stellvertreter-Läufe mit exakt
den Produktions-Prompts. Bewertet haben unabhängige Prüf-Läufe: je Folge ein
Stil-Prüfer mit dem bisherigen Maßstab und ein Vielfalts-Prüfer über alle
fünf Folgen. Die Tage 0 bis 2 liefen parallel (der Fingerabdruck sah dort nur
den ersten Lauf von Tag 0), die Tage 3 und 4 sahen die drei Vorgänger. Das
ist strenger als die Produktion, wo jede Folge alle Vorgänger sieht.

### Was der Test gefunden und behoben hat

1. Der Texturdurchgang strich durchlaufende Spitznamen als „verbraucht“
   (13 von 15). Er bekommt jetzt die Stilmittel des Tages, und die Prüfung
   verwirft Fassungen, in denen mehrfach genannte Namen fehlen.
2. Er teilte die langen Riffs mit eingestreuten Rückmeldungen (drei Zeilen
   über 120 Wörter wurden zu null). Riffs über 100 Wörter bleiben jetzt eine
   Zeile, auch das prüft die harte Prüfung.
3. Schablonen aus der eigenen Vorgabe: Jeder Ausbruch endete mit „sollte
   sich schämen“, Emma kündigte ihr „Urteil“ an, fast jede Geschichte war
   Widerspruch plus Pointe. Die Vorgaben sind umformuliert: kein moralischer
   Refrain, mehrere Geschichten gemeinsam gebaut, wechselnde Geschichtsenden.
4. Beide Stimmen sprachen die Takes des Artikels fast wörtlich nach. Stellen
   ab acht Wörtern am Stück erkennt jetzt `articleEchoes`, der
   Texturdurchgang formuliert sie um. In den Folgen danach sank die Zahl von
   acht auf zwei je Folge.
5. Schlichte Rückmeldungen („Mm-hm.“) standen als verbraucht im
   Fingerabdruck; sie sind ausgenommen.
6. Fünfmal derselbe Schluss und derselbe Running Gag aus dem
   Persönlichkeits-Gedächtnis: Der Schluss ist jetzt die siebte
   Regie-Achse, und je Folge ist nur ein Callback erlaubt, rotiert über die
   Folgennummer. Dieser letzte Fix kam nach dem Test und ist nur durch
   Unit-Tests abgesichert.

### Ergebnisse

Texturdurchgang: in allen fünf Folgen übernommen (nach den Fixes 1 und 2),
Länge −1 bis −6 %, Riffs erhalten.

Stil (HOST / GUEST / Dynamik / Humor / Gesamt):

| Folge | Regie (Form, Temperatur, Derbheit) | Noten | Mittel |
|---|---|---|---|
| Tag 0, 10.11. | Emma übernimmt, Kreuzzug gegen Skepsis, deftig | 6,5 / 5,5 / 6 / 6 / 6 | 6,0 |
| Tag 1, 11.11. | Tiefenbohrung, albern, ungefiltert | 6,5 / 6 / 6 / 6 / 6 | 6,1 |
| Tag 2, 12.11. | ein großer Streit, trocken und müde, sauber | 7 / 7 / 6,5 / 6 / 6,5 | 6,6 |
| Tag 3, 13.11. | Blitzrunde, wütend gegen trotzig, deftig | 6,5 / 6 / 6,5 / 6 / 6,5 | 6,3 |
| Tag 4, 14.11. | Einigkeit, vergnügte Zyniker, deftig | 7 / 6,5 / 6,5 / 6 / 6,5 | 6,5 |

Die Stil-Deckung liegt mit etwa 6,3 unter Runde 7 (6,9). Das ist der Preis
der Vielfalt: Der Prüfer misst gegen eine Sendung mit fester Form, und
Formen wie „Blitzrunde“ oder „Einigkeit“ weichen bewusst davon ab. Am
besten schneiden Tage mit einem großen Streit ab. Wiederkehrende Kritik:
Der Professor redet zu wenig am Stück (GUEST-Anteil 41–50 % statt 57 %,
nachgezogen), Takes klingen zu sehr nach dem Artikel (nachgezogen), Humor
zu sauber.

Vielfalt über die fünf Folgen (1–10): Form 6, Stilmittel 7,
Wendungen 5, Einstiege und Schlüsse 5, Stimmen gleich geblieben 9. Messung
ohne Modell: keine Wendung und keine Kurzzeile in drei oder mehr der fünf
Folgen (Fingerabdruck mit Schwelle 3), stilistische 3-Gramme je Paar mit
Jaccard 0,003 bis 0,008. Die Schwächen bei Wendungen und Schlüssen kamen vor
allem aus dem gleichen Schluss-Ritual und einem Callback, der jeden Tag
wiederkam (Fix 6), sowie aus Verbindungsfloskeln, die in der Produktion der
Fingerabdruck über sieben Folgen erfasst.

### Kosten

Regisseur (Sonnet 5) etwa 0,03 USD und Texturdurchgang (Opus 5.5) etwa
0,12 USD je Folge, zusammen etwa 0,15 USD Mehrkosten; die Erzeugung dauert
ein bis zwei Minuten länger.


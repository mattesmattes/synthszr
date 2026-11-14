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

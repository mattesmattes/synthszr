# AI WEEK Wrap-Up: Recherche-Schritt und „Synthszr Update“ (Spec, 2026-10-24)

Betreiber-Auftrag (verbesserter Prompt, freigegeben am 2026-10-24):

Erweitere den AI WEEK Wrap-Up (lib/wrapup/*) um einen Recherche-Schritt und ein „Synthszr Update“.

## Ausgangslage (kennen, nicht ändern)
- collect.ts holt je Wochentag den Topic-Abschnitt des Tagesartikels. Der Bericht wird als rohe TipTap-Knoten übernommen, weil die Quellenlinks nur in den link-Marks stecken.
- generate.ts macht EINEN Opus-Tool-Call über alle Themen (intro, excerptBullets, gekürzter take, optional bridge). assemble.ts setzt die Teile zusammen.
- Web-Recherche gibt es im Wrap-Up bisher nicht. Das Muster steht in lib/rankings/research.ts: Anthropic-Server-Tool web_search_20250305, max_uses, Citation-Stripping, Timeout, Quellenpflicht.

## Ziel
Für jede Nachricht der Woche prüfen, ob sich die Story zwischen dem Erscheinen des Tagesartikels und dem Bau des Wrap-Ups weiterentwickelt hat. Wo ja, ersetzt ein „Synthszr Update“ den gekürzten Take: Es sagt, wie die Story weitergegangen ist und ob die ursprüngliche Einschätzung gehalten hat. Das Intro teasert die Updates an.

## Schritt 1: Recherche (neu, lib/wrapup/research.ts)
- Je Thema ein eigener Aufruf mit web_search (max_uses 4), parallel über alle Themen, Timeout 90 s je Thema. Danach wie bisher EIN Compose-Aufruf über die ganze Woche, damit bridge weiter die ganze Woche sieht.
- Input je Thema: Headline, Datum des Tagesartikels, Bericht, Original-Take.
- Ergebnis per Tool-Call: { updateLevel: 'none' | 'minor' | 'major', summary, sources: [{ url, title, date }] }.
- Ein Update zählt nur, wenn die Quelle NACH dem Datum des Tagesartikels liegt und einen neuen Sachverhalt bringt: Reaktion, Korrektur, Folgeentscheidung, neue Zahl, Dementi, Gegenangebot, Marktreaktion. Dieselbe Nachricht in einem anderen Medium ist kein Update. Ohne datierte Quelle: 'none'.
- 'none' ist der Normalfall. Lieber kein Update als ein konstruiertes.
- 'major' nur, wenn das Update die Einschätzung des Original-Takes verändert oder die Story einen neuen Hauptakteur, eine Entscheidung oder eine Zahl in anderer Größenordnung bekommt. Mehr Berichterstattung allein ist 'minor'.
- Modell über neuen Use Case 'wrapup_research' in lib/ai/use-cases.ts (Default claude-sonnet-5, allowedProviders anthropic), Usage-Logging wie bei ranking_research.

## Schritt 2: Schreiben (generate.ts erweitern)
Der Compose-Aufruf bekommt je Thema zusätzlich updateLevel, summary und sources. Regeln für den System-Prompt:

- Je Nachricht gilt eine von drei Stufen.
- none: wie bisher ein gekürzter „Synthszr Take“, 40 bis 60 Wörter. Bericht unverändert.
- minor: ein „Synthszr Update“, 40 bis 60 Wörter. Der erste Satz nennt, was seit dem Tagesartikel passiert ist, mit Datum oder Akteur. Danach: Was heißt das für die ursprüngliche Einschätzung, bestätigt sie das oder kippt sie? Bericht unverändert.
- major: ein „Synthszr Update“, bis 120 Wörter. Der Bericht darf auf etwa die Hälfte gekürzt werden (siehe unten).
- Das Update ersetzt den Take, es gibt nie beides. Jede neue Zahl und jeder neue Fakt im Update muss aus der Recherche stammen. Der Original-Take bleibt als Haltung erkennbar, das Update sagt ausdrücklich, ob er gehalten hat.
- Intro: 3 bis 4 Zeilen These zur Woche wie bisher. Gibt es Updates, benennt das Intro in höchstens zwei Sätzen, welche Storys sich in der Woche bewegt haben und in welche Richtung. Keine Aufzählung, kein „mehr dazu unten“. Gibt es keine Updates, gibt es auch keinen Teaser.

## Kürzen des Berichts (nur bei major)
Kürzen heißt hier: ganze Absätze weglassen. Die Quellenlinks hängen an den Knoten, umformulierte Sätze verlören sie. Das Modell gibt je Thema die Indizes der Absätze zurück, die bleiben (keepParagraphs); assemble.ts übernimmt genau diese bodyNodes. Der erste Absatz bleibt immer, mindestens zwei Absätze bleiben, Ziel etwa 50 % der Wörter.

## Label und Darstellung
- „Synthszr Update:“ setzt der Zusammenbau, nicht das Modell (wie heute der Take-Prefix in assemble.ts).
- Renderer (components/tiptap-renderer/*, lib/tiptap/dom-processors/*), E-Mail-HTML (lib/email/tiptap-to-html.ts, Regex Take|Contra) und Take-Barometer erkennen „Update“ heute nicht. Ergänzen, sonst fehlen gelbes Label, Barometer und Vote-Block. lib/posts/take-exemplars.ts prüfen, damit Updates nicht als Vorbilder für Tages-Takes dienen.
- Unter jedem Update ein Absatz „Update-Quellen:“ mit den Recherche-Links als link-Marks (Titel verlinkt, Datum dahinter).

## Grenzen
- Route maxDuration 300 s. Recherche parallel, Compose danach. Scheitert die Recherche eines Themas oder läuft in den Timeout, gilt für dieses Thema 'none' und der Wrap-Up entsteht trotzdem. Fehler mit Prefix [WeekWrapup] loggen.
- Keine Änderung an week.ts (Wochenlogik), Slug-Bildung oder Draft-Status.
- Keine {Company}- und keine {lex:}-Tags im Update. Lexikon-Links kommen wie bisher aus injectGlossaryMarks.

## Prüfen
1. Unit-Tests für assemble.ts: keepParagraphs, Update statt Take, Quellen-Absatz, kein Teaser ohne Updates.
2. Trockenlauf-Script nach dem Muster von scripts/_wrapup_dry.ts: Recherche für die letzte abgeschlossene Woche ausführen, je Thema updateLevel, summary und Quellen ausgeben, nichts schreiben, Kosten aus llm_usage ausweisen.
3. Danach ein echter Entwurf über den Admin-Button und Sichtprüfung im Editor: Label, Barometer, Links, Längen.

## Festgelegte Annahmen (Betreiber hat sie am 2026-10-24 nicht gekippt)
- Dreistufig (none/minor/major) statt stufenlos; Wortbudgets 40 bis 60 bzw. bis 120.
- Das Update ersetzt den Take; nie beides untereinander.
- Recherche als eigener Aufruf je Thema, parallel; der Compose-Aufruf bleibt einer.

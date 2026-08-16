# Take-Winkel-Diversität — Design-Spec

**Datum:** 2026-07-13
**Status:** Design approved, bereit für Implementierungsplan
**Datei im Fokus:** `lib/claude/ghostwriter-pipeline.ts` (+ `lib/claude/normalize-plan.ts`)

## Problem

Die Synthszr Takes eines Tages-Digests sind einzeln handwerklich stark (klare Haltung, konkret, keine Kontrast-Konstruktionen, keine Em-Dashes — die Anti-Tell-Regeln greifen), aber als **Gruppe monoton**: In der Stichprobe (13.07-Post) mündeten 8 von 10 Takes in dieselbe Kern-These „Das Modell wird zur Commodity, der Wert wandert nach unten zu Chips/Strom/Rechenzentren". Ein aufmerksamer Leser liest zehnmal dasselbe Argument.

**Ursache (strukturell):** Takes werden isoliert pro Sektion generiert (`writeSection`, Concurrency 6). Kein Take weiß, was die anderen sagen, also greift jeder zur naheliegendsten Makro-These. Verstärkt wird das durch das Mattes-Korpus-Retrieval: ähnliche News ziehen ähnliche Passagen (drei Treffer zur selben „Intelligenz wird billig"-These bei einer einzigen Query), was die Wiederholung befeuert statt sie zu brechen.

**Der einzige Ort mit Gesamtblick** ist `planArticle` — ein Call über alle ≤40 Items. Diversität kann also nur dort oben erzwungen werden.

## Ziel & Erfolgskriterien

- Die Take-Konklusionen eines Posts clustern **nicht** mehr auf eine einzige Aussage.
- Höchstens 1–2 Takes tragen die übergreifende `thesis` direkt; die übrigen beleuchten je einen anderen Aspekt.
- Als Nebeneffekt: verschiedene Takes ziehen **verschiedene** Mattes/Code-Crash-Konzepte (Intent, Jevons, Compute-Disziplin, Hidden Champion) statt zehnmal „Commodity" — die Autorenstimme wird breiter, nicht schwächer.
- **Keine** zusätzlichen LLM-Calls, Parallelität und das 300s-Function-Cap bleiben unangetastet.
- Non-breaking: fällt die Winkel-Zuweisung aus, läuft die Pipeline exakt wie heute.

## Design

Diversität wird *oben* in `planArticle` (globale Sicht) erzeugt und über den Plan → `writeSection` durchgereicht — genau wie `heading` heute schon fließt. Kein Extra-Call, nur ein zusätzliches Plan-Feld und zwei Prompt-Ergänzungen.

### 1. Datenmodell
`ArticlePlan` (aktuell Z.54–62) erhält:
```ts
takeAngles: Record<string, string>  // itemIdx → freitextlicher Winkel-Satz
```
Optional/defensiv: fehlt das Feld, gilt „kein Winkel".

### 2. planArticle-Prompt (Z.218–332)
Neuer Prompt-Abschnitt + neues JSON-Feld (`takeAngles`). Kern der Anweisung:
- Bestimme für jedes Item einen `takeAngle` — **einen Satz**, der den eigenen Blickwinkel des Synthszr Take vorgibt.
- **HART: Höchstens 1–2 Takes dürfen die übergreifende `thesis` direkt tragen.** Alle anderen beleuchten je einen *anderen* Aspekt: Zweitrundeneffekt, konkreter Verlierer, historische Parallele, konträre Sicht, unterschätzte Zahl, betroffene Gruppe.
- **Keine zwei Takes dürfen dieselbe Konklusion ziehen.**
- Der Winkel ist spezifisch für dieses Item, kein generisches „sei anders".

### 3. planArticle-Modell
`thinking` für den `planArticle`-Call aktivieren (aktuell aus, Z.292). Die Winkel-Zuweisung mit Anti-Redundanz über den ganzen Digest ist anspruchsvoller als reine Sortierung. `callModelNonStreaming` behandelt die 2026-Frontier-Regeln bereits (Sonnet 5: adaptive thinking, temperature wird ohnehin ignoriert).

### 4. Durchreichung (writeSectionsBatch, Z.704–706)
```ts
const takeAngle = (plan.takeAngles ?? {})[String(itemIdx)] || undefined
```
Wird an `writeSection` übergeben.

### 5. writeSection (Z.338–426)
- Signatur: `takeAngle?: string` in das `context`-Objekt aufnehmen (kein neuer Positionsparameter).
- **Retrieval-Query anreichern** (Z.357): `retrievalQuery = heading + "\n\n" + (takeAngle ?? "") + "\n\n" + content` — so ziehen verschiedene Winkel verschiedene Mattes-Passagen.
- **userPrompt** (Z.391): eigener Block, falls Winkel vorhanden:
  `BLICKWINKEL FÜR DEN TAKE (nur den Take, nicht die Zusammenfassung): {takeAngle}`
- **SECTION_SYSTEM_PROMPT** beim Punkt „4. SYNTHSZR TAKE" (Z.201): ergänzen — „Wenn ein Blickwinkel vorgegeben ist, führe den Take aus dieser Perspektive und wiederhole nicht die offensichtliche Kern-These."

### 6. Robustheit (normalize-plan.ts)
`normalizeArticlePlan` behandelt `takeAngles` defensiv: fehlt es oder ist es kein Objekt → `{}`. Ein fehlender Winkel pro Item → `writeSection` verhält sich wie bisher. Ein Prompt-Ausfall degradiert sauber statt zu brechen.

## Verifikation

- **Unit:** `normalizeArticlePlan` mit fehlendem/driftendem `takeAngles` → `{}` (reine Logik, testbar). Bestehende Tests + tsc bleiben grün.
- **Integration:** Echter `planArticle` + `writeSectionsBatch`-Lauf auf einem Multi-Item-Digest (vorher/nachher). Erfolgskriterium: die Take-Schluss-Thesen clustern nicht mehr auf eine Aussage (Prüfung per LLM-Judge oder heuristisch über Schluss-Sätze). Zusätzlich Stichprobe: kommen verschiedene Mattes-Konzepte vor?

## Out of Scope (bewusst getrennt)

- Der **Schluss-Reflex** („Wer X tut…", 6/10 Takes) und das **„Genau deshalb"-Scharnier** → separater kleiner `SECTION_SYSTEM_PROMPT`-Fix, nicht Teil dieser Spec.
- Die **Attributions-/Tag-Fehler** aus der Take-Bewertung ({Nvidia} bei Zhipu, → Synthszr) → separater Mechanismus (Company-Tagging).

## Touchpoints (Zusammenfassung)

| Datei | Stelle | Änderung |
|---|---|---|
| `ghostwriter-pipeline.ts` | `ArticlePlan` (Z.54) | Feld `takeAngles` |
| `ghostwriter-pipeline.ts` | `planArticle` Prompt + JSON (Z.228–287) | Winkel-Anweisung + Feld |
| `ghostwriter-pipeline.ts` | `planArticle` Call (Z.292) | `thinking: true` |
| `ghostwriter-pipeline.ts` | `writeSection` context (Z.342) | `takeAngle?: string` |
| `ghostwriter-pipeline.ts` | `retrievalQuery` (Z.357) | Winkel anreichern |
| `ghostwriter-pipeline.ts` | `userPrompt` (Z.391) | BLICKWINKEL-Block |
| `ghostwriter-pipeline.ts` | `SECTION_SYSTEM_PROMPT` (Z.201) | Take-Winkel-Anweisung |
| `ghostwriter-pipeline.ts` | `writeSectionsBatch` (Z.704) | Winkel durchreichen |
| `normalize-plan.ts` | `normalizeArticlePlan` | `takeAngles` defensiv |

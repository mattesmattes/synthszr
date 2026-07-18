# Artikel-Bündelung „Thema des Tages" & „Nachlese" — Design-Spec

**Datum:** 2026-07-18
**Status:** Design approved (alle offenen Punkte geklärt), bereit für Implementierungsplan

## Ziel

In der News-Queue sollen mehrere selektierte Quellen zu je einem gebündelten Artikel zusammengefasst werden — „Thema des Tages" und „Nachlese". Jeder Bündel-Artikel vereint die inhaltlich unterschiedlichen Aspekte seiner Quellen ohne Redundanz, erscheint prominent oben im Post-Draft und trägt ein sichtbares Label in Blog + Newsletter. Die Gesamtlänge des Posts bleibt durch Kompensation an den übrigen Artikeln ausbalanciert.

## Geklärte Anforderungen

1. **Tags exklusiv** pro Artikel: normal | `topic` (Thema des Tages) | `recap` (Nachlese).
2. **Beide Bündel-Typen sind ausführliche Leitartikel** — kein Ton-/Umfangsunterschied. Unterschied ist nur **Label + Position**.
3. **Länge je Bündel-Artikel: die Zusammenfassung (Bericht-Teil) hart max. 18 Sätze — OHNE Take.** Der Take kommt zusätzlich mit fixer, normaler Take-Länge (siehe 5). Innerhalb der 18-Satz-Grenze skaliert die Zusammenfassung mit der Netto-Substanz (mehr einzigartige Aspekte → länger; redundante Aussagen werden zusammengeführt, nicht wiederholt).
4. **Quellen:** Die Quelle mit dem größten übernommenen Inhaltsanteil ist die **Haupt-Quelle** (primärer Link). Die weiteren Quellen werden als **Nebenquellen** mitgeführt.
5. **Synthszr Take** im Bündel-Artikel: Länge **unverändert** (steigt nicht durch die Bündelung).
6. **Reihenfolge im Draft:** 1. Thema des Tages, 2. Nachlese, danach die normalen Artikel.
7. **Kompensation:** Existiert mindestens ein Bündel-Artikel, werden alle übrigen (normalen) Artikel um **je einen Satz gekürzt — inklusive Take**.
8. **Mehrsprachigkeit:** Alles muss in allen Zielsprachen funktionieren (Labels, Tags, gebündelter Content).

## Architektur

### A) UI — `/admin/news-queue`, Tab „selected"
- Pro Artikel zwei klickbare Tags: `Thema des Tages` / `Nachlese`. Exklusiv; erneuter Klick entfernt.
- Optimistisches UI-Update, Persistenz über neue API-Route (PATCH `news_queue.bundle_type`).
- Sichtbare Markierung des aktiven Tags (Farbe/Badge).

### B) Datenmodell
- **Migration:** `news_queue.bundle_type text` (`'topic' | 'recap' | null`, default null; CHECK-Constraint).
- `selected_items` im `article_jobs`-Payload trägt `bundle_type` pro Item mit (die Job-Erstellung liest es aus `news_queue`).

### C) Ghostwriter-Pipeline (`lib/claude/ghostwriter-pipeline.ts`)
Kern-Erweiterung: Aus „1 Item → 1 Abschnitt" wird „Gruppe von Items → 1 Abschnitt" für Bündel.

- **planArticle:** gruppiert Items nach `bundle_type`. Ordering erzwingt: `topic`-Gruppe (Pos 1), `recap`-Gruppe (Pos 2), dann normale Items in bisheriger Logik. Für jede Bündel-Gruppe wird eine Heading + Take-Winkel geplant (wie bisher, aber über die Gruppe).
- **Neue `writeBundleSection(items[], bundleType, …)`** (analog `writeSection`): führt die `content`-Felder aller Gruppen-Quellen zusammen, dedupliziert Redundanz, deckt alle einzigartigen Aspekte ab. **Zusammenfassung hart ≤ 18 Sätze; der Take kommt zusätzlich mit normaler Take-Länge** (der Cap zählt nur den Bericht-Teil, nicht den Take). Bestimmt die Haupt-Quelle (größter Inhaltsanteil) + Nebenquellen und gibt sie strukturiert zurück (für Quellen-Links).
- **Kompensation:** Wenn ≥1 Bündel-Gruppe existiert, bekommt `writeSection` für normale Items eine Flag „ein Satz kürzer (inkl. Take)".
- **Determinismus:** Der 18-Sätze-Cap wird — analog zu `enforceHeadingLength`/`enforceTakeEnding` — nach der Generierung deterministisch geprüft/erzwungen (neues `lib/claude/bundle-length.ts`), nicht nur per Prompt.
- Durchreichung durch **beide** Pfade: `writeSectionsBatch` (Job/Cron) und `runGhostwriterPipeline` (Streaming/manueller Button).

### D) Darstellung (Renderer)
- Der Bündel-Abschnitt trägt ein **strukturelles Attribut** `data-bundle-type` (`topic`/`recap`) am Abschnitts-Heading — **nicht** als Content-Text.
- `components/tiptap-renderer.tsx` (Web) und `lib/email/tiptap-to-html.ts` (E-Mail) rendern daraus ein sichtbares Label.
- **Label-i18n:** Die sichtbaren Labels („Thema des Tages"/„Nachlese" und Übersetzungen) kommen aus einem i18n-Dictionary, das die Renderer nach Ziel-Locale auflösen. So bleibt das Label in jeder Sprache korrekt, unabhängig vom Übersetzungs-Flow des Fließtexts.
- Quellen-Links: Haupt-Quelle prominent, Nebenquellen als „auch: …"-Liste am Abschnittsende.

### E) Mehrsprachigkeit
- Der gebündelte Fließtext entsteht im DE-Generierungspfad und wird vom bestehenden Translation-Flow (`app/api/admin/translations/*`) mitübersetzt — keine Sonderbehandlung nötig, solange die Bündel-Abschnitte reguläre TipTap-Knoten sind.
- Das `data-bundle-type`-Attribut muss die Übersetzung **überstehen** (Attribut bleibt am Knoten). Verifikation nötig, dass der Translation-Flow Node-Attribute erhält.

## Touchpoints
| Datei | Änderung |
|---|---|
| DB-Migration | `news_queue.bundle_type` |
| `app/admin/news-queue/page.tsx` | Tag-UI im „selected"-Tab |
| `app/api/admin/news-queue/bundle-type/route.ts` (neu) | PATCH bundle_type |
| `lib/news-queue/service.ts` | bundle_type in Selektion/Job-Payload |
| `lib/claude/ghostwriter-pipeline.ts` | planArticle-Gruppierung, `writeBundleSection`, Kompensations-Flag, Durchreichung |
| `lib/claude/bundle-length.ts` (neu) | deterministischer 18-Sätze-Cap + Satz-Kürzung |
| `components/tiptap-renderer.tsx` | Label-Rendering aus `data-bundle-type` |
| `lib/email/tiptap-to-html.ts` | Label-Rendering (E-Mail) |
| `lib/i18n/*` (bestehend) | Label-Übersetzungen |
| Translation-Flow | Verifikation: Node-Attribute überstehen Übersetzung |

## Verifikation
- **Unit:** `bundle-length.ts` (18-Sätze-Cap NUR für die Zusammenfassung/ohne Take, Satz-Kürzung der normalen Artikel inkl. Take, Grenzfälle: 0/1/mehrere Quellen); Gruppierungs-/Ordering-Logik in planArticle.
- **Integration:** Realer Lauf mit 2–3 `topic`- + 2–3 `recap`-Quellen: (a) je ein gebündelter Abschnitt oben, Reihenfolge topic→recap→normal; (b) keine Redundanz, alle Aspekte abgedeckt, Zusammenfassung ≤ 18 Sätze + Take mit normaler Länge; (c) Haupt- + Nebenquellen korrekt; (d) normale Artikel je 1 Satz kürzer inkl. Take; (e) Labels in Web + E-Mail; (f) Übersetzung erhält Label + Struktur.
- tsc 0, bestehende Tests grün.

## Nicht-Ziele
- Kein neuer Ton/kein eigenes Format für „Nachlese" vs. „Thema des Tages" (beide = Leitartikel).
- Keine Änderung an der normalen Artikel-Auswahl/Ranking-Logik der Queue.
- Keine automatische Bündel-Erkennung — die Zuordnung ist rein manuell über die Tags.

# Podcast-Tip-Promo — Design

**Datum:** 2026-06-06
**Status:** Spec, zur Umsetzung freigegeben (Architektur abgenickt)

## Ziel

Ein neuer Tip-Promo-Typ, der den aktuellen Podcast bewirbt:
- **(a)** Im Copy-Text die **Show Notes der aktuellen Episode**, per LLM auf **~50% des Textumfangs gekürzt**.
- **(b)** Darunter die **Apple-Podcast- und Spotify-Icons**, verlinkt auf die Show (Show-Level-Links).

Erscheint wie die bestehenden Tip-Promos in **beiden** Pfaden: Web-Artikel und E-Mail-Newsletter.

**(c)** Solange ein Podcast-Tip-Promo aktiv ist, werden die **bestehenden** Podcast-Icons unter dem Cover-Image (Web + Newsletter) **ausgeblendet** — sonst erscheinen die Apple/Spotify-Badges doppelt.

## Kontext / Ausgangslage

- Tip-Promos sind statische, in `tip_promos` gespeicherte Datensätze (`headline`, `body`-HTML, `cta_label`, `link_url`, Gradient/Farben), gerendert von `TipPromoBox` (Web) bzw. `generateEmailContentWithVotes` (Newsletter). Auswahl über `getActiveTipPromo()` (`mode: rotate | constant | off`).
- Die Podcast-**Show Notes** werden im Publish-Flow generiert (`translate-metadata` → `title`/`subtitle`/`description`), im Podigee-Publish-UI angezeigt und an Podigee gesendet — aber **nicht in der eigenen DB gespeichert**. `post_podcasts` hält nur `podigee_episode_id/url/published_at`.
- Apple/Spotify-Icons + **Show-Level-Links** existieren bereits hardcoded in `components/podcast-badges.tsx` (`/podcast-apple.png`, `/podcast-spotify.png`).

## Architektur

Ein neuer `type='podcast'` auf `tip_promos`. Statische Felder (`headline`, Gradient, `text_color`) bleiben im Admin konfigurierbar. `body`/`cta` werden bei Podcast-Promos **ignoriert**; Copy-Text und Badges werden aus dem aktuellen Podcast erzeugt.

Die 50%-Zusammenfassung wird **beim Publish einmalig** erzeugt und gespeichert — der Render-Pfad (Newsletter an viele Empfänger, Web-Aufruf) bleibt rein lesend, ohne LLM-Call.

### 1. Datenbank (Migration)

```sql
-- Promo-Typ
ALTER TABLE tip_promos
  ADD COLUMN type TEXT NOT NULL DEFAULT 'static'
  CHECK (type IN ('static', 'podcast'));

-- Show Notes persistieren (bisher nur an Podigee gesendet, nirgends gespeichert)
ALTER TABLE post_podcasts
  ADD COLUMN episode_title    TEXT,
  ADD COLUMN episode_subtitle TEXT,
  ADD COLUMN show_notes       TEXT,   -- volle Description aus dem Publish-UI
  ADD COLUMN show_notes_short TEXT;   -- LLM-Kürzung auf ~50%, beim Publish erzeugt
```

### 2. Show Notes speichern + kürzen (beim Publish)

`app/api/podcast/publish-podigee/route.ts`:
- Beim `post_podcasts`-Update (beide Branches: by-audio und Fallback) zusätzlich `episode_title=title`, `episode_subtitle=subtitle`, `show_notes=description` schreiben.
- Vor dem Update `show_notes_short` per **Haiku** (`claude-haiku-4-5-20251001`) erzeugen: Eingabe = `description`, Ziel = ~50% der Wortzahl, kohärente Prosa, gleiche Sprache wie die Eingabe. Fail-soft: bei Fehler `show_notes_short = null` (Render fällt dann auf gekürzte `show_notes` zurück, siehe 4).
- Neue Helfer-Funktion `lib/podcast/show-notes.ts` → `summarizeShowNotes(text, locale): Promise<string>`.

### 3. Aktuellen Podcast laden + Promo anreichern

`lib/tip-promos/get-active.ts`:
- Bei `type='podcast'` die neueste veröffentlichte Episode laden:
  `post_podcasts` WHERE `podigee_episode_url IS NOT NULL` AND `show_notes_short IS NOT NULL` ORDER BY `podigee_published_at DESC` LIMIT 1.
- Die geladenen Felder (`show_notes_short`, `episode_title`, `podigee_episode_url`) als zusätzliche, optionale Felder am `TipPromo`-Objekt anhängen.
- Wenn keine passende Episode existiert → Podcast-Promo wird **nicht** ausgespielt (gilt als „kein aktiver Promo", `getActiveTipPromo` überspringt ihn / fällt zur Rotation auf den nächsten static zurück).

**Locale (v1, bewusst einfach):** Es wird die global neueste veröffentlichte Episode genommen (Podcast ist primär einsprachig). Locale-genaues Matching ist explizit **out of scope** für v1.

### 4. Typ-Erweiterung

`lib/tip-promos/types.ts` — `TipPromo` erhält:
```ts
type: 'static' | 'podcast'
// nur bei type='podcast', zur Render-Zeit von get-active angereichert:
podcast?: {
  showNotesShort: string
  episodeTitle: string | null
}
```

### 5. Rendering Web — `components/tip-promo-box.tsx`

Bei `promo.type === 'podcast'`:
- Statt `body`-HTML → `promo.podcast.showNotesShort` als Copy-Text.
- Darunter `<PodcastBadges />` (Apple + Spotify, verlinkt, aus `podcast-badges.tsx`) — ggf. eine kompakte Variante (nur Apple + Spotify, ohne Web-Player).
- `headline`, Gradient, Farben wie gehabt.

`components/podcast-badges.tsx`: ggf. um eine schlanke Prop-Variante erweitern (`variant="promo"` → nur die zwei Badge-Links, zentriert), ohne den bestehenden Player-Aufbau zu brechen.

### 6. Rendering Newsletter — `generateEmailContentWithVotes` (`lib/email/tiptap-to-html.ts`)

Bei `type='podcast'`:
- Inline-styled HTML-Tabelle mit Gradient (wie bestehende Promos), Copy = `showNotesShort`.
- Darunter zwei verlinkte Badge-Images: `<a href="<apple-url>"><img src="<abs>/podcast-apple.png"></a>` und Spotify analog. Absolute URLs (E-Mail braucht vollqualifizierte `src`/`href`).
- Apple/Spotify-URLs zentral aus einer gemeinsamen Konstante (siehe 8), damit Web und Email dieselben Links nutzen.

### 7. Admin-UI — `app/admin/tip-promos/page.tsx` + API

- Typ-Auswahl (`static` / `podcast`) im Promo-Editor.
- Bei `podcast`: `body`/`cta`-Felder ausblenden; Hinweis + Live-Vorschau der aktuellen `show_notes_short` (read-only).
- `app/api/admin/tip-promos/route.ts` und `[id]/route.ts`: `type` lesen/schreiben/validieren.
- `app/api/tip-promos/active/route.ts`: gibt die angereicherten Podcast-Felder mit zurück.

### 8. Gemeinsame Link-Konstante

Apple/Spotify-Show-URLs aus `podcast-badges.tsx` in eine geteilte Konstante extrahieren (z.B. `lib/podcast/platform-links.ts`), damit Web-Badge, Email-HTML und künftige Stellen eine Quelle haben.

### 9. Cover-Badges ausblenden bei aktivem Podcast-Promo

Wenn `getActiveTipPromo()` einen aktiven `type='podcast'`-Promo liefert, werden die bestehenden Podcast-Icons unter dem Cover **nicht** gerendert (Anti-Doppelung).

- **Web:** `app/posts/[slug]/page.tsx` (Z.173) und `app/[lang]/posts/[slug]/page.tsx` (Z.389) rufen `getActiveTipPromo()` bereits/zusätzlich server-side auf und rendern `<PodcastBadges>` nur, wenn **kein** aktiver Podcast-Promo vorliegt. `components/featured-article.tsx` (Z.96) erhält ein Flag `hidePodcastBadges` als Prop (entscheidung trifft die aufrufende Page, die den aktiven Promo kennt).
- **Newsletter:** `lib/resend/templates/newsletter.tsx` (Z.255-265, „Podcast Promo Section" mit `/api/newsletter/promo-block`) erhält ein Flag (z.B. `hidePodcastBadges` / aus `activeTipPromo.type==='podcast'` abgeleitet) und überspringt die Section. Das Flag wird von `generateEmailContentWithVotes`/den Newsletter-Send-Routen durchgereicht, die `getActiveTipPromo()` ohnehin schon aufrufen.

**Bedingung:** Ausgeblendet wird nur, wenn der aktive Promo `type='podcast'` ist **und** tatsächlich ausgespielt wird (d.h. es existiert eine aktuelle Episode mit Show Notes). Liefert der Podcast-Promo nichts (keine Episode), bleiben die Cover-Badges sichtbar.

## Datenfluss

```
Publish (publish-podigee)
  → translate-metadata liefert title/subtitle/description (Show Notes)
  → summarizeShowNotes(description) [Haiku] → show_notes_short
  → post_podcasts: episode_title/subtitle/show_notes/show_notes_short gespeichert
  → an Podigee: title/subtitle/summary

Render (Web + Newsletter)
  → getActiveTipPromo(): bei type='podcast' neueste Episode mit show_notes_short laden
  → TipPromoBox / Email-HTML: showNotesShort + Apple/Spotify-Badges (Show-Links)
```

## Fehlerbehandlung

- `summarizeShowNotes` fail-soft: bei LLM-Fehler `show_notes_short = null`. Render-Fallback: erste ~50% von `show_notes` auf Satzgrenze + „…".
- Kein veröffentlichter Podcast mit Show Notes → Podcast-Promo inaktiv, keine leere Box.
- Migration additiv (nur neue, nullable Spalten + `type DEFAULT 'static'`) → bestehende Promos unverändert.

## Testing / Verifikation

- Migration in Supabase anwenden, `tip_promos.type` und `post_podcasts.show_notes*` vorhanden.
- Publish einer Episode → `show_notes`/`show_notes_short` befüllt; `show_notes_short` ~50% kürzer.
- Podcast-Promo in `/admin/tip-promos` anlegen, aktiv schalten.
- Web-Artikel: Box zeigt gekürzte Show Notes + klickbare Apple/Spotify-Icons (öffnen Show-URLs).
- Newsletter-Vorschau/Testversand: gleiche Darstellung, absolute Badge-URLs, Links funktionieren.

## Out of Scope (v1)

- Episoden-genaue Apple/Spotify-Deeplinks (nur Show-Level).
- Locale-genaues Episoden-Matching.
- Nachträgliches Kürzen bereits veröffentlichter Alt-Episoden (nur ab Einführung beim Publish; optional späteres Backfill-Script).
```

## Betroffene Dateien

| Datei | Änderung |
|-------|----------|
| `supabase/migrations/<ts>_podcast_tip_promo.sql` | neu: `tip_promos.type`, `post_podcasts.show_notes*` |
| `lib/podcast/show-notes.ts` | neu: `summarizeShowNotes()` |
| `lib/podcast/platform-links.ts` | neu: Apple/Spotify-Show-URLs (geteilt) |
| `app/api/podcast/publish-podigee/route.ts` | Show Notes + Summary speichern |
| `lib/tip-promos/types.ts` | `type` + `podcast`-Felder |
| `lib/tip-promos/get-active.ts` | Podcast-Promo anreichern |
| `components/tip-promo-box.tsx` | Podcast-Rendering (Web) |
| `components/podcast-badges.tsx` | schlanke `variant="promo"` |
| `lib/email/tiptap-to-html.ts` | Podcast-Rendering (Email) |
| `app/admin/tip-promos/page.tsx` | Typ-Auswahl + Vorschau |
| `app/api/admin/tip-promos/route.ts`, `[id]/route.ts`, `active/route.ts` | `type`-Handling |
| `app/posts/[slug]/page.tsx`, `app/[lang]/posts/[slug]/page.tsx` | Cover-`PodcastBadges` bei aktivem Podcast-Promo ausblenden |
| `components/featured-article.tsx` | `hidePodcastBadges`-Prop |
| `lib/resend/templates/newsletter.tsx` | Cover-Badge-Section bei aktivem Podcast-Promo überspringen |

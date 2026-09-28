# Subtile GIF89a-Animationen für Lexikonbilder — Design-Spec

Datum: 2026-08-28
Status: freigegeben, nicht umgesetzt — die Animation kam stattdessen als Runtime-Canvas (`components/glossary/korn-canvas.tsx`, 1e94ef3 vom 2026-08-30)
Pilotmotiv: `buchgewinn`

## Ziel

Ausgewählte Illustrationen im Synthszr-Lexikon erhalten eine kurze, einmalige
GIF89a-Animation. Die Bewegung erklärt den Begriff durch einen einzigen
physischen Vorgang. Sie dekoriert das Bild nicht lediglich und konkurriert
nicht mit dem Text.

Das statische PNG bleibt das kanonische Bild:

- Es ist das serverseitig gerenderte, priorisierte Ausgangsbild und der
  erwartete initiale LCP-Kandidat.
- Es liefert den Alt-Text.
- Es bleibt Open-Graph-Bild und SEO-Quelle.
- Es ist der vollständige Fallback ohne JavaScript, bei reduzierter Bewegung,
  bei fehlender Animations-URL und bei Ladefehlern.

Das GIF ist eine optionale visuelle Ebene darüber. Es spielt einmal ab, sobald
das Bild zu mindestens einem Drittel sichtbar ist, und bleibt anschließend auf
dem letzten Frame stehen.

## Nicht-Ziele

Der Pilot baut bewusst nicht:

- keine automatisch generierte Animation für alle Lexikonbilder;
- keinen freien Timeline- oder Keyframe-Editor;
- keine Animation auf dem Lexikonindex;
- keine Endlosschleifen und keinen Replay-Button;
- keine Kamerafahrten, Zooms oder Bewegungen des gesamten Bildes;
- keine Video-, WebP- oder JavaScript-Canvas-Ausgabe auf der öffentlichen Seite;
- keine Ersetzung des PNGs als OG-Bild;
- keine automatische Inpainting-Pipeline für die flachen Quell-PNGs;
- kein neues Admin-Authoring-UI im Pilot;
- keine Änderung der bestehenden täglichen Illustrationserzeugung.

## Freigegebene Gestaltungsregeln

### Auslösung und Dauer

- Das GIF wird etwa 500 Pixel vor dem Viewport vorgeladen.
- Es startet, sobald ungefähr ein Drittel des Bildes sichtbar ist.
- Es spielt pro Seitenbesuch genau einmal.
- Es dauert 2,5 bis 3,5 Sekunden.
- Es läuft mit 8 bis 10 Frames pro Sekunde.
- Es endet in einem stabilen, lesbaren Zustand.

### Bewegungsumfang

- Höchstens zwei Bildzonen bewegen sich.
- Höchstens 12 Prozent der Bildfläche verändern sich über den gesamten Lauf.
- Bewegungen erfolgen auf ganzzahligen Pixelkoordinaten.
- Es gibt keine weichen Fades und keine neu eingeführte Kantenglättung.
- Ein Motiv nutzt genau ein Hauptmuster und höchstens eine kleine physische
  Reaktion.
- Mehr als 95 Prozent des Bildes sollen in der Regel unverändert bleiben.

### Sechs Bewegungsmuster

Die Produktionsbibliothek enthält sechs feste Muster. Ihre sichtbaren deutschen
Namen und ihre Code-IDs sind:

| Muster | Code-ID | Semantischer Vorgang |
|---|---|---|
| Transfer | `transfer` | Ein Objekt wechselt sichtbar von einem Zustand oder Ort in einen anderen. |
| Akkumulation | `accumulation` | Wenige gleichartige Elemente sammeln sich zu einem Bestand. |
| Enthüllung | `reveal` | Eine vorhandene Struktur wird durch eine harte Maske schrittweise sichtbar. |
| Umschlag | `transition` | Ein System überschreitet eine Schwelle und nimmt einen neuen stabilen Zustand an. |
| Signal | `signal` | Ein lokaler Impuls läuft einmal durch eine vorhandene Struktur und kommt an. |
| Ordnung | `order` | Wenige verstreute Elemente richten sich zu einer erkennbaren Ordnung aus. |

Die Muster liefern Bewegungslogik, keine inhaltliche Bedeutung. Die Bedeutung
entsteht aus den für einen Begriff ausgewählten Bildteilen und ihrem Weg.

Zulässige kleine Reaktionen sind `settle`, `tilt`, `compress` und `none`. Eine
Reaktion beginnt erst, wenn das Hauptmuster sein Ziel erreicht hat.

## Referenz: Buchgewinn

Das Pilotmotiv `buchgewinn` verwendet `transfer` plus `settle`:

| Zeit | Ereignis |
|---|---|
| 0,0–0,4 s | Das heutige Bild steht unverändert. |
| 0,4–1,1 s | Eine Münze löst sich aus dem oberen Vorrat. |
| 1,1–2,2 s | Die Münze fällt senkrecht durch den Hals der Sanduhr. |
| 2,2–3,0 s | Der untere Münzbestand setzt sich um ein bis zwei Pixel. |
| ab 3,0 s | Das GIF endet und hält den letzten Frame. |

Bei 10 fps sind das 30 Frames. Es gibt keine Kamerabewegung und keine zweite
Erzählung im Bild.

## Bestehender Repo-Anschluss

Das Lexikonbild wird heute direkt in
`app/[lang]/glossary/[slug]/page.tsx` gerendert:

- `next/image` mit 768 × 768 Pixeln;
- `priority`, weil das Bild das wahrscheinliche LCP-Element ist;
- `sizes="326px"`;
- Klassen `dithered-cover dithered-invert`;
- `illustration_url` zugleich als öffentliches Bild und OG-Bild;
- `illustration_alt`, ersatzweise der kanonische Begriff, als Alt-Text.

`glossary_terms` besitzt derzeit nur `illustration_url` und
`illustration_alt`. Die Übersetzungstabelle besitzt bewusst keine Bildfelder;
dasselbe Motiv gilt für alle Sprachfassungen.

Der aktuelle Blob-Vertrag in `lib/gemini/image-generator.ts` lautet:

```text
Pfad: glossary/<slug>.png
Zugriff: public
allowOverwrite: true
Cache-Busting: ?v=<timestamp>
```

Die Animation erweitert diesen Vertrag. Sie ersetzt ihn nicht.

## Quellpaket pro Motiv

Die versionierten Master liegen außerhalb von `public/`:

```text
assets/glossary-animations/<slug>/
  poster.png
  base.png
  layers/
    subject.png
    subject-b.png       # optional
    reaction.png        # optional; insgesamt höchstens zwei Layer
  recipe.json
```

### Dateien

`poster.png`

- ist eine bytegenaue lokale Kopie des aktuell freigegebenen statischen Bildes;
- hat 768 × 768 Pixel;
- dient als visueller Referenzzustand und als Soll für Frame 0;
- wird nicht anstelle von `illustration_url` ausgeliefert.

`base.png`

- ist die gereinigte Standfläche;
- enthält die bewegten Zonen nicht mehr;
- hat dieselben Dimensionen wie das Poster;
- enthält sichtbar ausschließlich opakes Schwarz und transparente Pixel; die
  RGB-Werte vollständig transparenter Pixel sind bedeutungslos.

`layers/*.png`

- sind vollflächige 768-×-768-Masken mit transparentem Hintergrund;
- enthalten ausschließlich die schwarzen Pixel der bewegten Zone;
- liegen an ihrer Ausgangsposition;
- der Renderer bestimmt daraus automatisch die Bounding Box;
- außerhalb der Bounding Box dürfen keine opaken Pixel liegen.

`subject.png`, `subject-b.png` und `reaction.png` sind Beispiele für mögliche
Dateinamen, keine drei gleichzeitig vorgesehenen Layer. Die Summe aller im
Recipe referenzierten Layer bleibt auf zwei begrenzt.

`recipe.json`

- wählt eines der sechs Muster;
- referenziert höchstens zwei Layer;
- beschreibt Zeitpunkt, Ziel und gegebenenfalls Reaktion;
- enthält keine freien JavaScript-Ausdrücke und keine beliebigen Keyframes.

Vollflächige Layer sind absichtlich einfacher als manuell zugeschnittene
Sprites: Ausgangsposition, Canvasbezug und Frame-0-Rekonstruktion bleiben ohne
zusätzliche Koordinaten eindeutig. Der Renderer darf sie intern auf ihre
Bounding Box reduzieren.

## Recipe-Vertrag

Die Recipes werden mit Zod als discriminated union validiert. Gemeinsame Form:

```ts
interface RecipeBase {
  schemaVersion: 1
  slug: string
  pattern: 'transfer' | 'accumulation' | 'reveal' | 'transition' | 'signal' | 'order'
  width: 768
  height: 768
  fps: 8 | 9 | 10
  logicalFrameCount: number
  posterSha256: string
  layers: Array<{
    id: string
    source: string
    role: 'subject' | 'reaction'
  }>
  reaction?: {
    kind: 'settle' | 'tilt' | 'compress'
    layerId: string
    startFrame: number
    durationFrames: number
    distancePx: 1 | 2
  }
}
```

`layers` enthält ein oder zwei eindeutige IDs. Jedes Muster ergänzt nur die
Parameter, die es tatsächlich benötigt, und referenziert Layer ausschließlich
über diese IDs:

- `transfer`: Start, Ziel sowie erster und letzter Frame einer Bewegung;
- `accumulation`: maximal vier Ankünfte desselben Layers und ein gemeinsames Ziel;
- `reveal`: eine Achse, eine Startkante und eine Endkante für eine harte Maske;
- `transition`: eine Schwellenposition und zwei stabile Ausrichtungen;
- `signal`: ein einmal durchlaufener Pfad aus zwei bis vier Punkten;
- `order`: maximal zwei Layer mit Ausgangs- und Zielpositionen.

Alle Koordinaten, Distanzen und Zeitangaben sind Integer. Zeitangaben stehen
ausschließlich als nullbasierte Frame-Indizes oder Frameanzahlen im Recipe.
`logicalFrameCount / fps` muss zwischen 2,5 und 3,5 Sekunden liegen. Für die
GIF-Ausgabe verteilt der Encoder die nur in 10-Millisekunden-Schritten
darstellbaren Delays per Fehlerakkumulation über die Frames. Bei 8 fps wechseln
dadurch 120 und 130 Millisekunden; bei 9 fps werden 110 und 120 Millisekunden
so verteilt, dass die kumulierte Abweichung nie mehr als 10 Millisekunden
beträgt. Layerpfade werden relativ zum Motivverzeichnis aufgelöst und dürfen
dieses nach `realpath` nicht verlassen.

Der `posterSha256` koppelt Recipe und lokales Poster. Beim Publish wird er
zusätzlich gegen das aktuell in `illustration_url` ausgelieferte PNG geprüft.
So kann eine lokal korrekte Animation nicht still mit einem inzwischen
geänderten öffentlichen Poster verbunden werden.

## Renderer

### Ablage

```text
lib/glossary/animation/
  schema.ts
  assets.ts
  compose-frame.ts
  motion.ts
  patterns/
    transfer.ts
    accumulation.ts
    reveal.ts
    transition.ts
    signal.ts
    order.ts
  encode-gif.ts
  validate-output.ts

scripts/render-glossary-animation.ts
scripts/publish-glossary-animation.ts
```

Generierte Dateien landen unter:

```text
artifacts/glossary-animations/<slug>/
  <slug>-326.gif
  <slug>-768.gif
  final-frame.png
  proof.html
  manifest.json
```

`/artifacts/` wird in `.gitignore` aufgenommen. Versioniert werden
`poster.png`, `base.png`, sämtliche Layer und `recipe.json`. Nur die
abgeleiteten Dateien unter `/artifacts/` werden ignoriert.

### Renderablauf

1. Recipe mit Zod validieren, einschließlich des bestehenden
   Glossar-Slugformats.
2. Vor jedem Decode Magic Bytes und eine harte Dateigrenze von 10 MB prüfen.
3. Poster, Base und Layer mit `limitInputPixels: 768 * 768` und
   `failOn: 'error'` laden; reale Layerpfade müssen innerhalb des Asset-Roots
   liegen.
4. Dimensionen und Farbraum prüfen.
5. Das Recipe für Zeitpunkt 0 auswerten und `base.png` mit den dabei sichtbaren
   Layerzuständen zusammensetzen.
6. Rekonstruierten Frame 0 kanonisch mit `poster.png` vergleichen: Alpha-Maske
   und opake RGB-Werte müssen übereinstimmen; RGB unter Alpha 0 wird ignoriert.
7. Für jedes logische Frame das gewählte Muster auswerten.
8. Transformationen auf ganzzahlige Pixel runden.
9. Vollständige PNG-Frames mit `sharp` komponieren.
10. 768er-GIF aus den Frames kodieren.
11. Dieselben Frames auf 326 × 326 Pixel reduzieren und erneut auf zwei
    Zustände quantisieren.
12. 326er-GIF kodieren.
13. Beide Ausgaben einschließlich ihrer dekodierten Delays validieren.
14. Proof-HTML, letzten Frame und Manifest schreiben.

Das Projekt enthält bereits `sharp@0.34.5`. Diese Version kann ein Array von
Frames über `join: { animated: true }` als Animation zusammenführen. Eine neue
GIF-Library und globale ImageMagick-/gifsicle-Abhängigkeiten sind deshalb nicht
Teil des verbindlichen Renderpfads.

### GIF-Kodierung

Die GIF-Ausgabe nutzt:

```ts
sharp(frameBuffers, { join: { animated: true } }).gif({
  colors: 2,
  dither: 0,
  effort: 10,
  interFrameMaxError: 0,
  keepDuplicateFrames: false,
  delay: frameDelays,
  loop: 1,
})
```

In der im Projekt fixierten Kombination aus `sharp@0.34.5`, libvips 8.17.3 und
cgif 0.5.0 übersetzt `loop: 1` in `CGIF_ATTR_NO_LOOP`. Das Ergebnis enthält
keine Netscape-Loop-Extension und spielt einmal. Weil Sharps öffentliche
Dokumentation und die gebündelte Encoderimplementierung an dieser Stelle
unterschiedlich leicht zu lesen sind, ist ein ausführbarer Encoder-Fixture-Test
Teil des Vertrages. Ändert ein Dependency-Update dieses Verhalten, bricht der
Test vor dem Rendern produktiver Motive ab.

Die Ausgabe wird anschließend binär auf `GIF89a` und das Fehlen von
`NETSCAPE2.0` geprüft. Der Header allein genügt nicht als Loop-Prüfung.

`frameDelays` enthält ausschließlich Vielfache von 10 Millisekunden. Doppelte
logische Frames dürfen zusammengeführt werden; ihr Delay wird addiert. Manifest
und Tests unterscheiden deshalb `logicalFrameCount` und `encodedFrameCount`.
Die kodierte Framezahl darf kleiner, aber nie größer als die logische sein. Die
aus dem fertigen GIF dekodierte Delay-Summe muss der Zieldauer bis auf höchstens
10 Millisekunden entsprechen.

`interFrameMaxError: 0` erlaubt nur verlustfreie Differenzframes. Wird das
Dateibudget überschritten, darf der Renderer nicht still Qualität reduzieren.
Das Recipe muss dann weniger Frames oder eine kleinere Bewegungsfläche nutzen.

### 326er-Ausgabe

Die kleine Ausgabe bedient Displays, die bei `sizes="326px"` keine höhere
Pixeldichte benötigen. Sie wird mit Nearest-Neighbour verkleinert und wieder
auf Schwarz plus Transparenz quantisiert. Vor den Animationsframes erzeugt der
Renderer mit exakt derselben Pipeline ein 326er-Referenzposter aus
`poster.png`. Der Proof zeigt 326 und 768 Pixel nebeneinander.

Beide Varianten sind im Pilot Pflicht. Die Laufzeit kann dennoch allein mit der
768er-URL arbeiten, falls ein älterer Datensatz noch keine kleine Variante hat.

## Automatische Abnahme

Ein Render gilt nur dann als veröffentlichbar, wenn alle Prüfungen bestehen:

### Dateivertrag

- Die ersten sechs Bytes lauten `GIF89a`.
- Die Datei besitzt mehr als einen Frame.
- Die Dimensionen sind exakt 768 × 768 beziehungsweise 326 × 326.
- Es existiert keine `NETSCAPE2.0`-Loop-Extension.
- `encodedFrameCount` ist höchstens `logicalFrameCount`, und die dekodierte
  Delay-Summe entspricht der Zieldauer mit höchstens 10 Millisekunden
  Abweichung.
- Das 768er-GIF ist höchstens 600 KB groß.
- Das 326er-GIF ist höchstens 250 KB groß.
- Jeder dekodierte Pixel ist entweder vollständig transparent oder opakes
  Schwarz. RGB-Werte vollständig transparenter Pixel werden ignoriert.

### Bildvertrag

- Frame 0 der 768er-Ausgabe stimmt in Alpha-Maske und opaken RGB-Werten mit
  `poster.png` überein.
- Frame 0 der 326er-Ausgabe stimmt nach derselben kanonischen Vergleichsregel
  mit dem vom Renderer aus `poster.png` abgeleiteten 326er-Referenzposter
  überein.
- Der letzte Frame entspricht dem vom Recipe berechneten Endzustand.
- Es bewegen sich höchstens zwei im Recipe referenzierte Layer. Als Zone gilt
  die über den Lauf vereinigte Bounding Box eines Layers, nicht jede getrennte
  schwarze Pixelinsel der Dither-Maske.
- Die XOR-Vereinigung aller Frames gegenüber Frame 0 belegt höchstens 12
  Prozent des Canvas.
- Kein Frame enthält Pixel außerhalb der aus Base und Layern ableitbaren
  Zustände.

### Proof

`proof.html` zeigt:

- statisches Poster;
- 326er-GIF in 326 CSS-Pixeln;
- 768er-GIF in 326 CSS-Pixeln;
- letzten Frame;
- Dauer, fps, logische und kodierte Framezahl, Dateigröße und Bewegungsfläche;
- Light- und Dark-Mode-Darstellung.

Der Publish-Befehl akzeptiert ausschließlich einen vollständig grünen
Validatorlauf. Die menschliche Freigabe beurteilt zusätzlich, ob die Bewegung
den Begriff erklärt und dem Bildstil entspricht.

## Blob- und Datenmodell

### Migration

`glossary_terms` erhält zwei nullable Spalten:

```sql
alter table public.glossary_terms
  add column if not exists illustration_animation_url text;

alter table public.glossary_terms
  add column if not exists illustration_animation_small_url text;

create or replace function public.clear_stale_glossary_animation()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.illustration_animation_url is distinct from old.illustration_animation_url
     and new.illustration_animation_small_url is distinct from old.illustration_animation_small_url
     and new.illustration_animation_url is not null
     and new.illustration_animation_small_url is not null then
    return new;
  end if;

  new.illustration_animation_url := null;
  new.illustration_animation_small_url := null;
  return new;
end;
$$;

drop trigger if exists clear_stale_glossary_animation
  on public.glossary_terms;

create trigger clear_stale_glossary_animation
before update of illustration_url on public.glossary_terms
for each row
when (old.illustration_url is distinct from new.illustration_url)
execute function public.clear_stale_glossary_animation();
```

Die Felder gehören nicht in `glossary_term_translations`: Bild und Bewegung
gelten wie heute für alle Sprachen.

`illustration_url` bleibt Quelle für Metadata und OG. Ein Animations-Publish
darf diese URL zusammen mit beiden neuen Animations-URLs atomar auf ein
immutable Poster umstellen. Jede spätere Änderung von `illustration_url`, bei
der nicht gleichzeitig beide Animations-URLs erneuert werden, leert dagegen
beide Animationsfelder im selben DB-Schreibvorgang.

### TypeScript-Mapping

`GlossaryTerm` erhält:

```ts
illustrationAnimationUrl: string | null
illustrationAnimationSmallUrl: string | null
```

`getGlossaryTerm()` selektiert und mappt beide Felder. Die Admin-Detailabfrage
führt sie ebenfalls mit, damit ein Operator den veröffentlichten Zustand sehen
kann. Die indexseitige Begriffsliste lädt weiterhin keine Bildfelder.

### Blob-Pfade

```text
glossary/posters/<slug>/<poster-sha256>.png
glossary/animations/<slug>/<release-id>/<slug>-326.gif
glossary/animations/<slug>/<release-id>/<slug>-768.gif
```

Das Poster ist die bereits verifizierte lokale `poster.png`. `release-id` ist
der SHA-256 über Posterhash, kanonisches Recipe und beide fertigen GIF-Hashes.
Alle drei Pfade sind unveränderlich; eine neue Fassung erzeugt neue Objekte.

Uploadoptionen:

```ts
{
  access: 'public',
  contentType: 'image/gif',
  addRandomSuffix: false,
  allowOverwrite: false,
}
```

Ein Query-basiertes Cache-Busting ist für diese immutable Pfade nicht nötig.
Jeder Upload ist wiederholbar: Das Skript prüft den Zielpfad zuerst mit der
Blob-`head`-API. Existiert er, lädt es die Datei und verwendet sie nur weiter,
wenn ihr SHA-256 exakt der lokalen Poster- beziehungsweise GIF-Datei entspricht.
Fehlt sie, lädt es mit `addRandomSuffix: false` und `allowOverwrite: false`
hoch; für das Poster verwendet es `contentType: 'image/png'`. Verliert ein
paralleler Lauf das Rennen zwischen `head` und `put`, behandelt das Skript
„already exists“ erst nach erneutem `head` und Hashvergleich als Erfolg. Ein
abweichender Inhalt unter demselben content-addressed Pfad ist ein harter
Fehler.

Schlägt der zweite Upload oder das DB-Update fehl, bleiben vorhandene DB-URLs
und bestehende Blobs unangetastet; derselbe Publish-Befehl kann den begonnenen
Release sicher fortsetzen. Nicht referenzierte neue Blobs kann ein späterer
Cleanup-Lauf entfernen.

### Publish-Skript

Aufruf:

```bash
pnpm tsx scripts/publish-glossary-animation.ts <slug> <env-datei>
pnpm tsx scripts/publish-glossary-animation.ts <slug> <env-datei> --apply
```

Ohne `--apply` liest und validiert das Skript ausschließlich. Mit `--apply`:

1. führt es den vollständigen Validator erneut aus;
2. liest `illustration_url` sowie beide nullable Animations-URLs als erwarteten
   Ausgangszustand und lädt exakt die aktuelle `illustration_url` über den
   vorhandenen allowlisted und größenbegrenzten Fetch-Pfad;
3. vergleicht den SHA-256 des ausgelieferten PNGs mit `posterSha256` und bricht
   bei jeder Abweichung ab;
4. lädt das verifizierte Poster unter seinem Hash sowie beide GIFs unter der
   `release-id` idempotent hoch;
5. aktualisiert `illustration_url`, beide Animationsspalten und `updated_at` per
   Compare-and-Swap. Die Bedingung muss die zuvor gelesene `illustration_url`
   und beide zuvor gelesenen nullable Animations-URLs treffen; bei `null` nutzt
   sie einen SQL-`IS NULL`-Vergleich. Das Update muss exakt eine Zeile
   zurückgeben, deren drei URLs exakt den Zielwerten entsprechen;
6. revalidiert alle Sprachfassungen aus `PUBLIC_LOCALES`;
7. gibt die drei finalen URLs und den Revalidierungsstatus aus.

Die DB wird erst aktualisiert, wenn alle drei Uploads erfolgreich waren. Scheitert
die Revalidierung danach, bleibt der DB-Stand gültig; die Seite übernimmt ihn
spätestens beim regulären ISR-Lauf nach sechs Stunden.

## Revalidierung

Ein kleines `POST /api/revalidate-glossary` folgt dem bestehenden Muster von
`/api/revalidate-rankings`:

- Bearer-Authentifizierung mit `REVALIDATE_SECRET`;
- timing-sicherer Vergleich über die vorhandene Security-Hilfe;
- striktes Rate Limit;
- JSON-Body `{ slug }`;
- Slug-Validierung vor der Pfadbildung;
- Iteration über die zentrale Konstante `PUBLIC_LOCALES`;
- `revalidatePath('/<locale>/glossary/<slug>')` für `de`, `en`, `cs`, `nds`
  und `fr`.

Der Lexikonindex braucht keine Revalidierung, weil er keine Illustrationsfelder
lädt oder darstellt.

## Öffentliche Laufzeit

### Komponente

Die Glossary Page bleibt eine Server Component und verzweigt vor dem Rendern:

- Ohne `illustration_animation_url` rendert sie exakt den heutigen statischen
  Bildblock. Es entsteht weder eine Client Boundary noch ein GIF-Request.
- Mit Animations-URL rendert sie
  `components/glossary/animated-illustration.tsx`. Diese kleine Client Component
  wird serverseitig weiterhin mit dem statischen Bild vorgerendert.

Aufbau:

```text
figure
  relative square wrapper, maximal 326 CSS-Pixel
    next/image             semantisches PNG, dauerhaft im DOM
    native img overlay     GIF, erst am Sichtbarkeitspunkt erzeugt
```

Das statische `next/image` behält:

- `width={768}` und `height={768}`;
- `priority`;
- `sizes="326px"`;
- `dithered-cover dithered-invert`;
- den bestehenden Alt-Text;
- `opacity: 1` bis das GIF sein `load`-Ereignis meldet, danach ohne Transition
  `opacity: 0`.

Das GIF-Overlay erhält:

- `src` als frische Object-URL der zuvor geladenen GIF-Bytes;
- dieselben Dither- und Dark-Mode-Klassen;
- feste absolute Position über dem PNG;
- `alt=""` und `aria-hidden="true"`;
- kein `next/image`, damit die Animation nicht umkodiert wird;
- eine lokal begründete `@next/next/no-img-element`-Ausnahme.

Es gibt dadurch genau einen semantischen Bildknoten. Das PNG bleibt auch bei
`opacity: 0` im DOM und im Accessibility Tree. Das GIF ist dekorativ, obwohl
seine Bewegung inhaltlich motiviert ist: Der statische Alt-Text erklärt das
Motiv bereits, und ein zweiter identischer Screenreader-Eintrag wäre redundant.

PNG und GIF werden nicht dauerhaft sichtbar übereinandergelegt. Transparente
GIF-Pixel könnten sonst die schwarzen Ausgangspixel des PNGs nicht entfernen
und bewegte Objekte würden Geisterbilder hinterlassen. Beim `load`-Ereignis des
GIFs wechselt der Wrapper in einem Render ohne Fade: GIF sichtbar, PNG
`opacity: 0`. Frame 0 entspricht dem PNG; die 0,4 Sekunden statischer Vorlauf im
Recipe geben dem atomaren Wechsel zusätzlich Decode-Spielraum. Bei jedem Fehler
wird das GIF entfernt und das PNG sofort wieder sichtbar.

### Zustandsmodell

Die Browserlogik wird als kleine, separat testbare State Machine modelliert:

```text
static
  ├─ reduced-motion ───────────────> disabled
  └─ 500px-Nähe ──────────────────> fetching-bytes
       ├─ Fehler ─────────────────> static-failed
       └─ Blob geladen ───────────> ready
            └─ mindestens ⅓ sichtbar ─> mounting
                 ├─ img error ───────> static-failed
                 └─ img load ────────> playing
                                          └─ bleibt gemountet
```

Zwei IntersectionObserver sind absichtlich getrennt:

1. Preload-Observer mit `rootMargin: '500px 0px'` und Schwelle 0.
2. Play-Observer ohne Root-Margin und mit Schwelle 0,33.

Ein gemeinsamer Observer würde die Sichtbarkeitsquote gegen den vergrößerten
Preload-Viewport berechnen und könnte zu früh starten.

Der Preloader instanziiert ausdrücklich kein `Image`, weil dessen GIF-Timeline
bereits außerhalb des Viewports anlaufen könnte. Er misst die gerenderte Breite
des Wrappers und wählt anhand von `Breite × devicePixelRatio` die 326er-Variante,
solange 326 Quellpixel genügen; andernfalls nimmt er die 768er-Variante. Dann
lädt er die öffentliche Blob-URL mit `fetch()` und hält das Ergebnis als `Blob`
im Speicher. Ein `AbortController` beendet den Request beim Unmount oder bei
nachträglich aktivierter Reduced Motion.

Die aktuelle Content Security Policy erlaubt `blob:` bereits unter `img-src`,
aber noch keinen browserseitigen Fetch zum öffentlichen Blob-Host. Die
Implementierung ergänzt deshalb in `lib/security/csp.mjs` ausschließlich
den bereits konfigurierten exakten Store-Origin
`https://lbrzdn804nhy3kox.public.blob.vercel-storage.com` unter `connect-src`.
Der öffentliche Store antwortet mit `Access-Control-Allow-Origin: *`; andere
externe Fetch-Ziele werden nicht freigegeben.

Erst wenn Blob und Sichtbarkeit bereit sind, erzeugt die Komponente eine neue
Object-URL und mountet das rohe `<img>`. Damit beginnt ein frischer Decoderlauf
am Sichtbarkeitspunkt statt beim Preload. Die Object-URL wird beim Unmount oder
beim Wechsel in einen terminalen Fehlerzustand widerrufen. Ein `hasPlayed`-Ref
verhindert das erneute Mounten bei späterem Scrollen.

### Reduced Motion

Vor dem Anlegen der Observer wird
`matchMedia('(prefers-reduced-motion: reduce)')` geprüft.

- Bei `reduce` wird keine GIF-Ressource angefordert.
- Wird die Präferenz während des Laufs auf `reduce` gestellt, verschwindet die
  GIF-Ebene, ein laufender Fetch wird abgebrochen, die Object-URL widerrufen und
  das PNG wieder sichtbar.
- Ein späteres Zurückschalten startet die Animation in derselben Montage nicht
  erneut.

### Fehlerverhalten

- Kein JavaScript: PNG.
- Keine Animations-URL: PNG.
- GIF-Preload schlägt fehl: PNG.
- GIF-Overlay meldet einen Fehler: Overlay entfernen, PNG.
- 326er-URL fehlt: 768er-GIF als alleiniger Fallback.
- DB-/Seitenfehler: bestehendes Verhalten der Glossarseite bleibt unverändert.

## Accessibility, SEO und Performance

### Accessibility

- Der bestehende Alt-Text bleibt unverändert.
- Das GIF wird nicht zusätzlich vorgelesen.
- Es gibt kein Blinken, keinen schnellen Kontrastwechsel und keine Schleife.
- Reduced Motion verhindert bereits den Request, nicht erst die Darstellung.

### SEO und GEO

- `generateMetadata()` verwendet weiterhin nur `illustrationUrl`.
- JSON-LD und sichtbarer Erklärungstext ändern sich nicht.
- Das GIF wird nicht als OG-Bild eingetragen.
- Der statische Bildknoten bleibt im initialen HTML.

### Performance

- Das PNG bleibt das serverseitig gerenderte, priorisierte Ausgangsbild.
- Das GIF wird nicht im Dokumentkopf vorgeladen. Ob sein späterer gleich großer
  Paint als neuer LCP-Kandidat zählt, ist eine zu messende Hypothese und keine
  garantierte Invariante.
- Feste Dimensionen verhindern Layout Shift.
- Die Auswahl zwischen 326 und 768 Pixeln reduziert Transfers auf normalen
  Displays.
- Die 768er-Variante ist auf 600 KB, die 326er-Variante auf 250 KB begrenzt.
- Die Client-Komponente verwendet keine Animationsbibliothek.

Der Pilot vergleicht pro Motiv:

- übertragene Bildbytes;
- LCP mit und ohne Animations-URL;
- Startzeit relativ zur Sichtbarkeit;
- Darstellung in Light und Dark Mode;
- Verhalten auf Desktop und Mobile;
- Verhalten mit Reduced Motion.

Vor dem Rollout darf sich der mobile p75-LCP gegenüber derselben Seite mit
leeren Animations-URLs um höchstens 100 Millisekunden verschlechtern.

## Tests

### Unit-Tests

`tests/lib/glossary-animation-schema.test.ts`

- akzeptiert jedes der sechs gültigen Muster;
- verwirft unbekannte Muster und Reaktionen;
- verwirft ungültige Frame-Indizes und eine Gesamtdauer außerhalb von 2,5 bis
  3,5 Sekunden;
- verwirft mehr als zwei Layer;
- verwirft nicht ganzzahlige Koordinaten;
- blockiert Pfadtraversal.

`tests/lib/glossary-animation-render.test.ts`

- rendert ein synthetisches Zweifarben-Fixture;
- rekonstruiert Frame 0 kanonisch, ohne RGB unter Alpha 0 zu vergleichen;
- hält Bewegungen auf Integer-Pixeln;
- berechnet Bewegungsfläche und Zonen korrekt;
- rendert erwarteten letzten Frame.

`tests/lib/glossary-animation-gif.test.ts`

- Header `GIF89a`;
- korrekte Dimensionen sowie getrennte logische und kodierte Framezahl;
- keine `NETSCAPE2.0`-Extension;
- ausschließlich opakes Schwarz oder vollständige Transparenz;
- per Fehlerakkumulation erzeugte 10-Millisekunden-Delays und eine dekodierte
  Gesamtdauer mit höchstens 10 Millisekunden Abweichung;
- Dateibudget wird erzwungen;
- doppelte Frames werden in ihrer Verzögerung zusammengeführt.

`tests/lib/glossary-animation-runtime.test.ts`

- State Machine lädt bei 500-Pixel-Nähe Bytes per `fetch`, ohne ein `Image` zu
  instanziieren;
- startet erst bei mindestens einem Drittel Sichtbarkeit;
- startet nach verspätetem Load, wenn das Bild bereits sichtbar ist;
- erzeugt erst am Startpunkt eine Object-URL und widerruft sie beim Cleanup;
- blendet das PNG erst nach `img.load` aus und bei `img.error` wieder ein;
- startet nicht erneut nach Re-Entry;
- lädt bei Reduced Motion nicht;
- fällt bei Fehler auf statisch zurück.

### Integrations-Tests

- `GlossaryTerm` und `getGlossaryTerm()` führen beide URLs.
- Admin-Detailabfrage selektiert beide URLs.
- Eine reine Änderung an `illustration_url` leert beide Animationsfelder per
  Trigger; der atomare Drei-URL-Publish bleibt aktiv.
- Der Publish-Schritt verwendet immutable Blob-Pfade, prüft den Live-Posterhash
  und aktiviert Poster sowie beide GIF-URLs nur bei unveränderter bisheriger
  `illustration_url` gemeinsam.
- Ein Integrationstest simuliert: alle Uploads erfolgreich, DB-Update
  fehlgeschlagen, identischer Retry verwendet die hashgleichen Blobs wieder.
- Interleaving-Tests belegen, dass Publish gegen gleichzeitigen Rollback und
  Publish gegen einen zweiten abweichenden Publish am vollständigen
  Ausgangszustand scheitern, statt eine neuere Entscheidung zu überschreiben.
- Der CSP-Test verlangt den exakten öffentlichen Vercel-Blob-Origin unter `connect-src`
  sowie `blob:` unter `img-src`, ohne die übrigen Direktiven aufzuweiten.
- Revalidierungsroute verlangt Bearer-Token, validiert den Slug und revalidiert
  alle Pfade aus `PUBLIC_LOCALES`.
- Public Page rendert bei null URLs exakt den bestehenden statischen Bildblock,
  referenziert keine Client Component und fordert weder GIF noch Client-Chunk
  dafür an.

### Visuelle Abnahme

Für jedes der zwölf Pilotmotive:

- 326 px und 768 px;
- Light und Dark Mode;
- Desktop und Mobile;
- erster und letzter Frame;
- einmaliges Abspielen bei Eintritt in den Viewport;
- keine Wiederholung nach Herausscrollen und Wiedereintritt.

## Pilot und Rollout

Der Pilot umfasst zwölf Motive:

- `buchgewinn` als Referenz für `transfer`;
- elf weitere veröffentlichte Begriffe mit vorhandener Illustration;
- genau zwei Motive pro Bewegungsmuster;
- mindestens je ein Motiv mit kompakter und mit verteilter Silhouette;
- keine zwei Motive, die denselben semantischen Vorgang nur anders benennen.

Die konkreten elf Slugs werden während der Implementierung anhand der aktuellen
Bildbibliothek gewählt. Das ist eine redaktionelle Auswahl innerhalb des hier
festgelegten Vertrages und keine offene Architekturentscheidung.

Rolloutfolge:

1. Toolchain unter Node 24 reparieren und Renderer-Fixture grün bekommen.
2. `buchgewinn` vollständig rendern und im Proof abnehmen.
3. DB-Felder, Loader und Runtime-Komponente einführen; alle URLs bleiben null.
4. `buchgewinn` veröffentlichen und reales Lade-/Replay-Verhalten prüfen.
5. Je ein zweites Motiv für `transfer`, danach je zwei für die übrigen Muster.
6. Nach zwölf Motiven Byte-, LCP- und Redaktionsaufwand auswerten.
7. Erst danach über einen breiteren Rollout oder ein Admin-Authoring-UI
   entscheiden.

Nullbare URLs bilden zugleich Rollout und Rollback:

- Aktivierung: die immutable Kopie des verifizierten Posters und beide
  Animations-URLs atomar setzen, danach alle Sprachseiten revalidieren.
- Rollback: beide Animations-URLs mit demselben vollständigen
  Compare-and-Swap leeren und danach alle Sprachseiten revalidieren.
- Beim Rollback bleibt das immutable statische PNG aktiv; es muss nicht erneut
  hochgeladen werden.

## Toolchain-Voraussetzungen

Das Projekt verlangt Node 24. Der aktuelle lokale Checkout lief während der
Konzeptprüfung unter Node 22; außerdem konnte das native Darwin-Modul der
vorhandenen `sharp`-Installation wegen einer ungültigen lokalen Code-Signatur
nicht geladen werden. Vor der Implementierung:

1. Node 24 aktivieren.
2. Abhängigkeiten mit pnpm frisch installieren.
3. Einen bestehenden Sharp-Test ausführen.
4. Den minimalen Zwei-Frame-Encoder-Fixture mit `loop: 1` ausführen und binär
   belegen, dass `GIF89a` ohne `NETSCAPE2.0` entsteht.
5. Erst danach den GIF-Renderer implementieren.

Die Vercel CLI sollte vor Publish- und Env-Arbeiten von 59.5.0 auf die aktuelle
Version aktualisiert werden:

```bash
pnpm add -g vercel@latest
```

Die Renderpipeline benötigt keine Vercel Function. Sie läuft lokal oder in
einem späteren dedizierten CI-Job. Blob und Supabase werden ausschließlich im
expliziten Publish-Schritt beschrieben.

## Erfolgskriterien

Der Pilot ist erfolgreich, wenn:

1. alle zwölf Motive die automatische und visuelle Abnahme bestehen;
2. jedes Motiv einen Begriff durch einen erkennbaren Vorgang erklärt;
3. kein GIF in einer Schleife läuft;
4. Reduced Motion keinen GIF-Request auslöst;
5. Seiten ohne Animation denselben statischen Bildblock rendern und keine
   Animations- oder zusätzliche Client-Ressource anfordern;
6. das statische PNG weiterhin das SSR-priorisierte Ausgangs-, OG- und
   Alt-Text-Bild ist und die gemessene mobile p75-LCP-Verschlechterung höchstens
   100 Millisekunden beträgt;
7. die Animationsdateien innerhalb der Budgets bleiben;
8. der zusätzliche Client-Code keine neue Animationsbibliothek benötigt;
9. Aktivierung und Rollback nur über nullable URLs erfolgen;
10. der Pilot eine belastbare Entscheidung über einen breiteren Rollout erlaubt.

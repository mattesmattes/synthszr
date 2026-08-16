# PRD: Calligram Animation System

## Overview

Ein konfigurierbares, animiertes Typografie-System das beliebigen Text in Form einer waehlbaren Silhouette (Herz, Kreis, Stern, Welle, Spirale, Custom-Text, Custom-Bild) rendert. Buchstaben fliegen per Spring-Physik in die Zielform, halten dort, zerstreuen sich, und wiederholen in einer Endlosschleife. Alle Parameter sind ueber ein Admin-UI konfigurierbar und werden persistent in einer Datenbank gespeichert.

## Tech Stack (Referenzimplementierung)

- **Framework:** Next.js (App Router, React 19)
- **Rendering:** HTML5 Canvas API (client-side, `'use client'`)
- **Textmessung:** `@chenglou/pretext` (pixelgenaue Zeichenbreiten via `prepareWithSegments` + `layoutWithLines`)
- **Admin UI:** shadcn/ui (Card, Input, Select, Switch, Button, Label, Tabs)
- **Datenbank:** Supabase (PostgreSQL) — Key-Value `settings`-Tabelle mit JSONB
- **Bild-Upload:** Vercel Blob (`@vercel/blob/client`)
- **TypeScript:** Durchgehend typisiert

## Architektur

### Komponenten-Hierarchie

```
CoverCalligram (Client-Wrapper, nimmt CalligramConfig als Props)
  └── CalligramCanvas (Generische Animations-Engine)
        ├── generateFn() → CharPosition[] (Form-Generierung)
        └── renderFrame() → Canvas 2D Drawing (Animation Loop)
```

### Datenfluss

```
Admin UI → PUT /api/admin/cover-animation → settings-Tabelle (key: 'cover_animation_config')
                                                     ↓
Server Component (Page) → SELECT settings → CoverAnimationConfig als Prop
                                                     ↓
CoverCalligram (Client) → CalligramCanvas → Canvas Animation
```

---

## 1. Datenmodell

### CoverAnimationConfig

```typescript
type CoverAnimationMode = 'static_svg' | 'calligram'

type CoverAnimationShape =
  | 'heart' | 'circle' | 'star' | 'wave' | 'spiral'
  | 'custom_text' | 'custom_image'

interface CalligramConfig {
  word: string              // Wiederholungstext, z.B. "OH-SO " oder "{{datetime}}"
  fontSize: number          // Zeichengroesse in Pixel (2-20)
  color: string             // Hex-Farbe (#ffffff) oder '' fuer Graustufen-Gradient
  width: number             // Canvas-Breite in Pixel (100-1200)
  height: number            // Canvas-Hoehe in Pixel (50-800)
  shape: CoverAnimationShape
  shapeText?: string        // Text als Form (wenn shape === 'custom_text')
  shapeImageUrl?: string    // Bild-URL als Form (wenn shape === 'custom_image')
  holdDuration: number      // Haltezeit in Sekunden (1-30)
  shadow: boolean           // Textschatten ein/aus
}

interface CoverAnimationConfig {
  mode: CoverAnimationMode
  calligram: CalligramConfig
}
```

### Default-Konfiguration

```typescript
const DEFAULT_COVER_ANIMATION_CONFIG: CoverAnimationConfig = {
  mode: 'static_svg',
  calligram: {
    word: '{{datetime}}',
    fontSize: 7,
    color: '#ffffff',
    width: 600,
    height: 120,
    shape: 'custom_text',
    shapeText: 'synthszr',
    holdDuration: 3,
    shadow: true,
  },
}
```

### Datenbank-Schema

Benoetigt eine Key-Value-Settings-Tabelle:

```sql
CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value JSONB NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
```

Konfiguration wird unter dem Key `'cover_animation_config'` als JSONB gespeichert.

---

## 2. Animations-Engine (CalligramCanvas)

### Kern-Algorithmus

#### Phase 1: Position Generation

Fuer jede Pixel-Position im Canvas wird geprueft ob sie innerhalb der gewaehlten Form liegt. Wenn ja, wird ein Buchstabe platziert.

**SDF-basierte Formen** (heart, circle, star, wave, spiral):
- Normalized coordinates: `nx = (pixelX - centerX) / (drawArea/2)`, analog fuer ny
- SDF-Funktion gibt signed distance zurueck: `< 0` = innerhalb, `> 0` = ausserhalb
- Zeichen werden nur platziert wenn `sdf(nx, ny) < -0.02`

**Bitmap-basierte Formen** (custom_text, custom_image):
- Offscreen-Canvas wird mit der Form (Text oder Bild) gerendert
- `getImageData()` liefert Pixel-Maske
- Zeichen werden platziert wo Pixel-Helligkeit > 128 (fuer Text) bzw. < 128 (fuer Bilder, invertiert)

#### Phase 2: Animation Loop (requestAnimationFrame)

Drei Phasen im Endloszyklus:

**Assemble** — Zeichen fliegen per Spring-Physik zur Zielposition:
```
springK = 0.08
damping = 0.75
velX = (velX + (targetX - currentX) * springK) * damping
currentX += velX
currentAlpha += (targetAlpha - currentAlpha) * 0.25
if (currentAlpha > 0.95) currentAlpha = 1  // Snap to full opacity
```

**Hold** — Zeichen stehen still fuer `holdDuration` Sekunden

**Scatter** — Zeichen fliegen mit zufaelligen Geschwindigkeiten auseinander:
```
velX = random(-4, 4), velY = random(-4, 4)
targetAlpha = 0
currentAlpha += (0 - currentAlpha) * 0.06
```

Transition: `allGone` (alle Alpha < 0.01) → zurueck zu Assemble

#### Phase 3: Rendering

Pro Frame und pro Zeichen:
```
ctx.font = `900 ${fontSize * dpr}px "Helvetica Neue", Helvetica, Arial, sans-serif`
ctx.textBaseline = 'top'
ctx.globalAlpha = currentAlpha

// Optional Shadow
if (shadow) {
  ctx.shadowColor = 'rgba(0, 0, 0, 0.9)'
  ctx.shadowBlur = 3 * dpr
}

// Double-strike fuer volle Deckkraft (Anti-Aliasing kompensieren)
ctx.fillText(ch, cx, cy)          // 1. Pass mit Shadow
ctx.shadowColor = 'transparent'
ctx.fillText(ch, cx, cy)          // 2. Pass ohne Shadow
```

### SDF-Funktionen

#### Herz (implizite Gleichung)
```typescript
function heartSDF(nx: number, ny: number): number {
  const x = nx * 0.85
  const y = -ny * 0.95 + 0.2
  const x2 = x * x, y2 = y * y
  const sum = x2 + y2 - 1
  return sum * sum * sum - x2 * y2 * y
}
```

#### Kreis
```typescript
function circleSDF(nx: number, ny: number): number {
  return Math.sqrt(nx * nx + ny * ny) - 0.75
}
```

#### Stern (5-Punkt)
```typescript
function starSDF(nx: number, ny: number): number {
  const angle = Math.atan2(ny, nx)
  const d = Math.sqrt(nx * nx + ny * ny)
  const a = (angle / Math.PI + 1) / 2 * 5 % 1
  const r = a < 0.5
    ? 0.35 + 0.45 * (1 - Math.abs(a - 0.25) * 4)
    : 0.35 + 0.45 * (1 - Math.abs(a - 0.75) * 4)
  return d - r
}
```

#### Welle
```typescript
function waveSDF(nx: number, ny: number): number {
  const waveY = Math.sin(nx * 4) * 0.25
  const thickness = 0.2 + Math.cos(nx * 2) * 0.05
  return Math.abs(ny - waveY) - thickness
}
```

#### Spirale
```typescript
function spiralSDF(nx: number, ny: number): number {
  const d = Math.sqrt(nx * nx + ny * ny)
  const angle = Math.atan2(ny, nx)
  const spiralR = (angle / Math.PI + 1) / 2 * 0.6 + d * 0.15
  const armDist = Math.abs((d - spiralR * 0.5) % 0.25 - 0.125)
  return d > 0.85 ? d - 0.85 : armDist - 0.06
}
```

### Bitmap-Masken-Generierung

#### Text als Form
```typescript
function createTextMask(text: string, canvasW: number, canvasH: number): ImageData {
  // Offscreen canvas, schwarzer Hintergrund
  // Text in weiss mit font-weight 800, skaliert auf volle Breite
  // Fontgroesse = min(canvasH * 0.7 * (usableW / textWidth), canvasH * 0.8)
  // textBaseline = 'middle', y = canvasH/2 + finalSize * 0.05
}
```

#### Bild als Form
```typescript
async function generateImagePositions(imageUrl, canvasW, canvasH, word, fontSize): Promise<CharPosition[]> {
  // Bild laden (crossOrigin = 'anonymous')
  // Auf Canvas skalieren (fit, zentriert)
  // Grayscale-Konvertierung: Luminanz < 128 → weiss (innerhalb), sonst schwarz
  // Bitmap-Positions-Generierung auf dem invertierten Bild
}
```

### Dynamischer Text

Der `word`-Parameter unterstuetzt einen Platzhalter:

| Wert | Ergebnis |
|------|----------|
| `{{datetime}}` | Aktuelles Datum und Uhrzeit im Format `DD.MM.YYYY HH:MM ` (deutsch), wird bei jedem Loop-Zyklus aktualisiert |
| Jeder andere String | Wird literal als Wiederholungsmuster verwendet |

---

## 3. API Endpoints

### GET /api/admin/cover-animation

Liefert die aktuelle Konfiguration.

**Auth:** Session-basiert (Admin-Berechtigung erforderlich)

**Response:** `CoverAnimationConfig` JSON — aus der `settings`-Tabelle, Key `'cover_animation_config'`. Falls kein Eintrag existiert, wird `DEFAULT_COVER_ANIMATION_CONFIG` zurueckgegeben.

### PUT /api/admin/cover-animation

Speichert die Konfiguration.

**Auth:** Session-basiert

**Body:** `CoverAnimationConfig` JSON

**Logik:** Upsert in `settings`-Tabelle mit `onConflict: 'key'`

**Response:** `{ success: true, config }`

### POST /api/admin/cover-animation/upload

Vercel Blob Upload fuer Custom-Shape-Bilder.

**Auth:** Session-basiert (Pruefung in `onBeforeGenerateToken`)

**Constraints:**
- Erlaubte Typen: `image/png`, `image/jpeg`, `image/svg+xml`, `image/webp`
- Max. Groesse: 5 MB

**Response:** Vercel Blob Upload-Response mit `url`-Feld

---

## 4. Admin UI

### Tab "Cover Animation" in der Settings-Seite

#### Abschnitt 1: Modus-Toggle
- Switch: "Calligram Animation aktivieren" (on/off)
- Status-Text: "Animiertes Calligram aktiv" / "Statisches SVG-Logo aktiv"

#### Abschnitt 2: Calligram-Parameter (nur sichtbar wenn Modus = calligram)

| Feld | Typ | Range | Default |
|------|-----|-------|---------|
| Wiederholungstext | Text Input | frei, `{{datetime}}` fuer live Uhrzeit | `{{datetime}}` |
| Schriftgroesse (px) | Number Input | 2-20 | 7 |
| Breite (px) | Number Input | 100-1200 | 600 |
| Hoehe (px) | Number Input | 50-800 | 120 |
| Farbe | Color Picker + "Graustufen" Button | Hex oder leer | `#ffffff` |
| Haltezeit (Sek.) | Number Input | 1-30, Step 0.5 | 3 |
| Textschatten | Switch (on/off) | — | an |
| Form | Select Dropdown | heart, circle, star, wave, spiral, custom_text, custom_image | custom_text |
| Form-Text | Text Input (nur bei custom_text) | frei | synthszr |
| Form-Bild | File Upload + Preview (nur bei custom_image) | PNG/JPG/SVG/WebP, max 5MB | — |

#### Abschnitt 3: Live-Vorschau
- Zeigt eine CalligramCanvas-Instanz mit aktuellen Einstellungen
- "Neu generieren" Button zum Zuruecksetzen der Animation

#### Abschnitt 4: Speichern
- Save-Button mit Loading-Spinner
- Erfolgsanzeige "Gespeichert" (3s auto-hide)

---

## 5. Integration in die oeffentliche Seite

### Server Component (Page)

```typescript
// Settings laden
const { data } = await supabase
  .from('settings')
  .select('value')
  .eq('key', 'cover_animation_config')
  .single()

const coverAnimation = data?.value as CoverAnimationConfig | undefined
```

Config als Prop an die Anzeige-Komponente weiterreichen.

### Conditional Rendering

```tsx
{coverAnimation?.mode === 'calligram' ? (
  <CoverCalligram {...coverAnimation.calligram} />
) : (
  <StaticLogo />  // Fallback
)}
```

### CoverCalligram Wrapper

```typescript
// 'use client'
function CoverCalligram(config: CalligramConfig) {
  const generateFn = useCallback(
    () => createGenerateFn(config)(),
    [config]
  )

  return (
    <CalligramCanvas
      width={config.width}
      height={config.height}
      word={config.word}
      fontSize={config.fontSize}
      color={config.color || undefined}
      holdDuration={config.holdDuration}
      shadow={config.shadow ?? true}
      generateFn={generateFn}
      style={{ width: '100%', height: 'auto', aspectRatio: `${config.width}/${config.height}` }}
    />
  )
}
```

---

## 6. npm-Abhaengigkeit

### @chenglou/pretext

- **Zweck:** Pixelgenaue Textbreitenmessung ohne Canvas `measureText()`
- **API:** `prepareWithSegments(text, fontString)` → `layoutWithLines(prepared, maxWidth, lineHeight)` → `result.lines[0].width`
- **Besonderheit:** Liefert rohe TypeScript-Dateien (kein Compile-Step). Erfordert:
  - `transpilePackages: ['@chenglou/pretext']` in next.config
  - `allowImportingTsExtensions: true` in tsconfig.json (bei `noEmit: true`)

---

## 7. Rendering-Details

### DPR-Awareness
- Canvas-Pixel: `canvas.width = configWidth * devicePixelRatio`
- CSS-Anzeige: `style.width = configWidth + 'px'`
- Zeichenkoordinaten: `fillText(ch, currentX * dpr, currentY * dpr)`

### Anti-Aliasing-Kompensation
Bei kleinen Schriftgroessen (< 10px) erzeugt Canvas-Textrendering halbtransparente Randpixel. Gegenmassnahmen:
1. **Font-Weight 900** (Black) — dickere Striche
2. **Double-Strike** — `fillText` zweimal an gleicher Position
3. **Optionaler Shadow** — dunkler Hintergrund-Schatten (`rgba(0,0,0,0.9)`, 3px blur)

### Transparenter Hintergrund
Canvas wird pro Frame mit `clearRect` geloescht → vollstaendig transparent. Eignet sich zum Ueberlagern anderer Inhalte (Cover-Bilder, Hintergruende).

### Graustufen-Gradient (wenn Farbe leer)
```typescript
function greyColor(charIdx: number, total: number): string {
  const t = charIdx / Math.max(1, total - 1)
  const lightness = 80 + Math.sin(t * Math.PI) * 20  // 80-100%
  return `hsl(0, 0%, ${lightness}%)`
}
```

---

## 8. Dateien (Referenz)

| Datei | Zweck |
|-------|-------|
| `components/calligram-canvas.tsx` | Animations-Engine, SDF-Formen, Bitmap-Masken, Factory |
| `components/cover-calligram.tsx` | Client-Wrapper fuer die oeffentliche Seite |
| `lib/types/cover-animation.ts` | TypeScript-Types und Default-Config |
| `app/api/admin/cover-animation/route.ts` | GET/PUT Settings API |
| `app/api/admin/cover-animation/upload/route.ts` | Vercel Blob Upload fuer Shape-Bilder |
| Admin Settings Page (Tab "Cover Animation") | Admin-UI mit Live-Vorschau |

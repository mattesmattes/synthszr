# Lexikon-GIF89a-Animation Implementation Plan

> **Status (2026-09-28):** nicht umgesetzt (0 von 116 Schritten). Die Animation kam stattdessen als Runtime-Canvas: erst WebGPU-Warp (79f5348), dann Korn-Wanderung (1e94ef3, `components/glossary/korn-canvas.tsx`).

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Zwölf ausgewählte Lexikonillustrationen erhalten kurze, einmalige GIF89a-Animationen, ohne das statische PNG als SSR-, LCP-, Alt-Text-, SEO- und OG-Bild zu ersetzen.

**Architecture:** Eine lokale, deterministische Sharp-Pipeline rendert aus versionierten Schwarz/Transparent-PNGs und einem streng validierten Recipe zwei immutable GIFs. Ein explizites Publish-Skript verifiziert Poster und Artefakte, lädt sie idempotent in Vercel Blob und aktiviert Poster sowie beide GIF-URLs atomar per vollständigem Compare-and-Swap in Supabase. Die öffentliche Next.js-Seite bleibt serverseitig; nur Datensätze mit Animations-URL erhalten eine kleine Client-Komponente, die GIF-Bytes vorlädt und den Decoder erst bei einem Drittel Sichtbarkeit startet.

**Tech Stack:** Node.js 24, pnpm 10.20, TypeScript strict, Zod 3, Sharp 0.34.5/libvips 8.17.3/cgif 0.5.0, Vitest 4, Next.js 16 App Router, React 19, Supabase/Postgres, Vercel Blob 2.6, Playwright Chromium.

**Spec:** [`docs/superpowers/specs/2026-08-28-glossary-gif89a-animation-design.md`](../specs/2026-08-28-glossary-gif89a-animation-design.md)

## Global Constraints

- Das vorhandene PNG bleibt `priority`, behält `width={768}`, `height={768}`, `sizes="326px"`, Alt-Text, Metadata und OG-Verwendung.
- Ohne `illustration_animation_url` muss der bestehende statische Bildblock unverändert erscheinen; die Seite darf dann weder GIF noch Animations-Client-Chunk anfordern.
- GIFs spielen genau einmal, enthalten keine `NETSCAPE2.0`-Extension und bleiben auf dem letzten Frame stehen.
- `prefers-reduced-motion: reduce` verhindert bereits den GIF-Request.
- Quell-PNGs bleiben versioniert unter `assets/`; generierte Dateien unter `/artifacts/` werden ignoriert.
- Renderer und Validator arbeiten offline. Nur das Publish-Skript darf Blob, Supabase und die Revalidation-Route ansprechen.
- Produktionsschreibvorgänge bleiben hinter `--apply`; Dry-Run ist der Default.
- Alle neuen Tests werden zuerst rot ausgeführt. Erst danach folgt die kleinste Implementierung bis Grün.
- Bestehende, nicht zu diesem Feature gehörende Änderungen und unversionierte Dateien bleiben unangetastet.
- Keine unbestätigten Produktionswrites: Migration, Deployment und erstes `--apply` erhalten vor Task 12 ein Operator-Gate.
- Vor Vercel-Arbeiten die veraltete CLI in Task 0 über den Node-24-Runner aktualisieren (lokal 59.5.0, Ziel mindestens 59.9.1).

---

## Task 0: Toolchain reparieren und Baseline sichern

**Files:**

- Create: `scripts/run-node24.sh`
- Verify: `package.json`
- Verify: `pnpm-lock.yaml`
- Verify: `vitest.config.ts`
- Verify: `tests/lib/dither-png-palette.test.ts`
- Verify: `tests/lib/glossary-illustration.test.ts`

- [ ] **Step 1: Isoliertes Feature-Worktree anlegen**

Vor jeder Implementierung REQUIRED SUB-SKILL `superpowers:using-git-worktrees` verwenden. Der Hauptcheckout ist stark verschmutzt und enthält zahlreiche fremde unversionierte `.ts`-Dateien, die wegen `tsconfig.json` (`**/*.ts`) sogar Builds beeinflussen können. Alle Tasks 0–14 deshalb in einem neuen, sauberen Feature-Worktree ausführen; die freigegebene Spec und diesen Plan aus dem absoluten Hauptcheckout lesen.

```bash
FEATURE_WORKTREE="$(pwd -P)"
test "$FEATURE_WORKTREE" != \
  '/Users/mattes/Library/CloudStorage/Dropbox/dev/synthszr'
test -z "$(git status --porcelain=v1)"
```

Diese Commands unmittelbar nach dem Wechsel in den vom Worktree-Skill erzeugten Pfad ausführen. Erwartung im neuen Feature-Worktree vor Task 1: leer. Diesen Pfad für alle folgenden Tasks beibehalten; nicht in den verschmutzten Hauptcheckout zurückwechseln.

- [ ] **Step 2: Node und pnpm auf den Repo-Vertrag bringen**

```bash
test "$(pwd -P)" != \
  '/Users/mattes/Library/CloudStorage/Dropbox/dev/synthszr'
test -z "$(git status --porcelain=v1)"
node --version
pnpm --version
```

Erwartung vor dem Fix: Node 22.x statt des in `package.json` verlangten Node 24.x.

NVM explizit laden, Node 24 installieren und für diesen Bootstrap-Prozess aktivieren:

```bash
export NVM_DIR="${NVM_DIR:-$HOME/.nvm}"
test -s "$NVM_DIR/nvm.sh"
source "$NVM_DIR/nvm.sh"
nvm install 24
nvm use --silent 24
corepack enable
corepack prepare pnpm@10.20.0 --activate
node --version
pnpm --version
```

Erwartung: `v24.x.x` und `10.20.0`.

- [ ] **Step 3: Stateless Node-24-Runner anlegen**

`scripts/run-node24.sh`:

```bash
#!/usr/bin/env bash
set -euo pipefail

export NVM_DIR="${NVM_DIR:-$HOME/.nvm}"
if [[ ! -s "$NVM_DIR/nvm.sh" ]]; then
  printf 'NVM fehlt: %s\n' "$NVM_DIR/nvm.sh" >&2
  exit 1
fi

# shellcheck source=/dev/null
source "$NVM_DIR/nvm.sh"
nvm use --silent 24 >/dev/null

if [[ "$(node -p "process.versions.node.split('.')[0]")" != '24' ]]; then
  printf 'Node 24 konnte nicht aktiviert werden.\n' >&2
  exit 1
fi

exec "$@"
```

Mit `apply_patch` anlegen, danach:

```bash
chmod +x scripts/run-node24.sh
./scripts/run-node24.sh node --version
./scripts/run-node24.sh pnpm --version
```

Erwartung: `v24.x.x` und `10.20.0`. **Globaler Ausführungsvertrag:** Ab hier läuft jeder `node`-, `pnpm`-, `tsx`-, `vitest`-, `next`- und `vercel`-Aufruf in jedem neuen Shell-/Agentenprozess über `./scripts/run-node24.sh`. In einem temporären Deployment-Worktree wird dessen lokales `./scripts/run-node24.sh` verwendet. Keine Task darf sich auf ein vorheriges `nvm use` verlassen.

- [ ] **Step 4: Native Dependencies frisch installieren**

```bash
./scripts/run-node24.sh pnpm install --frozen-lockfile --force
./scripts/run-node24.sh node -e "const sharp = require('sharp'); console.log(sharp.versions)"
```

Erwartung: Sharp lädt ohne Code-Signaturfehler; Ausgabe enthält mindestens `vips: '8.17.3'` und `cgif: '0.5.0'`.

- [ ] **Step 5: Bestehende Bildtests als Baseline ausführen**

```bash
./scripts/run-node24.sh pnpm exec vitest run \
  tests/lib/dither-png-palette.test.ts \
  tests/lib/glossary-illustration.test.ts
```

Erwartung: PASS. Bei einem Fehler stoppen; keinen Feature-Code schreiben, bevor die Baseline grün ist.

- [ ] **Step 6: Vercel CLI aktualisieren**

```bash
./scripts/run-node24.sh pnpm add -g vercel@latest
./scripts/run-node24.sh vercel --version
```

Erwartung: mindestens `59.9.1`.

- [ ] **Step 7: Supabase CLI aktualisieren und Commands verifizieren**

Die lokale Homebrew-Version 2.75.0 ist älter als die verfügbare 2.116.0 und kennt `db advisors` noch nicht:

```bash
brew update
brew upgrade supabase
supabase --version
supabase migration new --help
supabase db reset --help
supabase test db --help
supabase db advisors --help
```

Erwartung: Supabase CLI mindestens 2.116.0; alle später im Plan verwendeten Commands und Flags erscheinen in `--help`. Falls `db advisors` trotz aktueller CLI nicht angeboten wird, die Advisor-Prüfung ausschließlich über das konfigurierte Supabase-MCP oder Dashboard ausführen und im Handoff dokumentieren; keinen CLI-Befehl erfinden.

- [ ] **Step 8: Runner committen**

```bash
git add scripts/run-node24.sh
git commit -m "chore(tooling): enforce Node 24 for feature commands"
```

---

## Task 1: Recipe-Schema und sichere Asset-Ladung

**Files:**

- Create: `lib/glossary/animation/schema.ts`
- Create: `lib/glossary/animation/assets.ts`
- Create: `tests/lib/glossary-animation-schema.test.ts`
- Create: `tests/lib/glossary-animation-assets.test.ts`

**Core contracts:**

```ts
export type AnimationPattern =
  | 'transfer'
  | 'accumulation'
  | 'reveal'
  | 'transition'
  | 'signal'
  | 'order'

export interface PixelBuffer {
  data: Buffer
  width: number
  height: number
  channels: 4
}

export interface AnimationAssetPackage {
  root: string
  recipe: GlossaryAnimationRecipe
  poster: PixelBuffer
  base: PixelBuffer
  layers: Map<string, LayerAsset>
}

export function parseAnimationRecipe(input: unknown): GlossaryAnimationRecipe
export function canonicalRecipeJson(recipe: GlossaryAnimationRecipe): string
export async function loadAnimationPackage(
  assetRoot: string,
  expectedSlug?: string,
): Promise<AnimationAssetPackage>
```

Das Zod-Schema ist eine `.strict()` discriminated union auf `pattern`. Gemeinsame Felder entsprechen der Spec. Die sechs Pattern-Erweiterungen sind verbindlich:

```ts
// Integer-Offset relativ zur ursprünglichen Bounding-Box-Position des Layers.
// { x: 0, y: 0 } ist exakt die Position aus poster.png.
type Point = { x: number; y: number }
type Pose = Point & { quarterTurns?: 0 | 1 | 2 | 3 }

type TransferMotion = {
  layerId: string
  from: Point
  to: Point
  startFrame: number
  endFrame: number
}

type AccumulationMotion = {
  layerId: string
  target: Point
  arrivals: Array<{
    from: Point
    startFrame: number
    endFrame: number
  }> // 1..4
}

type RevealMotion = {
  layerId: string
  axis: 'x' | 'y'
  startEdge: number
  endEdge: number
  startFrame: number
  endFrame: number
}

type TransitionMotion = {
  layerId: string
  axis: 'x' | 'y'
  thresholdPosition: number
  from: Pose
  to: Pose
  startFrame: number
  endFrame: number
}

type SignalMotion = {
  layerId: string
  path: [Point, Point] | [Point, Point, Point] | [Point, Point, Point, Point]
  startFrame: number
  endFrame: number
}

type OrderMotion = {
  items: Array<{
    layerId: string
    from: Point
    to: Point
    startFrame: number
    endFrame: number
  }> // 1..2
}
```

Frame-Indizes liegen immer im Bereich `0 … logicalFrameCount - 1`. `startFrame` und `endFrame` sind inklusiv: Am `startFrame` ist der Ausgangszustand sichtbar, am `endFrame` der Zielzustand. Ein Hauptvorgang darf ausschließlich Layer mit `role:'subject'` referenzieren; `reaction.layerId` muss auf `role:'reaction'` zeigen. Die Reaktion beginnt frühestens am letzten Endframe des Hauptvorgangs und endet vollständig innerhalb der Laufzeit.

`reveal.startEdge`/`endEdge` und `transition.thresholdPosition` sind ebenfalls lokale Integer-Offsets ab der linken beziehungsweise oberen Kante der ursprünglichen Layer-Bounding-Box, abhängig von `axis`. Es gibt im Recipe keine absoluten Canvas-Koordinaten.

- [ ] **Step 1: Schema-Tests schreiben**

Tests müssen je ein gültiges Recipe für alle sechs Pattern enthalten und folgende Fehler erzwingen:

- unbekanntes Pattern oder unbekanntes Feld;
- Slug außerhalb `/^[a-z0-9]+(?:-[a-z0-9]+)*$/` oder länger als 128 Zeichen;
- Hash außerhalb von 64 lowercase Hex-Zeichen;
- Breite/Höhe ungleich 768;
- mehr als zwei Layer oder doppelte Layer-ID;
- Layerpfad außerhalb `layers/<sicherer-name>.png`;
- Float-Koordinaten, ungültige Framefenster oder Referenzen auf unbekannte Layer;
- `logicalFrameCount / fps` außerhalb 2,5 bis 3,5 Sekunden;
- Reaktion auf unbekanntes Layer, ungültige Distanz oder außerhalb liegendes Framefenster.
- Hauptbewegung auf einem `reaction`-Layer oder Reaktion auf einem `subject`-Layer;
- Reaktionsbeginn vor dem letzten Endframe der Hauptbewegung.

- [ ] **Step 2: Rote Schema-Suite ausführen**

```bash
./scripts/run-node24.sh pnpm exec vitest run tests/lib/glossary-animation-schema.test.ts
```

Erwartung: FAIL, weil `schema.ts` noch fehlt.

- [ ] **Step 3: Schema minimal implementieren**

Zusätzlich zu den Feldschemas in `.superRefine()` alle Cross-Field-Invarianten prüfen. `canonicalRecipeJson()` muss Objektschlüssel rekursiv sortieren und genau einen abschließenden Newline liefern, damit die Release-ID über Rechner hinweg stabil ist.

- [ ] **Step 4: Asset-Sicherheits-Tests schreiben**

Mit `mkdtemp()` synthetische 768er-PNGs erzeugen und testen:

- PNG-Magic-Bytes werden vor Sharp geprüft;
- Datei >10 MiB wird vor Decode verworfen;
- `realpath` blockiert Symlink- und `../`-Traversal;
- `limitInputPixels: 768 * 768` und `failOn: 'error'` sind wirksam;
- falsche Dimensionen, Alpha außerhalb 0/255 oder opake Nicht-Schwarz-Pixel werden verworfen;
- RGB-Werte unter Alpha 0 werden beim kanonischen Vergleich ignoriert;
- Layer-Bounding-Box wird aus opaken Pixeln bestimmt und intern ausgeschnitten;
- `posterSha256` muss dem lokalen `poster.png` entsprechen.

- [ ] **Step 5: Rote Asset-Suite ausführen**

```bash
./scripts/run-node24.sh pnpm exec vitest run tests/lib/glossary-animation-assets.test.ts
```

Erwartung: FAIL, weil `assets.ts` noch fehlt.

- [ ] **Step 6: Sicheren Loader implementieren und beide Suites grün machen**

```ts
sharp(buffer, {
  failOn: 'error',
  limitInputPixels: 768 * 768,
}).ensureAlpha().raw()
```

Vor `readFile()` per `stat()` die 10-MiB-Grenze prüfen. Nach `realpath()` darf `path.relative(assetRoot, candidate)` weder mit `..` beginnen noch absolut sein.

```bash
./scripts/run-node24.sh pnpm exec vitest run \
  tests/lib/glossary-animation-schema.test.ts \
  tests/lib/glossary-animation-assets.test.ts
```

Erwartung: PASS.

- [ ] **Step 7: Commit**

```bash
git add lib/glossary/animation/schema.ts \
  lib/glossary/animation/assets.ts \
  tests/lib/glossary-animation-schema.test.ts \
  tests/lib/glossary-animation-assets.test.ts
git commit -m "feat(glossary): validate animation recipes and assets"
```

---

## Task 2: Sechs Bewegungsmuster und Frame-Komposition

**Files:**

- Create: `lib/glossary/animation/motion.ts`
- Create: `lib/glossary/animation/compose-frame.ts`
- Create: `lib/glossary/animation/patterns/transfer.ts`
- Create: `lib/glossary/animation/patterns/accumulation.ts`
- Create: `lib/glossary/animation/patterns/reveal.ts`
- Create: `lib/glossary/animation/patterns/transition.ts`
- Create: `lib/glossary/animation/patterns/signal.ts`
- Create: `lib/glossary/animation/patterns/order.ts`
- Create: `tests/lib/glossary-animation-motion.test.ts`
- Create: `tests/lib/glossary-animation-render.test.ts`

**Core contracts:**

```ts
export interface LayerFrameState {
  instanceId: string
  layerId: string
  x: number
  y: number
  clip?: { left: number; top: number; width: number; height: number }
  transform?:
    | { kind: 'quarter-turn'; turns: 0 | 1 | 2 | 3 }
    | { kind: 'shear-x'; pixels: -2 | -1 | 0 | 1 | 2; anchor: 'bottom' }
    | { kind: 'compress-y'; pixels: 1 | 2; anchor: 'bottom' }
}

export interface AnimationFrameState {
  layers: LayerFrameState[]
}

export function evaluateFrame(
  recipe: GlossaryAnimationRecipe,
  frameIndex: number,
): AnimationFrameState

export async function composeFrame(
  assets: AnimationAssetPackage,
  state: AnimationFrameState,
): Promise<Buffer>

export async function renderLogicalFrames(
  assets: AnimationAssetPackage,
): Promise<RenderedFrameSet>
```

- [ ] **Step 1: Motion-Tests zuerst schreiben**

Je Pattern Frame 0, Bewegungsmitte und Endframe prüfen. Zusätzlich:

- alle finalen x/y-Werte sind Integer;
- vor `startFrame` gilt der stabile Ausgangszustand, nach `endFrame` der stabile Endzustand;
- `startFrame` zeigt exakt den Ausgangs-, `endFrame` exakt den Zielzustand;
- `accumulation` erzeugt eindeutige `instanceId`s für bis zu vier Ankünfte;
- `reveal` verändert nur einen harten Clip-Rand;
- `transition` schaltet die diskrete Ausrichtung exakt beim Überschreiten der Schwellenposition;
- `signal` interpoliert segmentweise über zwei bis vier Punkte;
- `order` bewegt höchstens zwei Layer;
- Reaktionen verwenden feste diskrete Sequenzen: `settle` als y-Versatz `0 → distance → 0`, `tilt` als ganzzahligen x-Shear um 1–2 Pixel mit unterer Verankerung `0 → distance → 0`, `compress` als Nearest-Neighbour-Höhenreduktion `0 → distance → 0`.

- [ ] **Step 2: Rote Motion-Suite ausführen**

```bash
./scripts/run-node24.sh pnpm exec vitest run tests/lib/glossary-animation-motion.test.ts
```

Erwartung: FAIL, weil Evaluatoren fehlen.

- [ ] **Step 3: Evaluatoren implementieren**

Jede Pattern-Datei exportiert genau einen Evaluator; `motion.ts` dispatcht und legt die optionale Reaktion darüber. Interpolation darf intern mit Fließkomma rechnen, muss aber vor Rückgabe deterministisch per `Math.round()` auf Integer-Pixel quantisieren.

- [ ] **Step 4: Render-Tests schreiben**

Mit kleinen synthetischen Formen auf 768er Canvas prüfen:

- Frame 0 rekonstruiert Poster kanonisch;
- Base plus zugeschnittenes Layer landet ohne Antialiasing an der Zielposition;
- Quarter-Turn und Compress erzeugen weiterhin ausschließlich Alpha 0/255 und opakes Schwarz;
- `shear-x` bleibt unten verankert, verschiebt die Oberkante exakt um ±1 beziehungsweise ±2 Pixel und erzeugt weder Grauwerte noch Teilalpha oder Antialiasing;
- der erwartete Endframe stimmt mit der Recipe-Auswertung überein;
- Vereinigungs-Bounding-Boxes zählen als höchstens zwei Bewegungszonen;
- XOR-Vereinigung gegen Frame 0 wird korrekt als Anteil der Canvasfläche berechnet;
- 326er-Resize nutzt `sharp.kernel.nearest` und wird erneut auf Schwarz/Transparent kanonisiert.

- [ ] **Step 5: Rote Render-Suite ausführen**

```bash
./scripts/run-node24.sh pnpm exec vitest run tests/lib/glossary-animation-render.test.ts
```

Erwartung: FAIL, weil Komposition und Resize fehlen.

- [ ] **Step 6: Komposition minimal implementieren**

`composeFrame()` beginnt immer mit `base.png`, transformiert ausschließlich intern ausgeschnittene Layer und setzt sie mit Sharp `composite()`. Jede Transformation nutzt Nearest-Neighbour; keine Standardrotation mit Antialiasing.

```bash
./scripts/run-node24.sh pnpm exec vitest run \
  tests/lib/glossary-animation-motion.test.ts \
  tests/lib/glossary-animation-render.test.ts
```

Erwartung: PASS.

- [ ] **Step 7: Commit**

```bash
git add lib/glossary/animation/motion.ts \
  lib/glossary/animation/compose-frame.ts \
  lib/glossary/animation/patterns \
  tests/lib/glossary-animation-motion.test.ts \
  tests/lib/glossary-animation-render.test.ts
git commit -m "feat(glossary): render six discrete animation patterns"
```

---

## Task 3: GIF89a-Encoding und vollständiger Validator

**Files:**

- Create: `lib/glossary/animation/encode-gif.ts`
- Create: `lib/glossary/animation/release.ts`
- Create: `lib/glossary/animation/validate-output.ts`
- Create: `tests/lib/glossary-animation-gif.test.ts`

**Core contracts:**

```ts
export function distributeGifDelays(
  frameCount: number,
  fps: 8 | 9 | 10,
): number[]

export function coalesceAdjacentDuplicateFrames(
  frames: Buffer[],
  delays: number[],
): { frames: Buffer[]; delays: number[] }

export async function encodeGif(
  frames: Buffer[],
  delays: number[],
): Promise<Buffer>

export function computeReleaseId(input: {
  posterSha256: string
  canonicalRecipe: string
  gif326Sha256: string
  gif768Sha256: string
}): string

export async function decodeGif(buffer: Buffer): Promise<DecodedGif>
export async function validateAnimationOutput(
  input: AnimationValidationInput,
): Promise<AnimationValidationReport>
export function assertPublishable(report: AnimationValidationReport): void
```

- [ ] **Step 1: Encoder-Fixture-Test schreiben**

Ein 32×32-Fixture mit mindestens drei unterschiedlichen Frames muss prüfen:

- Header exakt `GIF89a`;
- mehr als ein dekodiertes Frame;
- keine Bytes `NETSCAPE2.0`;
- Sharp-Metadata mit `pages`, `pageHeight` und `delay`;
- ausschließlich transparent oder opakes Schwarz nach Decode;
- `loop` enthält keinen wiederholenden Loop-Vertrag.
- ein fester Testvektor für `computeReleaseId()` bleibt bytegenau stabil und reagiert auf jede Feld- oder Reihenfolgeänderung.

- [ ] **Step 2: Rot ausführen**

```bash
./scripts/run-node24.sh pnpm exec vitest run tests/lib/glossary-animation-gif.test.ts
```

Erwartung: FAIL, weil Encoder und Validator fehlen.

- [ ] **Step 3: Delay-Verteilung und Duplicate-Coalescing implementieren**

Die Delay-Verteilung akkumuliert Rundungsfehler in 10-ms-Einheiten. Für 8, 9 und 10 fps darf jedes Präfix höchstens 10 ms von `(prefixLength * 1000) / fps` abweichen; die Gesamtsumme wird gegen `(frameCount * 1000) / fps` geprüft. Benachbarte Frames werden anhand kanonischer RGBA-Pixeldaten zusammengeführt, nicht anhand der PNG-Bytes; ihr Delay wird addiert.

- [ ] **Step 4: Encoder mit exakt fixierten Optionen implementieren**

```ts
await sharp(frames, { join: { animated: true } }).gif({
  colors: 2,
  dither: 0,
  effort: 10,
  interFrameMaxError: 0,
  keepDuplicateFrames: false,
  delay: delays,
  loop: 1,
}).toBuffer()
```

- [ ] **Step 5: Negative Validator-Tests ergänzen**

Vor der Validatorimplementierung je einen gezielt roten Test schreiben für:

- falsche 768er- oder 326er-Dimension;
- `encodedFrameCount > logicalFrameCount`;
- Präfix- oder Gesamtdelayabweichung >10 ms;
- Überschreitung von 600 KB beziehungsweise 250 KB;
- falsches Frame 0 bei 768 oder 326;
- falschen Endframe;
- mehr als zwei Zonen oder mehr als 12 Prozent XOR-Fläche;
- Grauwert, teiltransparenten Pixel oder opaken Nicht-Schwarz-Pixel;
- Pixelzustand, der weder aus Base noch aus den Recipe-Layern ableitbar ist.

```bash
./scripts/run-node24.sh pnpm exec vitest run tests/lib/glossary-animation-gif.test.ts
```

Erwartung: FAIL an den noch nicht implementierten Validator-Gates.

- [ ] **Step 6: Validator vollständig implementieren**

GIF-Decode verwendet wegen des vertikal gestapelten Sharp-Bildes:

```ts
const MAX_LOGICAL_FRAMES = 35
const MAX_ANIMATED_PIXELS = 768 * 768 * MAX_LOGICAL_FRAMES

sharp(gif, {
  animated: true,
  failOn: 'error',
  limitInputPixels: MAX_ANIMATED_PIXELS,
})
```

Der Report enthält für 326 und 768 mindestens: Dimensionen, logische/encoded Frames, Delays, Dauer, Bytegröße, Frame-0-Vergleich, Endframe-Vergleich, Zwei-Zustands-Pixel, Bewegungszonen und XOR-Anteil. `assertPublishable()` erzwingt 600 KB/250 KB, >1 Frame, ≤12 Prozent Bewegungsfläche und sämtliche Spec-Grenzen.

- [ ] **Step 7: Release-ID eindeutig implementieren**

Die Preimage-Struktur ist versioniert und längeneindeutig:

```text
UTF8("synthszr-glossary-animation-release-v1\0")
|| posterSha256 als 32 rohe Bytes
|| uint32be(ByteLength(canonicalRecipe))
|| UTF8(canonicalRecipe)
|| gif326Sha256 als 32 rohe Bytes
|| gif768Sha256 als 32 rohe Bytes
```

`computeReleaseId()` liefert den lowercase SHA-256 dieser Bytefolge. Renderer und Publisher importieren dieselbe Hilfe; keine zweite Hashimplementierung.

- [ ] **Step 8: Suite grün ausführen**

```bash
./scripts/run-node24.sh pnpm exec vitest run tests/lib/glossary-animation-gif.test.ts
```

Erwartung: PASS.

- [ ] **Step 9: Commit**

```bash
git add lib/glossary/animation/encode-gif.ts \
  lib/glossary/animation/release.ts \
  lib/glossary/animation/validate-output.ts \
  tests/lib/glossary-animation-gif.test.ts
git commit -m "feat(glossary): encode and validate one-shot GIF89a assets"
```

---

## Task 4: Render-CLI und Referenzmotiv `buchgewinn`

**Files:**

- Create: `scripts/render-glossary-animation.ts`
- Create: `assets/glossary-animations/buchgewinn/poster.png`
- Create: `assets/glossary-animations/buchgewinn/base.png`
- Create: `assets/glossary-animations/buchgewinn/layers/subject.png`
- Create: `assets/glossary-animations/buchgewinn/layers/reaction.png` only if the approved storyboard needs the second zone
- Create: `assets/glossary-animations/buchgewinn/recipe.json`
- Modify: `.gitignore`
- Test: `tests/lib/glossary-animation-render.test.ts`

- [ ] **Step 1: CLI-Contract als Test ergänzen**

Den Renderer über exportierte `main(args, io)`-Funktion testbar machen. Testfälle:

- genau ein gültiger Slug wird akzeptiert;
- Fehler erzeugt Exitcode 1 und hinterlässt keinen teilweise freigegebenen Zielordner;
- vollständiger Lauf schreibt exakt fünf Artefakte;
- Manifest und Proof werden erst nach grünem Validator geschrieben.

- [ ] **Step 2: Rot ausführen**

```bash
./scripts/run-node24.sh pnpm exec vitest run tests/lib/glossary-animation-render.test.ts
```

Erwartung: FAIL an der fehlenden CLI.

- [ ] **Step 3: CLI implementieren**

Aufruf:

```bash
./scripts/run-node24.sh pnpm tsx scripts/render-glossary-animation.ts buchgewinn
```

Ausgabe ausschließlich unter:

```text
artifacts/glossary-animations/buchgewinn/
  buchgewinn-326.gif
  buchgewinn-768.gif
  final-frame.png
  manifest.json
  proof.html
```

Das Manifest enthält mindestens Recipe-Hash, Posterhash, beide GIF-Hashes, Release-ID, logische/encoded Frames, Delays, Dauer, Bytegrößen, XOR-Anteil und Validatorstatus.

- [ ] **Step 4: Generierte Artefakte ignorieren**

In `.gitignore` genau ergänzen:

```gitignore
/artifacts/
```

`assets/` bleibt versioniert.

- [ ] **Step 5: Kanonisches Poster sichern**

Das aktuell ausgelieferte PNG von `buchgewinn` als `poster.png` laden. Danach:

```bash
shasum -a 256 assets/glossary-animations/buchgewinn/poster.png
```

Erwartung für die freigegebene Quelle: `5259e51882e7fe513f92e4b9f12eb9c6c138c36a0e4345bfb0b984c4654dbdba`.

- [ ] **Step 6: Base, Layer und Recipe authoren**

Storyboard: Eine Münze fällt vertikal durch den Hals der Sanduhr in den unteren Bestand; höchstens eine kleine Settle-Reaktion im unteren Bereich. Frame 0 muss das Poster exakt rekonstruieren. Die Bewegung beginnt mit mindestens vier statischen Frames, damit der atomare Poster/GIF-Wechsel Decode-Spielraum hat. Koordinaten werden aus den tatsächlichen Layer-Bounds als Integer bestimmt und im Recipe gespeichert; keine geschätzten Float-Werte.

- [ ] **Step 7: Rendern und maschinell abnehmen**

```bash
./scripts/run-node24.sh pnpm tsx scripts/render-glossary-animation.ts buchgewinn
```

Erwartung: Exit 0; Manifest vollständig grün; 768 ≤600 KB, 326 ≤250 KB; GIF89a; kein NETSCAPE2.0; Frame 0 kanonisch gleich Poster.

- [ ] **Step 8: Proof visuell abnehmen**

`artifacts/glossary-animations/buchgewinn/proof.html` in einem Browser prüfen:

- Light und Dark;
- 326er- und 768er-GIF bei 326 CSS-Pixeln;
- keine Geisterbilder oder antialiasenden Grauwerte;
- Bewegung erklärt den Buchgewinn und endet lesbar;
- genau ein Hauptvorgang, höchstens eine kleine Reaktion.

Bei Ablehnung nur `base.png`, Layer oder Recipe ändern und Step 7/8 wiederholen.

- [ ] **Step 9: Commit**

```bash
git add .gitignore scripts/render-glossary-animation.ts \
  assets/glossary-animations/buchgewinn \
  tests/lib/glossary-animation-render.test.ts
git commit -m "feat(glossary): add buchgewinn animation source package"
```

---

## Task 5: Supabase-Schema und Trigger-Vertrag

**Files:**

- Create: the exact path printed by `supabase migration new glossary_animation_urls` under `supabase/migrations/`
- Create: `supabase/tests/glossary_animation_urls_test.sql`

- [ ] **Step 1: Aktuelle Supabase-Hinweise prüfen**

Vor der Schemaänderung `https://supabase.com/changelog.md` nach relevanten `breaking-change`-Einträgen zu CLI, Migrationen, Triggern und pgTAP prüfen. Danach die aktuellen offiziellen Seiten für lokale Migrationen und Datenbanktests öffnen. Falls sich ein Command gegenüber Task 0 geändert hat, den Plan zuerst aktualisieren und erneut reviewen; nicht raten.

- [ ] **Step 2: Migration mit Repo-CLI erzeugen**

```bash
supabase migration new glossary_animation_urls
```

Den von der CLI ausgegebenen Pfad verwenden, im Task-Log festhalten und nicht umbenennen. Das Projekt nutzt imperative Migrationen; ein Timestamp darf deshalb nicht vorab erfunden werden.

- [ ] **Step 3: pgTAP-Test zuerst schreiben**

Der Test prüft:

- beide nullable Textspalten existieren;
- eine innerhalb der Testtransaktion in `public.glossary_terms` angelegte Fixture-Zeile behält beide Animations-URLs, wenn Poster plus beide URLs gemeinsam geändert werden;
- dieselbe echte Tabellenzeile leert beide Animations-URLs bei einer späteren reinen Posteränderung;
- `pg_trigger` bestätigt Tabelle `public.glossary_terms`, `UPDATE OF illustration_url`, Funktion `clear_stale_glossary_animation` und einen aktivierten, nicht internen Trigger;
- die Triggerfunktion ist nicht für `public`, `anon` oder `authenticated` ausführbar.

Die Fixture kann dank der Tabellendefaults minimal angelegt werden:

```sql
insert into public.glossary_terms (slug, canonical_name, status, summary)
values ('gif89a-trigger-fixture', 'GIF89a Trigger Fixture', 'draft', 'test');
```

Der pgTAP-Test läuft vollständig zwischen `begin;` und `rollback;`; er hinterlässt keine Zeile.

```bash
supabase start
supabase db reset --local --no-seed
supabase test db supabase/tests/glossary_animation_urls_test.sql
```

Erwartung vor der Migration: FAIL, weil Spalten/Funktion fehlen.

- [ ] **Step 4: Migration implementieren**

Die SQL-Funktion und den Trigger exakt aus der freigegebenen Spec übernehmen. Danach Berechtigungen ergänzen:

```sql
revoke all on function public.clear_stale_glossary_animation()
  from public, anon, authenticated;
grant execute on function public.clear_stale_glossary_animation()
  to service_role;
```

- [ ] **Step 5: Lokale DB vollständig verifizieren**

```bash
supabase db reset --local --no-seed
supabase test db supabase/tests/glossary_animation_urls_test.sql
supabase db lint --local --fail-on error
supabase migration list --local
supabase db advisors
```

Erwartung: PASS; keine Security- oder Lint-Fehler. Falls `db advisors` trotz der in Task 0 verifizierten CLI-Version nicht verfügbar ist, nicht raten: Security- und Performance-Advisors über das Supabase MCP beziehungsweise Dashboard ausführen und das Ergebnis im Task-Log festhalten.

- [ ] **Step 6: Commit**

```bash
git add supabase/migrations/*_glossary_animation_urls.sql \
  supabase/tests/glossary_animation_urls_test.sql
git commit -m "feat(glossary): store animation release URLs atomically"
```

---

## Task 6: Domain-Typen, Loader und Admin-Detailansicht

**Files:**

- Modify: `lib/glossary/types.ts`
- Modify: `lib/glossary/detail.ts`
- Modify: `app/api/admin/glossary/route.ts`
- Modify: `app/admin/glossary/page.tsx`
- Create: `lib/glossary/admin-types.ts`
- Create: `components/admin/glossary-illustration-detail.tsx`
- Modify: `tests/lib/glossary-detail.test.ts`
- Modify: `tests/api/admin-glossary.test.ts`
- Create: `tests/lib/admin-glossary-illustration-detail.test.ts`

- [ ] **Step 1: Tests um beide Felder erweitern**

`TERM_ROW` und Admin-Fixture erhalten:

```ts
illustration_animation_url: 'https://blob.example/buchgewinn-768.gif',
illustration_animation_small_url: 'https://blob.example/buchgewinn-326.gif',
```

Erwartungen prüfen camelCase im Domainobjekt sowie snake_case in der Admin-API. Ein zweiter Fall prüft beide Werte als `null`.

Der Admin-UI-Test prüft zusätzlich in der aufgeklappten Detailansicht:

- `Animation aktiv` bei vollständigem URL-Paar;
- klickbare read-only Links `326 GIF` und `768 GIF`;
- `Animation inaktiv` bei zwei null-Werten;
- `Animation unvollständig` als Warnzustand, falls genau eine URL null ist;
- kein Schreibfeld und keine implizite Aktivierungsaktion.

- [ ] **Step 2: Rot ausführen**

```bash
./scripts/run-node24.sh pnpm exec vitest run \
  tests/lib/glossary-detail.test.ts \
  tests/api/admin-glossary.test.ts \
  tests/lib/admin-glossary-illustration-detail.test.ts
```

Erwartung: FAIL, weil Select und Mapping fehlen.

- [ ] **Step 3: Domain-Typ und Loader ergänzen**

```ts
export interface GlossaryTerm extends GlossaryMatcherTerm {
  // bestehende Felder
  illustrationAnimationUrl: string | null
  illustrationAnimationSmallUrl: string | null
}
```

`getGlossaryTerm()` selektiert und mappt beide Spalten. `applyTermTranslation()` bleibt unverändert, weil es `...term` übernimmt. `generateMetadata()` verwendet weiterhin ausschließlich `illustrationUrl`.

- [ ] **Step 4: Admin-Detailabfrage und sichtbaren Status ergänzen**

Detailabfrage und Clienttyp erweitern. In der geöffneten Vorschau den read-only Status sowie die beiden Links darstellen. Die Listenabfrage bleibt absichtlich ohne Bildfelder.

Den gesamten vorhandenen Illustrationsteil der aufgeklappten Detailansicht als `GlossaryIllustrationDetail` auslagern und in `app/admin/glossary/page.tsx` an der bisherigen Stelle rendern. So prüft das Fixture nicht nur ein unverbundenes Statuslabel, sondern den vollständigen Operatorpfad:

```ts
export interface GlossaryIllustrationDetailProps {
  term: AdminGlossaryTerm
}
```

Den bestehenden Page-Typ dafür nach `lib/glossary/admin-types.ts` verschieben und sowohl Page als auch Komponente daraus importieren. Der Test rendert diesen vollständigen Illustrationsteil mit einem vollständigen `AdminGlossaryTerm`-Fixture. Die Page-Änderung ersetzt ihren bisherigen Inline-Illustrationsblock durch genau diesen Baustein; keine zweite Darstellung bleibt zurück.

- [ ] **Step 5: Grün verifizieren**

```bash
./scripts/run-node24.sh pnpm exec vitest run \
  tests/lib/glossary-detail.test.ts \
  tests/api/admin-glossary.test.ts \
  tests/lib/admin-glossary-illustration-detail.test.ts
./scripts/run-node24.sh pnpm typecheck
```

Erwartung: PASS.

- [ ] **Step 6: Commit**

```bash
git add lib/glossary/types.ts lib/glossary/detail.ts \
  lib/glossary/admin-types.ts \
  app/api/admin/glossary/route.ts app/admin/glossary/page.tsx \
  components/admin/glossary-illustration-detail.tsx \
  tests/lib/glossary-detail.test.ts tests/api/admin-glossary.test.ts \
  tests/lib/admin-glossary-illustration-detail.test.ts
git commit -m "feat(glossary): expose animation URLs in term details"
```

---

## Task 7: CSP und geschützte Revalidation für alle Sprachen

**Files:**

- Create: `lib/glossary/slug-validation.ts`
- Create: `app/api/revalidate-glossary/route.ts`
- Create: `tests/api/revalidate-glossary.test.ts`
- Modify: `lib/security/csp.mjs`
- Modify: `tests/lib/csp.test.ts`
- Modify: `.env.example`

- [ ] **Step 1: CSP-Tests zuerst erweitern**

Unter `connect-src` exakt erlauben:

```text
https://lbrzdn804nhy3kox.public.blob.vercel-storage.com
```

Test zusätzlich: `blob:` bleibt unter `img-src`; es gibt weder `https://*.public.blob.vercel-storage.com` noch eine andere neue Wildcard unter `connect-src`.

- [ ] **Step 2: Rote CSP-Suite ausführen**

```bash
./scripts/run-node24.sh pnpm exec vitest run tests/lib/csp.test.ts
```

Erwartung: FAIL, weil der exakte Origin fehlt.

- [ ] **Step 3: CSP minimal erweitern**

Nur `lib/security/csp.mjs` ändern. `next.config.mjs` liest diese Policy bereits; `vercel.json` enthält keine zweite CSP und bleibt unangetastet.

- [ ] **Step 4: Revalidation-Route testen**

Tests analog `tests/api/revalidate-security.test.ts` schreiben:

- gültiger Bearer revalidiert exakt `/de`, `/en`, `/cs`, `/nds`, `/fr` für denselben Slug;
- fehlender/falscher Bearer oder fehlendes `REVALIDATE_SECRET` → 401;
- Query-Secret wird ignoriert;
- ungültiger/überlanger Slug → 400 ohne Revalidation;
- striktes Rate Limit → 429;
- Lexikonindex wird nie revalidiert.

- [ ] **Step 5: Rot ausführen**

```bash
./scripts/run-node24.sh pnpm exec vitest run tests/api/revalidate-glossary.test.ts
```

Erwartung: FAIL, weil Route und Slug-Hilfe fehlen.

- [ ] **Step 6: Route implementieren**

```ts
export const GLOSSARY_SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/

export function isGlossarySlug(value: unknown): value is string {
  return typeof value === 'string'
    && value.length <= 128
    && GLOSSARY_SLUG_PATTERN.test(value)
}
```

Die Route nutzt `rateLimiters.strict()`, `checkRateLimit()`, `getClientIP()`, `rateLimitResponse()`, `verifyBearerToken()` und iteriert `PUBLIC_LOCALES`. Sie liegt bewusst nicht unter `/api/admin`.

- [ ] **Step 7: Env-Dokumentation ergänzen**

In `.env.example` dokumentieren:

```dotenv
BLOB_READ_WRITE_TOKEN=
REVALIDATE_SECRET=
```

- [ ] **Step 8: Beide Suites grün ausführen**

```bash
./scripts/run-node24.sh pnpm exec vitest run \
  tests/lib/csp.test.ts \
  tests/api/revalidate-glossary.test.ts
```

Erwartung: PASS.

- [ ] **Step 9: Commit**

```bash
git add lib/glossary/slug-validation.ts \
  app/api/revalidate-glossary/route.ts \
  tests/api/revalidate-glossary.test.ts \
  lib/security/csp.mjs tests/lib/csp.test.ts .env.example
git commit -m "feat(glossary): secure animation fetch and revalidation"
```

---

## Task 8: Idempotentes Blob-Publishing und vollständiger CAS

**Files:**

- Create: `lib/glossary/animation/state.ts`
- Create: `lib/glossary/animation/publish.ts`
- Create: `tests/lib/glossary-animation-publish.test.ts`
- Reuse: `lib/security/safe-image-fetch.ts`

**Core contracts:**

```ts
export interface GlossaryAnimationUrls {
  illustrationUrl: string | null
  illustrationAnimationUrl: string | null
  illustrationAnimationSmallUrl: string | null
}

export interface GlossaryAnimationState extends GlossaryAnimationUrls {
  id: string
  slug: string
}

export async function readGlossaryAnimationState(
  supabase: ReturnType<typeof createAdminClient>,
  slug: string,
): Promise<GlossaryAnimationState>

export async function compareAndSwapGlossaryAnimationState(
  supabase: ReturnType<typeof createAdminClient>,
  expected: GlossaryAnimationState,
  next: GlossaryAnimationUrls,
): Promise<GlossaryAnimationState>

export async function ensureImmutableBlob(input: {
  pathname: string
  bytes: Buffer
  contentType: 'image/png' | 'image/gif'
  token?: string
}): Promise<{ url: string; sha256: string }>
```

`GlossaryAnimationUrls`, `GlossaryAnimationState`, `readGlossaryAnimationState()` und `compareAndSwapGlossaryAnimationState()` liegen in `state.ts`. Dieses Modul importiert ausschließlich Supabase-/DB-Typen und keinerlei Blob-, Safe-Fetch-, Sharp-, Renderer- oder Asset-Code. `publish.ts` importiert den DB-CAS aus `state.ts` und enthält die Blob- und Poster-Verifikation für den normalen Publish-Pfad.

- [ ] **Step 1: Publish-Core-Tests schreiben**

Blob-Mocks müssen prüfen:

- fehlender Blob → `put()` mit `access:'public'`, korrektem Content-Type, `addRandomSuffix:false`, `allowOverwrite:false`;
- vorhandener identischer Blob → `head()` plus `get(useCache:false)`, kein Upload;
- gleiche Größe, anderer Hash → harter Fehler;
- paralleles `put()` verliert Rennen, anschließender Hashvergleich identisch → Erfolg;
- Netzwerk-/Authfehler bei `head()` wird nicht als „fehlt“ behandelt.
- jede von `head()` oder `put()` gelieferte URL nutzt HTTPS, exakt `lbrzdn804nhy3kox.public.blob.vercel-storage.com`, keinen Querystring und exakt den erwarteten Pathname;
- ein falsches Blob-Token, das auf einen anderen Store-Origin zeigt, bricht vor CAS hart ab.

CAS-Mocks müssen prüfen:

- Filter auf `id`, `illustration_url` und beide nullable Animationsspalten;
- `null` wird mit `.is(column, null)`, Wert mit `.eq(column, value)` verglichen;
- Rückgabe null ohne DB-Error bedeutet Konflikt;
- Returned Row muss alle drei Ziel-URLs exakt enthalten;
- Upload- oder CAS-Fehler lässt den bisherigen DB-Stand unangetastet;
- Publish-vs-Publish und Publish-vs-Rollback verlieren am vollständigen Ausgangszustand;
- identischer Retry ist idempotent;
- Rollback leert nur beide Animationen und lässt Poster bestehen.

- [ ] **Step 2: Rot ausführen**

```bash
./scripts/run-node24.sh pnpm exec vitest run tests/lib/glossary-animation-publish.test.ts
```

Erwartung: FAIL, weil `publish.ts` fehlt.

- [ ] **Step 3: Immutable Blob-Hilfe implementieren**

`head()` beweist Existenz, nicht Content-Hash. Bestehende Bytes deshalb über `get(pathname, { access:'public', useCache:false })` begrenzt laden und selbst SHA-256 rechnen. Nur `BlobNotFoundError` führt zu `put()`; ein Race nach `put()` wird durch erneutes Head/Get/Hash aufgelöst, niemals durch Parsing einer Fehlermeldung.

Jede zurückgegebene Blob-URL wird vor weiterer Verwendung mit `assertGlossaryBlobUrl(url, expectedPathname)` geprüft. Damit kann ein gültiges, aber zum falschen Blob-Store gehörendes Token keinen Zustand veröffentlichen, den CSP und Next Image später blockieren.

- [ ] **Step 4: Vollständigen CAS im Blob-freien State-Modul implementieren**

`state.ts` implementiert Read und Update ohne Import von `publish.ts`. Der Update-Builder setzt `updated_at` und filtert auf alle vier Identitätsbestandteile: Row-ID plus die drei zuvor gelesenen URLs. Danach `.select(...)` und `.maybeSingle()`. Kein Poster-only-CAS: Er würde einen gleichzeitigen Rollback unbemerkt überschreiben. Publish und Rollback verwenden exakt diese eine CAS-Implementierung; das CLI erhält keine Kopie davon.

- [ ] **Step 5: Live-Poster-Verifikation anbinden**

Für das aktuelle `illustration_url` `fetchNewsletterImage()` wiederverwenden und zusätzlich PNG-Magic-Bytes sowie SHA-256 prüfen. Weil `safe-image-fetch.ts` Env beim Module Load auswertet, importiert das spätere CLI diese Module erst nach `dotenv.config()` dynamisch.

- [ ] **Step 6: Suite grün ausführen**

```bash
./scripts/run-node24.sh pnpm exec vitest run tests/lib/glossary-animation-publish.test.ts
```

Erwartung: PASS.

- [ ] **Step 7: Commit**

```bash
git add lib/glossary/animation/state.ts \
  lib/glossary/animation/publish.ts \
  tests/lib/glossary-animation-publish.test.ts
git commit -m "feat(glossary): publish immutable animation releases safely"
```

---

## Task 9: Publish-/Rollback-CLI

**Files:**

- Create: `scripts/publish-glossary-animation.ts`
- Create: `tests/lib/glossary-animation-publish-cli.test.ts`

- [ ] **Step 1: CLI-Tests zuerst schreiben**

Die `main(args, dependencies)`-Tests prüfen:

- Standard ist Dry-Run und führt keinen Blob-/DB-Write aus;
- `--apply` ohne gültiges Manifest/Validatorstatus bricht vor Writes ab;
- Manifest, aktuelle Source-Dateien und erneut berechnete Artefakthashes müssen vor Dry-Run und Apply vollständig übereinstimmen;
- Normal-Publish: Live-Poster prüfen → drei Blobs sicherstellen → CAS → Revalidation;
- zweiter Uploadfehler verhindert CAS;
- CAS-Fehler verhindert Revalidation;
- Revalidation-Fehler macht den gültigen DB-Stand nicht rückgängig und setzt Exitcode 1 mit klarer Meldung;
- `--rollback --apply` liest Ausgangszustand, leert beide Animationen per vollem CAS und revalidiert;
- Rollback gelingt auch dann, wenn `artifacts/`, Recipe oder Quell-PNGs fehlen beziehungsweise beschädigt sind oder `BLOB_READ_WRITE_TOKEN` fehlt, und führt keinerlei Blob-Read/Write aus;
- der Rollback-Pfad importiert weder Blob-, Safe-Image-Fetch- noch Renderer-Module;
- Secrets und Authorization-Header erscheinen nie im Log.

- [ ] **Step 2: Rot ausführen**

```bash
./scripts/run-node24.sh pnpm exec vitest run tests/lib/glossary-animation-publish-cli.test.ts
```

Erwartung: FAIL, weil das Skript fehlt.

- [ ] **Step 3: CLI implementieren**

Aufrufe:

```bash
./scripts/run-node24.sh pnpm tsx scripts/publish-glossary-animation.ts <slug> <env-datei>
./scripts/run-node24.sh pnpm tsx scripts/publish-glossary-animation.ts <slug> <env-datei> --apply
./scripts/run-node24.sh pnpm tsx scripts/publish-glossary-animation.ts <slug> <env-datei> --rollback --apply
```

Argumente zuerst parsen, danach `dotenv.config({ path, quiet:true })` ausführen. Für beide Pfade Env hart prüfen:

- `NEXT_PUBLIC_SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`
- `REVALIDATE_SECRET`
- `NEXT_PUBLIC_BASE_URL`

`BLOB_READ_WRITE_TOKEN` ist ausschließlich im normalen Publish-Pfad Pflicht. Zuerst nur DB-Client, das Blob-freie `state.ts` und die Revalidation-Hilfe dynamisch importieren.

Nach gemeinsamer Env- und Slug-Prüfung verzweigt `--rollback` sofort in den Notfallpfad: aktuellen DB-Zustand über `state.ts` lesen, beide Animationen mit dessen gemeinsamem vollständigem CAS auf null setzen, revalidieren, beenden. Dieser Pfad verlangt kein Blob-Credential und importiert oder lädt weder `publish.ts`, Safe Image Fetch, Renderer, Manifest, Recipe, PNG, GIF noch Blob. Nur der normale Publish prüft danach `BLOB_READ_WRITE_TOKEN`, importiert Safe Fetch und Publish-Core und läuft durch die folgenden Artefaktprüfungen.

- [ ] **Step 4: Manifest und Release-ID erneut verifizieren**

Das CLI lädt Source-Paket und Artefakte frisch, führt den Validator erneut aus und ruft `computeReleaseId()` aus `release.ts` auf. Manifest, aktuelle Poster-/Recipe-/GIF-Hashes und Release-ID müssen exakt übereinstimmen. Erst danach entstehen die Pfade:

```text
glossary/posters/<slug>/<poster-sha256>.png
glossary/animations/<slug>/<release-id>/<slug>-326.gif
glossary/animations/<slug>/<release-id>/<slug>-768.gif
```

- [ ] **Step 5: Revalidation aufrufen**

Nach erfolgreichem CAS:

```http
POST <NEXT_PUBLIC_BASE_URL>/api/revalidate-glossary
Authorization: Bearer <REVALIDATE_SECRET>
Content-Type: application/json

{"slug":"buchgewinn"}
```

- [ ] **Step 6: Grün ausführen**

```bash
./scripts/run-node24.sh pnpm exec vitest run \
  tests/lib/glossary-animation-publish.test.ts \
  tests/lib/glossary-animation-publish-cli.test.ts \
  tests/api/revalidate-glossary.test.ts
```

Erwartung: PASS.

- [ ] **Step 7: Commit**

```bash
git add scripts/publish-glossary-animation.ts \
  tests/lib/glossary-animation-publish-cli.test.ts
git commit -m "feat(glossary): add dry-run animation publish and rollback CLI"
```

---

## Task 10: Browser-State-Machine und öffentliche Komponente

**Files:**

- Create: `lib/glossary/animation/runtime.ts`
- Create: `components/glossary/animated-illustration.tsx`
- Modify: `app/[lang]/glossary/[slug]/page.tsx`
- Create: `tests/lib/glossary-animation-runtime.test.ts`

**Component contract:**

```ts
export interface AnimatedIllustrationProps {
  posterUrl: string
  animationUrl: string
  animationSmallUrl: string | null
  alt: string
}

export function AnimatedIllustration(
  props: AnimatedIllustrationProps,
)
```

Den Rückgabetyp inferieren; nicht den globalen `JSX.Element`-Namespace verwenden, weil das Repo React-19-Typen mit scoped JSX-Namespace nutzt.

- [ ] **Step 1: Happy-DOM-Komponententests schreiben**

Dateikopf:

```ts
// @vitest-environment happy-dom
```

Ohne neue Testing-Library: `React.createElement`, `createRoot()` und `act()`. `next/image` wird auf ein einfaches `<img>` gemockt. Fake `IntersectionObserver`, `matchMedia`, `fetch`, `AbortController`, `URL.createObjectURL/revokeObjectURL`, `devicePixelRatio` und `clientWidth` bereitstellen. `globalThis.Image` absichtlich als werfenden Stub setzen.

Fälle:

- genau zwei Observer mit `rootMargin:'500px 0px'`/Threshold 0 und Threshold 0,33;
- Preload lädt per `fetch`, erzeugt aber weder `Image` noch Object-URL;
- 326/768-Auswahl nach `clientWidth × devicePixelRatio`;
- Sichtbarkeit vor/ nach Fetchabschluss startet jeweils genau einmal;
- Sichtbarkeit ist ein aktueller, nicht sticky Zustand: `enter → exit → fetch resolves` mountet nichts; ein späterer Re-Entry startet mit demselben Blob genau einmal;
- Object-URL entsteht erst bei Start;
- GIF bleibt bis `overlay.load` per `visibility:hidden` unsichtbar; derselbe React-State-Commit schaltet danach das GIF sichtbar und das Poster ohne Transition auf `opacity:0`;
- `overlay.error`, Fetchfehler oder nachträgliches Reduce entfernt Overlay und zeigt Poster;
- Re-Entry startet keinen zweiten Fetch/Decoder;
- initial Reduced Motion erzeugt weder Observer noch Request;
- Unmount/Reduce abortet Fetch und widerruft Object-URL genau einmal;
- verspätete Fetch-Promise-, `load`- und `error`-Callbacks nach Abort, Unmount oder Reduced Motion erzeugen weder Object-URL noch Overlay- oder Posterwechsel.
- Klassenvertrag: `figure` trägt `mt-8 mb-6`; Wrapper `relative mx-auto aspect-square w-full max-w-[326px]`; GIF `absolute inset-0 h-full w-full`; Poster behält alle bisherigen Größen-, Priority-, Sizes- und Dither-Klassen.

- [ ] **Step 2: Rot ausführen**

```bash
./scripts/run-node24.sh pnpm exec vitest run tests/lib/glossary-animation-runtime.test.ts
```

Erwartung: FAIL, weil State Machine und Komponente fehlen.

- [ ] **Step 3: Pure Runtime-Hilfen implementieren**

```ts
export type AnimationRuntimeState =
  | 'static'
  | 'fetching'
  | 'ready'
  | 'mounting'
  | 'playing'
  | 'failed'
  | 'disabled'

export function chooseAnimationUrl(input: {
  cssWidth: number
  devicePixelRatio: number
  largeUrl: string
  smallUrl: string | null
}): string
```

State-Transitions pure halten; Browser-Side-Effects bleiben in der Komponente.

- [ ] **Step 4: Client-Komponente implementieren**

DOM-Struktur:

```text
figure.mt-8.mb-6[data-glossary-illustration]
  div.relative.mx-auto.aspect-square.w-full.max-w-[326px]
    next/image[data-glossary-poster]
    img.absolute.inset-0.h-full.w-full[data-glossary-animation][alt=""][aria-hidden="true"]
```

Beide Ebenen tragen `dithered-cover dithered-invert`. Das rohe GIF-`img` erhält eine lokal kommentierte `@next/next/no-img-element`-Ausnahme. Kein Fade.

Die Play-Sichtbarkeit liegt in einem Ref, das bei jedem Observer-Callback gesetzt und beim Exit wieder gelöscht wird. Ein Blob darf nur bei `blobReady && currentlyVisible && !disabled && mounted` zur Object-URL werden. Jeder asynchrone Callback prüft vor einer Zustandsänderung dieselbe Generation beziehungsweise ein Invalidierungs-Token. Reduce, Abort und Unmount invalidieren die Generation zuerst und räumen danach Fetch, Object-URL und Observer idempotent auf. Vor `load` bleibt das Overlay `visibility:hidden`; der Load-Handler vollzieht GIF sichtbar und Poster transparent in einem State-Commit.

- [ ] **Step 5: Page konditional integrieren**

In `app/[lang]/glossary/[slug]/page.tsx`:

- ohne große Animations-URL den heutigen `<figure><Image ... /></figure>`-Block unverändert rendern;
- mit großer URL `<AnimatedIllustration ... />` rendern;
- `generateMetadata()` und JSON-LD unangetastet lassen.

- [ ] **Step 6: Unit-, Type- und Lint-Checks**

```bash
./scripts/run-node24.sh pnpm exec vitest run tests/lib/glossary-animation-runtime.test.ts
./scripts/run-node24.sh pnpm typecheck
./scripts/run-node24.sh pnpm lint
```

Erwartung: PASS.

- [ ] **Step 7: Commit**

```bash
git add lib/glossary/animation/runtime.ts \
  components/glossary/animated-illustration.tsx \
  app/'[lang]'/glossary/'[slug]'/page.tsx \
  tests/lib/glossary-animation-runtime.test.ts
git commit -m "feat(glossary): play GIF overlays once on visibility"
```

---

## Task 11: Deployment-E2E und mobile LCP-Abnahme

**Files:**

- Modify: `package.json`
- Modify: `pnpm-lock.yaml`
- Create: `playwright.config.ts`
- Create: `e2e/glossary-animation.spec.ts`
- Create: `scripts/measure-glossary-animation.ts`
- Create: `tests/lib/glossary-animation-measure.test.ts`

- [ ] **Step 1: Playwright installieren**

```bash
./scripts/run-node24.sh pnpm add -D @playwright/test
./scripts/run-node24.sh pnpm exec playwright install chromium
```

Scripts ergänzen:

```json
{
  "test:e2e": "playwright test",
  "test:e2e:glossary-animation": "playwright test e2e/glossary-animation.spec.ts"
}
```

`playwright.config.ts` nutzt `testDir:'./e2e'`, `baseURL:process.env.PLAYWRIGHT_BASE_URL` und bewusst keinen lokalen `webServer`: Abgenommen wird ein echtes Preview/Production Deployment.

- [ ] **Step 2: E2E-Spec schreiben**

Env-Vertrag:

- `ANIMATED_GLOSSARY_SLUG=buchgewinn`
- `STATIC_GLOSSARY_SLUG=inferenz` für den ersten Pilot; vor jedem Lauf per Admin-Detail oder read-only Query bestätigen, dass beide Animations-URLs weiterhin null sind.

Tests:

- Reduced Motion: null GIF-Requests, Poster sichtbar;
- normal: exakt ein GIF-Fetch, Overlay wird nach Sichtbarkeit und Load aktiv;
- Out-/Re-Entry: kein zweiter Request und dasselbe Overlay bleibt;
- interceptete ungültige GIF-Bytes: Poster-Fallback;
- Alt-Text nur auf Poster, Overlay `alt=""` und `aria-hidden`;
- Light/Dark sowie Desktop/Mobile;
- statischer Slug: kein GIF-Request und kein Animationscode im geladenen JS. Dazu alle geladenen same-origin-JS-Chunks abrufen und nach dem stabilen Literal `data-glossary-animation` durchsuchen: animierte Seite genau ein zugehöriger Chunk, statische Seite keiner. Nicht auf Hashdateinamen oder den Source-Dateinamen vertrauen.

- [ ] **Step 3: LCP-Messlogik testen**

`tests/lib/glossary-animation-measure.test.ts` prüft pure Auswertung:

- p75 ist `sorted[Math.ceil(.75*n)-1]`;
- Candidate/Baseline werden paarweise alternierend ausgewertet;
- Fail bei Delta >100 ms;
- GIF-/PNG-/JS-Bytes und CLS werden getrennt berichtet.
- der Report enthält Viewport, DPR, CPU-Faktor, Latenz, Down-/Upload, Cachemodus, Warm-up-Zahl, Runs und Wartezeit.

- [ ] **Step 4: Rot ausführen**

```bash
./scripts/run-node24.sh pnpm exec vitest run tests/lib/glossary-animation-measure.test.ts
```

Erwartung: FAIL, weil das Messskript fehlt.

- [ ] **Step 5: Messskript implementieren**

Das Skript führt zunächst je URL zwei ungezählte Warm-up-Navigationen aus. Danach startet es standardmäßig 30 frische Chromium-Contexts pro URL, streng abwechselnd Baseline/Candidate. Feste Konfiguration:

- Viewport 390×844, DPR 3;
- CPU-Throttling 4×;
- `latency:150` ms;
- `downloadThroughput:200000` Byte/s (1,6 Mbit/s);
- `uploadThroughput:93750` Byte/s (750 Kbit/s);
- Browsercache je gemessenem Context deaktiviert;
- Navigation mit `waitUntil:'networkidle'`;
- danach `await document.fonts.ready` und weitere fünf Sekunden ohne User-Input, damit ein später GIF-Paint noch als LCP-Kandidat erfasst wird.

Per Init-Script `PerformanceObserver` für alle LCP- und CLS-Einträge registrieren. `synthszr_consent` als gültiges JSON setzen:

```json
{"essential":true,"analytics":false,"marketing":false,"timestamp":1,"version":"1.0"}
```

Das Newsletter-Flag ist kein Local-Storage-Wert: vor jeder Navigation per `context.addCookies()` das Cookie `synthszr_subscribed=true` für den jeweiligen Host, Pfad `/`, `sameSite:'Lax'` und `secure:true` setzen. `/api/track/event` blockieren.

```bash
BASELINE_URL='https://<baseline-preview>/de/glossary/buchgewinn' \
CANDIDATE_URL='https://<candidate-preview>/de/glossary/buchgewinn' \
RUNS=30 \
./scripts/run-node24.sh pnpm tsx scripts/measure-glossary-animation.ts
```

Der Report nennt ausdrücklich `Lab-p75`; er wird nicht als Field/RUM-p75 ausgegeben.

- [ ] **Step 6: Unit-Check und Commit**

```bash
./scripts/run-node24.sh pnpm exec vitest run tests/lib/glossary-animation-measure.test.ts
./scripts/run-node24.sh pnpm typecheck
./scripts/run-node24.sh pnpm lint
git add package.json pnpm-lock.yaml playwright.config.ts \
  e2e/glossary-animation.spec.ts \
  scripts/measure-glossary-animation.ts \
  tests/lib/glossary-animation-measure.test.ts
git commit -m "test(glossary): verify animation runtime and LCP on deployments"
```

---

## Task 12: `buchgewinn` kontrolliert deployen und Rollback beweisen

**Files:**

- Verify: all files from Tasks 1–11
- Produce locally: `artifacts/glossary-animations/buchgewinn/*`
- Create: `docs/superpowers/pilots/2026-08-28-glossary-animation-pilot.md`

**Run-State-Vertrag:** Jeder Step kann in einem neuen Shell-/Agentenprozess laufen. Nicht geheime Laufwerte werden deshalb in `RUN_STATE_FILE="$(git rev-parse --git-path glossary-animation-run.env)"` mit shell-escaped `%q`-Werten persistiert. Jeder spätere Step, der einen Wert nutzt, ermittelt diesen Pfad neu, lädt die Datei und prüft alle benötigten Werte mit `test -n`. Secrets bleiben ausschließlich in `.env.glossary-animation.local` und dürfen nie in die State-Datei.

- [ ] **Step 1: Operator-Gate einholen**

Vor Produktionsmigration, staged Production Deployment, Promotion und `--apply` den konkreten Ziel-Stack, die drei Ziel-URLs und die geplante Rollback-Zeile zeigen. Ohne Freigabe bei Dry-Run stoppen.

- [ ] **Step 2: Produktions-Env laden und Supabase-Projektidentität beweisen**

```bash
FEATURE_WORKTREE="$(pwd -P)"
test "$FEATURE_WORKTREE" != \
  '/Users/mattes/Library/CloudStorage/Dropbox/dev/synthszr'
PROJECT_LINK_FILE='/Users/mattes/Library/CloudStorage/Dropbox/dev/synthszr/.vercel/project.json'
test -f "$PROJECT_LINK_FILE"
mkdir -p .vercel
cp "$PROJECT_LINK_FILE" .vercel/project.json

./scripts/run-node24.sh vercel env pull .env.glossary-animation.local \
  --environment=production \
  --yes

SUPABASE_REF="$(DOTENV_CONFIG_PATH=.env.glossary-animation.local ./scripts/run-node24.sh pnpm tsx -e \
  "import 'dotenv/config'; console.log(new URL(process.env.NEXT_PUBLIC_SUPABASE_URL!).hostname.split('.')[0])")"
test "$SUPABASE_REF" = 'zadrjbyszvsusukajsbp'
supabase link --project-ref "$SUPABASE_REF"
LINKED_REF="$(sed -n '1p' supabase/.temp/project-ref)"
PRODUCTION_URL="$(DOTENV_CONFIG_PATH=.env.glossary-animation.local ./scripts/run-node24.sh pnpm tsx -e \
  "import 'dotenv/config'; const raw=process.env.NEXT_PUBLIC_BASE_URL; if(!raw) process.exit(2); const u=new URL(raw); if(u.protocol!=='https:' || u.username || u.password || u.search || u.hash) process.exit(3); console.log(u.origin)")"
test "$SUPABASE_REF" = "$LINKED_REF"
printf '%s\n' "$SUPABASE_REF" "$PRODUCTION_URL"

RUN_STATE_FILE="$(git rev-parse --git-path glossary-animation-run.env)"
printf 'FEATURE_WORKTREE=%q\nPRODUCTION_URL=%q\n' \
  "$FEATURE_WORKTREE" "$PRODUCTION_URL" > "$RUN_STATE_FILE"
```

Der Feature-Worktree enthält die ignorierten Projektbindungen nicht. Deshalb wird die Vercel-Verknüpfung aus dem Hauptcheckout kopiert und Supabase im Feature-Worktree explizit mit dem aus der Production-Env abgeleiteten Ref verknüpft. Beide `test`-Schritte erzwingen den erwarteten Production-Ref `zadrjbyszvsusukajsbp` sowie die danach tatsächlich verlinkte Identität. Bei Abweichung stoppen. Ausgegeben werden nur Ref und öffentliche Production-URL, keine Secrets. Die Env-Datei ist über `.env*` ignoriert und darf nie committed werden.

- [ ] **Step 3: Migration zunächst lokal, dann produktiv anwenden**

```bash
RUN_STATE_FILE="$(git rev-parse --git-path glossary-animation-run.env)"
test -f "$RUN_STATE_FILE"
source "$RUN_STATE_FILE"
test -n "$FEATURE_WORKTREE"
test "$(pwd -P)" = "$FEATURE_WORKTREE"
supabase db reset --local --no-seed
supabase test db supabase/tests/glossary_animation_urls_test.sql
supabase db push --dry-run
supabase db push
```

Nach `db push` beide Spalten und Trigger über eine read-only Query verifizieren.

- [ ] **Step 4: Reproduzierbares Baseline-Deployment aus dem Task-9-Commit bauen**

Der Task-9-Commit enthält Loader, Revalidation und Publisher, aber noch keine Runtime-Komponente. Exakt diesen Commit in ein isoliertes temporäres Worktree auschecken:

```bash
RUN_STATE_FILE="$(git rev-parse --git-path glossary-animation-run.env)"
test -f "$RUN_STATE_FILE"
source "$RUN_STATE_FILE"
test -n "$FEATURE_WORKTREE"
test "$(pwd -P)" = "$FEATURE_WORKTREE"
TASK9_SHA="$(git log --format=%H --fixed-strings \
  --grep='feat(glossary): add dry-run animation publish and rollback CLI' -n 1)"
test -n "$TASK9_SHA"
PROJECT_LINK_FILE='/Users/mattes/Library/CloudStorage/Dropbox/dev/synthszr/.vercel/project.json'
test -f "$PROJECT_LINK_FILE"
BASELINE_PARENT="$(mktemp -d)"
BASELINE_DIR="$BASELINE_PARENT/baseline"
case "$BASELINE_PARENT" in
  /tmp/*|/private/tmp/*|/var/folders/*|/private/var/folders/*) ;;
  *) exit 4 ;;
esac
test "$BASELINE_DIR" = "$BASELINE_PARENT/baseline"
git worktree add "$BASELINE_DIR" "$TASK9_SHA"
mkdir -p "$BASELINE_DIR/.vercel"
cp "$PROJECT_LINK_FILE" "$BASELINE_DIR/.vercel/project.json"
BASELINE_URL="$(cd "$BASELINE_DIR" && ./scripts/run-node24.sh vercel deploy --prod --skip-domain --yes)"
test -n "$BASELINE_URL"
./scripts/run-node24.sh node -e "const u=new URL(process.argv[1]); if(u.protocol!=='https:' || !u.hostname.endsWith('.vercel.app') || u.pathname!=='/') process.exit(1)" "$BASELINE_URL"
printf '%s\n' "$TASK9_SHA" "$BASELINE_URL"
printf 'TASK9_SHA=%q\nBASELINE_PARENT=%q\nBASELINE_DIR=%q\nBASELINE_URL=%q\n' \
  "$TASK9_SHA" "$BASELINE_PARENT" "$BASELINE_DIR" "$BASELINE_URL" \
  >> "$RUN_STATE_FILE"
```

SHA und URL sofort in der Pilotdatei festhalten. `--prod --skip-domain` nutzt Production-Env und -Runtime, ändert aber noch keine Domainzuordnung.

- [ ] **Step 5: Candidate als staged Production Deployment bauen**

```bash
RUN_STATE_FILE="$(git rev-parse --git-path glossary-animation-run.env)"
test -f "$RUN_STATE_FILE"
source "$RUN_STATE_FILE"
test -n "$FEATURE_WORKTREE"
test -n "$BASELINE_URL"
test "$(pwd -P)" = "$FEATURE_WORKTREE"
PROJECT_LINK_FILE='/Users/mattes/Library/CloudStorage/Dropbox/dev/synthszr/.vercel/project.json'
test -f "$PROJECT_LINK_FILE"
CANDIDATE_SHA="$(git rev-parse HEAD)"
CANDIDATE_PARENT="$(mktemp -d)"
CANDIDATE_DIR="$CANDIDATE_PARENT/candidate"
case "$CANDIDATE_PARENT" in
  /tmp/*|/private/tmp/*|/var/folders/*|/private/var/folders/*) ;;
  *) exit 4 ;;
esac
test "$CANDIDATE_DIR" = "$CANDIDATE_PARENT/candidate"
git worktree add "$CANDIDATE_DIR" "$CANDIDATE_SHA"
mkdir -p "$CANDIDATE_DIR/.vercel"
cp "$PROJECT_LINK_FILE" "$CANDIDATE_DIR/.vercel/project.json"
CANDIDATE_URL="$(cd "$CANDIDATE_DIR" && ./scripts/run-node24.sh vercel deploy --prod --skip-domain --yes)"
test -n "$CANDIDATE_URL"
./scripts/run-node24.sh node -e "const u=new URL(process.argv[1]); if(u.protocol!=='https:' || !u.hostname.endsWith('.vercel.app') || u.pathname!=='/') process.exit(1)" "$CANDIDATE_URL"
printf '%s\n' "$CANDIDATE_SHA" "$CANDIDATE_URL"
printf 'CANDIDATE_SHA=%q\nCANDIDATE_PARENT=%q\nCANDIDATE_DIR=%q\nCANDIDATE_URL=%q\n' \
  "$CANDIDATE_SHA" "$CANDIDATE_PARENT" "$CANDIDATE_DIR" "$CANDIDATE_URL" \
  >> "$RUN_STATE_FILE"
```

SHA und URL dokumentieren. Deployt wird ausschließlich das saubere Worktree dieses SHA, niemals der Arbeitsbaum. Da beide Animationsspalten noch null sind, muss `/de/glossary/buchgewinn` auf diesem Candidate rein statisch rendern und darf keinen GIF-Request auslösen.

- [ ] **Step 6: Revalidation-Route und Candidate vor Promotion prüfen**

Unauthentifizierter Probeaufruf:

```bash
RUN_STATE_FILE="$(git rev-parse --git-path glossary-animation-run.env)"
test -f "$RUN_STATE_FILE"
source "$RUN_STATE_FILE"
test -n "$CANDIDATE_URL"
curl -sS -o /dev/null -w '%{http_code}\n' \
  -X POST "$CANDIDATE_URL/api/revalidate-glossary" \
  -H 'content-type: application/json' \
  --data '{"slug":"buchgewinn"}'
```

Erwartung: exakt `401`. Danach den statischen Buchgewinn-Pfad sowie einen zweiten statischen Slug mit Playwright prüfen. Erst wenn Route, CSP und statischer Fallback funktionieren, weiter.

- [ ] **Step 7: Exakt den geprüften Candidate promoten**

```bash
RUN_STATE_FILE="$(git rev-parse --git-path glossary-animation-run.env)"
test -f "$RUN_STATE_FILE"
source "$RUN_STATE_FILE"
test -n "$CANDIDATE_URL"
test -n "$PRODUCTION_URL"
./scripts/run-node24.sh vercel promote "$CANDIDATE_URL" --yes
./scripts/run-node24.sh vercel promote status synthszr
```

Danach denselben unauthentifizierten 401-Probeaufruf gegen `NEXT_PUBLIC_BASE_URL` wiederholen. So ist garantiert, dass die Production-Domain bereits die neue Route bedient, bevor das Publish revalidiert.

Anschließend das Secret selbst ohne Ausgabe authentifiziert prüfen:

```bash
RUN_STATE_FILE="$(git rev-parse --git-path glossary-animation-run.env)"
test -f "$RUN_STATE_FILE"
source "$RUN_STATE_FILE"
test -n "$PRODUCTION_URL"
PRODUCTION_URL="$PRODUCTION_URL" \
DOTENV_CONFIG_PATH=.env.glossary-animation.local \
./scripts/run-node24.sh pnpm tsx -e "import 'dotenv/config'; void (async()=>{const secret=process.env.REVALIDATE_SECRET; if(!secret) process.exit(2); const r=await fetch(process.env.PRODUCTION_URL + '/api/revalidate-glossary',{method:'POST',headers:{authorization:'Bearer '+secret,'content-type':'application/json'},body:JSON.stringify({slug:'buchgewinn'})}); console.log(r.status); if(!r.ok) process.exit(3)})()"
```

Erwartung: `200`. Die Seite ist zu diesem Zeitpunkt noch statisch; der Probeaufruf ist deshalb zustandsneutral und beweist Route, Production-Origin und Secret gemeinsam.

- [ ] **Step 8: Buchgewinn erneut rendern und Dry-Run ausführen**

```bash
./scripts/run-node24.sh pnpm tsx scripts/render-glossary-animation.ts buchgewinn
./scripts/run-node24.sh pnpm tsx scripts/publish-glossary-animation.ts \
  buchgewinn .env.glossary-animation.local
```

Erwartung: Validator grün; Live-Posterhash stimmt; keine Writes.

- [ ] **Step 9: Erstes atomisches Publish**

```bash
./scripts/run-node24.sh pnpm tsx scripts/publish-glossary-animation.ts \
  buchgewinn .env.glossary-animation.local --apply
```

Ausgabe muss immutable Poster-URL, 326er-/768er-GIF-URL und fünf revalidierte Sprachpfade nennen.

Ab diesem erfolgreichen CAS gilt ein verbindliches Fehlerprotokoll: Scheitert irgendein E2E-, LCP-, Sicht-, Revalidation- oder Smoke-Gate, sofort `--rollback --apply` ausführen, danach den statischen Fallback per E2E prüfen und den Fehler dokumentieren. Erst nach bestätigtem Rollback darf die Task beziehungsweise Welle stoppen.

- [ ] **Step 10: E2E gegen die promovierte Production-Fassung**

```bash
RUN_STATE_FILE="$(git rev-parse --git-path glossary-animation-run.env)"
test -f "$RUN_STATE_FILE"
source "$RUN_STATE_FILE"
test -n "$PRODUCTION_URL"
PLAYWRIGHT_BASE_URL="$PRODUCTION_URL" \
ANIMATED_GLOSSARY_SLUG='buchgewinn' \
STATIC_GLOSSARY_SLUG='inferenz' \
./scripts/run-node24.sh pnpm test:e2e:glossary-animation
```

Erwartung: PASS in Desktop/Mobile, Light/Dark und Reduced Motion.

- [ ] **Step 11: Lab-p75 gegen den reproduzierbaren Baseline-Commit messen**

```bash
RUN_STATE_FILE="$(git rev-parse --git-path glossary-animation-run.env)"
test -f "$RUN_STATE_FILE"
source "$RUN_STATE_FILE"
test -n "$BASELINE_URL"
test -n "$PRODUCTION_URL"
BASELINE_URL="$BASELINE_URL/de/glossary/buchgewinn" \
CANDIDATE_URL="$PRODUCTION_URL/de/glossary/buchgewinn" \
RUNS=30 \
./scripts/run-node24.sh pnpm tsx scripts/measure-glossary-animation.ts
```

Gate: mobiles Lab-p75-Delta ≤100 ms; keine CLS-Verschlechterung; keine GIF-Ressource bei Reduced Motion oder statischem Slug.

- [ ] **Step 12: Rollback einmal kontrolliert beweisen**

```bash
./scripts/run-node24.sh pnpm tsx scripts/publish-glossary-animation.ts \
  buchgewinn .env.glossary-animation.local --rollback --apply
```

Verifizieren: Poster bleibt immutable aktiv, beide Animationsfelder sind null, fünf Sprachpfade revalidiert, Seite ist statisch. Anschließend denselben geprüften Release erneut mit `--apply` aktivieren und E2E-Smoketest wiederholen.

- [ ] **Step 13: Deployment- und Hashnachweis versionieren**

Die Pilotdatei enthält für `buchgewinn`: Baseline-/Candidate-SHA und -URL, Posterhash, Recipehash, beide GIF-Hashes, Release-ID, Bytegrößen, Lab-p75, E2E-Zeitpunkt, Publish- und Rollbackstatus.

```bash
RUN_STATE_FILE="$(git rev-parse --git-path glossary-animation-run.env)"
test -f "$RUN_STATE_FILE"
source "$RUN_STATE_FILE"
test -n "$FEATURE_WORKTREE"
test -n "$BASELINE_PARENT"
test -n "$BASELINE_DIR"
test -n "$CANDIDATE_PARENT"
test -n "$CANDIDATE_DIR"
test "$(pwd -P)" = "$FEATURE_WORKTREE"
test "$BASELINE_DIR" = "$BASELINE_PARENT/baseline"
test "$CANDIDATE_DIR" = "$CANDIDATE_PARENT/candidate"
case "$BASELINE_PARENT" in
  /tmp/*|/private/tmp/*|/var/folders/*|/private/var/folders/*) ;;
  *) exit 4 ;;
esac
case "$CANDIDATE_PARENT" in
  /tmp/*|/private/tmp/*|/var/folders/*|/private/var/folders/*) ;;
  *) exit 4 ;;
esac
git add docs/superpowers/pilots/2026-08-28-glossary-animation-pilot.md
git commit -m "docs(glossary): record buchgewinn animation deployment"
test -f "$BASELINE_DIR/.vercel/project.json"
test -f "$CANDIDATE_DIR/.vercel/project.json"
unlink "$BASELINE_DIR/.vercel/project.json"
unlink "$CANDIDATE_DIR/.vercel/project.json"
rmdir "$BASELINE_DIR/.vercel" "$CANDIDATE_DIR/.vercel"
git worktree remove "$BASELINE_DIR"
git worktree remove "$CANDIDATE_DIR"
rmdir "$BASELINE_PARENT" "$CANDIDATE_PARENT"
```

---

## Task 13: Zwölf-Motiv-Pilot produzieren

**Files:**

- Modify: `docs/superpowers/pilots/2026-08-28-glossary-animation-pilot.md`
- Create: `assets/glossary-animations/<11 selected slugs>/poster.png`
- Create: `assets/glossary-animations/<11 selected slugs>/base.png`
- Create: `assets/glossary-animations/<11 selected slugs>/layers/*.png`
- Create: `assets/glossary-animations/<11 selected slugs>/recipe.json`

- [ ] **Step 1: Elf weitere Motive auswählen und dokumentieren**

Die Pilotdatei enthält eine Tabelle mit Slug, Begriff, Pattern, semantischem Vorgang, Silhouette (`kompakt`/`verteilt`), Layerzahl, Posterhash, Recipehash, beiden GIF-Hashes, Release-ID, Proofstatus, 326-/768-Bytes, LCP-Delta, Publishstatus und Rollbackstatus.

Auswahlregeln:

- exakt zwei Motive je Pattern inklusive `buchgewinn`;
- mindestens je ein kompaktes und verteiltes Motiv;
- keine zwei Motive erklären denselben semantischen Vorgang nur mit anderem Namen;
- nur veröffentlichte Begriffe mit vorhandenem 768er-PNG.

- [ ] **Step 2: Je Motiv Quellpaket authoren**

Für jedes Motiv Posterhash gegen die aktuelle öffentliche URL verifizieren, dann Base, höchstens zwei Layer und Recipe erstellen. Keine Animations-URLs setzen.

- [ ] **Step 3: Jeden Render einzeln abnehmen**

```bash
./scripts/run-node24.sh pnpm tsx scripts/render-glossary-animation.ts <slug>
```

Erst nach automatischem PASS die menschliche Proof-Abnahme in Light/Dark und beiden Größen durchführen. Status und Werte in die Pilotdatei eintragen.

- [ ] **Step 4: Alle abgenommenen Master vor dem ersten Publish committen**

```bash
git add assets/glossary-animations \
  docs/superpowers/pilots/2026-08-28-glossary-animation-pilot.md
git commit -m "feat(glossary): add remaining GIF89a pilot sources"
```

Keine unversionierte Assetfassung darf produktiv aktiviert werden. Jede spätere Änderung an Poster, Base, Layer oder Recipe zuerst committen, dann neu rendern und erst danach erneut publishen.

- [ ] **Step 5: In Wellen veröffentlichen und jedes Motiv einzeln messen**

Vor jedem Publish-/Messlauf den persistierten Deployment-State frisch laden und validieren:

```bash
RUN_STATE_FILE="$(git rev-parse --git-path glossary-animation-run.env)"
test -f "$RUN_STATE_FILE"
source "$RUN_STATE_FILE"
test -n "$FEATURE_WORKTREE"
test -n "$BASELINE_URL"
test -n "$PRODUCTION_URL"
test "$(pwd -P)" = "$FEATURE_WORKTREE"
```

Reihenfolge:

1. zweites `transfer`-Motiv;
2. je ein erstes Motiv der übrigen fünf Pattern;
3. Zwischenreview über die bereits je Motiv erhobenen E2E-/LCP-Werte;
4. je ein zweites Motiv der übrigen fünf Pattern.

Jeder Publish beginnt als Dry-Run und wird einzeln mit `--apply` aktiviert. Unmittelbar danach für genau diesen Slug den Deployment-E2E und denselben alternierenden 30-Läufe-Lab-p75-Vergleich gegen das Task-9-Baseline-Deployment ausführen. Hashes, Bytes und Messwerte sofort eintragen. Bei einem Fehler nach erfolgreichem CAS zwingend `--rollback --apply` für diesen Slug ausführen, statischen Fallback per E2E bestätigen und den Fehler dokumentieren. Erst danach die Welle stoppen; keine weiteren Motive aktivieren.

- [ ] **Step 6: Pilot auswerten**

Dokumentieren:

- Median und Maximum beider GIF-Größen;
- mobiles Lab-p75-Delta pro Motiv und über alle zwölf;
- Authoringzeit pro Motiv;
- Fehlerrate/Retryzahl beim Publish;
- welche Pattern semantisch tragen und welche nur dekorativ wirken.

- [ ] **Step 7: Messergebnisse committen**

```bash
git add docs/superpowers/pilots/2026-08-28-glossary-animation-pilot.md
git commit -m "docs(glossary): record twelve-motif GIF89a pilot"
```

---

## Task 14: Gesamtverifikation und Handoff

**Files:**

- Verify: all changed source, tests, migration, assets and docs
- Modify if needed: `docs/superpowers/pilots/2026-08-28-glossary-animation-pilot.md`

- [ ] **Step 1: Renderer- und Publishing-Suites**

```bash
./scripts/run-node24.sh pnpm exec vitest run \
  tests/lib/glossary-animation-schema.test.ts \
  tests/lib/glossary-animation-assets.test.ts \
  tests/lib/glossary-animation-motion.test.ts \
  tests/lib/glossary-animation-render.test.ts \
  tests/lib/glossary-animation-gif.test.ts \
  tests/lib/glossary-animation-publish.test.ts \
  tests/lib/glossary-animation-publish-cli.test.ts \
  tests/lib/glossary-animation-runtime.test.ts \
  tests/lib/glossary-animation-measure.test.ts \
  tests/lib/glossary-detail.test.ts \
  tests/lib/admin-glossary-illustration-detail.test.ts \
  tests/api/admin-glossary.test.ts \
  tests/api/revalidate-glossary.test.ts \
  tests/lib/csp.test.ts
```

Erwartung: PASS.

- [ ] **Step 2: Repo-weite Checks**

```bash
./scripts/run-node24.sh pnpm typecheck
./scripts/run-node24.sh pnpm lint
./scripts/run-node24.sh pnpm test
./scripts/run-node24.sh pnpm build
```

Erwartung: PASS. Der Build muss über den Runner unter Node 24 laufen.

- [ ] **Step 3: DB-Vertrag**

```bash
supabase db reset --local --no-seed
supabase test db supabase/tests/glossary_animation_urls_test.sql
supabase db lint --local --fail-on error
```

Erwartung: PASS.

- [ ] **Step 4: Alle zwölf Artefakte reproduzieren**

Für jeden in der Pilotdatei gelisteten Slug den Renderer erneut ausführen und Poster-, Recipe-, beide GIF-Hashes sowie Release-ID mit den versionierten Werten der Pilotdatei vergleichen. Kein Artifact wird committed.

- [ ] **Step 5: Deployment-E2E und LCP-Gate erneut ausführen**

Die Commands aus Task 11/12 gegen den finalen Candidate wiederholen. Bei jeder nachträglichen Codeänderung müssen Unit-Suites, Build, E2E und LCP-Messung erneut laufen; ältere Ergebnisse dürfen nicht als Beleg dienen.

- [ ] **Step 6: Security- und Race-Review**

Gezielt prüfen:

- exakter CSP-Origin statt Wildcard;
- sichere Posterfetch-Allowlist und Byte-/Pixelgrenzen;
- kein Secret im Log;
- vollständiger Drei-URL-CAS;
- Publish-vs-Publish und Publish-vs-Rollback;
- Rollback lässt Poster bestehen;
- Reduced Motion erzeugt null GIF-Requests.

- [ ] **Step 7: Finalen Handoff dokumentieren**

In der Pilotdatei final festhalten:

- zwölf aktive Slugs und Pattern;
- immutable Blob-Release-IDs;
- Rollback-Command;
- Test-/Build-/E2E-/LCP-Ergebnisse mit Datum;
- Empfehlung `breiter ausrollen`, `Pattern überarbeiten` oder `Pilot stoppen`.

- [ ] **Step 8: Abschlusscommit nur bei notwendigen Doc-Änderungen**

```bash
git add docs/superpowers/pilots/2026-08-28-glossary-animation-pilot.md
git commit -m "docs(glossary): record GIF89a pilot verification"
```

Falls Step 7 keine Datei verändert, keinen leeren Commit erzeugen.

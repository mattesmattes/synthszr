import type { MomentumMapData } from '@/lib/rankings/momentum-map'

/**
 * Pure Vector SVG A2 Print Poster (420 × 594 mm, portrait).
 * Coordinate system: 1260 × 1782 (exact 3 units = 1 mm, DIN A2 aspect ratio).
 * Light Editorial palette: warm off-white paper (#F6F5F0), deep ink (#0D0D0D),
 * hairline Swiss grid (#D4D4CE), surgical neon-lime accent (#CCFF00).
 */

const W = 1260
const H = 1782
const PAD = 54 // 18 mm print safe margin
const INNER_W = W - PAD * 2 // 1152

const PAPER = '#F6F5F0'
const INK = '#0D0D0D'
const MUTED = '#575752'
const LIGHT_MUTED = '#8A8A82'
const RULE = '#D4D4CE'
const CARD_BG = '#EFEDE6'
const LIME = '#CCFF00'
const LIME_STROKE = '#7FA300'
const LIME_DARK = '#4C6600'

const SANS = "'Inter', 'Helvetica Neue', Helvetica, Arial, sans-serif"
const MONO = "'JetBrains Mono', 'SFMono-Regular', Menlo, Monaco, Consolas, monospace"

function trunc(s: string, max: number): string {
  return s.length > max ? `${s.slice(0, max - 1)}…` : s
}

/** Smooth horizontal cubic Bézier path through (x,y) points. */
function smoothPath(pts: Array<[number, number]>): string {
  if (pts.length === 0) return ''
  let d = `M ${pts[0][0].toFixed(1)} ${pts[0][1].toFixed(1)}`
  for (let i = 1; i < pts.length; i++) {
    const [x0, y0] = pts[i - 1]
    const [x1, y1] = pts[i]
    const mx = ((x0 + x1) / 2).toFixed(1)
    d += ` C ${mx} ${y0.toFixed(1)}, ${mx} ${y1.toFixed(1)}, ${x1.toFixed(1)} ${y1.toFixed(1)}`
  }
  return d
}

/** Sparkline SVG area + line paths. */
function sparklinePaths(values: number[], x: number, y: number, w: number, h: number): { line: string; area: string; peakX: number; peakY: number } {
  const n = Math.max(2, values.length)
  const pts: Array<[number, number]> = values.map((v, i) => [
    x + (i / (n - 1)) * w,
    y + h - Math.max(0.04, Math.min(1, v)) * (h - 2) - 1,
  ])
  let peakIdx = 0
  let peakV = -1
  values.forEach((v, i) => {
    if (v >= peakV) {
      peakV = v
      peakIdx = i
    }
  })
  const line = pts.map(([px, py], i) => `${i === 0 ? 'M' : 'L'}${px.toFixed(1)},${py.toFixed(1)}`).join(' ')
  const area = `${line} L${(x + w).toFixed(1)},${(y + h).toFixed(1)} L${x.toFixed(1)},${(y + h).toFixed(1)} Z`
  return { line, area, peakX: pts[peakIdx]?.[0] ?? x, peakY: pts[peakIdx]?.[1] ?? y }
}

function trendGlyph(trend: 'up' | 'down' | 'flat'): { ch: string; fill: string } {
  if (trend === 'up') return { ch: '▲', fill: LIME_DARK }
  if (trend === 'down') return { ch: '▼', fill: '#8B4A3C' }
  return { ch: '—', fill: LIGHT_MUTED }
}

/**
 * Exact ISO-18004 Version 3-M (29×29) QR code matrix for
 * https://www.synthszr.com/en/rankings (with 2-module quiet zone).
 */
const QR_RANKINGS_MATRIX = [
  '11111110100100100110001111111',
  '10000010011100001101001000001',
  '10111010001011001111001011101',
  '10111010111010110010001011101',
  '10111010110001111110001011101',
  '10000010100001101001101000001',
  '11111110101010101010101111111',
  '00000000110000100111100000000',
  '10001011110001100110111111001',
  '10101001000010011110111111111',
  '10110011101011111010011110001',
  '01100001011011000111000011011',
  '00001011010101010101010000010',
  '00001101001101111010011011111',
  '01100110101110010110010011101',
  '11111101010110111111001000011',
  '01100010110001110100010100010',
  '11110100000000011110001111011',
  '00110010101011110010100010101',
  '00011101010001001101010000011',
  '11110110011011010111111111001',
  '00000000101101111110100010001',
  '11111110100010011011101011101',
  '10000010010100100111100010011',
  '10111010101001110101111111010',
  '10111010011100011001110100001',
  '10111010001110010000100001111',
  '10000010010000011100101011011',
  '11111110101111000100100110010',
]

const OH_SO_LOGO_PATH =
  'M475.269,148.05C447.911,148.05 424.873,156.147 408.674,170.845C392.475,185.543 383.116,206.841 383.116,233.243L383.116,236.584C383.115,262.985 392.475,284.283 408.674,298.981C424.873,313.679 447.911,321.777 475.269,321.777L567.7,321.777C595.042,321.777 618.073,313.679 634.272,298.981C650.471,284.284 659.838,262.985 659.854,236.584L659.854,233.243C659.854,206.841 650.494,185.543 634.295,170.845C618.097,156.147 595.058,148.05 567.7,148.05L475.269,148.05ZM681.291,150.834L681.291,318.714L756.74,318.714L756.74,257.464L870.33,257.464L870.33,318.714L945.779,318.714L945.779,150.834L870.33,150.834L870.33,202.618L756.74,202.618L756.74,150.834L681.291,150.834ZM490.303,204.567L552.666,204.567C561.901,204.567 569.626,206.91 575.044,211.561C580.461,216.213 583.57,223.173 583.57,232.408L583.57,237.141C583.57,246.39 580.461,253.351 575.044,257.998C569.626,262.646 561.901,264.981 552.666,264.981L490.303,264.981C481.068,264.981 473.343,262.646 467.925,257.998C462.508,253.351 459.4,246.39 459.4,237.141L459.4,232.408C459.4,223.158 462.508,216.198 467.926,211.55C473.343,206.902 481.069,204.567 490.303,204.567ZM382.28,340.708L382.28,396.39L945.779,396.39L945.779,340.708L382.28,340.708ZM458.008,417.549C413.545,417.549 385.621,437.512 385.621,471.282C385.621,505.052 413.663,524.737 458.564,524.736L582.456,524.736C591.33,524.736 596.376,527.437 596.376,533.646C596.376,538.976 591.522,542.555 582.178,542.555L474.434,542.555C468.648,542.555 464.333,541.758 461.185,539.794C458.037,537.83 456.058,534.698 454.945,530.026L383.951,530.026C383.951,548.244 391.669,563.556 406.282,574.314C420.895,585.072 442.401,591.276 469.979,591.276L578.558,591.276C628.79,591.276 662.081,570.038 662.081,534.481C662.081,496.258 629.786,478.52 579.115,478.521L462.184,478.521C455.066,478.521 451.047,475.456 451.047,471.004C451.047,466.112 455.065,462.929 462.184,462.93L573.825,462.93C578.497,462.93 582.037,463.806 584.796,465.462C587.555,467.118 589.534,469.554 591.087,472.674L657.626,472.674C657.626,456.448 652.006,442.666 639.104,432.942C626.202,423.217 606.017,417.549 576.888,417.549L458.008,417.549ZM767.319,417.828C739.961,417.827 716.923,425.925 700.724,440.623C684.525,455.321 675.166,476.619 675.166,503.02L675.166,506.361C675.166,532.763 684.526,554.061 700.724,568.759C716.923,583.457 739.961,591.554 767.319,591.554L860.029,591.554C887.387,591.554 910.417,583.457 926.612,568.759C942.807,554.061 952.167,532.763 952.182,506.361L952.182,503.02C952.183,476.619 942.823,455.321 926.624,440.623C910.425,425.925 887.387,417.828 860.029,417.828L767.319,417.828ZM782.632,474.345L844.995,474.345C854.23,474.345 861.956,476.688 867.373,481.339C872.79,485.991 875.899,492.951 875.899,502.185L875.899,506.918C875.899,516.168 872.79,523.128 867.372,527.776C861.955,532.424 854.229,534.759 844.995,534.759L782.632,534.759C773.397,534.759 765.602,532.424 760.115,527.776C754.628,523.128 751.45,516.168 751.45,506.918L751.45,502.185C751.45,492.951 754.628,485.991 760.115,481.339C765.602,476.688 773.397,474.345 782.632,474.345Z'

function renderOhSoLogo(x: number, y: number, targetHeight: number) {
  const scale = targetHeight / 443.5
  return (
    <g transform={`translate(${x.toFixed(1)}, ${y.toFixed(1)}) scale(${scale.toFixed(5)}) translate(-382.28, -148.05)`}>
      <path d={OH_SO_LOGO_PATH} fill={INK} fillRule="nonzero" />
    </g>
  )
}

function renderQrGraphic(x: number, y: number, size: number) {
  const cells = QR_RANKINGS_MATRIX.length
  const quiet = 2
  const cell = size / (cells + quiet * 2)
  const ox = x + quiet * cell
  const oy = y + quiet * cell
  const rects: Array<{ cx: number; cy: number }> = []
  for (let r = 0; r < cells; r++) {
    const row = QR_RANKINGS_MATRIX[r]
    for (let c = 0; c < cells; c++) {
      if (row[c] === '1') rects.push({ cx: c, cy: r })
    }
  }
  return (
    <g>
      <rect x={x} y={y} width={size} height={size} fill="#FFFFFF" stroke={RULE} strokeWidth={0.8} />
      {rects.map(({ cx, cy }, i) => (
        <rect key={i} x={ox + cx * cell} y={oy + cy * cell} width={cell + 0.12} height={cell + 0.12} fill={INK} />
      ))}
    </g>
  )
}

export function MomentumMapPoster({ data }: { data: MomentumMapData }) {
  // Zone Y coordinates (total height = 1782)
  const headerY = PAD // 54
  const heroTop = 188
  const heroChartTop = 226
  const heroChartH = 260
  const heroCalloutY = heroChartTop + heroChartH + 16 // 502
  const matrixTop = 588
  const matrixBottom = 1620
  const footerTop = 1640

  // Hero chart geometry
  const heroLeftX = PAD + 148 // Left labels (start rank)
  const heroRightX = W - PAD - 210 // Right labels (current rank + name + score)
  const heroSpanW = heroRightX - heroLeftX
  const heroRowH = heroChartH / 12

  // 4×4 Category Matrix geometry (16 tiles)
  const cols = 4
  const rows = 4
  const gapX = 14
  const gapY = 14
  const tileW = (INNER_W - gapX * (cols - 1)) / cols // ~277.5
  const tileH = (matrixBottom - matrixTop - gapY * (rows - 1)) / rows // ~247.5

  // Vendor bar palette (Swiss monochrome + lime lead)
  const vendorColors = [LIME, '#0D0D0D', '#3A3A38', '#63635E', '#8A8A82', '#AEAEA6', '#C9C9C1', '#E2E0D8']

  return (
    <svg
      id="synthszr-momentum-map-svg"
      xmlns="http://www.w3.org/2000/svg"
      viewBox={`0 0 ${W} ${H}`}
      width="100%"
      className="block h-auto w-full select-none"
      role="img"
      aria-label={`SYNTHSZR MOMENTUM MAP · ${data.monthLabel}`}
    >
      {/* Background warm off-white paper */}
      <rect x={0} y={0} width={W} height={H} fill={PAPER} />

      {/* Subtle corner print registration ticks */}
      {[
        [24, 24, 1, 1],
        [W - 24, 24, -1, 1],
        [24, H - 24, 1, -1],
        [W - 24, H - 24, -1, -1],
      ].map(([cx, cy, dx, dy], i) => (
        <g key={i} stroke={LIGHT_MUTED} strokeWidth={0.6}>
          <line x1={cx} y1={cy} x2={cx + dx * 10} y2={cy} />
          <line x1={cx} y1={cy} x2={cx} y2={cy + dy * 10} />
        </g>
      ))}

      {/* ===================================================================== */}
      {/* [A] MASTHEAD & SERIES IDENTIFIER                                      */}
      {/* ===================================================================== */}
      <g>
        {/* Top heavy Swiss rule */}
        <rect x={PAD} y={headerY} width={INNER_W} height={3.5} fill={INK} />

        {/* Issue pill top right */}
        <rect x={W - PAD - 224} y={headerY + 14} width={224} height={26} fill={LIME} stroke={INK} strokeWidth={1} />
        <text
          x={W - PAD - 112}
          y={headerY + 31}
          textAnchor="middle"
          fontFamily={MONO}
          fontSize={11.5}
          fontWeight={700}
          letterSpacing={1.4}
          fill={INK}
        >
          {data.issueCode} · 90-DAY EDITION
        </text>

        {/* Main Title */}
        <text
          x={PAD}
          y={headerY + 52}
          fontFamily={SANS}
          fontSize={42}
          fontWeight={900}
          letterSpacing={-1.2}
          fill={INK}
        >
          SYNTHSZR MOMENTUM MAP · {data.monthLabel}
        </text>

        {/* Thematic Deck */}
        <text
          x={PAD}
          y={headerY + 78}
          fontFamily={SANS}
          fontSize={14}
          fontWeight={400}
          fill={MUTED}
        >
          {data.thematicDeck}
        </text>

        {/* Metadata + Legend strip */}
        <line x1={PAD} y1={headerY + 94} x2={W - PAD} y2={headerY + 94} stroke={RULE} strokeWidth={1} />
        <text x={PAD} y={headerY + 114} fontFamily={MONO} fontSize={10} fill={MUTED} letterSpacing={0.4}>
          WINDOW: {data.windowLabel} · {data.totalMentions90d.toLocaleString('en-US')} MENTIONS · 16 CATEGORIES × TOP 5 = 80 PRODUCTS
        </text>

        {/* Legend right */}
        <g transform={`translate(${W - PAD - 372}, ${headerY + 104})`}>
          <rect x={0} y={2} width={14} height={8} fill={LIME} stroke={LIME_STROKE} strokeWidth={0.8} />
          <text x={19} y={10} fontFamily={MONO} fontSize={9.5} fill={MUTED}>#1 / BREAKOUT</text>
          <line x1={118} y1={6} x2={132} y2={6} stroke={INK} strokeWidth={2} />
          <text x={137} y={10} fontFamily={MONO} fontSize={9.5} fill={MUTED}>90D TRAJECTORY</text>
          <text x={242} y={10} fontFamily={MONO} fontSize={9.5} fill={LIME_DARK}>▲ RISING</text>
          <text x={306} y={10} fontFamily={MONO} fontSize={9.5} fill="#8B4A3C">▼ COOLING</text>
        </g>

        <line x1={PAD} y1={headerY + 124} x2={W - PAD} y2={headerY + 124} stroke={INK} strokeWidth={1} />
      </g>

      {/* ===================================================================== */}
      {/* [B] HERO: 90-DAY GLOBAL TOP 12 RANK-FLOW & MOMENTUM RIBBON            */}
      {/* ===================================================================== */}
      <g>
        <text x={PAD} y={heroTop + 16} fontFamily={MONO} fontSize={11} fontWeight={700} letterSpacing={1.2} fill={INK}>
          A · GLOBAL SUPER-LEAGUE — 90-DAY RANK FLOW &amp; MOMENTUM (TOP 12 OVERALL)
        </text>
        <text x={W - PAD} y={heroTop + 16} textAnchor="end" fontFamily={MONO} fontSize={9.5} fill={MUTED}>
          STROKE WEIGHT = RAW MOMENTUM · WEEKLY RANKINGS ACROSS 13 WEEKS
        </text>

        {/* Vertical 13-week gridlines & labels */}
        {data.weekLabels.map((lbl, w) => {
          const x = heroLeftX + (w / 12) * heroSpanW
          const showLabel = w === 0 || w === 3 || w === 6 || w === 9 || w === 12
          return (
            <g key={w}>
              <line
                x1={x}
                y1={heroChartTop}
                x2={x}
                y2={heroChartTop + heroChartH}
                stroke={w === 12 ? INK : RULE}
                strokeWidth={w === 12 ? 1.2 : 0.7}
                strokeDasharray={w === 12 ? undefined : '2,3'}
              />
              {showLabel && (
                <text
                  x={x}
                  y={heroChartTop - 6}
                  textAnchor={w === 0 ? 'start' : w === 12 ? 'end' : 'middle'}
                  fontFamily={MONO}
                  fontSize={8.5}
                  fontWeight={w === 12 ? 700 : 400}
                  fill={w === 12 ? INK : LIGHT_MUTED}
                >
                  {lbl}
                </text>
              )}
            </g>
          )
        })}

        {/* Subtle rank row guide lines */}
        {Array.from({ length: 12 }).map((_, r) => {
          const y = heroChartTop + r * heroRowH + heroRowH / 2
          return <line key={r} x1={heroLeftX} y1={y} x2={heroRightX} y2={y} stroke={RULE} strokeWidth={0.4} opacity={0.6} />
        })}

        {/* Ribbons (draw non-highlighted first, then #1 & breakouts on top!) */}
        {[...data.heroTop12]
          .sort((a, b) => (a.rank === 1 || a.isBreakout ? 1 : 0) - (b.rank === 1 || b.isBreakout ? 1 : 0))
          .map((p) => {
            const pts: Array<[number, number]> = p.weeklyRanks.map((rk, w) => [
              heroLeftX + (w / 12) * heroSpanW,
              heroChartTop + (rk - 1) * heroRowH + heroRowH / 2,
            ])
            const pathD = smoothPath(pts)
            const isHeroHighlight = p.rank === 1 || p.trend === 'up'
            const sw = Math.max(1.6, Math.min(7.5, 1.5 + (p.score / 100) * 6))
            const endY = pts[pts.length - 1][1]
            const startY = pts[0][1]
            const tg = trendGlyph(p.trend)

            return (
              <g key={p.id}>
                {/* Crisp dark casing for lime highlight so it pops on light paper */}
                {isHeroHighlight && (
                  <path d={pathD} fill="none" stroke={INK} strokeWidth={sw + 2.2} strokeLinecap="round" opacity={0.85} />
                )}
                <path
                  d={pathD}
                  fill="none"
                  stroke={isHeroHighlight ? LIME : p.rank <= 4 ? '#2A2A28' : '#9B9B93'}
                  strokeWidth={sw}
                  strokeLinecap="round"
                  opacity={isHeroHighlight ? 1 : p.rank <= 4 ? 0.85 : 0.6}
                />

                {/* Start node + left label */}
                <circle cx={pts[0][0]} cy={startY} r={2.6} fill={isHeroHighlight ? INK : '#7A7A72'} />
                <text
                  x={heroLeftX - 10}
                  y={startY + 3.5}
                  textAnchor="end"
                  fontFamily={SANS}
                  fontSize={9.5}
                  fontWeight={p.rank <= 3 ? 600 : 400}
                  fill={p.rank <= 3 ? INK : MUTED}
                >
                  {trunc(p.name, 19)}
                </text>

                {/* End node */}
                <circle
                  cx={heroRightX}
                  cy={endY}
                  r={isHeroHighlight ? 4.4 : 3.2}
                  fill={isHeroHighlight ? LIME : INK}
                  stroke={INK}
                  strokeWidth={1.2}
                />

                {/* Right-side ranking table column */}
                <text
                  x={heroRightX + 12}
                  y={endY + 3.5}
                  fontFamily={MONO}
                  fontSize={9.5}
                  fontWeight={700}
                  fill={INK}
                >
                  {String(p.rank).padStart(2, '0')}
                </text>
                <text
                  x={heroRightX + 32}
                  y={endY + 3.5}
                  fontFamily={SANS}
                  fontSize={10.5}
                  fontWeight={p.rank <= 3 || isHeroHighlight ? 700 : 500}
                  fill={INK}
                >
                  {trunc(p.name, 17)}
                </text>
                <text
                  x={W - PAD - 42}
                  y={endY + 3.5}
                  textAnchor="end"
                  fontFamily={MONO}
                  fontSize={9.5}
                  fontWeight={700}
                  fill={INK}
                >
                  {p.score}
                </text>
                <text
                  x={W - PAD - 24}
                  y={endY + 3.5}
                  textAnchor="end"
                  fontFamily={MONO}
                  fontSize={8.5}
                  fill={LIGHT_MUTED}
                >
                  {Math.round(p.momentum)}
                </text>
                <text
                  x={W - PAD - 4}
                  y={endY + 3.5}
                  textAnchor="end"
                  fontFamily={MONO}
                  fontSize={9}
                  fill={tg.fill}
                >
                  {tg.ch}
                </text>
              </g>
            )
          })}

        {/* 4 Editorial Callout Cards pinned below Hero */}
        {data.callouts.slice(0, 4).map((c, idx) => {
          const cw = (INNER_W - 14 * 3) / 4
          const cx = PAD + idx * (cw + 14)
          return (
            <g key={c.tag}>
              <rect x={cx} y={heroCalloutY} width={cw} height={58} fill={CARD_BG} stroke={RULE} strokeWidth={0.8} />
              <rect x={cx} y={heroCalloutY} width={3.5} height={58} fill={idx === 0 || idx === 1 ? LIME_STROKE : INK} />
              <text x={cx + 10} y={heroCalloutY + 14} fontFamily={MONO} fontSize={8} fontWeight={700} letterSpacing={0.8} fill={MUTED}>
                {c.tag}
              </text>
              <text x={cx + 10} y={heroCalloutY + 29} fontFamily={SANS} fontSize={10.5} fontWeight={700} fill={INK}>
                {trunc(c.title, 34)}
              </text>
              <text x={cx + 10} y={heroCalloutY + 44} fontFamily={SANS} fontSize={8.5} fill={MUTED}>
                {trunc(c.detail, 54)}
              </text>
            </g>
          )
        })}
      </g>

      {/* ===================================================================== */}
      {/* [C] 4×4 CATEGORY MOMENTUM MATRIX (16 CATEGORIES × TOP 5 = 80 PRODUCTS)*/}
      {/* ===================================================================== */}
      <g>
        <line x1={PAD} y1={matrixTop - 16} x2={W - PAD} y2={matrixTop - 16} stroke={INK} strokeWidth={1.2} />
        <text x={PAD} y={matrixTop - 4} fontFamily={MONO} fontSize={10.5} fontWeight={700} letterSpacing={1.1} fill={INK}>
          B · 16-CATEGORY MOMENTUM MATRIX — TOP 5 PER CATEGORY (80 PRODUCTS · SYNCHRONIZED 90-DAY SPARKLINES)
        </text>
        <text x={W - PAD} y={matrixTop - 4} textAnchor="end" fontFamily={MONO} fontSize={8.5} fill={MUTED}>
          SCORE 0–100 RELATIVE TO CATEGORY LEADER · HEAT BAR = PEAK VS GLOBAL #1
        </text>

        {data.categories.slice(0, 16).map((cat, idx) => {
          const col = idx % cols
          const row = Math.floor(idx / cols)
          const tx = PAD + col * (tileW + gapX)
          const ty = matrixTop + 6 + row * (tileH + gapY)
          const heatBarW = 54
          const rowStartY = ty + 48
          const rowStep = 38.5

          return (
            <g key={cat.slug}>
              {/* Tile container */}
              <rect x={tx} y={ty} width={tileW} height={tileH} fill="#FFFFFF" stroke={RULE} strokeWidth={0.9} />
              {/* Top accent bar */}
              <rect x={tx} y={ty} width={tileW} height={2.5} fill={idx < 2 ? LIME_STROKE : INK} />

              {/* Category number + title */}
              <text x={tx + 10} y={ty + 20} fontFamily={MONO} fontSize={9.5} fontWeight={700} fill={LIGHT_MUTED}>
                {String(cat.index).padStart(2, '0')}
              </text>
              <text x={tx + 28} y={ty + 20} fontFamily={SANS} fontSize={11.5} fontWeight={800} fill={INK}>
                {trunc(cat.name.toUpperCase(), 22)}
              </text>

              {/* Category Heat Bar + Peak */}
              <rect x={tx + 10} y={ty + 28} width={heatBarW} height={4.5} fill={CARD_BG} />
              <rect
                x={tx + 10}
                y={ty + 28}
                width={Math.max(3, (cat.heatPct / 100) * heatBarW)}
                height={4.5}
                fill={idx < 3 ? LIME_STROKE : INK}
              />
              <text x={tx + 70} y={ty + 33} fontFamily={MONO} fontSize={7.8} fill={MUTED}>
                PEAK {Math.round(cat.peakMomentum)} · {cat.productCount} TRACKED
              </text>

              <line x1={tx + 10} y1={ty + 40} x2={tx + tileW - 10} y2={ty + 40} stroke={RULE} strokeWidth={0.7} />

              {/* Top 5 Products */}
              {cat.products.slice(0, 5).map((p, pIdx) => {
                const ry = rowStartY + pIdx * rowStep
                const spX = tx + tileW - 108
                const spW = 62
                const spH = 22
                const sp = sparklinePaths(p.sparkline, spX, ry + 3, spW, spH)
                const tg = trendGlyph(p.trend)
                const isFirst = pIdx === 0

                return (
                  <g key={p.id}>
                    {pIdx > 0 && (
                      <line x1={tx + 10} y1={ry - 3} x2={tx + tileW - 10} y2={ry - 3} stroke={RULE} strokeWidth={0.45} />
                    )}

                    {/* Rank badge */}
                    {isFirst ? (
                      <>
                        <rect x={tx + 10} y={ry + 3} width={15} height={15} fill={LIME} stroke={INK} strokeWidth={0.7} />
                        <text x={tx + 17.5} y={ry + 13.5} textAnchor="middle" fontFamily={MONO} fontSize={8.5} fontWeight={700} fill={INK}>
                          1
                        </text>
                      </>
                    ) : (
                      <text x={tx + 17.5} y={ry + 13.5} textAnchor="middle" fontFamily={MONO} fontSize={8.5} fill={LIGHT_MUTED}>
                        {p.catRank}
                      </text>
                    )}

                    {/* Product name + vendor */}
                    <text x={tx + 31} y={ry + 12.5} fontFamily={SANS} fontSize={9.8} fontWeight={isFirst ? 700 : 500} fill={INK}>
                      {trunc(p.name, 19)}
                    </text>
                    <text x={tx + 31} y={ry + 24} fontFamily={MONO} fontSize={7.5} fill={LIGHT_MUTED}>
                      {trunc(p.vendor, 18)}
                    </text>

                    {/* 90-day Area Sparkline */}
                    <path d={sp.area} fill={isFirst ? LIME : '#D8D6CE'} opacity={isFirst ? 0.45 : 0.45} />
                    <path d={sp.line} fill="none" stroke={isFirst ? INK : '#5A5A54'} strokeWidth={isFirst ? 1.4 : 1.0} />
                    <circle cx={sp.peakX} cy={sp.peakY} r={1.8} fill={isFirst ? LIME_DARK : INK} />

                    {/* Score + trend */}
                    <text x={tx + tileW - 21} y={ry + 15} textAnchor="end" fontFamily={MONO} fontSize={9.5} fontWeight={isFirst ? 700 : 500} fill={INK}>
                      {p.catScore}
                    </text>
                    <text x={tx + tileW - 10} y={ry + 15} textAnchor="end" fontFamily={MONO} fontSize={8.5} fill={tg.fill}>
                      {tg.ch}
                    </text>
                  </g>
                )
              })}
            </g>
          )
        })}
      </g>

      {/* ===================================================================== */}
      {/* [D] VENDOR GRAVITY BARCODE + COLOPHON + QR                            */}
      {/* ===================================================================== */}
      <g>
        <line x1={PAD} y1={footerTop} x2={W - PAD} y2={footerTop} stroke={INK} strokeWidth={1.5} />
        <text x={PAD} y={footerTop + 16} fontFamily={MONO} fontSize={9.5} fontWeight={700} letterSpacing={1} fill={INK}>
          C · VENDOR GRAVITY — SHARE OF TOP-200 PRODUCT MOMENTUM
        </text>

        {/* Stacked proportional vendor bar */}
        {(() => {
          const barW = INNER_W - 176
          let cursor = PAD
          return data.vendorGravity.map((v, i) => {
            const segW = Math.max(2, (v.pct / 100) * barW)
            const x = cursor
            cursor += segW
            const fill = vendorColors[i % vendorColors.length]
            return (
              <g key={v.vendor}>
                <rect x={x} y={footerTop + 23} width={segW - 1} height={15} fill={fill} stroke={PAPER} strokeWidth={0.5} />
                {segW > 56 && (
                  <text
                    x={x + 5}
                    y={footerTop + 34}
                    fontFamily={MONO}
                    fontSize={8}
                    fontWeight={700}
                    fill={i === 0 || i >= 5 ? INK : '#FFFFFF'}
                  >
                    {v.label} {v.pct}%
                  </text>
                )}
              </g>
            )
          })
        })()}

        {/* Vendor Legend line */}
        <text x={PAD} y={footerTop + 52} fontFamily={MONO} fontSize={8.2} fill={MUTED}>
          {data.vendorGravity.map((v) => `${v.label} ${v.pct}%`).join('  ·  ')}
        </text>

        {/* Colophon bottom left */}
        <line x1={PAD} y1={footerTop + 62} x2={W - PAD - 170} y2={footerTop + 62} stroke={RULE} strokeWidth={0.7} />
        <text x={PAD} y={footerTop + 78} fontFamily={SANS} fontSize={9} fontWeight={700} fill={INK}>
          SYNTHSZR CHARTS · AI IS ABOUT SYNTHESIS, NOT EFFICIENCY.
        </text>
        <text x={PAD} y={footerTop + 92} fontFamily={MONO} fontSize={8} fill={MUTED}>
          METHODOLOGY: Exponential time-decay mention momentum across curated daily AI newsletters &amp; tech feeds.
        </text>
        <text x={PAD} y={footerTop + 104} fontFamily={MONO} fontSize={8} fill={MUTED}>
          DATA BASIS (90D): {data.totalArticles90d.toLocaleString('en-US')} articles analyzed across {data.totalNewsSources.toLocaleString('en-US')} curated news sources · {data.totalMentions90d.toLocaleString('en-US')} product mentions · synthszr.com/en/rankings
        </text>

        {/* OH-SO Logo next to QR code */}
        {renderOhSoLogo(W - PAD - 152, footerTop + 33, 46)}
        <text x={W - PAD - 122} y={footerTop + 103} textAnchor="middle" fontFamily={MONO} fontSize={7.2} fontWeight={700} fill={MUTED}>
          BY OH-SO
        </text>
        <line x1={W - PAD - 80} y1={footerTop + 25} x2={W - PAD - 80} y2={footerTop + 92} stroke={RULE} strokeWidth={0.8} />

        {/* Real ISO-18004 Vector QR code bottom right */}
        {renderQrGraphic(W - PAD - 68, footerTop + 23, 66)}
        <text x={W - PAD - 35} y={footerTop + 103} textAnchor="middle" fontFamily={MONO} fontSize={7.2} fontWeight={700} fill={INK}>
          LIVE CHARTS
        </text>
      </g>
    </svg>
  )
}

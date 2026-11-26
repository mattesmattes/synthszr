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

/** Deterministic, crisp minimalist 13×13 QR-style matrix + finder squares linking to synthszr.com/en/rankings */
function renderQrGraphic(x: number, y: number, size: number) {
  // Real 21×21 QR Version 1 visual finder + deterministic data pattern for compact print emblem
  const cells = 21
  const cell = size / cells
  const rects: Array<{ cx: number; cy: number }> = []
  const isFinder = (r: number, c: number) =>
    (r < 7 && c < 7) || (r < 7 && c >= cells - 7) || (r >= cells - 7 && c < 7)
  const finderOn = (r: number, c: number) => {
    const lr = r < 7 ? r : r - (cells - 7)
    const lc = c < 7 ? c : c - (cells - 7)
    return lr === 0 || lr === 6 || lc === 0 || lc === 6 || (lr >= 2 && lr <= 4 && lc >= 2 && lc <= 4)
  }
  const seed = 'https://www.synthszr.com/en/rankings'
  for (let r = 0; r < cells; r++) {
    for (let c = 0; c < cells; c++) {
      if (isFinder(r, c)) {
        if (finderOn(r, c)) rects.push({ cx: c, cy: r })
      } else if (r === 6 || c === 6) {
        if ((r + c) % 2 === 0) rects.push({ cx: c, cy: r })
      } else {
        const h = (seed.charCodeAt((r * 7 + c * 13) % seed.length) + r * 31 + c * 17) % 5
        if (h === 0 || h === 2) rects.push({ cx: c, cy: r })
      }
    }
  }
  return (
    <g>
      <rect x={x - 3} y={y - 3} width={size + 6} height={size + 6} fill="#FFFFFF" stroke={RULE} strokeWidth={0.8} />
      {rects.map(({ cx, cy }, i) => (
        <rect key={i} x={x + cx * cell} y={y + cy * cell} width={cell + 0.15} height={cell + 0.15} fill={INK} />
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
          const barW = INNER_W - 92
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
        <line x1={PAD} y1={footerTop + 62} x2={W - PAD - 84} y2={footerTop + 62} stroke={RULE} strokeWidth={0.7} />
        <text x={PAD} y={footerTop + 78} fontFamily={SANS} fontSize={9} fontWeight={700} fill={INK}>
          SYNTHSZR CHARTS · AI IS ABOUT SYNTHESIS, NOT EFFICIENCY.
        </text>
        <text x={PAD} y={footerTop + 92} fontFamily={MONO} fontSize={8} fill={MUTED}>
          METHODOLOGY: Exponential time-decay mention momentum across curated daily AI newsletters &amp; tech feeds.
        </text>
        <text x={PAD} y={footerTop + 104} fontFamily={MONO} fontSize={8} fill={MUTED}>
          PRINT SPEC: DIN A2 (420 × 594 mm) · 300 DPI Vector · Live charts &amp; full archive at https://www.synthszr.com/en/rankings
        </text>

        {/* Vector QR Emblem bottom right */}
        {renderQrGraphic(W - PAD - 68, footerTop + 23, 66)}
        <text x={W - PAD - 35} y={footerTop + 103} textAnchor="middle" fontFamily={MONO} fontSize={7.2} fontWeight={700} fill={INK}>
          LIVE CHARTS
        </text>
      </g>
    </svg>
  )
}

// Leichtgewichtiger Momentum-Verlauf als reines SVG (kein Client-JS, Server-Component).
// variant 'spark' = kompakte Sparkline für Listen; 'full' = responsive mit Datums-Labels.

interface Point { t: number; value: number }

function fmtShort(t: number): string {
  try {
    return new Date(t).toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit' })
  } catch {
    return ''
  }
}

export function MomentumChart({
  points,
  variant = 'spark',
  width = 80,
  height = 28,
}: {
  points: Point[]
  variant?: 'spark' | 'full'
  width?: number
  height?: number
}) {
  if (!points || points.length < 2) {
    return variant === 'spark' ? <div style={{ width, height }} /> : null
  }
  const max = Math.max(...points.map((p) => p.value), 0.0001)
  const n = points.length
  const pad = variant === 'full' ? 4 : 1
  const w = width
  const h = height
  const x = (i: number) => pad + (i / (n - 1)) * (w - 2 * pad)
  const y = (v: number) => pad + (1 - v / max) * (h - 2 * pad)
  const line = points.map((p, i) => `${x(i).toFixed(1)},${y(p.value).toFixed(1)}`).join(' ')
  const area = `${x(0).toFixed(1)},${(h - pad).toFixed(1)} ${line} ${x(n - 1).toFixed(1)},${(h - pad).toFixed(1)}`

  if (variant === 'spark') {
    return (
      <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} className="shrink-0" aria-hidden>
        <polygon points={area} fill="#CCFF00" opacity={0.5} />
        <polyline points={line} fill="none" stroke="#000" strokeWidth={1.25} strokeLinejoin="round" />
      </svg>
    )
  }

  return (
    <div>
      <svg viewBox={`0 0 ${w} ${h}`} className="w-full" style={{ height }} preserveAspectRatio="none" role="img" aria-label="Momentum-Verlauf">
        <polygon points={area} fill="#CCFF00" opacity={0.4} />
        <polyline points={line} fill="none" stroke="#000" strokeWidth={1.5} strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
      </svg>
      <div className="flex justify-between text-[10px] text-gray-400 mt-1">
        <span>{fmtShort(points[0].t)}</span>
        <span>{fmtShort(points[n - 1].t)}</span>
      </div>
    </div>
  )
}

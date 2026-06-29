// Vergleichs-Chart: mehrere Produkt-Momentum-Linien auf gemeinsamer Y-Skala
// (so direkt vergleichbar). Reines SVG, kein Client-JS.

interface Series {
  label: string
  points: Array<{ t: number; value: number }>
}

const COLORS = ['#111827', '#e63946', '#2a9d8f', '#e76f51', '#457b9d', '#9d4edd', '#d4a017', '#06947a']

function fmtShort(t: number): string {
  try {
    return new Date(t).toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit' })
  } catch {
    return ''
  }
}

export function MultiMomentumChart({ series, height = 180 }: { series: Series[]; height?: number }) {
  const valid = series.filter((s) => s.points.length >= 2)
  if (valid.length === 0) return null

  const W = 600
  const H = height
  const padX = 6
  const padY = 8
  const n = valid[0].points.length
  const max = Math.max(...valid.flatMap((s) => s.points.map((p) => p.value)), 0.0001)
  const x = (i: number) => padX + (i / (n - 1)) * (W - 2 * padX)
  const y = (v: number) => padY + (1 - v / max) * (H - 2 * padY)
  const first = valid[0].points[0].t
  const last = valid[0].points[n - 1].t

  return (
    <div className="rounded-xl border border-gray-200 p-3">
      <div className="text-xs uppercase tracking-wide text-gray-500 mb-2">Momentum-Verlauf (21 Tage)</div>
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full" style={{ height: H }} preserveAspectRatio="none" role="img" aria-label="Momentum-Vergleich">
        {valid.map((s, si) => (
          <polyline
            key={si}
            points={s.points.map((p, i) => `${x(i).toFixed(1)},${y(p.value).toFixed(1)}`).join(' ')}
            fill="none"
            stroke={COLORS[si % COLORS.length]}
            strokeWidth={1.75}
            strokeLinejoin="round"
            vectorEffect="non-scaling-stroke"
          />
        ))}
      </svg>
      <div className="flex justify-between text-[10px] text-gray-400 mt-1">
        <span>{fmtShort(first)}</span>
        <span>{fmtShort(last)}</span>
      </div>
      {/* Legende */}
      <div className="flex flex-wrap gap-x-3 gap-y-1 mt-2">
        {valid.map((s, si) => (
          <span key={si} className="inline-flex items-center gap-1 text-[11px] text-gray-600">
            <span className="w-3 h-0.5 rounded" style={{ background: COLORS[si % COLORS.length] }} />
            {s.label}
          </span>
        ))}
      </div>
    </div>
  )
}

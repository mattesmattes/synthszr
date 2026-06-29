'use client'

import { useState } from 'react'

const RANGES = [90, 30, 7]

function fmtShort(t: number): string {
  try { return new Date(t).toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit' }) } catch { return '' }
}

export function SingleMomentumChart({ points, height = 110 }: { points: Array<{ t: number; value: number }>; height?: number }) {
  const [days, setDays] = useState(90)
  if (!points || points.length < 2) return null

  const maxT = Math.max(...points.map((p) => p.t))
  const cutoff = maxT - days * 86_400_000
  const pts = points.filter((p) => p.t >= cutoff)
  if (pts.length < 2) return null

  const W = 600, H = height, pad = 4
  const minT = Math.min(...pts.map((p) => p.t))
  const max = Math.max(...pts.map((p) => p.value), 0.0001)
  const x = (t: number) => pad + ((t - minT) / (maxT - minT || 1)) * (W - 2 * pad)
  const y = (v: number) => pad + (1 - v / max) * (H - 2 * pad)
  const line = pts.map((p) => `${x(p.t).toFixed(1)},${y(p.value).toFixed(1)}`).join(' ')
  const area = `${x(minT).toFixed(1)},${(H - pad).toFixed(1)} ${line} ${x(maxT).toFixed(1)},${(H - pad).toFixed(1)}`

  return (
    <div>
      <div className="flex justify-between items-center mb-1">
        <span className="text-xs uppercase tracking-wide text-gray-500">Momentum-Verlauf</span>
        <div className="flex gap-1">
          {RANGES.map((d) => (
            <button
              key={d}
              onClick={() => setDays(d)}
              className={`px-2 py-0.5 rounded-full text-[11px] border transition-colors ${days === d ? 'bg-black text-white border-black' : 'border-gray-200 text-gray-600 hover:border-black'}`}
            >
              {d} Tage
            </button>
          ))}
        </div>
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full" style={{ height: H }} preserveAspectRatio="none" role="img" aria-label="Momentum-Verlauf">
        <polygon points={area} fill="#CCFF00" opacity={0.4} />
        <polyline points={line} fill="none" stroke="#000" strokeWidth={1.5} strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
      </svg>
      <div className="flex justify-between text-[10px] text-gray-400 mt-1">
        <span>{fmtShort(cutoff)}</span>
        <span>{fmtShort(maxT)}</span>
      </div>
    </div>
  )
}

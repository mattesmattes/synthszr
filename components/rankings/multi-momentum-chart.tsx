'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { useTranslation } from '@/lib/i18n/context'
import { VendorAvatar } from './vendor-avatar'

interface Series {
  label: string
  slug: string
  vendor: string
  points: Array<{ t: number; value: number }>
}

const COLORS = ['#111827', '#e63946', '#2a9d8f', '#e76f51', '#457b9d', '#9d4edd', '#d4a017', '#06947a']
const RANGES = [90, 30, 7]

function fmtShort(t: number): string {
  try { return new Date(t).toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit' }) } catch { return '' }
}

export function MultiMomentumChart({ series, lang }: { series: Series[]; lang: string }) {
  const router = useRouter()
  const t = useTranslation()
  const [days, setDays] = useState(90)
  const [hover, setHover] = useState<number | null>(null)

  const valid = series.filter((s) => s.points.length >= 2)
  if (valid.length === 0) return null

  const maxT = Math.max(...valid.flatMap((s) => s.points.map((p) => p.t)))
  const cutoff = maxT - days * 86_400_000
  const data = valid.map((s) => ({ ...s, pts: s.points.filter((p) => p.t >= cutoff) })).filter((s) => s.pts.length >= 2)
  if (data.length === 0) return null

  const W = 600, H = 170, padX = 6, padY = 8
  const minT = Math.min(...data.flatMap((s) => s.pts.map((p) => p.t)))
  const max = Math.max(...data.flatMap((s) => s.pts.map((p) => p.value)), 0.0001)
  const x = (t: number) => padX + ((t - minT) / (maxT - minT || 1)) * (W - 2 * padX)
  const y = (v: number) => padY + (1 - v / max) * (H - 2 * padY)
  const go = (slug: string) => router.push(`/${lang}/rankings/${slug}`)

  return (
    <div className="rounded-xl border border-gray-200 p-3">
      <div className="flex justify-between items-center mb-2">
        <span className="text-xs uppercase tracking-wide text-gray-500">{t('rankings.momentum_history')}</span>
        <div className="flex gap-1">
          {RANGES.map((d) => (
            <button
              key={d}
              onClick={() => setDays(d)}
              className={`px-2 py-0.5 rounded-full text-[11px] border transition-colors ${days === d ? 'bg-black text-white border-black' : 'border-gray-200 text-gray-600 hover:border-black'}`}
            >
              {d} {t('rankings.days')}
            </button>
          ))}
        </div>
      </div>

      <svg viewBox={`0 0 ${W} ${H}`} className="w-full" style={{ height: H }} preserveAspectRatio="none">
        {data.map((s, i) => {
          const dimmed = hover !== null && hover !== i
          return (
            <polyline
              key={s.slug}
              points={s.pts.map((p) => `${x(p.t).toFixed(1)},${y(p.value).toFixed(1)}`).join(' ')}
              fill="none"
              stroke={COLORS[i % COLORS.length]}
              strokeWidth={hover === i ? 2.6 : 1.6}
              strokeLinejoin="round"
              vectorEffect="non-scaling-stroke"
              opacity={dimmed ? 0.18 : 1}
              className="cursor-pointer"
              onMouseEnter={() => setHover(i)}
              onMouseLeave={() => setHover(null)}
              onClick={() => go(s.slug)}
            >
              <title>{s.label}</title>
            </polyline>
          )
        })}
      </svg>
      <div className="flex justify-between text-[10px] text-gray-400 mt-1">
        <span>{fmtShort(cutoff)}</span>
        <span>{fmtShort(maxT)}</span>
      </div>

      {/* Legende mit Favicon-Thumbnail + Link */}
      <div className="flex flex-wrap gap-2 mt-2">
        {data.map((s, i) => (
          <button
            key={s.slug}
            onClick={() => go(s.slug)}
            onMouseEnter={() => setHover(i)}
            onMouseLeave={() => setHover(null)}
            title={s.label}
            className={`inline-flex items-center gap-1.5 text-[11px] rounded-full border px-1.5 py-0.5 transition-colors ${hover === i ? 'border-black' : 'border-gray-200'} hover:border-black`}
          >
            <span className="w-2 h-2 rounded-full shrink-0" style={{ background: COLORS[i % COLORS.length] }} />
            <VendorAvatar vendor={s.vendor} size={14} />
            <span className="text-gray-700 max-w-[120px] truncate">{s.label}</span>
          </button>
        ))}
      </div>
    </div>
  )
}

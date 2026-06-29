// Deterministischer Vendor-Avatar (Initial + Farbe aus dem Namen). Robuster
// MVP-Ersatz für echte Logos — funktioniert für jeden Vendor ohne externe API.
const PALETTE = [
  '#0f3460', '#533483', '#1b4332', '#264653', '#6a040f',
  '#3a0ca3', '#1a1a2e', '#5c3d2e', '#14213d', '#7f5539',
]

function colorFor(s: string): string {
  let h = 0
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0
  return PALETTE[h % PALETTE.length]
}

export function VendorAvatar({ vendor, size = 40 }: { vendor: string; size?: number }) {
  const initial = (vendor.trim()[0] ?? '?').toUpperCase()
  return (
    <div
      aria-hidden
      style={{ width: size, height: size, background: colorFor(vendor || '?'), fontSize: size * 0.42 }}
      className="rounded-lg flex items-center justify-center text-white font-bold shrink-0 select-none"
    >
      {initial}
    </div>
  )
}

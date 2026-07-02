// Cover-Banner für alle Synthszr-Charts-Seiten. Gleiche Ästhetik wie die Post-Cover:
// hyper-fotorealistische griechische Marmorstatuen (Cover-Systemprompt) → Floyd-Steinberg-
// Dithering → white→transparent, sodass die Neon-Cyan-BG durchscheint. Motiv: die großen
// AI-Marken (Tech-CEOs + Firmenlogos) als Marmor-Krieger im mythischen Kampf ums Top-3-Podium.
// Asset nativ 880×200, durabel in Vercel Blob.
const BANNER_URL =
  'https://lbrzdn804nhy3kox.public.blob.vercel-storage.com/rankings/synthszr-charts-banner-marble.png'

export function RankingsBanner() {
  return (
    <div className="mb-5 overflow-hidden rounded-xl bg-[#00ffff]">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={BANNER_URL}
        alt="Synthszr Charts — die großen AI-Marken im Wettkampf ums Podium"
        width={880}
        height={200}
        loading="eager"
        className="block w-full max-w-[880px] mx-auto h-auto"
      />
    </div>
  )
}

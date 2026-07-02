// Cover-Banner für alle Synthszr-Charts-Seiten. Gleiche Ästhetik wie die Post-Cover:
// hyper-fotorealistische griechische Marmorstatuen (Cover-Systemprompt) → Floyd-Steinberg-
// Dithering → white→transparent, sodass die Neon-Cyan-BG durchscheint. Motiv: die großen
// AI-Marken (Tech-CEOs + Firmenlogos) als Marmor-Krieger im mythischen Kampf ums Top-3-Podium.
// Asset nativ 880×400, durabel in Vercel Blob. Zentriert das "synthszr/charts"-Wortmark
// (analog zum Post-Cover, das das synthszr-Logo aufs Cover legt — hier kleiner).
const BANNER_URL =
  'https://lbrzdn804nhy3kox.public.blob.vercel-storage.com/rankings/synthszr-charts-banner-2x.png'

export function RankingsBanner() {
  return (
    <div className="relative mb-5 overflow-hidden rounded-xl bg-[#00ffff]">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={BANNER_URL}
        alt="Synthszr Charts — die großen AI-Marken im Wettkampf ums Podium"
        width={880}
        height={400}
        loading="eager"
        className="block w-full max-w-[880px] mx-auto h-auto"
      />
      {/* Wortmark-Overlay: synthszr-Logo + /charts, zentriert, kleiner als auf dem Post-Cover */}
      <div className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center">
        <div className="flex items-end gap-1.5 drop-shadow-[0_2px_10px_rgba(0,0,0,0.6)]">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/synthszr-logo.svg" alt="Synthszr" className="h-8 w-auto sm:h-12" />
          <span className="font-bold leading-none text-white text-2xl sm:text-4xl">/charts</span>
        </div>
      </div>
    </div>
  )
}

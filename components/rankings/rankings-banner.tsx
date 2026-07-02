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
    <div className="relative mb-5 overflow-hidden rounded-xl bg-[#00ffb8]">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={BANNER_URL}
        alt="Synthszr Charts — die großen AI-Marken im Wettkampf ums Podium"
        width={880}
        height={400}
        loading="eager"
        className="block w-full max-w-[880px] mx-auto h-auto"
      />
      {/* Wortmark-Overlay: gestapeltes zweifarbiges Lockup — "synthszr" (dunkles Teal,
          kleiner) über "charts" (weiß, größer, leicht überlappend), fette Grotesk. */}
      <div className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center">
        <div
          className="flex flex-col items-center font-black leading-[0.8] tracking-tight drop-shadow-[0_2px_10px_rgba(0,0,0,0.3)]"
          style={{ fontFamily: 'var(--font-sf-pro)' }}
        >
          <span className="text-[#173d33] text-3xl sm:text-5xl">synthszr</span>
          <span className="-mt-[0.1em] text-white text-5xl sm:text-7xl">charts</span>
        </div>
      </div>
    </div>
  )
}

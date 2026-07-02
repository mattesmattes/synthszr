// Cover-Banner für alle Synthszr-Charts-Seiten. Gleiche Ästhetik wie die Post-Cover:
// hyper-fotorealistische griechische Marmorstatuen (Cover-Systemprompt) → Floyd-Steinberg-
// Dithering → white→transparent, sodass die Neon-Cyan-BG durchscheint. Motiv: die großen
// AI-Marken (Tech-CEOs + Firmenlogos) als Marmor-Krieger im mythischen Kampf ums Top-3-Podium.
// Asset nativ 880×400, durabel in Vercel Blob. Zentriert das "synthszr/charts"-Wortmark
// (analog zum Post-Cover, das das synthszr-Logo aufs Cover legt — hier kleiner).
const BANNER_URL =
  'https://lbrzdn804nhy3kox.public.blob.vercel-storage.com/rankings/synthszr-charts-banner-2x.png'
// Marken-Wortmark (aus ad-promo.svg extrahiert): "synthszr" dunkel-teal + "charts" weiß,
// korrekte Marken-Schrift, transparent — wird zentriert aufs Cover gelegt (wie im Vorbild).
const WORDMARK_URL =
  'https://lbrzdn804nhy3kox.public.blob.vercel-storage.com/rankings/synthszr-charts-wordmark.png'

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
      {/* Wortmark-Overlay: Marken-Wortmark aus ad-promo.svg, obere Bannerhälfte (wie im Vorbild). */}
      <div className="pointer-events-none absolute inset-x-0 top-[21%] z-10 flex justify-center">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={WORDMARK_URL}
          alt="synthszr charts"
          className="w-[32%] max-w-[280px] h-auto drop-shadow-[0_2px_10px_rgba(0,0,0,0.25)]"
        />
      </div>
    </div>
  )
}

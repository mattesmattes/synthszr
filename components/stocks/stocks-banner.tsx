/**
 * Hero-Banner der Stocks-Seiten. Baugleich zum Charts-Banner
 * (components/rankings/rankings-banner.tsx): das Motiv ist gedithert und Weiß
 * transparent, sodass die Flächenfarbe des Containers durchscheint. Beim
 * Charts-Banner ist das Neon-Grün, hier Neon-Cyan (--neon-cyan im
 * Design-System) — dieselbe Familie, unterscheidbarer Bereich.
 *
 * Motiv: Marmor-Bulle und -Bär vor Börsensäulen, erzeugt mit
 * scripts/_stocks_banner.ts durch dieselbe Dither-Pipeline wie die Post-Cover.
 *
 * WORTMARKE ALS TEXT, nicht als PNG: der Charts-Banner legt ein fertiges
 * Wortmark-Bild auf, für „stocks" existiert keines. Text mit der
 * Projektschrift skaliert schärfer, trägt den Dark Mode und lässt sich ohne
 * Bildbearbeitung ändern. „synthszr" dunkel-teal, „stocks" weiß — dieselbe
 * Aufteilung wie im Vorbild.
 */
const BANNER_URL =
  'https://lbrzdn804nhy3kox.public.blob.vercel-storage.com/stocks/synthszr-stocks-banner-2x.png'

export function StocksBanner() {
  return (
    <div className="relative mb-5 overflow-hidden rounded-xl bg-[#00ffff]">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={BANNER_URL}
        alt="Synthszr Stocks — Marmorner Bulle und Bär vor den Säulen der Börse"
        width={880}
        height={400}
        loading="eager"
        className="mx-auto block h-auto w-full max-w-[880px]"
      />
      <div className="pointer-events-none absolute inset-x-0 bottom-[8%] z-10 flex justify-center">
        <span className="text-[clamp(1.75rem,7vw,3.5rem)] font-bold leading-none tracking-tight drop-shadow-[0_2px_10px_rgba(0,0,0,0.25)]">
          <span className="text-[#0f5c56]">synthszr</span>
          <span className="ml-2 text-white">stocks</span>
        </span>
      </div>
    </div>
  )
}

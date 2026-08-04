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
 * AUF DAS MOTIV BESCHNITTEN (2026-08-04): das generierte Bild hatte 23% leere
 * Fläche oben und je ~13% links/rechts, gemessen an der Alpha-Bounding-Box —
 * durch die Transparenz schien dort nur das Cyan des Containers, das Motiv wirkte
 * verloren. Der Zuschnitt nimmt den leeren Rand weg und schneidet zusätzlich 90px
 * oben an, weil Bulle und Bär im Motiv tief sitzen und sonst eine Lücke über
 * ihnen bliebe. Ergebnis 1326x525 (2,53:1 statt 2,20:1) — das Layout verschiebt
 * sich kaum, das Motiv erscheint rund ein Drittel größer.
 *
 * NEUER DATEINAME statt Überschreiben: bei gleichbleibender URL liefern Browser
 * und CDN weiter die alte Datei aus.
 *
 * WORTMARKE ALS PNG (2026-08-04, war vorher Text): gesetzte Vorlage vom Nutzer,
 * damit die Marke exakt sitzt statt über Webfont-Metriken angenähert zu werden.
 * Damit ist der Banner nun in beiden Teilen baugleich zum Charts-Banner.
 *
 * Die Vorlage kam mit blauer Fläche; Alpha wurde aus der FARBDISTANZ zum
 * Hintergrund abgeleitet, nicht per Schwellenwert. Die Schriftkanten sind
 * antialiased, also Mischtöne — ein Schwellenwert hätte dort Treppen oder einen
 * blauen Saum hinterlassen. Mischpixel sind jetzt halbtransparent weiß und
 * sitzen deshalb sauber auf Neon-Cyan, obwohl die Vorlage blau war.
 */
const BANNER_URL =
  'https://lbrzdn804nhy3kox.public.blob.vercel-storage.com/stocks/synthszr-stocks-banner-fill-2x.png'

const WORDMARK_URL =
  'https://lbrzdn804nhy3kox.public.blob.vercel-storage.com/stocks/synthszr-stocks-wordmark-white.png'

export function StocksBanner() {
  return (
    <div className="relative mb-5 overflow-hidden rounded-xl bg-[#00ffff]">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={BANNER_URL}
        alt="Synthszr Stocks — Marmorner Bulle und Bär vor den Säulen der Börse"
        width={1326}
        height={525}
        loading="eager"
        className="mx-auto block h-auto w-full max-w-[880px]"
      />
      {/* Wortmark-Overlay, Größe wie beim Charts-Banner (32% der Bannerbreite) —
          dasselbe Verhältnis, in dem die Vorlage gesetzt war (478 von 1477px). */}
      <div className="pointer-events-none absolute inset-x-0 bottom-[8%] z-10 flex justify-center">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={WORDMARK_URL}
          alt="synthszr stocks"
          width={478}
          height={170}
          className="h-auto w-[32%] max-w-[280px] drop-shadow-[0_2px_10px_rgba(0,0,0,0.25)]"
        />
      </div>
    </div>
  )
}

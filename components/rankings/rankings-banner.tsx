// Cover-Banner für alle Synthszr-Charts-Seiten. Dithering-Halbton auf Neon-Cyan
// (gleiche Ästhetik wie die Post-Cover), Motiv: AI-Marken kämpfen ums Top-3-Podium.
// Bild generiert via gemini-3-pro-image + Cover-Pipeline, liegt durabel in Vercel Blob.
const BANNER_URL =
  'https://lbrzdn804nhy3kox.public.blob.vercel-storage.com/rankings/synthszr-charts-banner.png'

export function RankingsBanner() {
  return (
    <div className="mb-5 overflow-hidden rounded-xl bg-[#00ffff]">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={BANNER_URL}
        alt="Synthszr Charts — AI-Produkte im Wettkampf ums Podium"
        width={1584}
        height={672}
        loading="eager"
        className="block w-full h-[140px] sm:h-[200px] object-cover object-[center_28%]"
      />
    </div>
  )
}

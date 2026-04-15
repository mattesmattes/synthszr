import type { TipPromo } from '@/lib/tip-promos/types'
import { sanitizeAdminHtml } from '@/lib/security/sanitize-html'

interface TipPromoBoxProps {
  promo: TipPromo
  /** Render as an inline inline-ad within article flow (no outer margin). */
  inline?: boolean
}

/**
 * The "Tipp des Tages" box — a small text-only card with a configurable
 * gradient background, shown inside the first article of a post just
 * before the Synthszr Take. Typography inherits article body size.
 */
export function TipPromoBox({ promo, inline = false }: TipPromoBoxProps) {
  const gradient = `linear-gradient(${promo.gradient_direction}, ${promo.gradient_from}, ${promo.gradient_to})`
  const hasCta = promo.link_url && promo.cta_label
  const isExternal = promo.link_url?.startsWith('http')

  return (
    <div
      className={`rounded-xl px-4 py-3 ${inline ? 'my-4' : 'my-6'} text-center`}
      style={{ background: gradient, color: promo.text_color }}
    >
      <div className="font-bold tracking-widest uppercase text-xs mb-1">
        {promo.headline}
      </div>
      <div
        className="leading-snug"
        dangerouslySetInnerHTML={{ __html: sanitizeAdminHtml(promo.body) }}
      />
      {hasCta && (
        <a
          href={promo.link_url}
          target={isExternal ? '_blank' : undefined}
          rel={isExternal ? 'noopener noreferrer' : undefined}
          className="mt-2 inline-block text-sm font-semibold underline underline-offset-2 hover:opacity-80 transition-opacity"
          style={{ color: promo.text_color }}
        >
          {promo.cta_label}
        </a>
      )}
    </div>
  )
}

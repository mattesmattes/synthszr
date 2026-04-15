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

  const Content = (
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
      {promo.link_url && promo.cta_label && (
        <div
          className="mt-2 inline-block text-sm font-semibold underline underline-offset-2"
          style={{ color: promo.text_color }}
        >
          {promo.cta_label} →
        </div>
      )}
    </div>
  )

  if (!promo.link_url) return Content
  return (
    <a
      href={promo.link_url}
      className="block no-underline hover:opacity-95 transition-opacity"
      target={promo.link_url.startsWith('http') ? '_blank' : undefined}
      rel={promo.link_url.startsWith('http') ? 'noopener noreferrer' : undefined}
    >
      {Content}
    </a>
  )
}

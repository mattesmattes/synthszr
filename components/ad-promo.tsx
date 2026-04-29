import Link from 'next/link'
import { getActiveAdPromo } from '@/lib/ad-promos/get-active'
import type { AdPromo } from '@/lib/ad-promos/types'
import { sanitizeAdminHtml } from '@/lib/security/sanitize-html'

export async function AdPromo() {
  const promo = await getActiveAdPromo()
  if (!promo) return null
  return <AdPromoView promo={promo} />
}

export function AdPromoView({ promo }: { promo: AdPromo }) {
  const isSingle = promo.layout === 'single'
  return (
    <section className="mt-20">
      <Link
        href={promo.link_url}
        target="_blank"
        rel="noopener noreferrer"
        className="mx-auto block max-w-2xl overflow-hidden rounded-lg"
      >
        {isSingle ? (
          <div className="flex flex-col">
            {promo.image_left_url && (
              <div style={{ backgroundColor: promo.image_left_bg, width: '100%' }}>
                <img
                  src={promo.image_left_url}
                  alt={promo.title}
                  width={880}
                  height={880}
                  loading="lazy"
                  decoding="async"
                  className="block w-full"
                  style={{ mixBlendMode: 'multiply', maxWidth: 880, margin: '0 auto' }}
                />
              </div>
            )}
            <TextBlock promo={promo} />
          </div>
        ) : (
          <div className="grid grid-cols-2">
            {promo.image_left_url && (
              <div className="relative" style={{ backgroundColor: promo.image_left_bg }}>
                <img
                  src={promo.image_left_url}
                  alt={promo.title}
                  width={440}
                  height={440}
                  loading="lazy"
                  decoding="async"
                  className="block h-full w-full object-cover"
                  style={{ mixBlendMode: 'multiply' }}
                />
              </div>
            )}
            {promo.image_right_url && (
              <div style={{ backgroundColor: promo.image_right_bg }}>
                <img
                  src={promo.image_right_url}
                  alt={promo.title}
                  width={440}
                  height={440}
                  loading="lazy"
                  decoding="async"
                  className="block h-full w-full object-cover"
                  style={{ mixBlendMode: 'multiply' }}
                />
              </div>
            )}
            <div className="col-span-2">
              <TextBlock promo={promo} />
            </div>
          </div>
        )}
      </Link>
    </section>
  )
}

function TextBlock({ promo }: { promo: AdPromo }) {
  const text = promo.text_color
  return (
    <div
      className="flex flex-col justify-center p-6"
      style={{ backgroundColor: promo.text_bg, color: text }}
    >
      {promo.eyebrow && (
        <p
          className="font-mono text-[10px] font-medium uppercase tracking-wider"
          style={{ color: text, opacity: 0.5 }}
        >
          {promo.eyebrow}
        </p>
      )}
      <h2 className="mt-1 font-mono text-xl font-bold leading-tight" style={{ color: text }}>
        {promo.title}
      </h2>
      <p
        className="mt-3 text-sm leading-relaxed"
        style={{ fontFamily: 'var(--font-serif), serif', color: text, opacity: 0.7 }}
        dangerouslySetInnerHTML={{ __html: sanitizeAdminHtml(promo.body) }}
      />
      <span
        className="mt-4 inline-block font-mono text-xs font-semibold"
        style={{ color: text }}
      >
        {promo.cta_label}
      </span>
    </div>
  )
}

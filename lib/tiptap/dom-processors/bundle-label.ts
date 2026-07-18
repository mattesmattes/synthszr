// DOM processor: render a visible language-dependent label above bundled
// section headings ("Thema des Tages" / "Nachlese"), sourced from the
// `data-bundle-type` attribute the HeadingWithQueueId extension renders onto
// the H2 (see lib/tiptap/heading-with-queue-id.ts + lib/utils/markdown-to-tiptap.ts).

import { bundleLabel, type BundleType } from '@/lib/i18n/bundle-labels'

const BUNDLE_LABEL_CLASS = 'bundle-label-badge'

/**
 * Must run BEFORE processNewsHeadings(): that processor inserts a thumbnail
 * container immediately before the H2 and re-derives its own idempotency
 * from `h2.previousElementSibling` on every reprocessing pass. Inserting our
 * badge between the thumbnail and the heading would break that check and
 * cause duplicate thumbnails on re-render — so the badge goes in front of
 * the whole thumbnail block instead, and idempotency is tracked on the
 * heading itself (a dataset flag), not via sibling inspection.
 */
export function processBundleLabels(container: HTMLElement, locale: string): void {
  const headings = container.querySelectorAll<HTMLElement>('h2[data-bundle-type]')
  headings.forEach((heading) => {
    if (heading.dataset.bundleLabelProcessed) return

    const type = heading.getAttribute('data-bundle-type')
    if (type !== 'topic' && type !== 'recap') return

    const badge = document.createElement('div')
    badge.className = `${BUNDLE_LABEL_CLASS} inline-block mb-2 rounded-full bg-foreground px-3 py-1 text-[11px] font-bold uppercase tracking-wider text-background`
    badge.textContent = bundleLabel(type as BundleType, locale)
    heading.parentNode?.insertBefore(badge, heading)
    heading.dataset.bundleLabelProcessed = 'true'
  })
}

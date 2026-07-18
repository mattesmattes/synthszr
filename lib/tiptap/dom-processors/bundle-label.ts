// DOM processor: render a visible language-dependent label above bundled
// section headings ("Thema des Tages" / "Nachlese"), sourced from the
// `data-bundle-type` attribute the HeadingWithQueueId extension renders onto
// the H2 (see lib/tiptap/heading-with-queue-id.ts + lib/utils/markdown-to-tiptap.ts).

import { bundleLabel, type BundleType } from '@/lib/i18n/bundle-labels'

const BUNDLE_LABEL_CLASS = 'bundle-label-badge'

/**
 * Runs AFTER processNewsHeadings(): the badge is inserted directly before the
 * H2 — i.e. between the already-inserted thumbnail and the heading — so it
 * renders directly above the headline and below the thumbnail. That processor
 * now tracks thumbnail idempotency via a dataset flag on the H2 (not via
 * previousElementSibling), so the badge sitting between thumbnail and heading
 * no longer causes duplicate thumbnails on re-render. This processor's own
 * idempotency is the `bundleLabelProcessed` dataset flag below.
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

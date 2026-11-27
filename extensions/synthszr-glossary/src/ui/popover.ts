import type {
  ExtensionGlossaryTerm,
  SupportedLang,
  TermDetailResponse,
} from '../shared/types'
import { mountDitherIllustration } from './korn-animator'

interface PopoverHandlers {
  onRequestDetail: (slug: string, lang: SupportedLang) => Promise<TermDetailResponse>
  onRequestIllustration: (slug: string) => Promise<{ base64: string }>
  onPauseDomain: (hostname: string) => Promise<void>
}

const POPOVER_CSS = `
:host {
  all: initial;
  position: fixed;
  z-index: 2147483647;
  font-family: ui-sans-serif, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
  color-scheme: light dark;
}

.sg-card {
  width: min(390px, calc(100vw - 24px));
  max-height: min(540px, calc(100vh - 24px));
  display: flex;
  flex-direction: column;
  background: #ffffff;
  color: #111827;
  border: 1px solid #d4d4d8;
  border-radius: 10px;
  box-shadow: 0 20px 45px rgba(0, 0, 0, 0.22), 0 4px 12px rgba(0, 0, 0, 0.08);
  overflow: hidden;
  font-size: 13px;
  line-height: 1.5;
  animation: sg-in 110ms cubic-bezier(0.16, 1, 0.3, 1);
}

@media (prefers-color-scheme: dark) {
  .sg-card {
    background: #141416;
    color: #f4f4f5;
    border-color: #2e2e34;
    box-shadow: 0 24px 52px rgba(0, 0, 0, 0.55), 0 4px 14px rgba(0, 0, 0, 0.3);
  }
}

@keyframes sg-in {
  from {
    opacity: 0;
    transform: translateY(4px) scale(0.99);
  }
  to {
    opacity: 1;
    transform: translateY(0) scale(1);
  }
}

.sg-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 10px 14px;
  border-bottom: 1px solid #ececef;
  background: #fafafa;
}

@media (prefers-color-scheme: dark) {
  .sg-header {
    background: #1b1b1f;
    border-bottom-color: #27272c;
  }
}

.sg-brand {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: #52525b;
}

@media (prefers-color-scheme: dark) {
  .sg-brand {
    color: #a1a1aa;
  }
}

.sg-badge {
  display: inline-block;
  padding: 2px 6px;
  border-radius: 4px;
  background: #ccff00;
  color: #111111;
  font-weight: 800;
}

.sg-close {
  appearance: none;
  border: none;
  background: transparent;
  color: #71717a;
  cursor: pointer;
  width: 24px;
  height: 24px;
  border-radius: 6px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  font-size: 16px;
  line-height: 1;
}

.sg-close:hover {
  background: rgba(113, 113, 122, 0.14);
  color: #18181b;
}

@media (prefers-color-scheme: dark) {
  .sg-close:hover {
    color: #ffffff;
  }
}

.sg-body {
  padding: 14px;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.sg-illustration-wrap {
  display: flex;
  justify-content: center;
  align-items: center;
  padding: 4px 0 2px;
}

.sg-illustration-wrap[hidden] {
  display: none;
}

.sg-illustration-canvas {
  width: 196px;
  height: 196px;
  display: block;
  image-rendering: auto;
}

@media (prefers-color-scheme: dark) {
  .sg-illustration-canvas {
    filter: invert(1) brightness(0.92);
  }
}

.sg-title-row {
  display: flex;
  flex-direction: column;
  gap: 3px;
}

.sg-title {
  margin: 0;
  font-size: 16px;
  font-weight: 700;
  line-height: 1.25;
  letter-spacing: -0.01em;
}

.sg-surface-note {
  font-size: 11px;
  color: #71717a;
}

@media (prefers-color-scheme: dark) {
  .sg-surface-note {
    color: #a1a1aa;
  }
}

.sg-summary {
  margin: 0;
  font-size: 13px;
  font-weight: 500;
  color: #27272a;
  padding-left: 10px;
  border-left: 3px solid #ccff00;
}

@media (prefers-color-scheme: dark) {
  .sg-summary {
    color: #e4e4e7;
  }
}

.sg-paragraphs {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.sg-p {
  margin: 0;
  font-size: 12.5px;
  line-height: 1.55;
  color: #3f3f46;
}

@media (prefers-color-scheme: dark) {
  .sg-p {
    color: #d4d4d8;
  }
}

.sg-status {
  font-size: 11.5px;
  color: #71717a;
  font-style: italic;
}

.sg-section-label {
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: #71717a;
  margin-top: 2px;
}

.sg-chips {
  display: flex;
  flex-wrap: wrap;
  gap: 5px;
}

.sg-chip {
  appearance: none;
  border: 1px solid #e4e4e7;
  background: #f4f4f5;
  color: #18181b;
  border-radius: 5px;
  padding: 2px 7px;
  font-size: 11px;
  cursor: pointer;
}

.sg-chip:hover {
  border-color: #a3e635;
  background: rgba(204, 255, 0, 0.2);
}

@media (prefers-color-scheme: dark) {
  .sg-chip {
    background: #222227;
    border-color: #32323a;
    color: #e4e4e7;
  }
  .sg-chip:hover {
    background: rgba(204, 255, 0, 0.16);
    border-color: #ccff00;
  }
}

.sg-footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 10px 14px;
  border-top: 1px solid #ececef;
  background: #fafafa;
}

@media (prefers-color-scheme: dark) {
  .sg-footer {
    background: #1b1b1f;
    border-top-color: #27272c;
  }
}

.sg-pause-btn {
  appearance: none;
  border: none;
  background: transparent;
  color: #71717a;
  font-size: 11px;
  cursor: pointer;
  padding: 4px 2px;
  text-decoration: underline;
  text-underline-offset: 2px;
}

.sg-pause-btn:hover {
  color: #18181b;
}

@media (prefers-color-scheme: dark) {
  .sg-pause-btn:hover {
    color: #f4f4f5;
  }
}

.sg-cta {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  padding: 6px 10px;
  border-radius: 6px;
  background: #111111;
  color: #ccff00;
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
  font-size: 11px;
  font-weight: 700;
  text-decoration: none;
}

.sg-cta:hover {
  background: #27272a;
}

@media (prefers-color-scheme: dark) {
  .sg-cta {
    background: #ccff00;
    color: #111111;
  }
  .sg-cta:hover {
    background: #d9ff3b;
  }
}
`

const LABELS = {
  de: {
    brand: 'LEXIKON',
    matchedAs: 'Im Text als',
    loading: 'Lade vollständigen Eintrag…',
    offlineFallback: 'Detailansicht offline nicht verfügbar.',
    related: 'Verwandte Begriffe',
    pauseSite: 'Auf dieser Site pausieren',
    openFull: 'Im Lexikon öffnen ↗',
    closeAria: 'Schließen',
  },
  en: {
    brand: 'GLOSSARY',
    matchedAs: 'Matched as',
    loading: 'Loading full entry…',
    offlineFallback: 'Full entry unavailable offline.',
    related: 'Related terms',
    pauseSite: 'Pause on this site',
    openFull: 'Open in glossary ↗',
    closeAria: 'Close',
  },
} as const

export class GlossaryPopoverController {
  private host: HTMLElement | null = null
  private shadow: ShadowRoot | null = null
  private card: HTMLDivElement | null = null
  private stopIllustration: (() => void) | null = null
  private activeRequestToken = 0
  private readonly handlers: PopoverHandlers

  private readonly onKeyDown = (e: KeyboardEvent) => {
    if (e.key === 'Escape') this.close()
  }

  private readonly onOutsidePointerDown = (e: PointerEvent) => {
    if (!this.host) return
    if (e.target === this.host) return
    const path = e.composedPath?.() ?? []
    if (path.includes(this.host)) return
    this.close()
  }

  constructor(handlers: PopoverHandlers) {
    this.handlers = handlers
  }

  isOpen(): boolean {
    return this.host !== null
  }

  isEventInside(target: EventTarget | null): boolean {
    if (!this.host || !target) return false
    return target === this.host
  }

  open(
    term: ExtensionGlossaryTerm,
    matchedSurface: string,
    anchorRect: DOMRect,
    lang: SupportedLang,
  ): void {
    this.close()
    const requestToken = ++this.activeRequestToken
    const l = LABELS[lang]

    const host = document.createElement('synthszr-glossary-host')
    host.setAttribute('data-synthszr-ui', 'true')
    const shadow = host.attachShadow({ mode: 'closed' })

    let styledViaSheet = false
    if ('adoptedStyleSheets' in shadow && typeof CSSStyleSheet !== 'undefined') {
      try {
        const sheet = new CSSStyleSheet()
        sheet.replaceSync(POPOVER_CSS)
        shadow.adoptedStyleSheets = [sheet]
        styledViaSheet = true
      } catch {
        styledViaSheet = false
      }
    }
    if (!styledViaSheet) {
      const style = document.createElement('style')
      style.textContent = POPOVER_CSS
      shadow.appendChild(style)
    }

    const card = document.createElement('div')
    card.className = 'sg-card'
    card.setAttribute('role', 'dialog')
    card.setAttribute('aria-label', term.n)

    // Header
    const header = document.createElement('div')
    header.className = 'sg-header'

    const brand = document.createElement('div')
    brand.className = 'sg-brand'
    const badge = document.createElement('span')
    badge.className = 'sg-badge'
    badge.textContent = 'SYNTHSZR'
    const brandText = document.createElement('span')
    brandText.textContent = l.brand
    brand.append(badge, brandText)

    const closeBtn = document.createElement('button')
    closeBtn.type = 'button'
    closeBtn.className = 'sg-close'
    closeBtn.setAttribute('aria-label', l.closeAria)
    closeBtn.textContent = '×'
    closeBtn.addEventListener('click', () => this.close())

    header.append(brand, closeBtn)

    // Body
    const body = document.createElement('div')
    body.className = 'sg-body'

    const illustrationWrap = document.createElement('div')
    illustrationWrap.className = 'sg-illustration-wrap'
    illustrationWrap.hidden = true
    const illustrationCanvas = document.createElement('canvas')
    illustrationCanvas.className = 'sg-illustration-canvas'
    illustrationWrap.appendChild(illustrationCanvas)
    body.appendChild(illustrationWrap)

    const titleRow = document.createElement('div')
    titleRow.className = 'sg-title-row'

    const title = document.createElement('h2')
    title.className = 'sg-title'
    title.textContent = term.n
    titleRow.appendChild(title)

    if (matchedSurface.trim().toLowerCase() !== term.n.trim().toLowerCase()) {
      const note = document.createElement('div')
      note.className = 'sg-surface-note'
      note.textContent = `${l.matchedAs} „${matchedSurface}“`
      titleRow.appendChild(note)
    }
    body.appendChild(titleRow)

    const summaryEl = document.createElement('p')
    summaryEl.className = 'sg-summary'
    summaryEl.textContent = term.d || l.loading
    body.appendChild(summaryEl)

    const detailContainer = document.createElement('div')
    detailContainer.className = 'sg-paragraphs'
    const statusEl = document.createElement('div')
    statusEl.className = 'sg-status'
    statusEl.textContent = l.loading
    detailContainer.appendChild(statusEl)
    body.appendChild(detailContainer)

    // Footer
    const footer = document.createElement('div')
    footer.className = 'sg-footer'

    const pauseBtn = document.createElement('button')
    pauseBtn.type = 'button'
    pauseBtn.className = 'sg-pause-btn'
    pauseBtn.textContent = l.pauseSite
    pauseBtn.addEventListener('click', () => {
      const hostname = window.location.hostname
      this.close()
      if (hostname) void this.handlers.onPauseDomain(hostname)
    })

    const cta = document.createElement('a')
    cta.className = 'sg-cta'
    cta.href = `https://www.synthszr.com/${lang}/glossary/${encodeURIComponent(term.s)}`
    cta.target = '_blank'
    cta.rel = 'noopener noreferrer'
    cta.textContent = l.openFull

    footer.append(pauseBtn, cta)
    card.append(header, body, footer)
    shadow.appendChild(card)

    this.host = host
    this.shadow = shadow
    this.card = card

    this.positionHost(host, anchorRect)
    document.documentElement.appendChild(host)
    this.refineVerticalPlacement(host, anchorRect)

    document.addEventListener('keydown', this.onKeyDown, true)
    // Defer outside click binding so the opening click itself does not immediately close it
    setTimeout(() => {
      if (this.host === host) {
        document.addEventListener('pointerdown', this.onOutsidePointerDown, true)
      }
    }, 0)

    void this.loadTermDetail(
      term.s,
      lang,
      requestToken,
      illustrationWrap,
      illustrationCanvas,
      title,
      summaryEl,
      detailContainer,
      cta,
      anchorRect,
    )
  }

  private async loadTermDetail(
    slug: string,
    lang: SupportedLang,
    requestToken: number,
    illustrationWrap: HTMLElement,
    illustrationCanvas: HTMLCanvasElement,
    titleEl: HTMLElement,
    summaryEl: HTMLElement,
    detailContainer: HTMLElement,
    ctaEl: HTMLAnchorElement,
    anchorRect: DOMRect,
  ): Promise<void> {
    const l = LABELS[lang]
    try {
      const detail = await this.handlers.onRequestDetail(slug, lang)
      if (requestToken !== this.activeRequestToken || !this.host) return

      titleEl.textContent = detail.canonicalName
      if (detail.summary) {
        summaryEl.textContent = detail.summary
      }
      if (detail.url && detail.url.startsWith('https://')) {
        ctaEl.href = detail.url
      }

      if (detail.illustrationUrl) {
        void (async () => {
          try {
            const { base64 } = await this.handlers.onRequestIllustration(slug)
            if (requestToken !== this.activeRequestToken || !this.host) return

            illustrationCanvas.setAttribute('role', 'img')
            illustrationCanvas.setAttribute('aria-label', detail.illustrationAlt || detail.canonicalName)
            illustrationWrap.hidden = false
            this.refineVerticalPlacement(this.host, anchorRect)

            this.stopIllustration?.()
            this.stopIllustration = null
            const cleanup = await mountDitherIllustration(
              illustrationCanvas,
              base64,
              detail.animationParams,
            )
            if (requestToken !== this.activeRequestToken || !this.host) {
              cleanup()
              return
            }
            this.stopIllustration = cleanup
          } catch {
            if (requestToken === this.activeRequestToken) {
              illustrationWrap.hidden = true
            }
          }
        })()
      }

      detailContainer.replaceChildren()

      const paragraphs = detail.paragraphs.slice(0, 3)
      for (const text of paragraphs) {
        const p = document.createElement('p')
        p.className = 'sg-p'
        p.textContent = text
        detailContainer.appendChild(p)
      }

      if (detail.relatedTerms.length > 0) {
        const label = document.createElement('div')
        label.className = 'sg-section-label'
        label.textContent = l.related
        detailContainer.appendChild(label)

        const chips = document.createElement('div')
        chips.className = 'sg-chips'
        for (const rel of detail.relatedTerms.slice(0, 6)) {
          const btn = document.createElement('button')
          btn.type = 'button'
          btn.className = 'sg-chip'
          btn.textContent = rel.canonicalName
          btn.addEventListener('click', () => {
            this.open(
              { s: rel.slug, n: rel.canonicalName, d: '' },
              rel.canonicalName,
              anchorRect,
              lang,
            )
          })
          chips.appendChild(btn)
        }
        detailContainer.appendChild(chips)
      }

      this.refineVerticalPlacement(this.host, anchorRect)
    } catch {
      if (requestToken !== this.activeRequestToken || !this.host) return
      detailContainer.replaceChildren()
      const err = document.createElement('div')
      err.className = 'sg-status'
      err.textContent = l.offlineFallback
      detailContainer.appendChild(err)
    }
  }

  private positionHost(host: HTMLElement, rect: DOMRect): void {
    const maxWidth = Math.min(390, window.innerWidth - 24)
    const left = Math.max(12, Math.min(rect.left, window.innerWidth - maxWidth - 12))
    const top = Math.min(rect.bottom + 8, window.innerHeight - 160)

    host.style.left = `${Math.round(left)}px`
    host.style.top = `${Math.max(12, Math.round(top))}px`
  }

  private refineVerticalPlacement(host: HTMLElement, rect: DOMRect): void {
    if (!this.card) return
    const cardRect = this.card.getBoundingClientRect()
    const spaceBelow = window.innerHeight - rect.bottom - 12
    const spaceAbove = rect.top - 12

    if (cardRect.height > spaceBelow && spaceAbove > spaceBelow) {
      const aboveTop = Math.max(12, rect.top - cardRect.height - 8)
      host.style.top = `${Math.round(aboveTop)}px`
    } else if (rect.bottom + 8 + cardRect.height > window.innerHeight - 12) {
      const clampedTop = Math.max(12, window.innerHeight - cardRect.height - 12)
      host.style.top = `${Math.round(clampedTop)}px`
    }
  }

  close(): void {
    this.activeRequestToken++
    this.stopIllustration?.()
    this.stopIllustration = null
    document.removeEventListener('keydown', this.onKeyDown, true)
    document.removeEventListener('pointerdown', this.onOutsidePointerDown, true)
    if (this.host) {
      this.host.remove()
      this.host = null
      this.shadow = null
      this.card = null
    }
  }
}

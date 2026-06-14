/**
 * Partner-brand logo bar for the footer — matches the codecrash.ai footer.
 *
 * `h`/`w` are the OPTICAL box (px), tuned per logo so the marks read as visually
 * equal weight (not mathematically equal). Each logo is rendered as a CSS mask
 * filled with currentColor, so it inherits the footer's text colour (dark on
 * light pages) and all four marks read uniformly.
 */
const BRANDS = [
  { name: 'OH-SO', href: 'https://oh-so.com', logo: '/footer/logo-oh-so.png', h: 32, w: 41 },
  { name: 'RAIDAR', href: 'https://oh-so.com/raidar', logo: '/footer/logo-raidar.svg', h: 17, w: 82 },
  { name: 'CODE CRASH', href: 'https://codecrash.ai', logo: '/footer/codecrash-voxel.png', h: 46, w: 44 },
  { name: 'SYNTHSZR', href: 'https://www.synthszr.com', logo: '/footer/logo-synthszr.svg', h: 18, w: 80 },
]

function BrandLogo({ name, href, logo, h, w }: { name: string; href: string; logo: string; h: number; w: number }) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="flex min-h-[44px] shrink-0 items-center justify-center px-0 sm:px-1 text-foreground opacity-80 transition-opacity hover:opacity-100"
      aria-label={name}
    >
      <span
        aria-hidden
        style={{
          display: 'inline-block',
          height: h,
          width: w,
          backgroundColor: 'currentColor',
          WebkitMaskImage: `url(${logo})`,
          maskImage: `url(${logo})`,
          WebkitMaskRepeat: 'no-repeat',
          maskRepeat: 'no-repeat',
          WebkitMaskSize: 'contain',
          maskSize: 'contain',
          WebkitMaskPosition: 'center',
          maskPosition: 'center',
        }}
      />
    </a>
  )
}

export function FooterBrands() {
  return (
    <div className="flex flex-wrap items-center gap-x-6 gap-y-3 sm:gap-x-10">
      {BRANDS.map((b) => (
        <BrandLogo key={b.name} {...b} />
      ))}
    </div>
  )
}

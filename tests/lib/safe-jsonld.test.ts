import { describe, it, expect } from 'vitest'
import { safeJsonLd } from '@/lib/seo/site'

describe('safeJsonLd', () => {
  it('escapt "<" damit ein eingebettetes "</script>" den Script-Kontext nicht verlassen kann', () => {
    const malicious = { a: '</script><script>alert(1)</script>' }
    const out = safeJsonLd(malicious)
    expect(out).not.toContain('</script>')
    expect(JSON.parse(out)).toEqual(malicious)
  })

  it('bleibt für normale Objekte semantisch identisch (JSON.parse roundtrip)', () => {
    const normal = {
      '@context': 'https://schema.org',
      '@type': 'ItemList',
      name: 'Synthszr Charts',
      numberOfItems: 3,
      itemListElement: [
        { '@type': 'ListItem', position: 1, name: 'Foo', url: 'https://example.com/foo' },
      ],
    }
    expect(JSON.parse(safeJsonLd(normal))).toEqual(normal)
  })
})

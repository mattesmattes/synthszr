import { parseProductName, canonicalKey, productSlug } from '@/lib/rankings/canonicalize'
import { canonicalVendor } from '@/lib/rankings/vendor-canonical'

export interface ProductInsert {
  vendor_namespace: string
  family: string
  version: string | null
  qualifier: string | null
  canonical_name: string
  slug: string
  /** Nur zum Lookup — NICHT in den DB-Insert (products.canonical_key ist GENERATED). */
  canonical_key: string
}

/** Robuste Vendor-Namespace-Normalform: casefold + Sonderzeichen→'-' (konsistent zu slug). */
export function normalizeVendorNamespace(raw: string): string {
  return raw.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
}

/** Reine, deterministische Payload-Bildung. Wirft bei leerem Vendor/Name/family. */
export function buildProductInsert(vendor: string, detectedName: string): ProductInsert {
  const vendor_namespace = canonicalVendor(normalizeVendorNamespace(vendor))
  if (!vendor_namespace) throw new Error('buildProductInsert: vendor_namespace leer')
  const name = detectedName.trim()
  if (!name) throw new Error('buildProductInsert: detectedName leer')
  const parsed = parseProductName(name) // wirft selbst bei leerem Namen (Phase-0-guard)
  if (!parsed.family) throw new Error('buildProductInsert: family leer')
  return {
    vendor_namespace,
    family: parsed.family,
    version: parsed.version,
    qualifier: parsed.qualifier,
    canonical_name: name,
    slug: productSlug(vendor_namespace, parsed),
    canonical_key: canonicalKey(vendor_namespace, parsed),
  }
}

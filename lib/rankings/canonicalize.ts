/** Bekannte Produkt-Qualifier (Größen-/Varianten-Tiers), reihenfolge-unabhängig erkannt. */
const QUALIFIERS = new Set([
  'mini', 'nano', 'micro', 'small', 'medium', 'large', 'pro', 'max', 'plus',
  'turbo', 'flash', 'lite', 'air', 'ultra', 'preview', 'beta', 'alpha', 'rc',
  'experimental', 'opus', 'sonnet', 'haiku', 'earth', 'luna', 'instant',
  'thinking', 'vision',
])

/** Modell-Größen-Token wie 405b, 70b, 8b, 1.5b — identitätsrelevant, gelten als qualifier. */
const SIZE_TOKEN = /^\d+(?:\.\d+)?[bmk]$/i

export interface ParsedProduct {
  family: string
  version: string | null
  qualifier: string | null
}

/**
 * Zerlegt einen rohen Produktnamen deterministisch in {family, version, qualifier}.
 * Versionsnummer und Qualifier sind Teil der Produktidentität — Schreibvarianten
 * (Casing, Bindestriche, fehlende Leerzeichen) mergen, Versionen/Varianten nie.
 */
export function parseProductName(raw: string): ParsedProduct {
  const cleaned = raw.trim().replace(/_+/g, ' ').replace(/([a-zA-Z])(\d)/g, '$1 $2')
  const tokens = cleaned.split(/[\s\-/]+/).filter(Boolean)
  if (tokens.length === 0) throw new Error('parseProductName: leerer Produktname')

  let version: string | null = null
  const qualifiers: string[] = []
  const familyTokens: string[] = []

  for (const tok of tokens) {
    const low = tok.toLowerCase()
    if (SIZE_TOKEN.test(low)) { qualifiers.push(low); continue }       // 405b → qualifier (vor version!)
    const vMatch = low.match(/^v?(\d+(?:\.\d+)*[a-z]?)$/)               // 5.6, v3, 4o
    if (vMatch && version === null) { version = vMatch[1]; continue }
    if (QUALIFIERS.has(low)) { qualifiers.push(low); continue }
    familyTokens.push(low)
  }

  return {
    family: familyTokens.join(' ').trim(),
    version,
    qualifier: qualifiers.length ? qualifiers.join(' ') : null,
  }
}

/** Eindeutiger Identitäts-Anker. Vendor zuerst, damit generische Namen nicht kollidieren. */
export function canonicalKey(vendorNamespace: string, p: ParsedProduct): string {
  return `${vendorNamespace.toLowerCase()}@${p.family.toLowerCase()}@${p.version ?? ''}@${p.qualifier ?? ''}`
}

/** Permanenter, lesbarer URL-Slug — vendor-namespaced gegen Kollision generischer Namen. */
export function productSlug(vendorNamespace: string, p: ParsedProduct): string {
  return [vendorNamespace, p.family, p.version, p.qualifier]
    .filter(Boolean)
    .join(' ')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
}

/** Normalform für product_aliases.alias_normalized (vendor-scoped unique + Trigram-Lookup). */
export function normalizeAlias(raw: string): string {
  return raw.trim().toLowerCase().replace(/[\s\-_]+/g, ' ').trim()
}

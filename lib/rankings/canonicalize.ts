/** Bekannte Produkt-Qualifier, die auch VOR der Version stehen können
 *  (z.B. "Claude Opus 4.8"). Nach der Version stehende Tokens gelten ohnehin
 *  generisch als Qualifier (siehe parseProductName), daher muss dieses Set nur
 *  die pre-version-Tiers abdecken. */
const QUALIFIERS = new Set([
  'mini', 'nano', 'micro', 'small', 'medium', 'large', 'pro', 'max', 'plus',
  'turbo', 'flash', 'lite', 'air', 'ultra', 'preview', 'beta', 'alpha', 'rc',
  'experimental', 'opus', 'sonnet', 'haiku', 'earth', 'luna', 'instant',
  'thinking', 'vision',
])

/** Füllwörter, die nicht zur Produktidentität gehören (z.B. "5.2-Codex model"). */
const STOPWORDS = new Set(['model', 'modell', 'the'])

/** Modell-Größen-Token: 405b, 70b, 8b, 1.5b, 1.6t — identitätsrelevant → Qualifier. */
const SIZE_TOKEN = /^\d+(?:\.\d+)?[bmkt]$/i

export interface ParsedProduct {
  family: string
  version: string | null
  qualifier: string | null
}

/**
 * Zerlegt einen rohen Produktnamen deterministisch in {family, version, qualifier}.
 * Heuristik: family = Tokens VOR der ersten Versionsnummer (außer bekannte
 * pre-version-Qualifier); alles NACH der Version sowie Size-Token gilt als
 * Qualifier. So landen benannte Varianten ("GPT-5.6 Sol/Terra/Luna") konsistent
 * als Qualifier statt in der family. Schreibvarianten mergen, Versionen/Varianten nie.
 */
export function parseProductName(raw: string): ParsedProduct {
  // Unicode-Bindestriche (‑ – — etc.) auf ASCII-"-" normalisieren, damit der Split
  // sie trennt (LLMs liefern teils U+2011 statt "-"). Buchstabe→Ziffer nur bei ≥2
  // Buchstaben trennen ("GPT5.6"→"GPT 5.6"), damit kurze IDs wie "V4"/"M3" intakt bleiben.
  const cleaned = raw.trim()
    .replace(/[‐-―−]/g, '-')
    .replace(/_+/g, ' ')
    .replace(/([a-zA-Z]{2,})(\d)/g, '$1 $2')
  const tokens = cleaned.split(/[\s\-/]+/).filter(Boolean).filter(t => !STOPWORDS.has(t.toLowerCase()))
  if (tokens.length === 0) throw new Error('parseProductName: leerer Produktname')

  // Pass 1: Index der ersten echten Versionsnummer finden (Size-Token zählt nicht als Version).
  let version: string | null = null
  let versionIdx = -1
  for (let i = 0; i < tokens.length; i++) {
    const low = tokens[i].toLowerCase()
    if (SIZE_TOKEN.test(low)) continue
    const m = low.match(/^v?(\d+(?:\.\d+)*[a-z]?)$/) // 5.6, v3, 4o, v4
    if (m) { version = m[1]; versionIdx = i; break }
  }

  // Pass 2: Tokens zuordnen.
  const qualifiers: string[] = []
  const familyTokens: string[] = []
  tokens.forEach((tok, i) => {
    if (i === versionIdx) return
    const low = tok.toLowerCase()
    if (SIZE_TOKEN.test(low)) { qualifiers.push(low); return }
    if (QUALIFIERS.has(low)) { qualifiers.push(low); return }
    if (versionIdx >= 0 && i > versionIdx) { qualifiers.push(low); return } // nach der Version → Qualifier
    familyTokens.push(low) // vor der Version (oder gar keine Version) → family
  })

  // Fallback: kein family-Token (z.B. "Opus 4.5") → ersten Qualifier zur family
  // promoten, statt eine leere family zu erzeugen (DB-/Slug-Schutz).
  if (familyTokens.length === 0 && qualifiers.length > 0) {
    familyTokens.push(qualifiers.shift()!)
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

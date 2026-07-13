import { describe, it, expect, vi } from 'vitest'
import { enforceHeadingLength, sanitizeHeading } from '@/lib/claude/heading-length'

const LONG = 'SpaceX baut gemeinsam mit dem Coding-Startup Cursor ein neues Modell auf der Colossus-Infrastruktur auf' // 101
const SHORT = 'SpaceX baut mit Cursor Coding-Modell' // 36

describe('sanitizeHeading', () => {
  it('entfernt führende Markdown-Hashes', () => {
    expect(sanitizeHeading('## Nvidia stellt Nemotron vor')).toBe('Nvidia stellt Nemotron vor')
  })
  it('entfernt umschließende Anführungszeichen', () => {
    expect(sanitizeHeading('"Cloudflare stellt Crawlern Abrufe in Rechnung"')).toBe('Cloudflare stellt Crawlern Abrufe in Rechnung')
    expect(sanitizeHeading('»OpenAI sucht Produktmanager«')).toBe('OpenAI sucht Produktmanager')
  })
  it('nimmt nur die erste nicht-leere Zeile und trimmt', () => {
    expect(sanitizeHeading('  Zhipu bringt GLM-5.2\n\nblabla erklärung')).toBe('Zhipu bringt GLM-5.2')
  })
})

describe('enforceHeadingLength', () => {
  const section = (h: string) => `## ${h}\n\nDies ist der Fließtext des Abschnitts. Er bleibt unverändert.`

  it('lässt kurze Überschriften unangetastet und ruft shorten NICHT auf', async () => {
    const shorten = vi.fn()
    const input = section(SHORT)
    const out = await enforceHeadingLength(input, shorten)
    expect(out).toBe(input)
    expect(shorten).not.toHaveBeenCalled()
  })

  it('kürzt lange Überschriften: shorten wird mit dem Heading-Text aufgerufen und die Zeile ersetzt', async () => {
    const shorten = vi.fn(async () => SHORT)
    const out = await enforceHeadingLength(section(LONG), shorten)
    expect(shorten).toHaveBeenCalledWith(LONG)
    expect(out).toBe(section(SHORT))
    // Body unverändert
    expect(out).toContain('Dies ist der Fließtext des Abschnitts. Er bleibt unverändert.')
  })

  it('säubert das shorten-Ergebnis (kein doppeltes ## / keine Quotes)', async () => {
    const shorten = vi.fn(async () => `## "${SHORT}"`)
    const out = await enforceHeadingLength(section(LONG), shorten)
    expect(out).toBe(section(SHORT))
    expect(out).not.toContain('####')
    expect(out).not.toContain('"')
  })

  it('behält das Original, wenn shorten nicht kürzt (gleich lang oder länger)', async () => {
    const notShorter = LONG + ' extra'
    const shorten = vi.fn(async () => notShorter)
    const input = section(LONG)
    const out = await enforceHeadingLength(input, shorten)
    expect(out).toBe(input)
  })

  it('behält das Original, wenn shorten leer zurückkommt', async () => {
    const shorten = vi.fn(async () => '   ')
    const input = section(LONG)
    expect(await enforceHeadingLength(input, shorten)).toBe(input)
  })

  it('behält das Original (non-fatal), wenn shorten wirft', async () => {
    const shorten = vi.fn(async () => { throw new Error('API down') })
    const input = section(LONG)
    expect(await enforceHeadingLength(input, shorten)).toBe(input)
  })

  it('gibt die Section unverändert zurück, wenn keine ##-Überschrift existiert', async () => {
    const shorten = vi.fn()
    const input = 'Kein Heading, nur Text der zufällig sehr lang ist ' + 'x'.repeat(80)
    const out = await enforceHeadingLength(input, shorten)
    expect(out).toBe(input)
    expect(shorten).not.toHaveBeenCalled()
  })

  it('ersetzt nur die erste ##-Zeile (die Überschrift), nicht spätere', async () => {
    const input = `## ${LONG}\n\nText.\n\n## Zwischenzeile bleibt`
    const shorten = vi.fn(async () => SHORT)
    const out = await enforceHeadingLength(input, shorten)
    expect(out).toBe(`## ${SHORT}\n\nText.\n\n## Zwischenzeile bleibt`)
  })

  it('respektiert eine benutzerdefinierte maxLen', async () => {
    const shorten = vi.fn(async () => 'kurz')
    // 40-Zeichen-Heading, maxLen 20 → muss kürzen
    const h = 'Ein vierzig Zeichen langer Titeltext hier'
    expect(h.length).toBeGreaterThan(20)
    const out = await enforceHeadingLength(section(h), shorten, 20)
    expect(shorten).toHaveBeenCalled()
    expect(out).toBe(section('kurz'))
  })
})

/**
 * Server-taugliche Markdown→TipTap-Konvertierung.
 *
 * PROD-BEFUND 2026-08-09: Die Wrap-up-Route benutzte markdownToTiptap aus
 * lib/utils/markdown-to-tiptap.ts und scheiterte mit
 *   "[tiptap error]: there is no window object available"
 * TipTaps generateJSON() ruft elementFromString(), das ein DOM braucht. Die
 * Funktion ist eine CLIENT-Funktion; alle anderen Aufrufer sind
 * die Admin-Seiten unter app/admin.
 *
 * Die Server-Variante existierte bereits, lag aber modul-privat in
 * lib/article-jobs/service.ts — ein Artikel-Job-Modul, aus dem die Wrap-up-Route
 * nichts importieren sollte. Deshalb hier ein eigenes Modul, das beide teilen.
 *
 * Diese Tests laufen in environment: 'node' (vitest.config.ts) — genau der
 * Umgebung, in der die Client-Variante wirft. Ein bestandener Test beweist
 * damit tatsaechlich die Servertauglichkeit.
 */
import { describe, expect, it } from 'vitest'
import { markdownToTiptapServer } from '@/lib/utils/markdown-to-tiptap-server'

describe('markdownToTiptapServer', () => {
  it('konvertiert Markdown ohne window-Objekt', async () => {
    const json = await markdownToTiptapServer('## Überschrift\n\nEin Absatz.')
    expect(json.type).toBe('doc')
    const nodes = json.content as Array<Record<string, unknown>>
    expect(nodes[0].type).toBe('heading')
    expect(nodes[1].type).toBe('paragraph')
  })

  it('behaelt den Ueberschriftentext', async () => {
    const json = await markdownToTiptapServer('## Montag — Alibaba stellt Qwen vor\n\nText.')
    const heading = (json.content as Array<Record<string, unknown>>)[0]
    const text = ((heading.content ?? []) as Array<{ text?: string }>)[0]?.text
    expect(text).toContain('Alibaba stellt Qwen vor')
  })

  it('uebernimmt data-bundle-type-Marker als bundleType-Attribut', async () => {
    // Gleiche Zusicherung wie in der Client-Variante: der HTML-Kommentar
    // ueberlebt die DOM-Parse nicht und wird als Attribut nachgetragen.
    const json = await markdownToTiptapServer('## Thema <!-- data-bundle-type:topic -->\n\nText.')
    const heading = (json.content as Array<Record<string, unknown>>)[0]
    expect((heading.attrs as Record<string, unknown>).bundleType).toBe('topic')
  })

  it('normalisiert Anfuehrungszeichen auf deutsche Typografie', async () => {
    const json = await markdownToTiptapServer('Er sagte "Hallo".')
    const para = (json.content as Array<Record<string, unknown>>)[0]
    const text = ((para.content ?? []) as Array<{ text?: string }>)[0]?.text ?? ''
    expect(text).toMatch(/[„"]/)
    expect(text).not.toContain('"Hallo"')
  })

  it('verkraftet leeres Markdown', async () => {
    const json = await markdownToTiptapServer('')
    expect(json.type).toBe('doc')
  })
})

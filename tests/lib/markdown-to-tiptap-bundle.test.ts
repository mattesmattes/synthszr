import { describe, expect, it } from 'vitest'
import { extractBundleMarkers, applyBundleMarkers } from '@/lib/utils/markdown-to-tiptap'

const U1 = '11111111-1111-4111-8111-111111111111'
const U2 = '22222222-2222-4222-8222-222222222222'

describe('extractBundleMarkers', () => {
  it('strips the marker from the heading line and records its ordinal + type', () => {
    const md = '## Foo <!-- data-bundle-type:topic -->\n\ntext\n\n## Bar\n\nmore\n\n## Baz <!-- data-bundle-type:recap -->'
    const { cleaned, markers } = extractBundleMarkers(md)
    expect(cleaned).not.toContain('data-bundle-type')
    expect(cleaned).toContain('## Foo')
    expect(cleaned).toContain('## Baz')
    expect([...markers.entries()]).toEqual([
      [0, { bundleType: 'topic' }],
      [2, { bundleType: 'recap' }],
    ])
  })

  it('leaves markdown without markers untouched (no headings mutated)', () => {
    const md = '## Normal heading\n\ntext'
    const { cleaned, markers } = extractBundleMarkers(md)
    expect(cleaned).toBe(md)
    expect(markers.size).toBe(0)
  })

  // Regression: die vorherige Fassung matchte nur (topic|recap) wörtlich —
  // "deep_dive" (seit 2026-08-13) und "cover_story" (seit 2026-09-13) wurden
  // dadurch nie erkannt: der Marker blieb als HTML-Kommentar in der Zeile
  // stehen und verschwand beim Parsen kommentarlos, ohne bundleType zu setzen.
  it('recognizes multi-word bundle types (deep_dive, cover_story), not just topic/recap', () => {
    const md = '## Foo <!-- data-bundle-type:deep_dive -->\n\ntext\n\n## Bar <!-- data-bundle-type:cover_story -->'
    const { cleaned, markers } = extractBundleMarkers(md)
    expect(cleaned).not.toContain('data-bundle-type')
    expect([...markers.entries()]).toEqual([
      [0, { bundleType: 'deep_dive' }],
      [1, { bundleType: 'cover_story' }],
    ])
  })

  // BEFUND 2026-10-06: Die alte Regex war mit `$` ans Zeilenende gebunden und
  // matchte bei zwei Kommentaren auf einer Zeile gar nicht mehr (Karte C,
  // Fallstrick 1). Beide Reihenfolgen müssen denselben Marker ergeben.
  // Die dritte Zeile hält die bewusste Toleranz fest: Vertrag 2.5 schreibt die
  // Kommentare ans Zeilenende, der Extraktor durchsucht aber die ganze Zeile —
  // schiebt ein Proofread-LLM Text hinter den Kommentar, darf der Kommentar
  // trotzdem nicht im Überschriftentext landen.
  it('sammelt mehrere data-Kommentare einer Heading-Zeile ein, Reihenfolge und Position egal', () => {
    const md = [
      `## Foo <!-- data-bundle-type:topic --> <!-- data-queue-item-ids:${U1},${U2} -->`,
      '',
      'text',
      '',
      `## Bar <!-- data-queue-item-ids:${U2},${U1} --><!-- data-bundle-type:recap -->`,
      '',
      '## Mitte <!-- data-curation-tier:bench --> Text dahinter',
    ].join('\n')
    const { cleaned, markers } = extractBundleMarkers(md)
    expect(cleaned.split('\n')[0]).toBe('## Foo')
    expect(cleaned.split('\n')[4]).toBe('## Bar')
    expect(cleaned.split('\n')[6]).toBe('## Mitte Text dahinter')
    expect(cleaned).not.toContain('<!--')
    expect(markers.get(0)).toEqual({ bundleType: 'topic', queueItemIds: [U1, U2] })
    expect(markers.get(1)).toEqual({ bundleType: 'recap', queueItemIds: [U2, U1] })
    expect(markers.get(2)).toEqual({ curationTier: 'bench' })
  })

  it('akzeptiert queue-item-ids, rank und tier ohne bundle-type (Einzelabschnitt im Kurations-Draft)', () => {
    const md = `## Solo <!-- data-queue-item-ids:${U1} --> <!-- data-curation-rank:3 --> <!-- data-curation-tier:bench -->\n\ntext`
    const { cleaned, markers } = extractBundleMarkers(md)
    expect(cleaned.split('\n')[0]).toBe('## Solo')
    expect(markers.get(0)).toEqual({ queueItemIds: [U1], curationRank: 3, curationTier: 'bench' })
    expect(markers.get(0)?.bundleType).toBeUndefined()
  })

  // Quux sichert zwei Entscheidungen ab: `3x` muss abgewiesen werden (ein
  // parseInt+isNaN-Check hätte 3 gesetzt), und ein ungültiger Kommentar darf den
  // gültigen auf derselben Zeile nicht mitreißen. Corge prüft, dass auch ein
  // Schlüssel mit Großbuchstaben/Ziffer/Unterstrich (vom LLM verfälscht) aus dem
  // Text verschwindet, statt erst im DOM-Parser stumm verworfen zu werden.
  it('entfernt unbekannte Schlüssel und ungültige Werte aus dem Text, setzt nur gültige Felder', () => {
    const md = [
      '## Foo <!-- data-foo:bar -->',
      '## Bar <!-- data-curation-tier:unknown_tier -->',
      '## Baz <!-- data-curation-rank:abc -->',
      '## Qux <!-- data-bundle-type:TOPIC -->',
      '## Quux <!-- data-curation-rank:3x --> <!-- data-bundle-type:topic -->',
      '## Corge <!-- data-Foo_1:x -->',
    ].join('\n\n')
    const { cleaned, markers } = extractBundleMarkers(md)
    expect(cleaned).toBe('## Foo\n\n## Bar\n\n## Baz\n\n## Qux\n\n## Quux\n\n## Corge')
    expect([...markers.entries()]).toEqual([[4, { bundleType: 'topic' }]])
  })

  // Ein Proofread-LLM setzt gern Leerzeichen nach dem Komma; ein leerer Wert
  // darf nicht als Kommentar im Überschriftentext stehen bleiben.
  it('normalisiert Whitespace im Wert und entfernt leere Marker ohne Eintrag', () => {
    const md = `## Foo <!-- data-queue-item-ids: ${U1}, ${U2} -->\n\n## Bar <!-- data-queue-item-ids: -->`
    const { cleaned, markers } = extractBundleMarkers(md)
    expect(cleaned).toBe('## Foo\n\n## Bar')
    expect(markers.get(0)).toEqual({ queueItemIds: [U1, U2] })
    expect(markers.has(1)).toBe(false)
  })

  // BEFUND 2026-10-06: queueItemId landet in get_winner_similarity
  // (supabase/migrations/20260601000000_assisted_ranking.sql:58) in einem harten
  // `::uuid`-Cast — EIN verstümmelter Wert in einem veröffentlichten Post lässt
  // den ganzen RPC scheitern. Deshalb nur UUID-förmige IDs übernehmen; eine
  // großgeschriebene UUID wird kleingeschrieben, weil Postgres UUIDs klein
  // ausgibt und die Ground Truth (Task 10/11) per String-Vergleich matcht.
  it('übernimmt nur UUID-förmige IDs und schreibt sie klein', () => {
    const md = [
      `## A <!-- data-queue-item-ids:${U1},abc,${U2.toUpperCase()} -->`,
      '## B <!-- data-queue-item-ids:not-a-uuid -->',
      `## C <!-- data-queue-item-ids:1234,${U2} -->`,
    ].join('\n\n')
    const { cleaned, markers } = extractBundleMarkers(md)
    expect(cleaned).toBe('## A\n\n## B\n\n## C')
    expect(markers.get(0)).toEqual({ queueItemIds: [U1, U2] })
    expect(markers.has(1)).toBe(false)
    expect(markers.get(2)).toEqual({ queueItemIds: [U2] })
  })

  // Doppelte Schlüssel auf einer Zeile kommen nur durch ein verwirrtes
  // Proofread-LLM zustande. Regel: der letzte GÜLTIGE Wert gewinnt, ein
  // ungültiger überschreibt nichts.
  it('bei doppeltem Schlüssel gewinnt der letzte gültige Wert', () => {
    const md = [
      '## A <!-- data-bundle-type:topic --> <!-- data-bundle-type:recap -->',
      '## B <!-- data-bundle-type:topic --> <!-- data-bundle-type:TOPIC -->',
    ].join('\n\n')
    const { cleaned, markers } = extractBundleMarkers(md)
    expect(cleaned).toBe('## A\n\n## B')
    expect(markers.get(0)).toEqual({ bundleType: 'recap' })
    expect(markers.get(1)).toEqual({ bundleType: 'topic' })
  })

  it('zählt nur Heading-Zeilen; Kommentare in Absätzen bleiben stehen', () => {
    const md = '## Foo\n\ntext <!-- data-bundle-type:topic -->'
    const { cleaned, markers } = extractBundleMarkers(md)
    expect(cleaned).toBe(md)
    expect(markers.size).toBe(0)
  })

  // BEFUND 2026-10-06: `# kommentar` in einem Code-Fence wurde als Heading
  // gezählt, wird in TipTap aber ein codeBlock — ab dort verrutschte das
  // Ordinal, und applyBundleMarkers schrieb die IDs von B auf C. Seit
  // queueItemIds die Ground Truth speist (Task 10, member_ids), ist das ein
  // Datenfehler, kein Schönheitsfehler. Der Fence-Inhalt bleibt unverändert.
  it('überspringt Zeilen in Code-Fences (``` und ~~~) beim Zählen und Bereinigen', () => {
    const md = [
      '```inline``` am Zeilenanfang ist kein Fence',
      `## A <!-- data-queue-item-ids:${U1} -->`,
      '```bash',
      '# shell comment <!-- data-bundle-type:topic -->',
      '```',
      `## B <!-- data-queue-item-ids:${U2} -->`,
      '~~~~',
      '# noch ein Kommentar',
      '~~~',
      '~~~~',
      '## C <!-- data-bundle-type:recap -->',
    ].join('\n')
    const { cleaned, markers } = extractBundleMarkers(md)
    expect(cleaned.split('\n')[3]).toBe('# shell comment <!-- data-bundle-type:topic -->')
    expect([...markers.entries()]).toEqual([
      [0, { queueItemIds: [U1] }],
      [1, { queueItemIds: [U2] }],
      [2, { bundleType: 'recap' }],
    ])
  })
})

describe('applyBundleMarkers', () => {
  it('sets bundleType attr on the Nth heading node, leaves others untouched', () => {
    const json = {
      type: 'doc',
      content: [
        { type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: 'Foo' }] },
        { type: 'paragraph', content: [{ type: 'text', text: 'x' }] },
        { type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: 'Bar' }] },
      ],
    }
    applyBundleMarkers(json, new Map([[1, { bundleType: 'recap' as const }]]))
    const headings = (json.content as Array<{ type: string; attrs?: Record<string, unknown> }>).filter((n) => n.type === 'heading')
    expect(headings[0].attrs?.bundleType).toBeUndefined()
    expect(headings[0].attrs?.queueItemId).toBeUndefined()
    expect(headings[1].attrs?.bundleType).toBe('recap')
    expect(headings[1].attrs?.queueItemIds).toBeUndefined()
  })

  it('schreibt alle fünf Attrs als Strings; queueItemId = erste ID', () => {
    const json = {
      type: 'doc',
      content: [
        { type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: 'Foo' }] },
      ],
    }
    applyBundleMarkers(
      json,
      new Map([[0, { bundleType: 'topic' as const, queueItemIds: [U1, U2], curationRank: 3, curationTier: 'held' as const }]]),
    )
    const attrs = (json.content[0] as { attrs?: Record<string, unknown> }).attrs
    expect(attrs).toEqual({
      level: 2,
      bundleType: 'topic',
      queueItemId: U1,
      queueItemIds: `${U1},${U2}`,
      curationRank: '3',
      curationTier: 'held',
    })
  })

  it('ist no-op bei leerer Map', () => {
    const json = {
      type: 'doc',
      content: [{ type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: 'Foo' }] }],
    }
    applyBundleMarkers(json, new Map())
    expect((json.content[0] as { attrs?: Record<string, unknown> }).attrs).toEqual({ level: 2 })
  })
})

// markdownToTiptap() itself calls @tiptap/core's generateJSON(), which hard-
// requires a `window` object (elementFromString) — it only runs in a browser
// or jsdom-with-window context, never under vitest's `environment: 'node'`
// (same reason lib/article-jobs/service.ts built a separate jsdom+prosemirror
// markdownToTiptapServer() for cron/server contexts — see the comment there).
// That's a pre-existing constraint of the function, not something this task
// changes. We prove the round trip the same way the production pipeline
// actually exercises it: marked → jsdom DOM → prosemirror DOMParser (the
// exact machinery markdownToTiptapServer uses), using the SAME shared
// extractBundleMarkers/applyBundleMarkers helpers markdownToTiptap calls.
describe('data-bundle-type round trip (jsdom + prosemirror, mirrors markdownToTiptapServer)', () => {
  it('converts the marker into a bundleType heading attribute and strips it from visible text', async () => {
    const { marked } = await import('marked')
    const { getSchema } = await import('@tiptap/core')
    const { DOMParser: PMDOMParser } = await import('@tiptap/pm/model')
    const StarterKit = (await import('@tiptap/starter-kit')).default
    const Link = (await import('@tiptap/extension-link')).default
    const { HeadingWithQueueId } = await import('@/lib/tiptap/heading-with-queue-id')
    const { JSDOM } = await import('jsdom')

    const md = `## Thema-Bündel <!-- data-bundle-type:topic --> <!-- data-queue-item-ids:${U1},${U2} -->\n\nInhalt.\n\n## Normale Überschrift\n\nmehr Inhalt.`
    const { cleaned, markers } = extractBundleMarkers(md)
    const html = marked.parse(cleaned, { async: false }) as string
    const schema = getSchema([
      StarterKit.configure({ heading: false }),
      HeadingWithQueueId.configure({ levels: [1, 2, 3, 4, 5, 6] }),
      Link.configure({ openOnClick: false }),
    ])
    const dom = new JSDOM(`<body>${html}</body>`)
    const json = PMDOMParser.fromSchema(schema).parse(dom.window.document.body).toJSON() as {
      content: Array<{ type: string; attrs?: Record<string, unknown>; content?: Array<{ text?: string }> }>
    }
    applyBundleMarkers(json, markers)

    const headings = json.content.filter((n) => n.type === 'heading')
    expect(headings).toHaveLength(2)
    expect(headings[0].attrs?.bundleType).toBe('topic')
    expect(headings[0].attrs?.queueItemId).toBe(U1)
    expect(headings[0].attrs?.queueItemIds).toBe(`${U1},${U2}`)
    expect(headings[0].content?.map((t) => t.text).join('')).toBe('Thema-Bündel')
    expect(headings[1].attrs?.bundleType).toBeFalsy()
    expect(headings[1].attrs?.queueItemId).toBeFalsy()
  })
})

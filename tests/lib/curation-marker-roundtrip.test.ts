/**
 * Marker-Roundtrip Pipeline → Konverter → Editor-Save → extractPublishedUnits.
 *
 * WARUM: Spec-Risiko „Marker geht im Editor verloren" (Gegenmaßnahme laut
 * Spec: Roundtrip-Test Markdown→TipTap→Editor-Save→extractPublishedUnits).
 * Tasks 7, 8 und 9 testen jeweils nur ihr Teilstück, Task 10 füttert
 * extractPublishedUnits mit handgebautem JSON. Bricht ein Glied der Kette —
 * Pipeline setzt den Kommentar anders, Konverter liest ihn nicht, Extension
 * deklariert ein Attr nicht, Extraktor liest das falsche Attr —, ist der
 * Final Cut in published_units unsichtbar, ohne dass ein Einzeltest rot wird.
 *
 * „Editor-Save" = schema.nodeFromJSON(json).toJSON(): genau das passiert in
 * components/tiptap-editor.tsx bzw. tiptap-editor-with-patterns.tsx bei
 * `setContent(content)` + `editor.getJSON()` (onUpdate). Undeklarierte attrs
 * verwirft ProseMirror dabei (BEFUND 2026-10-06, Task 8). Placeholder,
 * GlossaryLinkMark und PatternHighlightMark aus dem Editor-Satz fassen den
 * Heading-Knoten nicht an und fehlen deshalb im Test-Schema.
 * „DB" = JSON.stringify: generated_posts.content ist TEXT (Vertrag 0).
 */
import { describe, expect, it } from 'vitest'
import { getSchema } from '@tiptap/core'
import StarterKit from '@tiptap/starter-kit'
import Link from '@tiptap/extension-link'
import { HeadingWithQueueId } from '@/lib/tiptap/heading-with-queue-id'
import { ensureBundleMarker, ensureQueueIdMarker } from '@/lib/claude/ghostwriter-pipeline'
import { markdownToTiptapServer } from '@/lib/utils/markdown-to-tiptap-server'
import { extractPublishedUnits } from '@/scripts/lib/taste-ground-truth'

const A = '11111111-1111-4111-8111-111111111111'
const B = '22222222-2222-4222-8222-222222222222'
const C = '33333333-3333-4333-8333-333333333333'
const D = '44444444-4444-4444-8444-444444444444'
const E = '55555555-5555-4555-8555-555555555555'

// Gleicher Extension-Satz wie der Admin-Editor (Heading-relevant) und
// markdownToTiptapServer.
const schema = getSchema([
  StarterKit.configure({ heading: false }),
  HeadingWithQueueId.configure({ levels: [1, 2, 3, 4, 5, 6] }),
  Link.configure({ openOnClick: false }),
])

/** Editor öffnen und speichern: setContent(json) → getJSON(). */
function editorSave(json: Record<string, unknown>): Record<string, unknown> {
  return schema.nodeFromJSON(json).toJSON() as Record<string, unknown>
}

describe('Marker-Roundtrip Pipeline → Konverter → Editor-Save → extractPublishedUnits', () => {
  // Abschnitte so, wie die Pipeline sie nach Task 9 ausgibt: Bündel mit
  // ensureBundleMarker(ensureQueueIdMarker(…)) (writeBundleSection), Einzel
  // nur mit ensureQueueIdMarker (writeSection). Die Nachlese setzt die Helfer
  // in umgekehrter Reihenfolge (Backstop-Fall: Typ stand schon, IDs kommen
  // nach) — beide Reihenfolgen müssen dieselben Attrs ergeben.
  const sections = [
    ensureBundleMarker(ensureQueueIdMarker('## Thema des Tages\n\nErster Bündel-Absatz.\n\nZweiter Absatz.', [A, B]), 'topic'),
    ensureQueueIdMarker('## Nvidia meldet Zahlen\n\nNvidia-Absatz.', [C]),
    ensureQueueIdMarker(ensureBundleMarker('## Nachlese der Woche\n\nNachlese-Absatz.', 'recap'), [D, E]),
    // Review-Fokus 1: Abschnitt ohne jeden Marker (Altpost-Form).
    '## Alter Abschnitt\n\nOhne Marker.',
  ]
  const markdown = sections.join('\n\n')

  it('alle Member-IDs in Reihenfolge, bundleType und Text überleben die ganze Kette', async () => {
    const converted = await markdownToTiptapServer(markdown)
    const stored = JSON.stringify(editorSave(converted))

    expect(stored).not.toContain('data-queue-item-ids')
    expect(stored).not.toContain('data-bundle-type')
    expect(extractPublishedUnits(stored)).toEqual([
      { position: 0, heading: 'Thema des Tages', bundleType: 'topic', memberIds: [A, B], firstParagraph: 'Erster Bündel-Absatz.' },
      { position: 1, heading: 'Nvidia meldet Zahlen', bundleType: null, memberIds: [C], firstParagraph: 'Nvidia-Absatz.' },
      { position: 2, heading: 'Nachlese der Woche', bundleType: 'recap', memberIds: [D, E], firstParagraph: 'Nachlese-Absatz.' },
      { position: 3, heading: 'Alter Abschnitt', bundleType: null, memberIds: [], firstParagraph: 'Ohne Marker.' },
    ])
  })

  it('queueItemId bleibt nach dem Editor-Save die ERSTE ID (Kompatibilität extractQueueItemIds/get_winner_similarity)', async () => {
    const saved = editorSave(await markdownToTiptapServer(markdown))
    const headings = (saved.content as Array<{ type: string; attrs?: Record<string, unknown> }>)
      .filter((n) => n.type === 'heading')
    expect(headings.map((n) => [n.attrs?.queueItemId ?? null, n.attrs?.queueItemIds ?? null])).toEqual([
      [A, `${A},${B}`],
      [C, C],
      [D, `${D},${E}`],
      [null, null],
    ])
  })

  it('ein zweites Öffnen und Speichern im Editor ändert nichts (idempotent)', async () => {
    const once = editorSave(await markdownToTiptapServer(markdown))
    const twice = editorSave(once)
    expect(twice).toEqual(once)
    expect(extractPublishedUnits(twice)).toEqual(extractPublishedUnits(once))
  })
})

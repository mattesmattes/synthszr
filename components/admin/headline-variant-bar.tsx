'use client'

import { useEffect, useState, useCallback } from 'react'
import type { Editor } from '@tiptap/react'
import { Button } from '@/components/ui/button'

interface Props {
  editor: Editor | null
  /** Für das Protokoll der Wahl. Fehlt sie, wird nur getauscht, nicht gemeldet. */
  postId?: string
}

interface AktiveUeberschrift {
  /** Dokumentposition des heading-Knotens — zum Ersetzen des Textes. */
  pos: number
  /** Der Text, der gerade dasteht. */
  text: string
  varianten: string[]
  queueItemId: string | null
}

/**
 * Die Überschriften-Auswahl, OBEN im Editor (Betreiber-Vorgabe 2026-08-16).
 *
 * Bewusst eine Leiste und kein Popover am Text: Eine Überschrift wird beim
 * Schreiben ständig angeklickt, um den Cursor zu setzen. Ein Popover, das
 * dabei jedes Mal aufspringt, macht das Bearbeiten unbrauchbar — deshalb steht
 * die Auswahl fest oben und zeigt die Vorschläge zu der Überschrift, in der
 * der Cursor gerade steht.
 *
 * Sie erscheint NUR, wenn der Cursor in einer Überschrift mit Vorschlägen
 * steht. Bei allen anderen Absätzen bleibt die Zeile leer statt einen leeren
 * Rahmen zu zeigen.
 */
export function HeadlineVariantBar({ editor, postId }: Props) {
  const [aktiv, setAktiv] = useState<AktiveUeberschrift | null>(null)
  const [gesamt, setGesamt] = useState(0)

  // Bei jeder Cursorbewegung prüfen, ob wir in einer Überschrift mit
  // Vorschlägen stehen. `$from.node(d)` läuft die Knotentiefen hoch — der
  // Cursor sitzt im Textknoten, die Attribute hängen am heading darüber.
  const pruefen = useCallback(() => {
    if (!editor) return setAktiv(null)

    // Wie viele Überschriften im Dokument überhaupt Vorschläge haben. Ohne
    // diese Zahl ist das Feature unsichtbar: Steht der Cursor im Fließtext,
    // zeigt die Leiste nichts, und man kann nicht wissen, dass es etwas zu
    // sehen gäbe. (Dieselbe Falle wie bei den Bündel-Knöpfen daneben, die
    // ebenfalls nur bei aktiver H2 erscheinen.)
    let mitVorschlaegen = 0
    editor.state.doc.forEach((node) => {
      if (node.type.name === 'heading' && Array.isArray(node.attrs.headlineAlts)) mitVorschlaegen++
    })
    setGesamt(mitVorschlaegen)

    const { $from } = editor.state.selection
    for (let d = $from.depth; d > 0; d--) {
      const node = $from.node(d)
      if (node.type.name !== 'heading') continue
      const alts = node.attrs.headlineAlts
      if (!Array.isArray(alts) || alts.length < 2) return setAktiv(null)
      return setAktiv({
        pos: $from.before(d),
        text: node.textContent,
        varianten: alts as string[],
        queueItemId: (node.attrs.queueItemId as string) ?? null,
      })
    }
    setAktiv(null)
  }, [editor])

  useEffect(() => {
    if (!editor) return
    editor.on('selectionUpdate', pruefen)
    editor.on('transaction', pruefen)
    pruefen()
    return () => {
      editor.off('selectionUpdate', pruefen)
      editor.off('transaction', pruefen)
    }
  }, [editor, pruefen])

  const waehlen = useCallback(
    (index: number) => {
      if (!editor || !aktiv) return
      const neu = aktiv.varianten[index]
      if (neu === aktiv.text) return

      const node = editor.state.doc.nodeAt(aktiv.pos)
      if (!node) return

      // Nur den Textinhalt tauschen, den Knoten samt Attributen behalten:
      // queueItemId, bundleType und die Vorschlagsliste müssen die Auswahl
      // überleben, sonst ist sie einmalig und nicht umkehrbar.
      editor
        .chain()
        .focus()
        .insertContentAt(
          { from: aktiv.pos + 1, to: aktiv.pos + 1 + node.content.size },
          neu,
        )
        .run()

      // Protokoll ist Beiwerk: Der Tausch ist bereits passiert, ein
      // fehlgeschlagener Aufruf darf die Arbeit nicht stören.
      if (postId) {
        fetch('/api/admin/headline-choice', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            postId,
            queueItemId: aktiv.queueItemId,
            variants: aktiv.varianten,
            chosenIndex: index,
          }),
        }).catch(() => {})
      }
    },
    [editor, aktiv, postId],
  )

  // Cursor steht nicht in einer Überschrift mit Vorschlägen — aber es gibt
  // welche im Dokument. Dann ist ein Hinweis nötig, sonst bleibt das Feature
  // unentdeckt.
  if (!aktiv) {
    if (gesamt === 0) return null
    return (
      <div className="border-b bg-muted/30 px-3 py-1.5 text-[11px] text-muted-foreground">
        {gesamt} {gesamt === 1 ? 'Überschrift hat' : 'Überschriften haben'} Vorschläge —
        Cursor in eine Überschrift setzen, um sie zu sehen.
      </div>
    )
  }

  // Welche Variante steht gerade? Über den Text, nicht über einen gespeicherten
  // Index: der Betreiber kann die Überschrift auch von Hand ändern, dann ist
  // keine mehr aktiv — und genau das soll die Leiste dann auch zeigen.
  const aktiverIndex = aktiv.varianten.findIndex((v) => v === aktiv.text)

  const sorte = ['journalistisch', 'Pointe aus dem Take', 'Insight im Widerspruch']

  return (
    <div className="border-b bg-muted/30 px-3 py-2">
      <div className="mb-1.5 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
        Überschrift wählen
        {aktiverIndex === -1 && (
          <span className="ml-2 normal-case font-normal">
            (aktuell von Hand geändert — ein Klick ersetzt sie)
          </span>
        )}
      </div>
      <div className="flex flex-col gap-1">
        {aktiv.varianten.map((v, i) => {
          const ist = i === aktiverIndex
          return (
            <Button
              key={i}
              type="button"
              variant={ist ? 'secondary' : 'ghost'}
              size="sm"
              onClick={() => waehlen(i)}
              disabled={ist}
              className="h-auto justify-start whitespace-normal py-1.5 text-left"
            >
              <span className="mr-2 shrink-0 text-[10px] uppercase tracking-wide text-muted-foreground">
                {/* Die Sortenbezeichnung stimmt nur, wenn die Liste die drei
                    erzeugten Varianten sind. Steht der Ersetzungs-Schalter auf
                    aus, ist Index 0 die alte Überschrift und alles verschiebt
                    sich um eins — das fängt die Länge ab. */}
                {aktiv.varianten.length === 3 ? sorte[i] : i === 0 ? 'bisher' : sorte[i - 1] ?? ''}
              </span>
              <span className="flex-1">{v}</span>
              <span className="ml-2 shrink-0 tabular-nums text-[10px] text-muted-foreground">
                {v.length}
              </span>
            </Button>
          )
        })}
      </div>
    </div>
  )
}

import { GLOSSARY_MAX_PER_ARTICLE } from '@/lib/glossary/types'
import { matchNameInText } from '@/lib/glossary/mentions'
import type { GlossaryMatcherTerm } from '@/lib/glossary/types'

const MARK_TYPE = 'glossaryLink'

type Node = Record<string, unknown>

function hasMark(node: Node, type: string): boolean {
  return Array.isArray(node.marks) &&
    node.marks.some((m) => (m as { type?: string }).type === type)
}

/** Entfernt alle glossaryLink-Marks — Grundlage der Idempotenz. */
function stripMarks(node: unknown): unknown {
  if (!node || typeof node !== 'object') return node
  const o = { ...(node as Node) }
  if (Array.isArray(o.marks)) {
    const kept = o.marks.filter((m) => (m as { type?: string }).type !== MARK_TYPE)
    if (kept.length > 0) o.marks = kept
    else delete o.marks
  }
  if (Array.isArray(o.content)) o.content = o.content.map(stripMarks)
  return o
}

/**
 * Schreibt glossaryLink-Marks für die bestätigten Slugs in das TipTap-JSON.
 *
 * Idempotent: bestehende Marks werden zuerst entfernt und neu gesetzt. Damit
 * ist mehrfaches Speichern unschädlich, und nach einer Übersetzung genügt ein
 * erneuter Lauf mit der übersetzten Begriffsliste — die Marks müssen nicht
 * durch die Übersetzung getragen werden.
 *
 * Pro Begriff wird nur die erste Erwähnung verlinkt, insgesamt maximal
 * GLOSSARY_MAX_PER_ARTICLE Begriffe. Text, der schon eine `link`-Mark trägt
 * (Quellenlink) oder bereits Company-/Produkt-verlinkt ist, wird übersprungen.
 */
export function injectGlossaryMarks(
  content: unknown,
  slugs: string[],
  terms: GlossaryMatcherTerm[],
  opts: { reserved?: string[] } = {},
): unknown {
  const cleaned = stripMarks(content)
  // `reserved` sind Company- und Chart-Produktnamen. Die Kollisionsregel kann
  // NICHT über eine bestehende Mark geprüft werden: die Produkt- und
  // Company-Verlinkung läuft client-seitig im DOM, im gespeicherten JSON
  // existiert dafür keine Mark. Also wird die Namensliste übergeben.
  const reserved = new Set((opts.reserved ?? []).map((n) => n.toLowerCase()))
  const wanted = terms
    .filter((t) => slugs.includes(t.slug))
    .filter((t) => !reserved.has(t.canonicalName.toLowerCase()))
    .slice(0, GLOSSARY_MAX_PER_ARTICLE)
  if (wanted.length === 0) return cleaned

  const done = new Set<string>()

  const walk = (node: unknown): unknown => {
    if (!node || typeof node !== 'object') return node
    const o = node as Node

    if (typeof o.text === 'string') {
      // Quellenlinks gewinnen — in einen bestehenden <a> darf kein zweiter
      // Link geschachtelt werden.
      if (hasMark(o, 'link')) return o

      for (const term of wanted) {
        if (done.has(term.slug)) continue
        const names = [term.canonicalName, ...term.aliases]
          .sort((a, b) => b.length - a.length)
        for (const name of names) {
          const pos = matchNameInText(o.text as string, name)
          if (!pos) continue
          done.add(term.slug)
          const before = (o.text as string).slice(0, pos.start)
          const hit = (o.text as string).slice(pos.start, pos.end)
          const after = (o.text as string).slice(pos.end)
          const baseMarks = Array.isArray(o.marks) ? o.marks : []
          const parts: Node[] = []
          if (before) parts.push({ ...o, text: before })
          parts.push({
            ...o,
            text: hit,
            marks: [...baseMarks, { type: MARK_TYPE, attrs: { slug: term.slug } }],
          })
          if (after) {
            // Der Rest kann selbst wieder aufgeteilt werden (weiterer Begriff
            // im selben Textknoten) — dann liefert walk() ein Array statt
            // eines einzelnen Knotens. Gespreadet statt verschachtelt, sonst
            // bleibt `parts` nach mehreren kaskadierten Splits mehrstufig
            // verschachtelt und das äußere `.flat()` (Tiefe 1) reicht nicht.
            const rest = walk({ ...o, text: after })
            if (Array.isArray(rest)) parts.push(...(rest as Node[]))
            else parts.push(rest as Node)
          }
          return parts
        }
      }
      return o
    }

    if (Array.isArray(o.content)) {
      // flat(), weil ein Textknoten zu mehreren Knoten aufgeteilt werden kann.
      return { ...o, content: o.content.map(walk).flat() }
    }
    return o
  }

  return walk(cleaned)
}

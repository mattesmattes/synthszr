/**
 * Sampler der Tagesregie: wählt je Achse Optionen aus dem Katalog, ohne
 * Modell, deterministisch aus Datum, Post und Historie.
 *
 * Regeln (die „Spreizung"):
 * - Eine Option ist für `cooldown` Folgen gesperrt, nachdem sie dran war.
 * - Unter den freien Optionen gewinnt die, die in den letzten 14 Folgen am
 *   seltensten dran war (geteilt durch ihr Gewicht); so kommt jede Option
 *   regelmäßig vor, keine dominiert.
 * - Gleichstand entscheidet ein Zufall mit festem Seed (Datum + Post): Wer
 *   dasselbe Skript am selben Tag neu erzeugt, bekommt dieselbe Regie, nur
 *   die konkrete Ausgestaltung durch den Regisseur kann anders ausfallen.
 */
import { REGIE_AXES, type AxisId } from '@/lib/podcast/regie/catalog'

export type RegiePicks = Record<AxisId, string[]>

export interface RegieHistoryEntry {
  /** YYYY-MM-DD des Posts. */
  date: string
  postId: string
  picks: RegiePicks
}

export interface RegieCoordinates {
  date: string
  postId: string
  picks: RegiePicks
}

const WINDOW = 14

function hash(s: string): number {
  let h = 2166136261
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return h >>> 0
}

/** mulberry32, klein und reproduzierbar. */
function rng(seed: number): () => number {
  let a = seed
  return () => {
    a |= 0
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/**
 * @param history neueste Folge zuerst; ein Eintrag zum selben Post (Neu-Erzeugung) zählt nicht.
 */
export function sampleRegie(history: RegieHistoryEntry[], ctx: { date: string; postId: string }): RegieCoordinates {
  const past = history.filter((h) => h.postId !== ctx.postId).slice(0, WINDOW)
  const random = rng(hash(`${ctx.date}|${ctx.postId}`))
  const picks = {} as RegiePicks

  for (const ax of REGIE_AXES) {
    const blocked = new Set(past.slice(0, ax.cooldown).flatMap((h) => h.picks?.[ax.id] ?? []))
    let free = ax.options.filter((opt) => !blocked.has(opt.id))
    if (free.length < ax.pick) free = [...ax.options]

    const scored = free.map((opt) => {
      const uses = past.filter((h) => (h.picks?.[ax.id] ?? []).includes(opt.id)).length
      return { id: opt.id, score: uses / (opt.weight ?? 1), tie: random() }
    })
    scored.sort((a, b) => a.score - b.score || a.tie - b.tie)
    picks[ax.id] = scored.slice(0, ax.pick).map((s) => s.id)
  }

  return { date: ctx.date, postId: ctx.postId, picks }
}

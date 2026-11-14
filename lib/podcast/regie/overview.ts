/**
 * Ansicht der Tagesregie für das Podcast Studio (Betreiber 2026-11-15: „Ist
 * die Tonalität, die am Ende des Tages gewählt wird, transparent?“).
 *
 * Reine Funktion über Historie, Katalog und optional einer Vorschau: welche
 * Regie die letzten Folgen hatten (mit Plan des Regisseurs, Fingerabdruck,
 * Texturergebnis und Artikel-Echos, soweit gespeichert), wie oft jede Option
 * zuletzt dran war, was für die nächste Folge gesperrt ist und was die
 * Ziehung für den ausgewählten Post ergäbe. Anzeige auf Deutsch; die Stimmen
 * selbst (Tonalität v2) sind fest und stehen nicht im Katalog.
 */
import { REGIE_AXES, option, type AxisId } from '@/lib/podcast/regie/catalog'
import { regieAxisStates, type RegieCoordinates, type RegieHistoryEntry } from '@/lib/podcast/regie/sampler'
import type { RegieFill } from '@/lib/podcast/regie/director'
import type { WornOut } from '@/lib/podcast/fingerprint'

export const AXIS_NAMES_DE: Record<AxisId, string> = {
  dramaturgy: 'Form',
  temperature: 'Temperatur',
  devices: 'Stilmittel',
  imagery: 'Bildwelt',
  segment: 'Segment vor dem Schluss',
  coarseness: 'Derbheit',
  ending: 'Schluss',
}

export type LabeledPicks = Partial<Record<AxisId, string[]>>

export interface RegieOverviewEntry {
  date: string
  postId: string
  title: string | null
  createdAt: string | null
  picks: LabeledPicks
  directed: boolean | null
  fill: RegieFill | null
  worn: WornOut | null
  texture: { applied: boolean; problems: string[] } | null
  echoes: string[]
  /** Eintrag von vor dem 2026-11-15: nur die gezogenen Werte, keine Details. */
  legacy: boolean
}

export interface RegieOverview {
  lang: 'de' | 'en'
  axes: Array<{
    id: AxisId
    name: string
    pick: number
    cooldown: number
    options: Array<{ id: string; label: string; text: string; weight: number; uses: number; blocked: boolean }>
  }>
  history: RegieOverviewEntry[]
  preview: { postId: string; title: string | null; date: string; picks: LabeledPicks } | null
}

/** Gezogene Werte als deutsche Bezeichnungen, in Katalog-Reihenfolge. */
export function labelPicks(picks: Partial<Record<AxisId, string[]>>): LabeledPicks {
  const out: LabeledPicks = {}
  for (const ax of REGIE_AXES) {
    const ids = picks[ax.id]
    if (ids?.length) out[ax.id] = ids.map((id) => option(ax.id, id)?.label.de ?? id)
  }
  return out
}

export function buildRegieOverview(input: {
  lang: 'de' | 'en'
  history: RegieHistoryEntry[]
  preview?: (RegieCoordinates & { title?: string | null }) | null
}): RegieOverview {
  const states = regieAxisStates(input.history, input.preview?.postId)
  const axes = REGIE_AXES.map((ax) => {
    const state = states.find((s) => s.id === ax.id)
    return {
      id: ax.id,
      name: AXIS_NAMES_DE[ax.id],
      pick: ax.pick,
      cooldown: ax.cooldown,
      options: ax.options.map((opt) => {
        const st = state?.options.find((o) => o.id === opt.id)
        return {
          id: opt.id,
          label: opt.label.de,
          text: opt.text.de,
          weight: opt.weight ?? 1,
          uses: st?.uses ?? 0,
          blocked: st?.blocked ?? false,
        }
      }),
    }
  })

  const history = input.history.map((h): RegieOverviewEntry => {
    const legacy = h.directed === undefined && h.fill === undefined && h.texture === undefined
    return {
      date: h.date,
      postId: h.postId,
      title: h.title ?? null,
      createdAt: h.createdAt ?? null,
      picks: labelPicks(h.picks ?? {}),
      directed: h.directed ?? null,
      fill: h.fill ?? null,
      worn: h.worn ?? null,
      texture: h.texture ?? null,
      echoes: h.echoes ?? [],
      legacy,
    }
  })

  const preview = input.preview
    ? { postId: input.preview.postId, title: input.preview.title ?? null, date: input.preview.date, picks: labelPicks(input.preview.picks) }
    : null

  return { lang: input.lang, axes, history, preview }
}

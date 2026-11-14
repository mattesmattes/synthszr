/**
 * Die Tagesregie als Prompt-Abschnitt (an den User-Prompt des Skripts
 * angehängt, wie Einstieg/Schluss und Smalltalk).
 */
import { REGIE_AXES, SWEARING_LIMITS, axis, option, type AxisId, type Lang } from '@/lib/podcast/regie/catalog'
import type { RegieCoordinates } from '@/lib/podcast/regie/sampler'
import type { RegieFill } from '@/lib/podcast/regie/director'

function texts(coords: RegieCoordinates, id: AxisId, lang: Lang): string[] {
  return coords.picks[id].map((pid) => option(id, pid)?.text[lang] ?? pid)
}

function label(id: AxisId, pid: string, lang: Lang): string {
  return option(id, pid)?.label[lang] ?? pid
}

/** Die Anweisung zur Sprache des Tages, auch für den Texturdurchgang. */
export function coarsenessInstruction(coords: RegieCoordinates, lang: Lang): string {
  return `${texts(coords, 'coarseness', lang).join(' ')} ${SWEARING_LIMITS[lang]}`
}

export function renderRegieSection(coords: RegieCoordinates, fill: RegieFill | null, lang: Lang): string {
  const devices = coords.picks.devices
  const notToday = axis('devices').options.filter((opt) => !devices.includes(opt.id)).map((opt) => opt.label[lang])
  const imagery = texts(coords, 'imagery', lang)
  const deviceLines = devices.map((pid, i) => `  ${i + 1}. ${option('devices', pid)?.text[lang] ?? pid}`).join('\n')

  if (lang === 'de') {
    let s = `\n\n**REGIE DIESER FOLGE (gilt nur heute; geht den allgemeinen Vorgaben oben vor, wo sie sich unterscheiden):**
- Form der Folge: ${texts(coords, 'dramaturgy', lang).join(' ')}
- Temperatur: ${texts(coords, 'temperature', lang).join(' ')}
- Stilmittel heute (genau diese, jedes einmal, außer die Beschreibung sagt etwas anderes):
${deviceLines}
- Heute NICHT: ${notToday.join(', ')}.
- Vergleiche kommen heute aus ${imagery.join(' und ')}.
- Vor dem Schluss: ${texts(coords, 'segment', lang).join(' ')}
- Sprache: ${coarsenessInstruction(coords, lang)}`
    if (fill) {
      s += `\n- Konkreter Plan:`
      if (fill.fight) s += `\n  - Hauptstreit: ${fill.fight.story}: ${fill.fight.conflict}`
      for (const r of fill.rants) s += `\n  - Emmas Ausbruch gegen ${r.target} (${r.story}): ${r.charge}`
      for (const d of fill.devicePlans) s += `\n  - ${label('devices', d.device, lang)}: ${d.story}: ${d.idea}`
      if (fill.quickStories.length) s += `\n  - Kurz abhandeln: ${fill.quickStories.join('; ')}`
      if (fill.segmentPlan) s += `\n  - Vor dem Schluss: ${fill.segmentPlan}`
    }
    s += `\nDas sind Regieanweisungen, keine Zeilen: frischen Dialog schreiben, diese Worte nie übernehmen.`
    return s
  }

  let s = `\n\n**TODAY'S DIRECTION (applies to this episode only; it overrides the general guidance above where they differ):**
- Shape of the episode: ${texts(coords, 'dramaturgy', lang).join(' ')}
- Temperature: ${texts(coords, 'temperature', lang).join(' ')}
- Devices today (exactly these, each once unless its description says otherwise):
${deviceLines}
- NOT today: ${notToday.join(', ')}.
- Comparisons today come from ${imagery.join(' and ')}.
- Before the ending: ${texts(coords, 'segment', lang).join(' ')}
- Language: ${coarsenessInstruction(coords, lang)}`
  if (fill) {
    s += `\n- Concrete plan:`
    if (fill.fight) s += `\n  - Main argument: ${fill.fight.story}: ${fill.fight.conflict}`
    for (const r of fill.rants) s += `\n  - Emma's rant at ${r.target} (${r.story}): ${r.charge}`
    for (const d of fill.devicePlans) s += `\n  - ${label('devices', d.device, lang)}: ${d.story}: ${d.idea}`
    if (fill.quickStories.length) s += `\n  - Keep short: ${fill.quickStories.join('; ')}`
    if (fill.segmentPlan) s += `\n  - Before the ending: ${fill.segmentPlan}`
  }
  s += `\nThese are directions, not lines: write fresh dialogue and never copy these words.`
  return s
}

/**
 * Die heutigen Stilmittel für den Texturdurchgang, mit dem Plan des
 * Regisseurs: Der Durchgang soll sie weder als Pointe ausdünnen noch als
 * Wiederholung ersetzen (ein Spitzname läuft absichtlich durch die Folge).
 */
export function textureDeviceNotes(coords: RegieCoordinates, fill: RegieFill | null, lang: Lang): string[] {
  return coords.picks.devices.map((pid) => {
    const opt = option('devices', pid)
    const base = opt ? `${opt.label[lang]}: ${opt.text[lang]}` : pid
    const plan = fill?.devicePlans.find((d) => d.device === pid)
    return plan ? `${base} (${lang === 'de' ? 'heute' : 'today'}: ${plan.idea})` : base
  })
}

/** Alle Achsen-IDs, für Tests und die Admin-Anzeige. */
export const AXIS_IDS = REGIE_AXES.map((a) => a.id)

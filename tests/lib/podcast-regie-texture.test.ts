/**
 * Tagesregie, Fingerabdruck, Texturdurchgang und Explicit-Kennzeichnung
 * (Betreiber 2026-11-14): Abwechslung von Folge zu Folge, ohne die feste
 * Verfassung des Skripts (Marker, Zahlen, Begrüßung, Format) anzutasten.
 */
import { describe, expect, it } from 'vitest'
import { REGIE_AXES } from '@/lib/podcast/regie/catalog'
import { sampleRegie, type RegieHistoryEntry } from '@/lib/podcast/regie/sampler'
import { withEntry } from '@/lib/podcast/regie/history'
import { buildDirectorPrompt, parseRegieFill } from '@/lib/podcast/regie/director'
import { coarsenessInstruction, renderRegieSection, textureDeviceNotes } from '@/lib/podcast/regie/render'
import { computeWornOut, wornSection } from '@/lib/podcast/fingerprint'
import { articleEchoes, buildTexturePrompt, numbersIn, quotesFromMoments, recurringNames, splitMomentsSection, stripPreamble, validateTexture } from '@/lib/podcast/texture-pass'
import { containsExplicitLanguage } from '@/lib/podcast/explicit'

function run(days: number): RegieHistoryEntry[] {
  let h: RegieHistoryEntry[] = []
  for (let d = 1; d <= days; d++) {
    const date = `2026-12-${String(d).padStart(2, '0')}`
    const c = sampleRegie(h, { date, postId: `post-${d}` })
    h = withEntry(h, { date, postId: `post-${d}`, picks: c.picks })
  }
  return h.reverse() // älteste zuerst
}

describe('Sampler der Tagesregie', () => {
  it('ist deterministisch für Datum, Post und Historie', () => {
    const a = sampleRegie([], { date: '2026-11-14', postId: 'x' })
    const b = sampleRegie([], { date: '2026-11-14', postId: 'x' })
    expect(a.picks).toEqual(b.picks)
  })

  it('wählt je Achse die richtige Anzahl gültiger Optionen', () => {
    const c = sampleRegie([], { date: '2026-11-14', postId: 'x' })
    for (const ax of REGIE_AXES) {
      expect(c.picks[ax.id]).toHaveLength(ax.pick)
      for (const id of c.picks[ax.id]) expect(ax.options.map((o) => o.id)).toContain(id)
      expect(new Set(c.picks[ax.id]).size).toBe(ax.pick)
    }
  })

  it('wiederholt keine Dramaturgie innerhalb von drei Folgen und bringt jede binnen einer Woche', () => {
    const h = run(14)
    const forms = h.map((e) => e.picks.dramaturgy[0])
    for (let i = 3; i < forms.length; i++) expect(forms.slice(i - 3, i)).not.toContain(forms[i])
    expect(new Set(forms.slice(0, 7)).size).toBe(7)
  })

  it('wiederholt kein Stilmittel aus den zwei vorigen Folgen', () => {
    const h = run(10)
    for (let i = 2; i < h.length; i++) {
      const recent = new Set([...h[i - 1].picks.devices, ...h[i - 2].picks.devices])
      for (const d of h[i].picks.devices) expect(recent.has(d)).toBe(false)
    }
  })

  it('eine Neu-Erzeugung zum selben Post zählt nicht als Vorgänger', () => {
    const first = sampleRegie([], { date: '2026-11-14', postId: 'x' })
    const again = sampleRegie([{ date: '2026-11-14', postId: 'x', picks: first.picks }], { date: '2026-11-14', postId: 'x' })
    expect(again.picks).toEqual(first.picks)
  })

  it('withEntry ersetzt den Eintrag desselben Posts und kappt die Länge', () => {
    let h: RegieHistoryEntry[] = []
    const picks = sampleRegie([], { date: '2026-11-14', postId: 'x' }).picks
    for (let i = 0; i < 30; i++) h = withEntry(h, { date: '2026-11-14', postId: `p${i % 25}`, picks })
    expect(h.length).toBe(21)
    expect(new Set(h.map((e) => e.postId)).size).toBe(21)
  })
})

describe('Regisseur und Darstellung', () => {
  const coords = sampleRegie([], { date: '2026-11-14', postId: 'x' })
  const content = 'Nvidia CEO Jensen Huang resigned. Anthropic plans an IPO with JPMorgan. Microsoft signed the letter.'

  it('der Prompt enthält die Koordinaten und den Artikel', () => {
    const p = buildDirectorPrompt({ title: 'T', content, coords })
    expect(p).toContain(coords.picks.devices[0])
    expect(p).toContain('Jensen Huang resigned')
  })

  it('verwirft Ziele, die nicht im Artikel stehen, und fremde Stilmittel', () => {
    const fill = parseRegieFill({
      fight: { story: 'Nvidia', conflict: 'Was the board negligent?' },
      rants: [
        { story: 'Nvidia', target: 'Jensen Huang', charge: 'misled his own counsel' },
        { story: 'X', target: 'Elon Musk', charge: 'not in the article' },
      ],
      device_plans: [
        { device: coords.picks.devices[0], story: 'Anthropic', idea: 'during the IPO story' },
        { device: 'not-a-device', story: 'x', idea: 'y' },
      ],
      segment_plan: 'winners and losers',
    }, { content, coords })
    expect(fill?.rants.map((r) => r.target)).toEqual(['Jensen Huang'])
    expect(fill?.devicePlans.map((d) => d.device)).toEqual([coords.picks.devices[0]])
    expect(parseRegieFill({ rants: [], device_plans: [] }, { content, coords })).toBeNull()
  })

  it('der Abschnitt nennt die heutigen Mittel und verbietet die übrigen', () => {
    const s = renderRegieSection(coords, null, 'en')
    expect(s).toContain("TODAY'S DIRECTION")
    expect(s).toContain('NOT today:')
    expect(s).toContain('never copy these words')
    const de = renderRegieSection(coords, null, 'de')
    expect(de).toContain('REGIE DIESER FOLGE')
    expect(coarsenessInstruction(coords, 'en')).toMatch(/Never slurs/)
  })
})

const scriptA = `HOST: [indignant, fast] Moving on to the main thing, honestly this is a total clown show.
GUEST: [booming] Jensen Huang said 7 things.
HOST: [scoffing] Oh, come on.
HOST: [sharp] Yeah.`
const scriptB = `HOST: [indignant, fast] Okay, this is a total clown show and everybody knows it.
GUEST: [booming] Jensen Huang denied it twice.
HOST: [scoffing] Oh, come on.`
const scriptC = `HOST: [dry] Honestly a total clown show, again.
GUEST: [booming] Jensen Huang again, 12 times.
HOST: [scoffing] Oh, come on.`

describe('Fingerabdruck der letzten Folgen', () => {
  it('meldet Wendungen und Kurzzeilen, die in mehreren Folgen wiederkehren', () => {
    const w = computeWornOut([scriptA, scriptB, scriptC])
    expect(w.phrases).toContain('a total clown show')
    expect(w.shortLines).toContain('Oh, come on.')
  })

  it('lässt Eigennamen, Zahlen, einfache Rückmeldungen und Themen des heutigen Artikels aus', () => {
    const w = computeWornOut([scriptA, scriptB, scriptC])
    expect(w.phrases.join(' ')).not.toMatch(/jensen|huang|\d/)
    expect(w.shortLines).not.toContain('Yeah.')
    const topical = computeWornOut([scriptA, scriptB, scriptC], { excludeText: 'Yesterday was a total clown show at the board.' })
    expect(topical.phrases).not.toContain('a total clown show')
  })

  it('schlichte Rückmeldungen gelten nie als verbraucht, Floskeln schon', () => {
    const tail = '\nHOST: [flat] Mm-hm.\nGUEST: [quick] Uh-huh.\nHOST: [dry] Got it.\nGUEST: [dry] Noted.'
    const w = computeWornOut([scriptA + tail, scriptB + tail, scriptC + tail])
    expect(w.shortLines).toContain('Noted.')
    expect(w.shortLines).not.toEqual(expect.arrayContaining(['Mm-hm.']))
    for (const plain of ['Mm-hm.', 'Uh-huh.', 'Got it.']) expect(w.shortLines).not.toContain(plain)
  })

  it('der Prompt-Abschnitt bleibt leer, wenn nichts verbraucht ist', () => {
    expect(wornSection(computeWornOut([scriptA]), 'en')).toBe('')
    expect(wornSection(computeWornOut([scriptA, scriptB, scriptC]), 'en')).toMatch(/WORN OUT/)
  })
})

const original = `HOST: [dry, clipped] Something first. Hey, Hey and welcome to Synthesizer Daily on Friday, November 14, 2026, episode 320!
GUEST: [booming, building] Nvidia sold 12,000 chips and the board slept through it, which is the whole story in one sentence, honestly.
[ARTICLE 2]
HOST: [indignant, fast] Anthropic wants 1,385 reasons to trust it. I mean, come on.
GUEST: [conspiratorial] Fine.`

describe('Texturdurchgang: harte Prüfung', () => {
  it('nimmt eine reine Oberflächen-Überarbeitung an', () => {
    const revised = `HOST: [dry, clipped] Something first. Hey, Hey and welcome to Synthesizer Daily on Friday, November 14, 2026, episode 320!
GUEST: [booming, building] Nvidia sold 12,000 chips and the board just slept through it...
HOST: [flat] Yeah.
GUEST: [booming] which is the whole story in one sentence, really.
[ARTICLE 2]
HOST: [indignant, fast] Anthropic wants 1,385 reasons to trust it. Look, come on.
GUEST: [conspiratorial] Fine.`
    expect(validateTexture(original, revised, 'en')).toEqual({ ok: true, problems: [] })
  })

  it('verwirft geänderte Zahlen, Marker, Begrüßung, Format und Länge', () => {
    const numbers = original.replace('12,000', '13,000')
    expect(validateTexture(original, numbers, 'en').problems.join()).toMatch(/Zahlen/)
    const marker = original.replace('[ARTICLE 2]\n', '')
    expect(validateTexture(original, marker, 'en').problems.join()).toMatch(/Marker/)
    const greeting = original.replace('Hey, Hey and welcome', 'Hey and welcome')
    expect(validateTexture(original, greeting, 'en').problems.join()).toMatch(/Begrüßung/)
    const format = original.replace('GUEST: [conspiratorial] Fine.', 'GUEST: Fine.')
    expect(validateTexture(original, format, 'en').problems.join()).toMatch(/Format/)
    const short = original.split('\n').slice(0, 3).join('\n')
    expect(validateTexture(original, short, 'en').ok).toBe(false)
  })

  it('trennt MOMENTS ab, liest geschützte Zitate und entfernt Vorreden', () => {
    const { body, moments } = splitMomentsSection(`${original}\n\n---MOMENTS---\n[joke] "the board slept through it"`)
    expect(body).toBe(original)
    expect(quotesFromMoments(moments)).toEqual(['the board slept through it'])
    expect(stripPreamble(`Here is the revised script:\n\n${original}\n\nLet me know!`)).toBe(original)
    expect(numbersIn('1,385 and 12,000 and 2.5')).toEqual(new Set(['1385', '12000', '2.5']))
  })

  it('verwirft eine Fassung, die einen durchlaufenden Spitznamen streicht (Fünf-Folgen-Test 2026-11-14)', () => {
    const withNick = `HOST: [indignant, fast] And Speed-Dial Tim reportedly called the export chief.
GUEST: [booming] So Speed-Dial Tim is the story now?
HOST: [dry] Ask Speed-Dial Tim, like I said about Steve Jobs once.`
    const nickGone = `HOST: [indignant, fast] And the general counsel reportedly called the export chief.
GUEST: [booming] So the lawyer is the story now?
HOST: [dry] Ask him, like I said about Steve Jobs once.`
    expect(validateTexture(withNick, nickGone, 'en').problems.join()).toMatch(/Namen fehlen: Speed-Dial, Tim/)
    // ein einmaliger Name aus einem ausgedünnten Vergleich darf gehen
    const analogyGone = withNick.replace(', like I said about Steve Jobs once', '')
    expect(validateTexture(withNick, analogyGone, 'en').problems.join()).not.toMatch(/Namen/)
  })

  it('verwirft eine Fassung, die einen langen Riff mit einer Rückmeldung teilt', () => {
    const words = (n: number) => Array.from({ length: n }, () => 'blah').join(' ')
    const orig = `HOST: [sharp] Go on then.\nGUEST: [booming, building] ${words(130)}\nHOST: [dry] Okay.`
    const split = `HOST: [sharp] Go on then.\nGUEST: [booming, building] ${words(65)}\nHOST: [flat] Yeah.\nGUEST: [booming] ${words(65)}\nHOST: [dry] Okay.`
    expect(validateTexture(orig, split, 'en').problems.join()).toMatch(/lange Riffs geteilt/)
    const edited = orig.replace('blah blah', 'I mean, blah')
    expect(validateTexture(orig, edited, 'en').ok).toBe(true)
  })

  it('recurringNames zählt nur Namen mitten im Satz, die mehrfach vorkommen', () => {
    const text = 'Look, we asked Nvidia twice and Nvidia said no.\nLook again, I\'m sure I\'m right about Apple.\nThe board met.'
    expect(recurringNames(text)).toEqual(['Nvidia'])
  })

  it('der Prompt schützt die Stilmittel des Tages', () => {
    const coords = sampleRegie([], { date: '2026-11-10', postId: 'x' })
    coords.picks.devices = ['nicknames', 'quiz', 'scene']
    const notes = textureDeviceNotes(coords, {
      fight: null, rants: [], quickStories: [], segmentPlan: null,
      devicePlans: [{ device: 'nicknames', story: 'Nvidia', idea: 'Emma coins nicknames and reuses them' }],
    }, 'en')
    expect(notes[0]).toMatch(/^nicknames: .*keeps using them all episode.*today: Emma coins nicknames/)
    expect(notes).toHaveLength(3)
    const { system, user } = buildTexturePrompt(original, {
      lang: 'en', worn: { phrases: [], shortLines: [], directions: [] }, coarseness: 'Clean.', devices: notes,
    })
    expect(system).toMatch(/A nickname or running gag that recurs on purpose is one of them, not worn wording/)
    expect(system).toMatch(/not counting today's devices/)
    expect(system).toMatch(/Every line of more than 100 words stays one unbroken line/)
    expect(system).toMatch(/labels their own move or stance/)
    expect(user).toContain("TODAY'S DEVICES")
    expect(user).toContain('Emma coins nicknames')
    const plain = buildTexturePrompt(original, { lang: 'en', worn: { phrases: [], shortLines: [], directions: [] }, coarseness: 'Clean.' })
    expect(plain.user).not.toContain("TODAY'S DEVICES")
  })

  it('articleEchoes findet wörtlich nachgesprochene Stellen, lässt Zitate und kurze Treffer aus', () => {
    const article = 'Crypto audit shops sell two things: expert years and the signature of a small team. The CEO said "we have no reason to believe any secrets were compromised" on Sunday.'
    const script = `HOST: [sharp] Here's the thing.
GUEST: [booming] Look, crypto audit shops sell two things: expert years and the signature of a small team, and that's over.
HOST: [dry] He said "we have no reason to believe any secrets were compromised" with a straight face.
GUEST: [quick] Expert years and the signature, sure.`
    const echoes = articleEchoes(script, article)
    expect(echoes).toEqual(['crypto audit shops sell two things: expert years and the signature of a small team'])
    expect(articleEchoes(script, '')).toEqual([])
    const { system, user } = buildTexturePrompt(original, {
      lang: 'en', worn: { phrases: [], shortLines: [], directions: [] }, coarseness: 'Clean.', echoes,
    })
    expect(system).toMatch(/TOO CLOSE TO THE ARTICLE in the speaker's own spoken words/)
    expect(user).toContain('TOO CLOSE TO THE ARTICLE')
    expect(buildTexturePrompt(original, { lang: 'en', worn: { phrases: [], shortLines: [], directions: [] }, coarseness: 'Clean.' }).system).not.toMatch(/TOO CLOSE/)
  })

  it('der Prompt verlangt Texturarbeit und schützt Fakten', () => {
    const { system, user } = buildTexturePrompt(original, {
      lang: 'en', worn: { phrases: ['a total clown show'], shortLines: [], directions: [] }, coarseness: 'Salty.', protectedQuotes: ['x y z'],
    })
    expect(system).toMatch(/do not add, drop or change a single digit/)
    expect(system).toContain('Hey, Hey and welcome to Synthesizer Daily on Friday, November 14, 2026, episode 320!')
    expect(system).toContain('Language today: Salty.')
    expect(user).toContain('a total clown show')
    expect(user).toContain('PROTECTED LINES')
  })
})

describe('Explicit-Kennzeichnung', () => {
  it('erkennt starke Wörter in den gesprochenen Zeilen', () => {
    expect(containsExplicitLanguage('HOST: [x] That is bullshit.')).toBe(true)
    expect(containsExplicitLanguage('GUEST: [x] What the fuck, Emma.')).toBe(true)
    expect(containsExplicitLanguage('HOST: [x] Damn, what the hell.')).toBe(false)
    expect(containsExplicitLanguage('HOST: [x] Clean.\n---MOMENTS---\n[joke] "shit"')).toBe(false)
  })

  it('ohne Skript gilt die Folge vorsichtshalber als explicit', () => {
    expect(containsExplicitLanguage(null)).toBe(true)
  })
})

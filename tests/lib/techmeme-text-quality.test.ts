/**
 * Was als Artikeltext durchgeht — und was nicht.
 *
 * ALLE BEISPIELE HIER SIND ECHT. Sie stammen aus dem ersten Produktionslauf am
 * 2026-08-13, in dem drei von 69 Einträgen keine Artikel waren, sondern
 * Abwehrseiten: Bloombergs „Are you a robot?" und Cloudflares Sperrseite. Eine
 * Längenprüfung fängt die nicht — sie sind mit über 1.000 Zeichen länger als
 * mancher echte Anriss.
 */
import { describe, expect, it } from 'vitest'
import { looksBlocked, stripMarkdownPreamble, capText, MAX_TEXT_LENGTH } from '@/lib/techmeme/text-quality'

const BLOOMBERG_ROBOT = `Title: Bloomberg - Are you a robot?

URL Source: https://www.bloomberg.com/news/articles/2026-08-13/anthropic-said-in-talks

Markdown Content:
---
title: "Bloomberg - Are you a robot?"
---

# Bloomberg

[Need help? Contact us](https://www.bloomberg.com/feedback)

## We've detected unusual activity from your computer network

To continue, please click the box below to let us know you're not a robot.`

const CLOUDFLARE = `Title: Attention Required! | Cloudflare

Markdown Content:
Please enable cookies.

# Sorry, you have been blocked

## You are unable to access theinformation.com`

describe('looksBlocked', () => {
  it('erkennt Bloombergs Bot-Abwehr', () => {
    expect(looksBlocked('Bloomberg - Are you a robot?', BLOOMBERG_ROBOT)).toBe(true)
  })

  it('erkennt Cloudflares Sperrseite', () => {
    expect(looksBlocked('Attention Required! | Cloudflare', CLOUDFLARE)).toBe(true)
  })

  it('erkennt die Sperrseite auch ohne Titel', () => {
    expect(looksBlocked(null, CLOUDFLARE)).toBe(true)
  })

  it('laesst einen echten Artikel durch', () => {
    const echt = 'Cisco Systems reported fiscal fourth quarter earnings that topped estimates as artificial intelligence-related product orders accelerated. '.repeat(10)
    expect(looksBlocked('Cisco Earnings Beat, Revenue Outlook Above Estimates', echt)).toBe(false)
  })

  it('laesst einen ARTIKEL UEBER Sperren durch', () => {
    // Der gefaehrlichste Fehlalarm: Wir schreiben ueber Technik. Ein Bericht
    // darueber, dass Cloudflare KI-Crawler aussperrt, enthaelt dieselben Woerter
    // wie die Sperrseite selbst — nur ist er lang und der Titel ist unverdaechtig.
    const bericht = 'Cloudflare now blocks AI crawlers by default. Site owners see a message saying you have been blocked when a bot without permission arrives. '.repeat(30)
    expect(looksBlocked('Cloudflare blocks AI crawlers by default', bericht)).toBe(false)
  })

  it('erkennt die Verifizierungsseite der Financial Times', () => {
    // 2026-08-13 in der Queue gefunden: Titel „Security Verification", Score
    // 10,65 — die BESTBEWERTETE Quelle ihres Themas. Mit der Fuenf-Quellen-
    // Grenze waere sie garantiert in den Artikel gewandert.
    expect(looksBlocked('Financial Times — Security Verification', 'Please verify you are human to continue reading.')).toBe(true)
  })

  it('faellt bei leerem Text nicht um', () => {
    expect(looksBlocked(null, '')).toBe(false)
  })
})

describe('stripMarkdownPreamble', () => {
  it('entfernt den Metadaten-Kopf von markdown.new', () => {
    // Ohne das landen „Title:" und „URL Source:" als erste Zeilen des
    // Artikeltextes in der Queue — und damit im Ghostwriter-Prompt.
    const roh = `Title: CISCO REPORTS FOURTH QUARTER EARNINGS

URL Source: https://www.prnewswire.com/news-releases/cisco-reports.html

Markdown Content:
---
description: Record top and bottom-line performance
title: CISCO REPORTS FOURTH QUARTER EARNINGS
---

Cisco today reported fourth quarter results.`
    const sauber = stripMarkdownPreamble(roh)
    expect(sauber.startsWith('Cisco today reported')).toBe(true)
    expect(sauber).not.toContain('URL Source:')
    expect(sauber).not.toContain('Markdown Content:')
  })

  it('laesst Text ohne Kopf unveraendert', () => {
    expect(stripMarkdownPreamble('Einfach nur Text.')).toBe('Einfach nur Text.')
  })

  it('behaelt Ueberschriften im eigentlichen Text', () => {
    const roh = 'Title: X\n\nMarkdown Content:\n# Eine echte Ueberschrift\n\nUnd Text.'
    expect(stripMarkdownPreamble(roh)).toContain('# Eine echte Ueberschrift')
  })
})

describe('capText', () => {
  it('kappt uebergrosse Texte', () => {
    // Ein Eintrag des ersten Laufs hatte 96.477 Zeichen: markdown.new liefert
    // bei manchen Seiten die ganze Seite samt Navigation, nicht den Artikel.
    const riesig = 'wort '.repeat(40_000)
    expect(capText(riesig).length).toBeLessThanOrEqual(MAX_TEXT_LENGTH)
  })

  it('kappt an einer Wortgrenze, nicht mitten im Wort', () => {
    const riesig = 'wort '.repeat(40_000)
    expect(capText(riesig).endsWith('wort')).toBe(true)
  })

  it('laesst normale Texte unangetastet', () => {
    const normal = 'Ein normaler Artikel. '.repeat(50)
    expect(capText(normal)).toBe(normal)
  })
})

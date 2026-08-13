/**
 * Roh-HTML → lesbarer Text für die Quellen-Vorschau im Admin.
 *
 * BETREIBER-BEFUND 2026-08-13: Die Vorschau zeigte
 * `<div id="readability-page-1" class="page"><section>…` als Text. Gecrawlte
 * Artikel liegen als HTML-Fragment vor, Newsletter dagegen als Klartext — die
 * Vorschau gab beides unverändert aus.
 */
import { describe, expect, it } from 'vitest'
import { htmlToPlainText, looksLikeHtml } from '@/lib/utils/html-to-text'

describe('htmlToPlainText', () => {
  it('entfernt Markup und laesst den Text stehen', () => {
    const html = '<div id="readability-page-1" class="page"><section><p>Apple stellt neue iPhones vor.</p></section></div>'
    expect(htmlToPlainText(html)).toBe('Apple stellt neue iPhones vor.')
  })

  it('macht aus Blockenden Absaetze', () => {
    const html = '<p>Erster Absatz.</p><p>Zweiter Absatz.</p>'
    expect(htmlToPlainText(html)).toBe('Erster Absatz.\n\nZweiter Absatz.')
  })

  it('wirft Skript- und Stilbloecke samt Inhalt weg', () => {
    const html = '<div><script>var x = "nicht anzeigen";</script><style>.a{color:red}</style><p>Sichtbar.</p></div>'
    const text = htmlToPlainText(html)
    expect(text).toBe('Sichtbar.')
    expect(text).not.toContain('nicht anzeigen')
    expect(text).not.toContain('color')
  })

  it('loest Entities auf, auch numerische', () => {
    expect(htmlToPlainText('<p>Tim&#39;s Firma &amp; Co. &hellip; &#x2019;</p>')).toBe("Tim's Firma & Co. … ’")
  })

  it('macht <br> zu einem Zeilenumbruch', () => {
    expect(htmlToPlainText('<p>Zeile eins<br>Zeile zwei</p>')).toBe('Zeile eins\nZeile zwei')
  })

  it('laesst Klartext unangetastet', () => {
    // Newsletter-Inhalte kommen oft schon als Text — der darf nicht durch die
    // Tag-Entfernung laufen und dabei Zeichen verlieren.
    const text = 'Meta hat Muse Glimmer vorgestellt, ein 30B-Modell.\n\nMehr dazu morgen.'
    expect(htmlToPlainText(text)).toBe(text)
  })

  it('haelt ein einzelnes < im Fliesstext nicht fuer Markup', () => {
    expect(looksLikeHtml('5 < 7 und 8 > 3')).toBe(false)
    expect(htmlToPlainText('5 < 7 und 8 > 3')).toBe('5 < 7 und 8 > 3')
  })

  it('kommt mit leerer Eingabe klar', () => {
    expect(htmlToPlainText('')).toBe('')
  })

  it('zieht ueberzaehlige Leerzeilen zusammen', () => {
    expect(htmlToPlainText('<p>A</p><div></div><div></div><p>B</p>')).toBe('A\n\nB')
  })
})

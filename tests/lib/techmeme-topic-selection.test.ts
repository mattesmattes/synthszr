/**
 * Welche Techmeme-Stories werden „Thema des Tages"?
 *
 * BETREIBER-VORGABE 2026-08-13: Die fünf obersten Stories, vollautomatisch bis
 * in den Post.
 *
 * DIE FALLE: Der Job läuft alle vier Stunden. Markierte jeder Lauf einfach „die
 * obersten fünf", stünden nach sechs Läufen bis zu dreißig Themen im Tagespost.
 * Bereits vorgemerkte Themen müssen deshalb mitzählen.
 */
import { describe, expect, it } from 'vitest'
import { pickTopicStories, TOPIC_STORY_LIMIT } from '@/lib/techmeme/topic-selection'

describe('pickTopicStories', () => {
  it('nimmt die obersten fuenf, wenn noch nichts vorgemerkt ist', () => {
    const stories = ['a', 'b', 'c', 'd', 'e', 'f', 'g']
    expect([...pickTopicStories(stories, new Set())]).toEqual(['a', 'b', 'c', 'd', 'e'])
  })

  it('zaehlt bereits vorgemerkte Themen mit', () => {
    // Sonst haette der Tagespost nach sechs Laeufen dreissig Themen.
    const aktiv = new Set(['x', 'y', 'z'])
    const gewaehlt = pickTopicStories(['a', 'b', 'c', 'd'], aktiv)
    expect(gewaehlt.size).toBe(TOPIC_STORY_LIMIT)
    expect(gewaehlt.has('x')).toBe(true)
    expect([...gewaehlt].filter((k) => !aktiv.has(k))).toEqual(['a', 'b'])
  })

  it('nimmt nichts Neues auf, wenn das Soll schon erfuellt ist', () => {
    const aktiv = new Set(['v', 'w', 'x', 'y', 'z'])
    const gewaehlt = pickTopicStories(['a', 'b'], aktiv)
    expect(gewaehlt).toEqual(aktiv)
  })

  it('behaelt ein vorgemerktes Thema, das weiter oben steht', () => {
    // Eine Story, die schon Thema ist, bleibt es — auch wenn sie inzwischen
    // nach unten gerutscht ist. Sonst verloere der Post auf halbem Weg einen
    // Abschnitt, dessen Quellen schon geschrieben sind.
    const aktiv = new Set(['c'])
    const gewaehlt = pickTopicStories(['a', 'b', 'c', 'd', 'e', 'f'], aktiv)
    expect(gewaehlt.has('c')).toBe(true)
    expect(gewaehlt.size).toBe(TOPIC_STORY_LIMIT)
  })

  it('waehlt nur aus den obersten Stories — nicht aus der ganzen Liste', () => {
    // „Top 5" heisst oben, nicht „die ersten fuenf, die noch frei sind".
    // Stuenden schon vier Themen fest, duerfte nicht Platz 20 nachruecken.
    const aktiv = new Set(['p', 'q', 'r', 's'])
    const gewaehlt = pickTopicStories(['a', 'b', 'c', 'd', 'e', 'f'], aktiv)
    expect([...gewaehlt].filter((k) => !aktiv.has(k))).toEqual(['a'])
  })

  it('kommt mit leerer Liste klar', () => {
    expect(pickTopicStories([], new Set()).size).toBe(0)
  })
})

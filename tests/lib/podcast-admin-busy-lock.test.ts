/**
 * Admin → Audio: Solange ein Script oder Audio entsteht, lässt sich nichts
 * Neues starten (Betreiber 2026-11-10). Vorher war „Podcast generieren"
 * während der Script-Erzeugung klickbar und „Nur Script" während der
 * Audio-Erzeugung; ein zweiter Start überschrieb das Script oder legte einen
 * zweiten Audio-Job an.
 */
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const PAGE = readFileSync('app/admin/audio/page.tsx', 'utf-8')

describe('Sperre der Podcast-Buttons', () => {
  it('ein gemeinsamer Zustand für Script und Audio', () => {
    expect(PAGE).toContain('const podcastBusy = scriptGenerating || podcastGenerating')
  })

  it.each([
    ['Script + Audio', 'onClick={generateScriptAndPodcast} disabled={podcastBusy'],
    ['Nur Script', 'onClick={generateScriptFromPost} disabled={podcastBusy'],
    ['Podcast generieren', 'onClick={() => generatePodcast()} disabled={podcastBusy'],
  ])('%s ist gesperrt, solange etwas entsteht', (_, snippet) => {
    expect(PAGE).toContain(snippet)
  })

  it('jeder Start prüft die Sperre, bevor React neu gerendert hat', () => {
    for (const fn of ['generateScriptFromPost()', 'generateScriptAndPodcast()']) {
      const body = PAGE.slice(PAGE.indexOf(`async function ${fn}`))
      expect(body.slice(0, 120)).toContain('if (podcastBusyRef.current) return')
    }
    const podcast = PAGE.slice(PAGE.indexOf('async function generatePodcast('))
    expect(podcast.slice(0, 200)).toContain('if (podcastBusyRef.current && !opts.lockHeld) return')
    // Script + Audio reicht die Sperre an die Audio-Erzeugung weiter.
    expect(PAGE).toContain('generatePodcast(generatedScript, { lockHeld: true })')
  })
})

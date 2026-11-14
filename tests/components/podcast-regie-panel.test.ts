// @vitest-environment jsdom
/**
 * Karte „Tagesregie“ im Podcast Studio: lädt die Übersicht, zeigt Vorschau,
 * letzte Folgen und auf Klick Plan, Fingerabdruck und Katalog. Als .ts mit
 * createElement, weil vitest nur tests/**\/*.test.ts einsammelt.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createElement as h } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { act } from 'react'
import { sampleRegie, type RegieHistoryEntry } from '@/lib/podcast/regie/sampler'
import { buildRegieOverview } from '@/lib/podcast/regie/overview'
import { PodcastRegiePanel } from '@/components/admin/podcast-regie-panel'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const legacy: RegieHistoryEntry = { ...sampleRegie([], { date: '2026-11-13', postId: '11111111-1111-1111-1111-111111111111' }) }
const detailed: RegieHistoryEntry = {
  ...sampleRegie([legacy], { date: '2026-11-14', postId: '22222222-2222-2222-2222-222222222222' }),
  title: 'Nvidia-Drama erreicht den Höhepunkt',
  createdAt: '2026-11-14T08:15:00Z',
  directed: true,
  fill: {
    fight: { story: 'Nvidia', conflict: 'Hat der Aufsichtsrat versagt?' },
    rants: [{ story: 'Nvidia', target: 'Jensen Huang', charge: 'hat den eigenen Anwalt im Dunkeln gelassen' }],
    devicePlans: [{ device: 'quiz', story: 'Anthropic', idea: 'Zahl der Geschäftskunden abfragen' }],
    quickStories: ['Adobe'],
    segmentPlan: 'Wer hat den schlechtesten Tag',
  },
  worn: { phrases: ['write it down'], shortLines: ['Noted.'], directions: [] },
  texture: { applied: false, problems: ['Zahlen geändert (fehlen: 12; neu: -)'] },
  echoes: ['the board launched an independent investigation'],
}
const history = [detailed, legacy]
const preview = { ...sampleRegie(history, { date: '2026-11-15', postId: '33333333-3333-3333-3333-333333333333' }), title: 'Neuer Post' }
const overview = buildRegieOverview({ lang: 'en', history, preview })

let root: Root | null = null
let container: HTMLDivElement | null = null

afterEach(() => {
  act(() => root?.unmount())
  container?.remove()
  root = null
  container = null
  vi.unstubAllGlobals()
})

async function render(props: { postId?: string; locale: string }) {
  const fetchMock = vi.fn(async (_input: RequestInfo | URL) => new Response(JSON.stringify(overview), { status: 200, headers: { 'Content-Type': 'application/json' } }))
  vi.stubGlobal('fetch', fetchMock)
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  await act(async () => { root!.render(h(PodcastRegiePanel, props)) })
  await act(async () => { await Promise.resolve() })
  return fetchMock
}

describe('PodcastRegiePanel', () => {
  it('fragt die Übersicht für Post und Skript-Sprache ab und zeigt Vorschau und letzte Folgen', async () => {
    const fetchMock = await render({ postId: preview.postId, locale: 'cs' })
    expect(String(fetchMock.mock.calls[0][0])).toBe(`/api/admin/podcast-regie?lang=en&postId=${preview.postId}`)
    const text = container!.textContent ?? ''
    expect(text).toContain('Tagesregie')
    expect(text).toContain('Vorschau für „Neuer Post“')
    expect(text).toContain('Letzte Folgen (2)')
    expect(text).toContain('Nvidia-Drama erreicht den Höhepunkt')
    expect(text).toContain('mit Regisseur')
    expect(text).toContain('Textur verworfen')
    expect(text).toContain('Form')
    expect(text).toContain('Schluss')
  })

  it('klappt Plan, Fingerabdruck, Echos und Verwurf-Grund auf; alte Einträge sagen, dass Details fehlen', async () => {
    await render({ locale: 'en' })
    const buttons = [...container!.querySelectorAll('li > button')] as HTMLButtonElement[]
    await act(async () => { buttons[0].click() })
    let text = container!.textContent ?? ''
    expect(text).toContain('Plan des Regisseurs')
    expect(text).toContain('Hauptstreit: Nvidia: Hat der Aufsichtsrat versagt?')
    expect(text).toContain('Emmas Ausbruch gegen Jensen Huang')
    expect(text).toContain('Quiz: Anthropic: Zahl der Geschäftskunden abfragen')
    expect(text).toContain('„write it down“')
    expect(text).toContain('the board launched an independent investigation')
    expect(text).toContain('Zahlen geändert')
    await act(async () => { buttons[1].click() })
    text = container!.textContent ?? ''
    expect(text).toContain('nur die gezogenen Werte sind gespeichert')
  })

  it('ohne ausgewählten Post gibt es keine Vorschau, der Katalog klappt auf', async () => {
    const fetchMock = await render({ locale: 'de' })
    expect(String(fetchMock.mock.calls[0][0])).toBe('/api/admin/podcast-regie?lang=de')
    const catalogToggle = [...container!.querySelectorAll('section > button')].find((b) => b.textContent?.startsWith('Katalog')) as HTMLButtonElement
    await act(async () => { catalogToggle.click() })
    const text = container!.textContent ?? ''
    expect(text).toContain('Spitznamen')
    expect(text).toContain('zuletzt')
    expect(text).toContain('je Folge')
  })
})

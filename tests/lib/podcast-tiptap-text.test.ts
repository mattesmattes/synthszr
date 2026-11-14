/**
 * Klartext für den Podcast-Prompt: Leerzeichen-Textknoten zwischen
 * ausgezeichneten Stücken bleiben erhalten (Befund 2026-11-14: „longagentic").
 */
import { describe, expect, it } from 'vitest'
import { extractTextFromTiptap } from '@/lib/podcast/tiptap-text'

const t = (text: string, marks?: unknown[]) => ({ type: 'text', text, ...(marks ? { marks } : {}) })

describe('extractTextFromTiptap', () => {
  it('behält Leerzeichen-Knoten zwischen ausgezeichneten Wörtern', () => {
    const doc = { type: 'doc', content: [{ type: 'paragraph', content: [t('long', [{ type: 'bold' }]), t(' '), t('agentic', [{ type: 'link' }])] }] }
    expect(extractTextFromTiptap(doc)).toBe('long agentic\n\n')
  })

  it('Absätze, Überschriften und Listen wie bisher, leere Absätze fallen weg', () => {
    const doc = { type: 'doc', content: [
      { type: 'heading', content: [t('Title')] },
      { type: 'paragraph', content: [] },
      { type: 'bulletList', content: [{ type: 'listItem', content: [{ type: 'paragraph', content: [t('one')] }] }] },
    ] }
    expect(extractTextFromTiptap(doc)).toBe('Title\n\n• one\n\n\n')
    expect(extractTextFromTiptap(JSON.stringify({ type: 'paragraph', content: [t('x')] }))).toBe('x\n\n')
    expect(extractTextFromTiptap('kein JSON')).toBe('kein JSON')
  })
})

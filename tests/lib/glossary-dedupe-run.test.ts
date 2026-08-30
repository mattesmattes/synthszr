/**
 * buildClusters (lib/glossary/dedupe-run.ts) — Gruppierung veroeffentlichter
 * Begriffe fuer den Dedupe-Lauf. Deckt die drei realen Faelle vom
 * Vollkorpus-Scan 2026-08-30 ab: Slug-Varianten (bereits vor der Erweiterung
 * erkannt), Namens-Varianten mit voellig verschiedenem Slug (der Grund fuer
 * die Erweiterung), und einen 3-Wege-Cluster, der ueber beide Kriterien
 * zusammenhaengt (Union-Find-Verhalten).
 */
import { describe, expect, it } from 'vitest'
import { buildClusters, type SlugRow } from '@/lib/glossary/dedupe-run'

function row(slug: string, canonical_name: string, created_at = '2026-08-01T00:00:00Z'): SlugRow {
  return { id: `id-${slug}`, slug, canonical_name, created_at }
}

describe('buildClusters', () => {
  it('gruppiert Slug-Varianten (Bindestrich/End-s) wie bisher', () => {
    const rows = [row('artboard', 'Artboard'), row('artboards', 'Artboard')]
    const clusters = buildClusters(rows)
    expect(clusters).toHaveLength(1)
    expect(clusters[0].map((r) => r.slug).sort()).toEqual(['artboard', 'artboards'])
  })

  it('gruppiert Namens-Varianten mit voellig unterschiedlichem Slug (die Erweiterung)', () => {
    // "mcp" und "model-context-protocol" haben normalisiert nichts gemeinsam —
    // normalizeSlugForDedup allein haette dieses Paar NIE gefunden.
    const rows = [row('mcp', 'Model Context Protocol'), row('model-context-protocol', 'Model Context Protocol')]
    const clusters = buildClusters(rows)
    expect(clusters).toHaveLength(1)
    expect(clusters[0].map((r) => r.slug).sort()).toEqual(['mcp', 'model-context-protocol'])
  })

  it('vergleicht canonical_name getrimmt und case-insensitiv', () => {
    const rows = [row('a', '  KI-Agent  '), row('b', 'ki-agent')]
    expect(buildClusters(rows)).toHaveLength(1)
  })

  it('vereinigt einen 3-Wege-Cluster, der ueber Slug UND Name verbunden ist', () => {
    // agent-ki-agent/ai-agents/ki-agent (realer Fall): "ki-agent" und
    // "agent-ki-agent" teilen KEINEN normalisierten Namen (unterschiedliche
    // canonical_name in echten Daten waere denkbar), aber alle drei teilen
    // exakt "KI-Agent" als canonical_name. Hier zusaetzlich geprueft: eine
    // Kette ueber unterschiedliche Kriterien (A-B ueber Namen, B-C ueber Slug)
    // muss trotzdem zu EINEM Cluster verschmelzen, nicht zu zwei Paaren.
    const rows = [
      row('ki-agent', 'KI-Agent'),
      row('agent-ki-agent', 'KI-Agent'),
      row('ai-agents', 'KI-Agent'),
    ]
    const clusters = buildClusters(rows)
    expect(clusters).toHaveLength(1)
    expect(clusters[0]).toHaveLength(3)
  })

  it('laesst unbeteiligte Begriffe unangetastet (keine Einzel-Cluster)', () => {
    const rows = [row('agent', 'Agent'), row('llm', 'LLM'), row('cuda', 'CUDA')]
    expect(buildClusters(rows)).toHaveLength(0)
  })

  it('findet mehrere unabhaengige Cluster gleichzeitig', () => {
    const rows = [
      row('mcp', 'Model Context Protocol'), row('model-context-protocol', 'Model Context Protocol'),
      row('sso', 'Single Sign-on'), row('single-sign-on', 'Single Sign-on'),
      row('agent', 'Agent'), // unbeteiligt
    ]
    const clusters = buildClusters(rows)
    expect(clusters).toHaveLength(2)
    const slugSets = clusters.map((c) => c.map((r) => r.slug).sort().join(','))
    expect(slugSets).toContain('mcp,model-context-protocol')
    expect(slugSets).toContain('single-sign-on,sso')
  })
})

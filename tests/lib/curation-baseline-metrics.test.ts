/**
 * Reine Baseline-Metriken der Kuratierung (Phase 0).
 *
 * BEFUND 2026-10-06 (Spec „Treffer-Währung"): Ein veröffentlichter Abschnitt
 * kann aus bis zu fünf Queue-Items bestehen (member_ids), eine Baseline rankt
 * aber einzelne Items. Auf ID-Ebene trifft eine Baseline nur, wenn sie genau
 * die ID aus dem Bündel zieht — eine andere Quelle derselben Meldung zählt als
 * Fehltreffer. Deshalb misst die Story-Ebene über dieselbe Clusterung wie die
 * Dedup (clusterByEmbedding, Schwelle 0,8); die strenge ID-Variante läuft
 * daneben mit.
 */
import { describe, expect, it } from 'vitest'
import {
  assignStoryKeys,
  duplicateRate,
  idRecallAtK,
  mdeAtN,
  mulberry32,
  pairedBootstrap,
  precisionAtK,
  quantiles,
  unitRecallAtK,
} from '@/lib/curation/baseline-metrics'

// 2-D-Vektoren wie in tests/lib/semantic-dedup.test.ts: Cosinus leicht nachzurechnen.
const A = [1, 0]            // Basis
const A_NEAR = [0.98, 0.02] // ~0.9998 Cosinus zu A
const ORTHOGONAL = [0, 1]   // 0 Cosinus zu A

describe('assignStoryKeys', () => {
  it('gibt nahen Items den Schlüssel des zuerst gelisteten Items', () => {
    const emb = new Map([['first', A], ['second', A_NEAR]])
    const keys = assignStoryKeys(['first', 'second'], emb, 0.8)
    expect(keys.get('first')).toBe('first')
    expect(keys.get('second')).toBe('first')
  })

  it('gibt einem unähnlichen Item einen eigenen Schlüssel', () => {
    const emb = new Map([['a', A], ['b', ORTHOGONAL]])
    const keys = assignStoryKeys(['a', 'b'], emb, 0.8)
    expect(keys.get('a')).toBe('a')
    expect(keys.get('b')).toBe('b')
  })

  it('macht ein Item ohne Embedding zu seinem eigenen Cluster (key = id)', () => {
    const emb = new Map([['a', A], ['c', A_NEAR]])
    const keys = assignStoryKeys(['a', 'no-embedding', 'c'], emb, 0.8)
    expect(keys.get('no-embedding')).toBe('no-embedding')
    expect(keys.get('c')).toBe('a')
    expect(keys.size).toBe(3)
  })

  it('respektiert die Schwelle', () => {
    const emb = new Map([['a', A], ['b', A_NEAR]])
    // Cosinus(A, A_NEAR) ≈ 0.9998 < 0.9999 → getrennte Cluster
    const keys = assignStoryKeys(['a', 'b'], emb, 0.9999)
    expect(keys.get('b')).toBe('b')
  })

  it('liefert eine leere Map für eine leere ID-Liste', () => {
    expect(assignStoryKeys([], new Map(), 0.8).size).toBe(0)
  })

  it('doppelte IDs ändern den Schlüssel nicht (erstes Vorkommen zählt)', () => {
    // WARUM diese Vektoren: cos(a,x)=0,8 und cos(y,x)=0,6 → beim ersten Vorkommen
    // gehört a zu x, y bildet einen eigenen Cluster. Ohne Dedup würde das zweite
    // 'a' gegen x UND y verglichen, cos(a,y)=0,96 gewänne und a→y überschriebe a→x.
    // Schwelle 0,75 statt 0,8, damit cos(a,x)=0,8 nicht an der Gleitkomma-Grenze liegt.
    const emb = new Map([['x', [1, 0]], ['a', [0.8, 0.6]], ['y', [0.6, 0.8]]])
    const keys = assignStoryKeys(['x', 'a', 'y', 'a'], emb, 0.75)
    expect(keys.get('a')).toBe('x')
    expect(keys.get('y')).toBe('y')
    expect(keys.size).toBe(3)
  })
})

describe('unitRecallAtK vs. idRecallAtK', () => {
  it('Bündel: gerankte ID ist kein Member, liegt aber im Cluster eines Members → Story-Treffer, kein ID-Treffer', () => {
    // r1 (gerankt) und m1 (Member) sind dieselbe Meldung aus zwei Quellen; m2 ohne Embedding.
    const emb = new Map([['r1', A], ['m1', A_NEAR], ['x', ORTHOGONAL]])
    const storyOf = assignStoryKeys(['r1', 'm1', 'm2', 'x'], emb, 0.8)
    expect(storyOf.get('m1')).toBe('r1')

    const units = [{ memberIds: ['m1', 'm2'] }]
    expect(unitRecallAtK(['r1'], 1, units, storyOf)).toEqual({ hits: 1, total: 1, recall: 1 })
    expect(idRecallAtK(['r1'], 1, new Set(['m1', 'm2']))).toBe(0)
  })

  it('direkter ID-Treffer zählt auch ohne Eintrag in storyOf (Fallback key = id)', () => {
    const units = [{ memberIds: ['m1'] }, { memberIds: ['m2'] }]
    const r = unitRecallAtK(['m2', 'z'], 2, units, new Map())
    expect(r).toEqual({ hits: 1, total: 2, recall: 0.5 })
  })

  it('betrachtet nur die Top-K', () => {
    const units = [{ memberIds: ['m1'] }]
    expect(unitRecallAtK(['x', 'y', 'm1'], 2, units, new Map()).hits).toBe(0)
    expect(unitRecallAtK(['x', 'y', 'm1'], 3, units, new Map()).hits).toBe(1)
  })

  it('zählt eine Einheit ohne memberIds im Nenner, sie kann nie treffen', () => {
    const units = [{ memberIds: [] }, { memberIds: ['m1'] }]
    expect(unitRecallAtK(['m1'], 1, units, new Map())).toEqual({ hits: 1, total: 2, recall: 0.5 })
  })

  it('liefert 0/0/0 ohne Einheiten', () => {
    expect(unitRecallAtK(['a'], 1, [], new Map())).toEqual({ hits: 0, total: 0, recall: 0 })
  })

  it('idRecallAtK zählt jede Member-ID einzeln', () => {
    expect(idRecallAtK(['m1', 'm2', 'x'], 3, new Set(['m1', 'm2', 'm3']))).toBeCloseTo(2 / 3)
  })

  it('idRecallAtK ist 0 bei leerer Menge veröffentlichter IDs', () => {
    expect(idRecallAtK(['a'], 1, new Set())).toBe(0)
  })
})

describe('precisionAtK', () => {
  const units = [{ memberIds: ['a'] }, { memberIds: ['c'] }]

  it('ist der Anteil der Top-K, der in einer veröffentlichten Einheit liegt (Überlebensquote)', () => {
    expect(precisionAtK(['a', 'b', 'c', 'd'], 4, units, new Map())).toBeCloseTo(0.5)
  })

  it('betrachtet nur die Top-K', () => {
    // WARUM diese Daten: ohne Kappung ergäbe die volle Liste jeweils 0,5 —
    // nur mit slice(0, k) kommen 0 bzw. 1 heraus.
    expect(precisionAtK(['b', 'd', 'a', 'c'], 2, units, new Map())).toBe(0)
    expect(precisionAtK(['a', 'b', 'c', 'd'], 1, units, new Map())).toBe(1)
  })

  it('teilt durch die tatsächliche Listenlänge, wenn sie kürzer als K ist', () => {
    // Handauswahl mit 2 Items bei K=10: 1 Treffer von 2, nicht von 10
    expect(precisionAtK(['a', 'b'], 10, units, new Map())).toBeCloseTo(0.5)
  })

  it('ist 0 für eine leere Liste', () => {
    expect(precisionAtK([], 10, units, new Map())).toBe(0)
  })

  it('zählt einen Story-Treffer über storyOf (andere Quelle derselben Meldung)', () => {
    const storyOf = new Map([['r1', 'a']])
    expect(precisionAtK(['r1'], 1, units, storyOf)).toBe(1)
  })
})

describe('duplicateRate', () => {
  it('ist der Anteil der IDs, deren Story-Schlüssel schon vergeben war', () => {
    expect(duplicateRate(['a', 'b', 'c'], new Map([['b', 'a']]))).toBeCloseTo(1 / 3)
  })

  it('ist 0 ohne Dubletten', () => {
    expect(duplicateRate(['a', 'b', 'c'], new Map())).toBe(0)
  })

  it('ist 0 für eine leere Liste', () => {
    expect(duplicateRate([], new Map())).toBe(0)
  })

  it('behandelt IDs ohne Cluster-Eintrag als eigenen Schlüssel', () => {
    expect(duplicateRate(['a', 'b'], new Map([['zz', 'a']]))).toBe(0)
  })
})

describe('quantiles', () => {
  it('interpoliert linear an Position q·(n−1) und sortiert selbst', () => {
    const q = quantiles([10, 1, 9, 2, 8, 3, 7, 4, 6, 5], [0, 0.25, 0.5, 1])
    expect(q[0]).toBe(1)
    expect(q[1]).toBeCloseTo(3.25)
    expect(q[2]).toBeCloseTo(5.5)
    expect(q[3]).toBe(10)
  })

  it('gibt bei einem Wert diesen Wert für jedes q', () => {
    expect(quantiles([7], [0.1, 0.5, 0.9])).toEqual([7, 7, 7])
  })

  it('klemmt q außerhalb von [0, 1] auf Minimum bzw. Maximum', () => {
    // WARUM: ohne Klemme läse sorted[-1] bzw. sorted[3] → undefined/NaN im Baseline-JSON
    expect(quantiles([1, 2, 3], [-0.5, 1.5])).toEqual([1, 3])
  })

  it('liefert NaN je q ohne Daten', () => {
    const q = quantiles([], [0.5, 0.9])
    expect(q).toHaveLength(2)
    expect(q[0]).toBeNaN()
    expect(q[1]).toBeNaN()
  })
})

describe('mdeAtN', () => {
  it('ist z·sd/√n mit z = 1,645 als Default (Detektionsschwelle bei 50 % Power)', () => {
    expect(mdeAtN(0.2, 20)).toBeCloseTo(0.0736, 3)
    expect(mdeAtN(0.2, 30)).toBeCloseTo(0.0601, 3)
  })

  it('nimmt ein anderes z an', () => {
    expect(mdeAtN(0.2, 20, 1.96)).toBeCloseTo(0.0877, 3)
  })

  it('liefert mit z = 1,645 + 0,8416 den MDE bei 80 % Power', () => {
    // WARUM eigener Test: bei sd 0,2 / n 20 kippt die Aussage über die +0,10-
    // Gate-Schwelle — Default 0,074 (scheinbar nachweisbar), 80 % Power 0,111 (nicht).
    expect(mdeAtN(0.2, 20, 1.645 + 0.8416)).toBeCloseTo(0.1112, 3)
  })

  it('ist NaN bei n = 0', () => {
    expect(mdeAtN(0.2, 0)).toBeNaN()
  })
})

describe('pairedBootstrap', () => {
  const diffs = [0.1, 0.2, 0.15, 0.3, 0.25, 0.12, 0.18, 0.22]

  it('ist deterministisch: gleicher Seed, gleiches Ergebnis', () => {
    expect(pairedBootstrap(diffs, 500, 42)).toEqual(pairedBootstrap(diffs, 500, 42))
    expect(pairedBootstrap(diffs)).toEqual(pairedBootstrap(diffs))
  })

  it('nimmt die Quantile 0,05/0,95 der Resample-Mittelwerte (90 %, Default 2000 × Seed 42)', () => {
    // WARUM unabhängig nachgerechnet: die Gate-Regel hängt an lo90 > 0 — ein
    // 95-%-Intervall (0,025/0,975) bestünde sonst jeden anderen Test hier.
    const rand = mulberry32(42)
    const n = diffs.length
    const means: number[] = []
    for (let i = 0; i < 2000; i++) {
      let sum = 0
      for (let j = 0; j < n; j++) sum += diffs[Math.floor(rand() * n)]
      means.push(sum / n)
    }
    const [lo, hi, lo95] = quantiles(means, [0.05, 0.95, 0.025])
    const b = pairedBootstrap(diffs)
    expect(b.lo90).toBe(lo)
    expect(b.hi90).toBe(hi)
    expect(lo95).toBeLessThan(lo)
  })

  it('liefert bei konstanten Differenzen ein entartetes Intervall auf dem Mittelwert', () => {
    const b = pairedBootstrap([0.2, 0.2, 0.2], 200, 1)
    expect(b.mean).toBeCloseTo(0.2)
    expect(b.lo90).toBeCloseTo(0.2)
    expect(b.hi90).toBeCloseTo(0.2)
  })

  it('hat bei durchweg positiven Differenzen eine Untergrenze > 0 und umschließt den Mittelwert', () => {
    const b = pairedBootstrap(diffs)
    expect(b.mean).toBeCloseTo(0.19)
    expect(b.lo90).toBeGreaterThan(0)
    expect(b.lo90).toBeLessThanOrEqual(b.mean)
    expect(b.hi90).toBeGreaterThanOrEqual(b.mean)
  })

  it('umschließt 0 bei symmetrischen Differenzen', () => {
    const b = pairedBootstrap([0.3, -0.3, 0.1, -0.1, 0.2, -0.2])
    expect(b.mean).toBeCloseTo(0)
    expect(b.lo90).toBeLessThan(0)
    expect(b.hi90).toBeGreaterThan(0)
  })

  it('liefert NaN ohne Daten', () => {
    const b = pairedBootstrap([])
    expect(b.mean).toBeNaN()
    expect(b.lo90).toBeNaN()
    expect(b.hi90).toBeNaN()
  })
})

describe('mulberry32', () => {
  it('liefert eine deterministische Folge in [0, 1)', () => {
    const a = mulberry32(42)
    const b = mulberry32(42)
    const seqA = [a(), a(), a()]
    const seqB = [b(), b(), b()]
    expect(seqA).toEqual(seqB)
    for (const v of seqA) {
      expect(v).toBeGreaterThanOrEqual(0)
      expect(v).toBeLessThan(1)
    }
    expect(seqA[0]).toBeCloseTo(0.6011, 4)
  })
})

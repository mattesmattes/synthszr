// tests/lib/ghostwriter-queue-id-marker.test.ts — Queue-ID-Marker auf jeder H2
// (Spec 2026-10-05 „Heading-Marker", Phase 0). Wie article-jobs-batch.test.ts:
// vi.mock fängt modul-interne Aufrufe (callModelNonStreaming) nicht ab, daher
// wird die SDK-Schicht gemockt. Der Mock unterscheidet am System-Prompt:
// Lektor (PROOFREADING_PROMPT) → Eingabetext OHNE HTML-Kommentare, also ein
// Proofread, der Regel 9 reißt — genau der Fall, den der Backstop abfangen
// muss; jeder andere Call → fester Abschnittstext ohne "##", damit
// writeSection/writeBundleSection die Plan-Überschrift voranstellen. Mit
// `failWrites` wirft der Schreib-Call, damit der Fehler-Platzhalter aus
// writeSectionsBatch durch Proofread und Backstop läuft.
//
// Grenze: prüft die deterministische Marker-Logik um den Modell-Call herum,
// nicht das Modellverhalten.
import { describe, it, expect, vi, beforeEach } from 'vitest'

const mockState = vi.hoisted(() => {
  // Schutz vor echten Netz-Calls, falls ein Mock nicht greift: ohne Credentials
  // scheitert jedes Leck offline und kostenfrei, statt Prod anzusprechen.
  // tests/setup.ts hat .env.local bereits geladen; vi.hoisted läuft vor den
  // Imports dieser Datei.
  // - Anthropic — BEFUND 2026-10-06 (Prüferlauf): Testdatei außerhalb des
  //   Vite-Roots → vi.mock nicht gehoistet → 8 echte Opus-Calls (0,39 USD) und
  //   8 Zeilen in llm_usage über den after()-Fallback in lib/ai/usage-log.ts.
  //   Ohne Key wirft der echte Client beim ERSTEN Request „Could not resolve
  //   authentication method" (SDK 0.71, client.js:117) — vor jeder Kostenzeile.
  // - Google/Supabase — BEFUND 2026-10-06 (Prüferlauf): der Retrieval-Stub
  //   unten greift in den writeSectionsBatch-Tests nur für einen Teil der
  //   Aufrufe (gemessen: 4 von 8 findRelevantPastPosts-Aufrufen liefen ins
  //   echte Modul). Mit .env.local wären das je Lauf 4 Gemini-Embeddings und
  //   4 match_generated_posts-RPCs gegen Prod gewesen; der Fehler wird dort
  //   non-fatal geschluckt, die Tests blieben grün.
  for (const key of [
    'ANTHROPIC_API_KEY',
    'ANTHROPIC_AUTH_TOKEN',
    'GOOGLE_GENERATIVE_AI_API_KEY',
    'NEXT_PUBLIC_SUPABASE_URL',
    'SUPABASE_SERVICE_ROLE_KEY',
  ]) {
    delete process.env[key]
  }
  return { proofreadCalls: 0, failWrites: false }
})

vi.mock('@anthropic-ai/sdk', () => {
  class MockAnthropic {
    // BEFUND 2026-10-06: callModelNonStreaming (ghostwriter-pipeline.ts:1218)
    // prüft im catch `err instanceof Anthropic.APIError` — ein statisches Feld
    // der echten SDK-Klasse (client.d.ts:197). Fehlt es im Mock, wirft
    // `instanceof undefined` selbst („Right-hand side of 'instanceof' is not
    // an object"), und der Fehler-Platzhalter trüge DIESEN Text statt
    // „Mock-Schreibfehler". Die Vorlage article-jobs-batch.test.ts braucht das
    // Feld nicht, weil sie den Fehlerpfad nie auslöst. Hier reicht eine leere
    // Error-Unterklasse: der Check liefert false, der Original-Fehler wird
    // durchgereicht (kein Overload-Retry, kein Warten).
    static APIError = class APIError extends Error {
      status?: number
    }
    messages = {
      stream: (params: {
        system: Array<{ text: string }>
        messages: Array<{ content: Array<{ text: string }> }>
      }) => {
        const system = params.system?.[0]?.text ?? ''
        const content = params.messages?.[0]?.content ?? []
        const input = content[content.length - 1]?.text ?? ''
        const isProofread = system.startsWith('Du bist ein professioneller deutscher Lektor')
        if (!isProofread && mockState.failWrites) throw new Error('Mock-Schreibfehler')
        let text = 'Erster Satz. Zweiter Satz. Dritter Satz.\n\nSynthszr Take: Take eins. Take zwei. Take drei.'
        if (isProofread) {
          mockState.proofreadCalls++
          text = input.replace(/ <!--[^>]*-->/g, '')
        }
        return (async function* () {
          yield { type: 'content_block_delta', delta: { type: 'text_delta', text } }
        })()
      },
    }
  }
  return { default: MockAnthropic }
})

// Retrieval-Module stubben: writeSection/writeBundleSection importieren sie
// dynamisch (ghostwriter-pipeline.ts:593/605, :941/950). Der Stub ist die erste
// Schicht, greift aber nicht verlässlich (s. BEFUND im vi.hoisted-Block oben;
// Ursache in Vitests Auflösung des dynamischen Imports nicht geklärt). Zweite
// Schicht: die Netz-Module darunter (Embedding, Supabase-Client), auf die auch
// ein ins echte Modul durchgerutschter Aufruf trifft — embedQuery liefert []
// und findRelevantPastPosts kehrt vor dem RPC zurück. Dritte Schicht: die
// gelöschten Credentials oben.
vi.mock('@/lib/posts/historical-retrieval', () => ({
  findRelevantPastPosts: async () => [],
  formatPastPostsForPrompt: () => '',
}))
vi.mock('@/lib/mattes/retrieval', () => ({
  findRelevantMattesPassages: async () => [],
  formatPassagesForPrompt: () => '',
}))
vi.mock('@/lib/search/embeddings', () => ({ embedQuery: async () => [] }))
vi.mock('@/lib/embeddings/generator', () => ({ generateEmbedding: async () => [] }))
vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: () => {
    throw new Error('ghostwriter-queue-id-marker.test.ts: kein Supabase-Zugriff im Test')
  },
}))

import {
  writeSection,
  writeBundleSection,
  writeSectionsBatch,
  type ArticlePlan,
  type PipelineItem,
  type SectionContext,
} from '@/lib/claude/ghostwriter-pipeline'

const MODEL = 'claude-opus-4-8' as never

function item(id: string, bundle_type: 'topic' | null, contentLength = 20): PipelineItem {
  return {
    id,
    title: `Titel ${id}`,
    content: 'x'.repeat(contentLength),
    source_display_name: `Quelle ${id}`,
    source_url: null,
    source_identifier: `src-${id}`,
    bundle_type,
  }
}

const sectionCtx = {
  relevantCompanies: { public: [] as string[], premarket: [] as string[] },
  cacheableUserPrefix: 'prefix',
}

const firstLine = (s: string) => s.split('\n')[0]

describe('writeSection — Queue-ID-Marker', () => {
  it('hängt data-queue-item-ids mit der Item-ID an die H2-Zeile (kein Bündel-Marker)', async () => {
    const section = await writeSection(item('id-1', null), 'Überschrift eins', MODEL, sectionCtx)
    expect(firstLine(section)).toBe('## Überschrift eins <!-- data-queue-item-ids:id-1 -->')
    expect(section).not.toContain('data-bundle-type')
  })
})

describe('writeBundleSection — beide Marker', () => {
  it('trägt data-queue-item-ids (alle Member in Quellen-Reihenfolge) UND data-bundle-type als letzten Kommentar', async () => {
    const section = await writeBundleSection(
      [item('id-1', 'topic'), item('id-2', 'topic')],
      'topic',
      'Thema des Tages',
      MODEL,
      sectionCtx,
    )
    expect(firstLine(section)).toBe(
      '## Thema des Tages <!-- data-queue-item-ids:id-1,id-2 --> <!-- data-bundle-type:topic -->',
    )
  })
})

describe('writeSectionsBatch — Backstop nach Proofread', () => {
  // Units (buildBundleWriteUnits): bundle(topic: id-1,id-2) → single(Einzelfassung
  // des stärksten Items = id-1, längster Content, Heading des Bündels) → single(id-3).
  const items = [item('id-1', 'topic', 300), item('id-2', 'topic', 100), item('id-3', null)]
  const plan: ArticlePlan = {
    thesis: 't',
    ordering: [1, 2, 3],
    headings: { '1': 'Heading 1', '2': 'Heading 2', '3': 'Heading 3' },
    takeAngles: {},
    retrievalHints: {},
    articleTitle: 'T',
    excerptBullets: ['a', 'b', 'c'],
    category: 'AI & Tech',
    introParagraph: 'i',
  }
  const ctx: SectionContext = {
    cacheableUserPrefix: 'prefix',
    companiesPerItem: new Map(),
    metadataBlock: 'meta',
    loadedPatterns: [],
  }

  beforeEach(() => {
    mockState.proofreadCalls = 0
    mockState.failWrites = false
  })

  it('ergänzt fehlende Marker auf Bündel UND Einzelabschnitten, nachdem der Proofread sie entfernt hat', async () => {
    const res = await writeSectionsBatch(items, plan, ctx, 0, MODEL, 'medium', Infinity, Date.now(), MODEL)

    expect(res.done).toBe(true)
    expect(res.sections).toHaveLength(3)
    // Der Proofread lief für jede Section und hat die Kommentare entfernt —
    // sonst bewiese der Test nichts über den Backstop.
    expect(mockState.proofreadCalls).toBe(3)
    expect(firstLine(res.sections[0])).toBe(
      '## Heading 1 <!-- data-queue-item-ids:id-1,id-2 --> <!-- data-bundle-type:topic -->',
    )
    expect(firstLine(res.sections[1])).toBe('## Heading 1 <!-- data-queue-item-ids:id-1 -->')
    expect(firstLine(res.sections[2])).toBe('## Heading 3 <!-- data-queue-item-ids:id-3 -->')
  })

  it('setzt die Marker auch auf Fehler-Platzhalter (Schreib-Call wirft), damit die Unit-Zuordnung beim Nachschreiben erhalten bleibt', async () => {
    mockState.failWrites = true
    const res = await writeSectionsBatch(items, plan, ctx, 0, MODEL, 'medium', Infinity, Date.now(), MODEL)

    expect(res.sections).toHaveLength(3)
    expect(mockState.proofreadCalls).toBe(3)
    // Platzhalter aus writeSectionsBatch (`## ${heading}\n\n*Fehler: …*`);
    // shortenBySentences behält mindestens einen Satz, der Body überlebt.
    // Der Fehlertext ist der ORIGINAL-Fehler des Mocks — Voraussetzung ist
    // das statische APIError im Mock (s. Kommentar oben).
    for (const section of res.sections) expect(section).toContain('*Fehler: Mock-Schreibfehler*')
    expect(firstLine(res.sections[0])).toBe(
      '## Heading 1 <!-- data-queue-item-ids:id-1,id-2 --> <!-- data-bundle-type:topic -->',
    )
    expect(firstLine(res.sections[1])).toBe('## Heading 1 <!-- data-queue-item-ids:id-1 -->')
    expect(firstLine(res.sections[2])).toBe('## Heading 3 <!-- data-queue-item-ids:id-3 -->')
  })
})

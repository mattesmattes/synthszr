import { NextRequest, NextResponse } from 'next/server'
import Anthropic from '@anthropic-ai/sdk'
import OpenAI from 'openai'
import { GoogleGenerativeAI } from '@google/generative-ai'
import { createAdminClient } from '@/lib/supabase/admin'
import { getSession } from '@/lib/auth/session'
import { resolveModel } from '@/lib/claude/ghostwriter'
import { getModelForUseCase } from '@/lib/ai/model-config'
import { parseTiptapContent, convertTiptapToMarkdown } from '@/lib/utils/tiptap-to-markdown'
import { markdownToTiptapServer } from '@/lib/utils/markdown-to-tiptap-server'
import { extractSections, selectSectionsForEnrich } from '@/lib/enrich/sections'
import { linkPostContent } from '@/lib/glossary/backfill'
import { getMatcherTerms, getChartProductNames, buildReservedNames } from '@/lib/glossary/terms'
import type { TiptapDoc, TiptapNode } from '@/lib/email/tiptap-to-html'

export const runtime = 'nodejs'
// Sequenziell verarbeitete Abschnitte (typisch 4-6: Take + Top 3 + Labels),
// jeder mit optionaler Web-Recherche — grosszuegiger als ein einzelner
// Sektions-Call braucht, aber Web-Suche kann pro Abschnitt mehrere Sekunden
// zusaetzlich kosten. Gleiche Groessenordnung wie die alte Editor-in-Chief-
// Route (600s), hier mit Marge nach unten, weil Abschnitte klein sind.
export const maxDuration = 500

/**
 * POST /api/enrich
 *
 * Body: { content: TipTap-JSON (ganzer Artikel), model?: string }
 *
 * Ersetzt die alte Editor-in-Chief-Route (2026-08-31). Arbeitet NICHT auf dem
 * ganzen Artikel in einem Rutsch, sondern waehlt serverseitig eine Teilmenge
 * der H2-Abschnitte aus (lib/enrich/sections.ts: Synthszr-Take-Abschnitt
 * immer, sonst Top 3 nach news_queue.total_score UNION alle mit Bundle-Label)
 * und verarbeitet JEDEN EINZELN — nicht gewaehlte Abschnitte bleiben
 * unangetastet. Streamt pro Abschnitt ein Ereignis, damit bereits fertige
 * Abschnitte im Editor sichtbar bleiben, auch wenn ein spaeterer scheitert.
 *
 * Output-Protokoll (SSE-artig, newline-delimited JSON):
 *   {started, totalSections, model, promptName}
 *   {sectionStart, index, headingText}                    — vor jedem Abschnitt
 *   {sectionDone, index, nodes}                            — TipTap-Knoten des ueberarbeiteten Abschnitts
 *   {sectionError, index, error}                           — Abschnitt bleibt im Editor unveraendert
 *   {done, processed, errors}                              — einmal am Ende
 */
export async function POST(request: NextRequest) {
  const session = await getSession()
  if (!session?.isAdmin) {
    return NextResponse.json({ error: 'Nicht autorisiert' }, { status: 401 })
  }

  const body = await request.json().catch(() => ({}))
  const { content, model: requestedModel } = body as {
    content?: Record<string, unknown>
    model?: string
  }

  if (!content || typeof content !== 'object') {
    return NextResponse.json({ error: 'content (TipTap-JSON) erforderlich' }, { status: 400 })
  }

  const doc = parseTiptapContent(content)
  if (!doc) {
    return NextResponse.json({ error: 'TipTap-Content ist nicht parsebar' }, { status: 400 })
  }

  const supabase = createAdminClient()

  const { data: promptRow, error: promptErr } = await supabase
    .from('enrich_prompts')
    .select('id, name, prompt_text')
    .eq('is_active', true)
    .eq('is_archived', false)
    .order('updated_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (promptErr) {
    return NextResponse.json({ error: promptErr.message }, { status: 500 })
  }
  if (!promptRow) {
    return NextResponse.json({ error: 'Kein aktiver Enrich-Prompt gefunden' }, { status: 400 })
  }

  const allSections = extractSections(doc)
  const queueItemIds = [...new Set(allSections.map((s) => s.queueItemId).filter((id): id is string => Boolean(id)))]

  let scores = new Map<string, number>()
  if (queueItemIds.length > 0) {
    const { data: scoreRows } = await supabase
      .from('news_queue')
      .select('id, total_score')
      .in('id', queueItemIds)
    scores = new Map((scoreRows ?? []).map((r) => [r.id as string, Number(r.total_score) || 0]))
  }

  const sections = selectSectionsForEnrich(allSections, scores)

  const modelStr = requestedModel || (await getModelForUseCase('enrich').catch(() => 'claude-sonnet-5'))
  const resolved = resolveModel(modelStr) || resolveModel('claude-sonnet-5')!

  // Glossar-Begriffsliste EINMAL vorab laden (nicht pro Abschnitt) — Grundlage
  // fuer die Re-Verlinkung nach jedem Abschnitt, s. Kommentar bei linkPostContent
  // weiter unten. Schlaegt das Laden fehl, bleiben Glossar-Links des Abschnitts
  // unverlinkt statt den ganzen Lauf zu blockieren (gleiche Fallback-Haltung wie
  // lib/glossary/dedupe-run.ts).
  const glossaryTerms = await getMatcherTerms('de').catch(() => null)
  const glossaryReserved = glossaryTerms ? buildReservedNames(await getChartProductNames()) : []

  const encoder = new TextEncoder()
  const stream = new ReadableStream({
    async start(controller) {
      const send = (obj: Record<string, unknown>) =>
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(obj)}\n\n`))

      send({ started: true, totalSections: sections.length, model: modelStr, promptName: promptRow.name })

      let processed = 0
      let errors = 0

      for (const section of sections) {
        const sectionNodes = doc.content!.slice(section.startIndex, section.endIndex)
        send({
          sectionStart: true,
          queueItemId: section.queueItemId,
          isTake: section.isTake,
          headingText: section.headingText,
        })

        try {
          const sectionMarkdown = convertTiptapToMarkdown(
            { type: 'doc', content: sectionNodes } as TiptapDoc,
            { preserveCompanyTags: true },
          )
          if (!sectionMarkdown.trim()) throw new Error('Abschnitt ergibt leeren Markdown')

          const userMessage = buildSectionMessage(promptRow.prompt_text, sectionMarkdown, section.isTake)
          const revisedMarkdown = await runSection(userMessage, resolved)

          const revisedDoc = await markdownToTiptapServer(revisedMarkdown)
          const revisedContent = (revisedDoc as { content?: TiptapNode[] }).content
          if (!Array.isArray(revisedContent) || revisedContent.length === 0) {
            throw new Error('Modell lieferte keinen verwertbaren Abschnitt zurück')
          }

          // KRITISCH: queueItemId/bundleType ueberleben den Markdown-Rundgang
          // NICHT (convertTiptapToMarkdown schreibt sie beim Heading-Fall nicht
          // mit raus, s. lib/utils/tiptap-to-markdown.ts) — deshalb hier explizit
          // auf die neue erste Heading-Node zurueckschreiben, sonst brechen
          // Thumbnail-Matching und Label-Anzeige fuer JEDEN enriched Abschnitt.
          // Fehlt die Heading-Node (Modell haelt sich nicht an die Formatvorgabe),
          // lieber laut scheitern als Metadaten still zu verlieren — der Abschnitt
          // bleibt dann im Editor unveraendert (catch-Block).
          const firstNode = revisedContent[0]
          if (firstNode?.type !== 'heading') {
            throw new Error('Modell-Antwort beginnt nicht mit einer Überschrift — Abschnitt verworfen')
          }
          firstNode.attrs = {
            ...(firstNode.attrs || {}),
            ...(section.queueItemId ? { queueItemId: section.queueItemId } : {}),
            ...(section.bundleType ? { bundleType: section.bundleType } : {}),
          }

          // Glossar-Links (Mark-Typ 'glossaryLink') ueberleben den Markdown-
          // Rundgang ebenfalls NICHT — renderTextNode() in tiptap-to-markdown.ts
          // kennt nur den Standard-Mark 'link', der eigene glossaryLink-Typ wird
          // beim Serialisieren stillschweigend fallengelassen (Text bleibt,
          // Verlinkung verschwindet). Deshalb hier deterministisch neu setzen,
          // statt zu hoffen, dass sie den Rundgang ueberstehen — injectGlossaryMarks
          // ist idempotent (entfernt zuerst alle glossaryLink-Marks, setzt sie dann
          // anhand des AKTUELLEN, ggf. umformulierten Texts neu). Bereits bestehende
          // 'link'-Marks (Quellen-/Stock-Links) werden dabei uebersprungen, s.
          // lib/glossary/inject-marks.ts.
          let revisedContentAfterLinking = revisedContent
          if (glossaryTerms) {
            const relinked = linkPostContent(
              { type: 'doc', content: revisedContent },
              glossaryTerms,
              glossaryReserved,
            )
            const relinkedContent = (relinked.content as { content?: TiptapNode[] } | null)?.content
            if (Array.isArray(relinkedContent)) revisedContentAfterLinking = relinkedContent
          }

          send({
            sectionDone: true,
            queueItemId: section.queueItemId,
            isTake: section.isTake,
            nodes: revisedContentAfterLinking,
          })
          processed++
        } catch (err) {
          console.error('[Enrich] Abschnitt fehlgeschlagen:', section.headingText, err)
          send({
            sectionError: true,
            queueItemId: section.queueItemId,
            isTake: section.isTake,
            headingText: section.headingText,
            error: err instanceof Error ? err.message : 'Unbekannter Fehler',
          })
          errors++
        }
      }

      send({ done: true, processed, errors })
      controller.close()
    },
  })

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      'X-Accel-Buffering': 'no',
      Connection: 'keep-alive',
    },
  })
}

function buildSectionMessage(promptText: string, sectionMarkdown: string, isTake: boolean): string {
  return `${promptText}

---
${isTake ? '\nHINWEIS: Dieser Abschnitt IST der Synthszr Take — wende Aufgabe 3 an.\n' : ''}
Hier ist der zu überarbeitende Abschnitt (Markdown, beginnt mit einer Überschrift):

\`\`\`markdown
${sectionMarkdown}
\`\`\`

---

ANTWORT-FORMAT (verbindlich):
- Gib AUSSCHLIESSLICH den überarbeiteten Abschnitt zurück, beginnend mit derselben Überschrift.
- KEIN Vorwort, KEINE Erklärung deiner Änderungen.
- KEIN umschließender \`\`\`markdown … \`\`\` Codeblock — nur der rohe Markdown-Text.
- Zeilen mit "→ [Quellenname](URL)" oder "{Company}"/"{lex:Begriff}"-Tags in geschweiften Klammern WÖRTLICH und an derselben Stelle belassen — niemals löschen, umformulieren, verschieben oder die URL verändern. Das sind strukturelle Marker, keine Prosa.`
}

// Ein Abschnitt = ein einziger, NICHT gestreamter Modell-Aufruf (Abschnitte
// sind klein, Token-fuer-Token-Streaming lohnt sich hier nicht — der Client
// bekommt stattdessen ein Fortschritts-Event pro fertigem Abschnitt).
async function runSection(
  userMessage: string,
  resolved: { provider: 'anthropic' | 'openai' | 'google'; modelId: string },
): Promise<string> {
  if (resolved.provider === 'anthropic') {
    const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
    // web_search ist ein server-seitiges Anthropic-Tool: die Suche laeuft
    // INNERHALB dieses einen Aufrufs, kein eigener Round-Trip noetig (gleiches
    // Muster wie lib/rankings/research.ts). max_uses begrenzt Kosten/Latenz
    // pro Abschnitt.
    const resp = await anthropic.messages.create({
      model: resolved.modelId,
      max_tokens: 8000,
      tools: [{ type: 'web_search_20250305', name: 'web_search', max_uses: 4 }],
      messages: [{ role: 'user', content: userMessage }],
    })
    const text = resp.content
      .filter((b): b is Anthropic.TextBlock => b.type === 'text')
      .map((b) => b.text)
      .join('')
    return stripMarkdownWrapper(text)
  } else if (resolved.provider === 'openai') {
    // Kein web_search-Aequivalent verdrahtet — Recherche-Teil des Prompts
    // greift hier nicht, Fluessigkeit/Take-Schaerfe funktionieren trotzdem.
    const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY })
    const resp = await openai.chat.completions.create({
      model: resolved.modelId,
      max_completion_tokens: 8000,
      messages: [{ role: 'user', content: userMessage }],
    })
    return stripMarkdownWrapper(resp.choices[0]?.message?.content || '')
  } else {
    const genAI = new GoogleGenerativeAI(process.env.GOOGLE_GENERATIVE_AI_API_KEY || '')
    const m = genAI.getGenerativeModel({ model: resolved.modelId })
    const result = await m.generateContent(userMessage)
    return stripMarkdownWrapper(result.response.text())
  }
}

function stripMarkdownWrapper(raw: string): string {
  const s = raw.trim()
  const fenceStart = s.match(/^```(?:markdown|md)?\s*\n/i)
  if (!fenceStart) return s
  const after = s.slice(fenceStart[0].length)
  const lastFence = after.lastIndexOf('```')
  if (lastFence === -1) return after
  return after.slice(0, lastFence).trimEnd()
}

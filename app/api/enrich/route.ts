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
import { extractSections, sectionMatchesKey, type SectionKey } from '@/lib/enrich/sections'
import { ANTI_LLM_STYLE_RULES } from '@/lib/enrich/style-rules'
import { linkPostContent } from '@/lib/glossary/backfill'
import { getMatcherTerms, getChartProductNames, buildReservedNames } from '@/lib/glossary/terms'
import type { TiptapDoc, TiptapNode } from '@/lib/email/tiptap-to-html'

export const runtime = 'nodejs'
// Sequenziell verarbeitete Abschnitte — seit der Umstellung auf "alle
// Abschnitte" (Betreiber-Vorgabe 2026-08-31) potenziell die volle Artikellaenge
// (auch 10+ News-Items pro Post), nicht mehr nur 4-6. Deshalb hoeher als die
// alte Editor-in-Chief-Route (600s) angesetzt — an der Obergrenze, die dieses
// Projekt an anderer Stelle bereits nutzt (article-job-Route, 800s).
export const maxDuration = 800

// Bewusst ABWEICHEND von TAKE_MAX_SENTENCES (5, lib/claude/take-cap.ts) — das
// ist der Zielwert bei der Erst-Generierung, dieser hier gilt NUR fuer den
// Enrich-Durchlauf (Betreiber-Korrektur 2026-08-31/09-01). Als benannte
// Konstante statt Magic Number in der Prompt-Vorlage, damit eine spaetere
// Aenderung nicht in einem langen Template-String gesucht werden muss.
const ENRICH_TAKE_TARGET_SENTENCES = 4
const ENRICH_MAX_LENGTH_GROWTH_PERCENT = 20

// PROD-BEFUND 2026-09-01: ein Artikel mit 18 Abschnitten (seit "alle
// Abschnitte statt Top-5", Betreiber-Vorgabe 2026-08-31) ueberschritt bei
// Websuche pro Abschnitt das maxDuration-Limit — Vercel kappte die Funktion
// mitten im Lauf, der Client sah nur "Enrich-Stream endete ohne
// Abschluss-Ereignis" (lib/enrich/run-stream.ts). Statt maxDuration weiter
// hochzudrehen (bricht bei noch mehr Abschnitten wieder), verarbeitet EIN
// Aufruf jetzt nur so viele Abschnitte, wie sicher ins Zeitbudget passen,
// beendet den Stream dann SAUBER mit needsContinuation:true, und
// runEnrichOnTiptap (lib/enrich/run-stream.ts) stoesst automatisch einen
// Folge-Request an. 150s Marge vor den 800s maxDuration fuer den zuletzt
// gestarteten Abschnitt (inkl. moeglicher Overload-Retries, s.
// ghostwriter-pipeline.ts) und den Verbindungsaufbau.
const SOFT_TIME_BUDGET_MS = 650_000

/**
 * POST /api/enrich
 *
 * Body: { content: TipTap-JSON (ganzer Artikel), model?: string }
 *
 * Ersetzt die alte Editor-in-Chief-Route (2026-08-31). Arbeitet NICHT auf dem
 * ganzen Artikel in einem Rutsch, sondern zerlegt ihn in H2-Abschnitte
 * (lib/enrich/sections.ts) und verarbeitet ALLE EINZELN (Betreiber-Vorgabe
 * 2026-08-31, geaendert am selben Tag — urspruenglich nur eine Teilmenge).
 * Streamt pro Abschnitt ein Ereignis, damit bereits fertige Abschnitte im
 * Editor sichtbar bleiben, auch wenn ein spaeterer scheitert.
 *
 * buildSectionMessage haengt an den DB-Prompt einen fest codierten Regelblock
 * an, der NICHT der Admin-UI ueberlassen ist (Betreiber-Korrektur 2026-08-31,
 * nach Praxis-Feedback auf einem echten Artikel):
 *  - Take-Laenge: jeder eingebettete "Synthszr Take:"-Absatz (nicht nur in
 *    Bundle-Abschnitten — jeder Abschnitt kann einen tragen, s.
 *    lib/claude/take-cap.ts) UND der eine abschliessende Post-Take
 *    (isTake-Abschnitt) auf ENRICH_TAKE_TARGET_SENTENCES bringen.
 *  - Laengenbegrenzung: Fliesstext maximal ENRICH_MAX_LENGTH_GROWTH_PERCENT
 *    laenger als die Vorlage (Recherche-Ergaenzungen ersetzen/verdichten
 *    statt zu addieren).
 *  - ANTI_LLM_STYLE_RULES (lib/enrich/style-rules.ts): Kernregeln aus dem
 *    Mattes-Schreibe-Skill (keine Gedankenstriche, keine "Nicht X, sondern
 *    Y"-Konstruktionen, keine toten KI-Uebergaenge).
 * Alle drei sind Code-Konstanten, nicht Teil des editierbaren DB-Prompts —
 * der globale TAKE_MAX_SENTENCES-Cap (5) fuer die normale Ghostwriter-
 * Generierung bleibt unangetastet, das hier gilt nur innerhalb von Enrich.
 *
 * WICHTIG fuer buildSectionMessage: Der Regelblock ist ABSICHTLICH NICHT
 * durchnummeriert als "Aufgabe N", weil die DB-Prompt-Aufgabenliste selbst
 * vom Nutzer editierbar ist (aktuell 1-3, mal mit doppelter "3." — Admin-UI
 * "Enrich-Prompts"). Eine feste Nummer wie "Aufgabe 4" wuerde bei jeder
 * Aenderung der DB-Nummerierung mit ihr kollidieren oder falsch anschliessen.
 * Stattdessen ein eigener, klar abgegrenzter Abschnitt mit Ueberschrift.
 *
 * Fortsetzbar (Betreiber-Korrektur 2026-09-01, s. Kommentar bei
 * SOFT_TIME_BUDGET_MS): ein einzelner Aufruf verarbeitet nur so viele
 * Abschnitte, wie sicher ins Zeitbudget passen, und meldet das im
 * done-Ereignis (needsContinuation). runEnrichOnTiptap (lib/enrich/
 * run-stream.ts) stoesst bei Bedarf automatisch einen Folge-Aufruf an, mit
 * excludeKeys fuer die bereits verarbeiteten Abschnitte — fuer die vier
 * Admin-Aufrufstellen ist das transparent, deren onSectionDone/onSectionError
 * werden einfach ueber mehrere HTTP-Requests hinweg weiter aufgerufen.
 *
 * Output-Protokoll (SSE-artig, newline-delimited JSON):
 *   {started, totalSections, model, promptName}
 *   {sectionStart, queueItemId, isTake, headingText}       — vor jedem Abschnitt
 *   {sectionDone, queueItemId, isTake, nullIndex, nodes}   — TipTap-Knoten des ueberarbeiteten Abschnitts
 *   {sectionError, queueItemId, isTake, nullIndex, headingText, error} — Abschnitt bleibt im Editor unveraendert
 *   {done, processed, errors, needsContinuation}           — einmal am Ende jedes Aufrufs
 */
export async function POST(request: NextRequest) {
  const session = await getSession()
  if (!session?.isAdmin) {
    return NextResponse.json({ error: 'Nicht autorisiert' }, { status: 401 })
  }

  const body = await request.json().catch(() => ({}))
  const { content, model: requestedModel, excludeKeys } = body as {
    content?: Record<string, unknown>
    model?: string
    /** Abschnitte, die ein vorheriger Aufruf (Fortsetzung nach
     *  needsContinuation) bereits verarbeitet hat — werden hier
     *  uebersprungen (sectionMatchesKey, lib/enrich/sections.ts). */
    excludeKeys?: SectionKey[]
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
  const sections = excludeKeys?.length
    ? allSections.filter((s) => !excludeKeys.some((k) => sectionMatchesKey(s, k)))
    : allSections

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

      const startedAt = Date.now()
      let processed = 0
      let errors = 0
      let needsContinuation = false

      for (const section of sections) {
        // Abschnitts-Grenze pruefen, nicht mittendrin: ein einmal gestarteter
        // Abschnitt laeuft immer zu Ende, sonst gaebe es einen halb
        // angewendeten Zustand. Sicher genug, weil ein einzelner Abschnitt
        // inklusive Overload-Retries (ghostwriter-pipeline.ts) die 150s Marge
        // bis maxDuration nicht ausschoepft.
        if (Date.now() - startedAt > SOFT_TIME_BUDGET_MS) {
          needsContinuation = true
          break
        }
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
            nullIndex: section.nullIndex,
            nodes: revisedContentAfterLinking,
          })
          processed++
        } catch (err) {
          console.error('[Enrich] Abschnitt fehlgeschlagen:', section.headingText, err)
          send({
            sectionError: true,
            queueItemId: section.queueItemId,
            isTake: section.isTake,
            nullIndex: section.nullIndex,
            headingText: section.headingText,
            error: err instanceof Error ? err.message : 'Unbekannter Fehler',
          })
          errors++
        }
      }

      send({ done: true, processed, errors, needsContinuation })
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

function buildSectionMessage(
  promptText: string,
  sectionMarkdown: string,
  isTake: boolean,
): string {
  const takeRule = isTake
    ? `Dieser Abschnitt IST der Synthszr Take — bringe ihn zusätzlich zu den Aufgaben oben auf GENAU ${ENRICH_TAKE_TARGET_SENTENCES} vollständige Sätze, nicht mehr, nicht weniger.`
    : `Falls dieser Abschnitt — an beliebiger Stelle, unabhängig von seiner Überschrift und unabhängig davon, welche der obigen Aufgaben hier laut ihrer eigenen Bedingung greifen — einen mit "Synthszr Take:" beginnenden Absatz enthält, bringe GENAU diesen Absatz auf GENAU ${ENRICH_TAKE_TARGET_SENTENCES} vollständige Sätze. Beim Kürzen die schwächste Teilaussage streichen, nicht wahllos Wörter sparen. Ist der Absatz schon kürzer, sinnvoll ergänzen, ohne neue Fakten zu erfinden.`

  return `${promptText}

---

VERBINDLICHE ZUSATZREGELN (gelten für JEDEN Abschnitt, zusätzlich zu den Aufgaben oben, unabhängig von deren Nummerierung):

TAKE-LÄNGE: ${takeRule}

LÄNGENBEGRENZUNG: Der überarbeitete Fließtext des Abschnitts (ohne Überschrift, Tags, Quellenzeile) darf höchstens ${ENRICH_MAX_LENGTH_GROWTH_PERCENT}% länger sein als die Vorlage, gemessen in Wörtern. Recherche-Ergänzungen ERSETZEN oder VERDICHTEN bestehenden Text, statt ihn zu addieren — wähle die wichtigste Ergänzung, nicht alle.

${ANTI_LLM_STYLE_RULES}

---

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

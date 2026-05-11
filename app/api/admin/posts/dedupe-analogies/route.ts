/**
 * POST /api/admin/posts/dedupe-analogies
 *
 * Re-run that focuses on one job: make sure no analogy/metaphor is
 * reused across multiple Synthszr Takes within the same article.
 *
 * Flow:
 *   1. Split incoming markdown into Synthszr Take blocks.
 *   2. Single LLM call extracts the central analogy concept per take.
 *   3. Group by canonical concept (case-insensitive substring match).
 *   4. For every duplicate (skip the first occurrence), rewrite that
 *      take with a fresh analogy from a sophisticated domain pool,
 *      forbidding all analogies already used in the article.
 *   5. Stitch the revised takes back into the markdown and return.
 *
 * Streams progress events (SSE-style data: lines) so the admin UI can
 * show "Analysiere Analogien…" / "Schreibe Take 4/N um…" / "Fertig".
 */

import { NextRequest } from 'next/server'
import Anthropic from '@anthropic-ai/sdk'
import { getSession } from '@/lib/auth/session'
import { resolveModel } from '@/lib/claude/ghostwriter'
import { getModelForUseCase } from '@/lib/ai/model-config'

export const runtime = 'nodejs'
export const maxDuration = 300

interface TakeBlock {
  /** Position in the markdown — used to splice the rewrite back in. */
  start: number
  end: number
  /** The full block including "Synthszr Take:" prefix. */
  fullText: string
  /** Body without the "Synthszr Take:" prefix. */
  body: string
}

interface AnalogyExtraction {
  index: number
  /** Short canonical label (≤ 4 words), e.g. "Reinsurance", "Bauleitplanung". */
  analogy: string
  /** Source domain bucket, e.g. "Versicherung", "Pharma", "Stadtplanung". */
  domain: string
}

const SOPHISTICATED_DOMAINS = [
  'Pharma-Studien & FDA-Trigger (Phase-3, DMC, Zulassungspfade)',
  'Sarbanes-Oxley & Wirtschaftsprüfung',
  'Versicherungsmathematik & Reinsurance',
  'Stadtplanung & Bauleitplanung',
  'Mikrobiologie & Habitat-Dynamik',
  'Architekturgeschichte (Bauhaus, Brutalismus, Form-Follows-Function)',
  'Maritime Logistik & Containerisierung',
  'Patentrecht & Standardessenzielle Patente',
  'Geldpolitik & Notenbank-Mechanik',
  'Gerichtsverfahren & Beweislast',
  'Akkordlohn & Fertigungslogik',
  'Notariatswesen',
  'Treuhand-Abwicklung',
  'Pharma-Generika nach Patentablauf',
  'Spritzguss & Werkzeugbau',
  'Reedereiwesen & Charter-Verträge',
]

const FORBIDDEN_TRIVIAL_ANALOGIES = [
  'Schachbrett',
  'David vs Goliath',
  'Race to the bottom',
  'Highway',
  'Lego',
  'Marathon vs Sprint',
  'Goldgräberstimmung',
  'Wilder Westen',
  'McDonald\'s',
  'DNA',
  'Goldrausch',
  'Gladiatorenkampf',
  'Trojanisches Pferd',
  'Restaurant',
  'Beichtstuhl',
  'Impfstoff',
  'Kreditkarte',
  'Therapeut',
]

const RERANK_FALLBACK_MODEL = 'claude-sonnet-4-6-20260301'

function send(controller: ReadableStreamDefaultController<Uint8Array>, encoder: TextEncoder, obj: Record<string, unknown>) {
  controller.enqueue(encoder.encode(`data: ${JSON.stringify(obj)}\n\n`))
}

/**
 * Locate every "Synthszr Take:" block in the markdown. A block ends at
 * the next H2 (`##`), the next "---" rule, or end-of-file — whichever
 * comes first.
 */
function findTakeBlocks(markdown: string): TakeBlock[] {
  const blocks: TakeBlock[] = []
  const re = /Synthszr Take:\s*/g
  let m: RegExpExecArray | null
  while ((m = re.exec(markdown))) {
    const start = m.index
    // Find the end: next H2 line, next horizontal rule, or EOF.
    const rest = markdown.slice(start + m[0].length)
    const endMatchers = [
      rest.search(/\n##\s+/),
      rest.search(/\n---\s*\n/),
      rest.length,
    ].filter((n) => n >= 0)
    const relEnd = Math.min(...endMatchers)
    const end = start + m[0].length + relEnd
    const fullText = markdown.slice(start, end).trimEnd()
    const body = fullText.replace(/^Synthszr Take:\s*/i, '').trim()
    blocks.push({ start, end, fullText, body })
  }
  return blocks
}

/**
 * Normalize an analogy string for duplicate detection.
 */
function canonicalize(s: string): string {
  return s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9 ]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

export async function POST(request: NextRequest) {
  const session = await getSession()
  if (!session?.isAdmin) {
    return new Response(JSON.stringify({ error: 'Nicht autorisiert' }), { status: 401 })
  }

  const body = await request.json().catch(() => ({}))
  const { content } = body as { content?: string }
  if (!content || typeof content !== 'string' || content.trim().length === 0) {
    return new Response(JSON.stringify({ error: 'content (Markdown) erforderlich' }), { status: 400 })
  }

  const modelStr = await getModelForUseCase('ghostwriter').catch(() => RERANK_FALLBACK_MODEL)
  const resolved = resolveModel(modelStr) || resolveModel(RERANK_FALLBACK_MODEL)
  const modelId = resolved?.modelId || RERANK_FALLBACK_MODEL

  const encoder = new TextEncoder()
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      try {
        send(controller, encoder, { started: true, model: modelId })

        const takes = findTakeBlocks(content)
        send(controller, encoder, { stage: 'parsed', takeCount: takes.length })

        if (takes.length < 2) {
          send(controller, encoder, {
            done: true,
            content,
            takeCount: takes.length,
            duplicates: 0,
            rewrites: [],
            note: 'Weniger als zwei Synthszr Takes — keine Dedupe nötig.',
          })
          controller.close()
          return
        }

        const apiKey = process.env.ANTHROPIC_API_KEY
        if (!apiKey) {
          send(controller, encoder, { error: 'ANTHROPIC_API_KEY missing' })
          controller.close()
          return
        }
        const client = new Anthropic({ apiKey })

        // STEP 1: Single batch call to extract analogy + domain per take.
        send(controller, encoder, { stage: 'analyzing' })
        const numberedTakes = takes
          .map((t, i) => `<take index="${i + 1}">\n${t.body}\n</take>`)
          .join('\n\n')

        const analyzePrompt = `Du bist Editor-in-Chief des Synthszr Newsletters. Du bekommst ${takes.length} Synthszr Takes aus einem Artikel.

Extrahiere für JEDEN Take die zentrale Analogie/Metapher (das Bild, das den Take trägt).

Antworte AUSSCHLIESSLICH mit einem JSON-Array, ohne Markdown-Codeblock:
[
  { "index": 1, "analogy": "<kurze Bezeichnung max 4 Wörter>", "domain": "<Domäne, z.B. Versicherung, Pharma, Stadtplanung>" },
  ...
]

Wenn ein Take KEINE klare Analogie hat (rein argumentativ), schreibe analogy: "none".

TAKES:

${numberedTakes}`

        const analyzeResp = await client.messages.create({
          model: modelId,
          max_tokens: 2000,
          messages: [{ role: 'user', content: analyzePrompt }],
        })
        const analyzeText = analyzeResp.content
          .filter((b): b is Anthropic.TextBlock => b.type === 'text')
          .map((b) => b.text)
          .join('')
        const jsonMatch = analyzeText.match(/\[[\s\S]*\]/)
        if (!jsonMatch) {
          send(controller, encoder, { error: 'Analogie-Analyse: kein JSON gefunden', raw: analyzeText.slice(0, 300) })
          controller.close()
          return
        }
        const extractions = JSON.parse(jsonMatch[0]) as AnalogyExtraction[]

        send(controller, encoder, { stage: 'analyzed', extractions })

        // STEP 2: Bucket by canonical analogy. First occurrence wins.
        const seen = new Map<string, number>() // canonical → take index (1-based)
        const duplicates: Array<{ takeIndex: number; analogy: string; firstAt: number }> = []
        for (const ex of extractions) {
          if (!ex.analogy || ex.analogy.toLowerCase() === 'none') continue
          const key = canonicalize(ex.analogy)
          if (!key) continue
          if (seen.has(key)) {
            duplicates.push({ takeIndex: ex.index, analogy: ex.analogy, firstAt: seen.get(key)! })
          } else {
            seen.set(key, ex.index)
          }
        }

        send(controller, encoder, { stage: 'duplicates-identified', duplicates })

        if (duplicates.length === 0) {
          send(controller, encoder, {
            done: true,
            content,
            takeCount: takes.length,
            duplicates: 0,
            rewrites: [],
            note: 'Keine wiederholten Analogien gefunden.',
          })
          controller.close()
          return
        }

        // Collect every analogy currently in use so the rewriter avoids them.
        const usedAnalogies = new Set<string>()
        for (const ex of extractions) {
          if (ex.analogy && ex.analogy.toLowerCase() !== 'none') usedAnalogies.add(ex.analogy)
        }

        // STEP 3: Rewrite each duplicate take with a fresh analogy.
        // Rewrites accumulate; later duplicates see prior rewrites'
        // analogies as forbidden too (so we don't trade one duplicate
        // for another).
        const rewrites: Array<{ takeIndex: number; oldAnalogy: string; newTake: string }> = []
        let revisedMarkdown = content

        for (const dup of duplicates) {
          const take = takes[dup.takeIndex - 1]
          if (!take) continue

          const forbiddenList = Array.from(usedAnalogies).join(', ')
          send(controller, encoder, {
            stage: 'rewriting',
            takeIndex: dup.takeIndex,
            oldAnalogy: dup.analogy,
          })

          const rewritePrompt = `Du bist Editor-in-Chief des Synthszr Newsletters. Du schreibst einen Synthszr Take um.

GRUND: Die aktuelle Analogie ("${dup.analogy}") wird bereits in einem anderen Take dieses Artikels verwendet. Jede Analogie darf im Artikel nur EINMAL vorkommen.

REGELN:
- Behalte den Inhalt, die Argumentation und die Tonalität des Takes vollständig bei.
- Ersetze die alte Analogie durch eine NEUE, sophisticated Analogie aus einer dieser Domänen:
${SOPHISTICATED_DOMAINS.map((d) => '  - ' + d).join('\n')}
- VERBOTEN (schon im Artikel verwendet oder trivial): ${forbiddenList}, ${FORBIDDEN_TRIVIAL_ANALOGIES.join(', ')}
- Genau EINE zentrale Analogie, durchgezogen über mindestens zwei Sätze.
- Keine Em-Dashes (— oder –) als Satzteiler.
- Keine Kontrast-Konstruktionen ("Nicht X, sondern Y").
- 5–8 Sätze, freier Fluss, klare Haltung im letzten Satz.

Antworte AUSSCHLIESSLICH mit dem neuen Take-Text. Kein Präfix "Synthszr Take:", keine Erklärung, kein Markdown-Codeblock.

ALTER TAKE:
${take.body}`

          const rewriteResp = await client.messages.create({
            model: modelId,
            max_tokens: 800,
            messages: [{ role: 'user', content: rewritePrompt }],
          })
          const newBody = rewriteResp.content
            .filter((b): b is Anthropic.TextBlock => b.type === 'text')
            .map((b) => b.text)
            .join('')
            .trim()

          if (!newBody) {
            send(controller, encoder, { stage: 'rewrite-skipped', takeIndex: dup.takeIndex, reason: 'empty response' })
            continue
          }

          // Replace in markdown. We splice using the ORIGINAL `take.start`
          // / `take.end` — but markdown may have shifted from previous
          // rewrites, so locate-by-search using the original fullText.
          const newFullText = `Synthszr Take: ${newBody}`
          const idx = revisedMarkdown.indexOf(take.fullText)
          if (idx >= 0) {
            revisedMarkdown =
              revisedMarkdown.slice(0, idx) + newFullText + revisedMarkdown.slice(idx + take.fullText.length)
          }

          rewrites.push({ takeIndex: dup.takeIndex, oldAnalogy: dup.analogy, newTake: newBody })

          // Register a coarse keyword from the rewrite to discourage
          // accidental re-introduction by the next iteration.
          const firstLine = newBody.split(/[.,;]/)[0] || ''
          usedAnalogies.add(firstLine.slice(0, 60))
        }

        send(controller, encoder, {
          done: true,
          content: revisedMarkdown,
          takeCount: takes.length,
          duplicates: duplicates.length,
          rewrites,
        })
        controller.close()
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        console.error('[dedupe-analogies] Failed:', message)
        send(controller, encoder, { error: message })
        try { controller.close() } catch { /* already closed */ }
      }
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

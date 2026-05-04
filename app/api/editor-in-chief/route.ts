import { NextRequest, NextResponse } from 'next/server'
import Anthropic from '@anthropic-ai/sdk'
import OpenAI from 'openai'
import { GoogleGenerativeAI } from '@google/generative-ai'
import { createAdminClient } from '@/lib/supabase/admin'
import { getSession } from '@/lib/auth/session'
import { resolveModel } from '@/lib/claude/ghostwriter'
import { getModelForUseCase } from '@/lib/ai/model-config'

export const runtime = 'nodejs'
// Editor-in-Chief processes the full article in one shot — give it room.
export const maxDuration = 180

/**
 * POST /api/editor-in-chief
 *
 * Body: { content: string (markdown), model?: string }
 *
 * Streams the editor-in-chief LLM pass: takes the freshly generated
 * markdown article (with the TITLE/EXCERPT/CATEGORY frontmatter the
 * ghostwriter produces), runs it through the active editor_in_chief_prompts
 * row using the same model family as the ghostwriter, and streams the
 * revised markdown back. Frontend accumulates and replaces articleContent
 * on completion.
 *
 * Output protocol (SSE-like newline-delimited JSON):
 *   {model, started, promptName} — once at the start
 *   {text}                       — many, raw model token chunks
 *   {done, content}              — once at end with the full revised markdown
 *   {error}                      — once on failure
 */
export async function POST(request: NextRequest) {
  const session = await getSession()
  if (!session?.isAdmin) {
    return NextResponse.json({ error: 'Nicht autorisiert' }, { status: 401 })
  }

  const body = await request.json().catch(() => ({}))
  const { content, model: requestedModel } = body as {
    content?: string
    model?: string
  }

  if (!content || typeof content !== 'string' || content.trim().length === 0) {
    return NextResponse.json(
      { error: 'content (Markdown-Artikel als String) erforderlich' },
      { status: 400 }
    )
  }

  // Load the active editor-in-chief prompt
  const supabase = createAdminClient()
  const { data: promptRow, error: promptErr } = await supabase
    .from('editor_in_chief_prompts')
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
    return NextResponse.json(
      { error: 'Kein aktiver Editor-in-Chief-Prompt gefunden' },
      { status: 400 }
    )
  }

  // Resolve model: caller's choice → ghostwriter setting → default
  const modelStr =
    requestedModel ||
    (await getModelForUseCase('ghostwriter').catch(() => 'claude-sonnet-4'))
  const resolved = resolveModel(modelStr) || resolveModel('claude-sonnet-4')!

  const userMessage = buildUserMessage(promptRow.prompt_text, content)

  const encoder = new TextEncoder()
  const stream = new ReadableStream({
    async start(controller) {
      const send = (obj: Record<string, unknown>) =>
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(obj)}\n\n`))

      try {
        send({ started: true, model: modelStr, promptName: promptRow.name })

        let buffer = ''
        for await (const chunk of streamModel(userMessage, resolved)) {
          buffer += chunk
          send({ text: chunk })
        }

        // The model may wrap the markdown in a ```markdown … ``` codeblock —
        // strip that wrapper, but keep all internal fenced codeblocks intact.
        const cleaned = stripMarkdownWrapper(buffer)
        send({ done: true, content: cleaned, model: modelStr })
        controller.close()
      } catch (err) {
        console.error('[Editor-in-Chief] Stream error:', err)
        send({ error: err instanceof Error ? err.message : 'Unbekannter Fehler' })
        controller.close()
      }
    },
  })

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
    },
  })
}

function buildUserMessage(promptText: string, articleMarkdown: string): string {
  return `${promptText}

---

Hier ist der Artikel-Entwurf in Markdown. Die ersten Zeilen zwischen \`---\` enthalten Metadaten (TITLE, EXCERPT, CATEGORY). Behalte das Frontmatter-Format unverändert bei. Sortiere und überarbeite NUR den Body danach gemäß deiner Routine.

\`\`\`markdown
${articleMarkdown}
\`\`\`

---

ANTWORT-FORMAT (verbindlich):
- Gib AUSSCHLIESSLICH den vollständigen, überarbeiteten Markdown-Artikel zurück.
- INKL. dem unveränderten \`---\` … \`---\` Metadaten-Block am Anfang (passe nur EXCERPT-Bullets an, falls die H2-Reihenfolge sich ändert).
- KEIN Vorwort, KEINE Erklärung deiner Änderungen.
- KEIN umschließender \`\`\`markdown … \`\`\` Codeblock — nur der rohe Markdown-Text.`
}

// Strip a leading ```markdown … ``` codeblock if the model wraps the whole
// answer. Internal fenced blocks (e.g. code samples) inside the article
// are unaffected because we only peel the outermost fence.
function stripMarkdownWrapper(raw: string): string {
  const s = raw.trim()
  const fenceStart = s.match(/^```(?:markdown|md)?\s*\n/i)
  if (!fenceStart) return s
  const after = s.slice(fenceStart[0].length)
  const lastFence = after.lastIndexOf('```')
  if (lastFence === -1) return after
  return after.slice(0, lastFence).trimEnd()
}

async function* streamModel(
  userMessage: string,
  resolved: { provider: 'anthropic' | 'openai' | 'google'; modelId: string }
): AsyncGenerator<string, void, unknown> {
  // No system prompt here — the editor prompt is fully self-contained
  // and we don't want the ghostwriter's STRUCTURED-OUTPUT system prompt
  // bleeding through.
  if (resolved.provider === 'anthropic') {
    const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
    const stream = anthropic.messages.stream({
      model: resolved.modelId,
      max_tokens: 16384,
      messages: [{ role: 'user', content: userMessage }],
    })
    for await (const event of stream) {
      if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') {
        yield event.delta.text
      }
    }
  } else if (resolved.provider === 'openai') {
    const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY })
    const stream = await openai.chat.completions.create({
      model: resolved.modelId,
      max_completion_tokens: 16384,
      messages: [{ role: 'user', content: userMessage }],
      stream: true,
    })
    for await (const chunk of stream) {
      const text = chunk.choices[0]?.delta?.content
      if (text) yield text
    }
  } else {
    const genAI = new GoogleGenerativeAI(process.env.GOOGLE_GENERATIVE_AI_API_KEY || '')
    const m = genAI.getGenerativeModel({ model: resolved.modelId })
    const result = await m.generateContentStream(userMessage)
    for await (const chunk of result.stream) {
      const text = chunk.text()
      if (text) yield text
    }
  }
}

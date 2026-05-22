/**
 * Single-source client helper for the Editor-in-Chief pass.
 *
 * All three Re-Run trigger points (Blog-Posts edit dialog,
 * Generated-Articles edit dialog, Generated-Articles edit page) and
 * the manual button on the Create-Article page funnel through this
 * helper. Keeps the SSE-frame parsing, fallback-on-incomplete-stream
 * behaviour and status reporting in one place.
 */

export interface RunEditorInChiefOptions {
  /** Optional override; falls back to the ghostwriter use-case model. */
  model?: string | null
  /** Called with human-readable status strings as the stream progresses. */
  onStatus?: (msg: string) => void
}

export async function runEditorInChiefOnMarkdown(
  markdown: string,
  options: RunEditorInChiefOptions = {}
): Promise<string> {
  const { model, onStatus } = options

  const res = await fetch('/api/editor-in-chief', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify({ content: markdown, ...(model ? { model } : {}) }),
  })

  if (!res.ok || !res.body) {
    const errBody = await res.json().catch(() => ({}))
    throw new Error(errBody.error || `HTTP ${res.status}`)
  }

  const reader = res.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  let revised: string | null = null
  // Mirrors the create-article fallback: if the stream ends without a
  // `done` event (proxy timeout, edge disconnect) we keep whatever the
  // model already produced rather than dropping everything.
  let accumulatedText = ''

  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })

    const frames = buffer.split('\n\n')
    buffer = frames.pop() || ''
    for (const frame of frames) {
      const line = frame.trim()
      if (!line.startsWith('data:')) continue
      const json = line.slice(5).trim()
      if (!json) continue
      try {
        const evt = JSON.parse(json)
        if (evt.started && onStatus) {
          onStatus(`Editor-in-Chief läuft (${evt.promptName || 'Default'}, ${evt.model})…`)
        }
        if (typeof evt.text === 'string') accumulatedText += evt.text
        if (evt.error) throw new Error(evt.error)
        if (evt.done && typeof evt.content === 'string') {
          revised = evt.content
        }
      } catch (e) {
        if (e instanceof SyntaxError) continue
        throw e
      }
    }
  }

  if (!revised && accumulatedText.trim().length > 0) {
    console.warn('[Editor-in-Chief] Stream ended without done event — using accumulated text', {
      accumulatedLength: accumulatedText.length,
    })
    revised = accumulatedText
  }
  if (!revised) throw new Error('Editor-in-Chief lieferte keinen finalen Inhalt — der Stream hat nichts produziert')
  return revised
}

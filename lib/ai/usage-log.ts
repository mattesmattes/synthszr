import { createAdminClient } from '@/lib/supabase/admin'
import { computeCostUsd, extractUsage } from '@/lib/ai/usage-cost'

/**
 * Token- und Kostenprotokoll je Modellaufruf.
 *
 * WARUM (Betreiber-Frage 2026-09-20): Die Anthropic-Rechnung zeigt nur Kosten
 * je Modell und Tag. Welcher Job dahinter steckt — Ghostwriter, Glossar,
 * Podcast — liess sich nur schaetzen, weil jede Antwort ihr `usage`-Objekt
 * ungenutzt verwarf. Mit dieser Zeile je Aufruf ist die Frage eine Abfrage.
 *
 * FAIL-OPEN: Das Protokoll haengt an JEDEM Anthropic-Aufruf der Anwendung.
 * Weder ein DB-Fehler noch eine fehlende Tabelle darf einen Modellaufruf
 * scheitern lassen — im Zweifel fehlt eine Zeile in der Buchhaltung, nicht ein
 * Abschnitt im Artikel.
 */
export async function logLlmUsage(
  useCase: string,
  model: string,
  rawUsage: unknown,
  meta?: Record<string, unknown>,
): Promise<void> {
  const tokens = extractUsage(rawUsage)
  if (!tokens) return
  try {
    const { error } = await createAdminClient().from('llm_usage').insert({
      use_case: useCase,
      model,
      input_tokens: tokens.inputTokens,
      output_tokens: tokens.outputTokens,
      cache_write_tokens: tokens.cacheWriteTokens,
      cache_read_tokens: tokens.cacheReadTokens,
      cost_usd: computeCostUsd(model, tokens),
      meta: meta ?? null,
    })
    if (error) console.warn('[LlmUsage] Protokoll nicht geschrieben:', error.message)
  } catch (err) {
    console.warn('[LlmUsage] Protokoll nicht geschrieben:', err instanceof Error ? err.message : err)
  }
}

/** Minimalform des Anthropic-Clients, die hier gebraucht wird. */
interface MessagesClient {
  messages: {
    create: (...args: never[]) => Promise<unknown>
    stream?: (...args: never[]) => unknown
  }
}

/**
 * Legt das Protokoll um einen Anthropic-Client: `messages.create` schreibt das
 * `usage` der Antwort mit, `messages.stream` haengt sich an `finalMessage`.
 *
 * Am Client statt an jeder Aufrufstelle, damit ein neuer Aufruf im selben
 * Modul automatisch mitzaehlt — vergessene Aufrufe sind sonst die Regel.
 */
export function withUsageLogging<T extends MessagesClient>(
  client: T,
  useCase: string,
  meta?: Record<string, unknown>,
): T {
  const modelOf = (params: unknown, response: unknown): string =>
    (params as { model?: string })?.model ?? (response as { model?: string })?.model ?? 'unbekannt'

  const messages = new Proxy(client.messages, {
    get(target, prop, receiver) {
      const value = Reflect.get(target, prop, receiver)
      if (prop === 'create' && typeof value === 'function') {
        return async (params: unknown, ...rest: never[]) => {
          const response = await (value as (...a: unknown[]) => Promise<unknown>).call(target, params, ...rest)
          void logLlmUsage(useCase, modelOf(params, response), (response as { usage?: unknown })?.usage, meta)
          return response
        }
      }
      if (prop === 'stream' && typeof value === 'function') {
        return (params: unknown, ...rest: never[]) => {
          const stream = (value as (...a: unknown[]) => unknown).call(target, params, ...rest)
          const on = (stream as { on?: (e: string, cb: (m: unknown) => void) => unknown })?.on
          // Nur mitschreiben, wenn der Stream das Event kennt; sonst bleibt der
          // Aufruf unprotokolliert statt zu scheitern.
          if (typeof on === 'function') {
            try {
              on.call(stream, 'finalMessage', (message: unknown) => {
                void logLlmUsage(useCase, modelOf(params, message), (message as { usage?: unknown })?.usage, meta)
              })
            } catch { /* s.o. — fail-open */ }
          }
          return stream
        }
      }
      return typeof value === 'function' ? (value as (...a: unknown[]) => unknown).bind(target) : value
    },
  })

  return new Proxy(client, {
    get(target, prop, receiver) {
      if (prop === 'messages') return messages
      const value = Reflect.get(target, prop, receiver)
      return typeof value === 'function' ? (value as (...a: unknown[]) => unknown).bind(target) : value
    },
  })
}

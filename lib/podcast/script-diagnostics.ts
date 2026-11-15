/**
 * Warum kam kein Skript? (Befund 2026-10-29) Opus 5.5 lieferte wiederholt
 * Antworten ohne Textblock — einmal 35, einmal 4.919 Ausgabe-Token —, und die
 * Route meldete nur „AI generated empty script". Diese Helfer machen aus der
 * Antwort eine Meldung, mit der sich die Ursache zuordnen lässt: Verweigerung
 * (stop_reason refusal), Denkbudget aufgebraucht (max_tokens, nur
 * thinking-Blöcke) oder etwas Drittes (stop_reason und Blocktypen).
 */
import { getModelCapabilities } from '@/lib/claude/model-capabilities'

interface Block { type: string; text?: string }
interface MessageLike {
  stop_reason?: string | null
  content: Block[]
  usage?: { output_tokens?: number }
}

export function extractScriptText(message: Pick<MessageLike, 'content'>): string {
  return message.content
    .filter((b) => b.type === 'text')
    .map((b) => b.text ?? '')
    .join('\n')
}

export function describeEmptyScript(message: MessageLike, maxTokens: number): string {
  const types = message.content.map((b) => b.type)
  const out = message.usage?.output_tokens
  const base = `AI generated empty script (stop_reason: ${message.stop_reason ?? 'unbekannt'}, blocks: ${types.join(',') || 'keine'}, output_tokens: ${out ?? '?'}/${maxTokens})`
  if (message.stop_reason === 'refusal') {
    return `Das Modell hat die Antwort verweigert (stop_reason refusal). ${base}`
  }
  if (message.stop_reason === 'max_tokens' && !types.includes('text')) {
    return `Das Modell hat das Token-Budget (${maxTokens}) vollständig mit Denken verbraucht und keinen Text ausgegeben. ${base}`
  }
  return base
}

/** Zusätzliches Budget, wenn das Modell sein Denken nicht abschalten kann:
 *  bei Opus 5.5 zählt das Denken gegen max_tokens (Befund 2026-10-28:
 *  12.000/12.000 Token ohne Text). */
const THINKING_HEADROOM_TOKENS = 8000

/**
 * Untergrenze des Budgets für Modelle, die ihr Denken nicht abschalten können.
 * Beide Aufrufer (Skript und Texturdurchgang) streamen, ein großes max_tokens
 * kostet also kein HTTP-Timeout; es ist nur eine Decke, bezahlt wird, was das
 * Modell tatsächlich erzeugt. Befund 2026-11-15: Mit 12.000 + 8.000 Token
 * verbrauchte Opus 5.5 das ganze Budget für Denken und Text, das Skript brach
 * bei Zeile 84 mitten im Satz ab (der Prompt ist mit Tagesregie und
 * Fingerabdruck länger geworden, das Modell denkt entsprechend mehr).
 */
const STREAMED_MAX_TOKENS = 64_000

/**
 * Aufruf-Parameter je Modell: Denken aus, wo es geht (die Skript-Aufgabe ist
 * Schreiben, kein Reasoning); sonst reichlich Spielraum, damit nach dem
 * Denken der ganze Text herauskommt.
 */
export function scriptRequestBudget(model: string, maxTokens: number): { max_tokens: number; thinking?: { type: 'disabled' } } {
  const caps = getModelCapabilities(model)
  if (caps.supportsDisabledThinking) return { max_tokens: maxTokens, thinking: { type: 'disabled' } }
  return { max_tokens: Math.max(maxTokens + THINKING_HEADROOM_TOKENS, STREAMED_MAX_TOKENS) }
}

/** Rückfallmodell mit abschaltbarem Denken; null, wenn das Hauptmodell das schon kann. */
export function fallbackModelFor(model: string): string | null {
  return getModelCapabilities(model).supportsDisabledThinking ? null : 'claude-opus-5'
}

/** Abgeschnitten: Das Budget war voll, bevor das Modell fertig war, auch wenn schon Text da ist. */
export function isTruncated(message: Pick<MessageLike, 'stop_reason'>): boolean {
  return message.stop_reason === 'max_tokens'
}

/**
 * Verweigert oder abgeschnitten: Ein zweiter Versuch mit dem Rückfallmodell
 * (Denken aus) lohnt. Bis 2026-11-15 galt das nur, wenn gar kein Text kam;
 * ein halbes Skript ging dann als fertiges durch.
 */
export function shouldRetryWithFallback(message: Pick<MessageLike, 'stop_reason' | 'content'>): boolean {
  return message.stop_reason === 'refusal' || isTruncated(message)
}

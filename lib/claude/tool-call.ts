/**
 * Ein Anthropic-Aufruf, der genau EIN Tool aufrufen soll — modellunabhängig.
 *
 * Das Projekt holte strukturierte Antworten an 22 Stellen über
 * `tool_choice: { type: 'tool', name }`. Opus 5.5 (und laut Anthropic Fable 5.1
 * / Mythos 5.1) lehnen erzwungenes tool_choice mit HTTP 400 ab. PROD-BEFUND
 * 2026-09-27: der Wochenrückblick brach ab, der Lexikon-Lesbarkeits-Check
 * scheiterte seit dem 24.09. still (readability_score blieb null) — beide
 * waren im Admin auf claude-opus-5-5 gestellt, das die Modellliste live von
 * der API bekommt und damit auswählbar war, bevor der Code es kannte.
 *
 * Für solche Modelle wird der Aufruf umgebaut, wie es der Migrationsleitfaden
 * vorsieht: `auto` statt erzwungen, das Tool im Systemprompt verlangt, und
 * EIN zweiter Versuch, falls trotzdem kein Tool-Block kommt — `auto`
 * garantiert keinen Aufruf. Alle anderen Modelle bekommen die Parameter
 * unverändert.
 */
import type Anthropic from '@anthropic-ai/sdk'
import { getModelCapabilities } from '@/lib/claude/model-capabilities'

/**
 * Untergrenze für max_tokens bei Modellen, deren Thinking sich nicht abschalten
 * lässt: das Denken zählt gegen max_tokens, und Budgets wie 300 (Moderation)
 * oder 512 (Lesbarkeit) waren für Aufrufe OHNE Thinking bemessen — der
 * Tool-Aufruf käme nach dem Denken nicht mehr heraus. Eine Obergrenze kostet
 * nichts, solange sie nicht ausgeschöpft wird.
 */
export const ALWAYS_THINKING_MIN_TOKENS = 4096

type Params = Anthropic.MessageCreateParamsNonStreaming

interface ToolCallClient {
  messages: {
    create(params: Params, options?: Anthropic.RequestOptions): PromiseLike<Anthropic.Message>
  }
}

function adaptForModel(params: Params): Params {
  const choice = params.tool_choice
  if (!choice || (choice.type !== 'tool' && choice.type !== 'any')) return params
  const caps = getModelCapabilities(params.model)
  if (caps.supportsForcedToolChoice) return params

  const instruction = choice.type === 'tool'
    ? `Antworte ausschließlich über das Tool „${choice.name}“ — kein Text außerhalb des Tool-Aufrufs.`
    : 'Antworte ausschließlich über eines der bereitgestellten Tools — kein Text außerhalb eines Tool-Aufrufs.'
  // Als eigener Block HINTER dem bestehenden Systemprompt: ein gecachter
  // Block davor bleibt byte-gleich, der Cache-Präfix also gültig.
  const system: Params['system'] = params.system === undefined
    ? instruction
    : typeof params.system === 'string'
      ? `${params.system}\n\n${instruction}`
      : [...params.system, { type: 'text', text: instruction }]

  // SDK 0.71 typisiert output_config noch nicht (s. ghostwriter-pipeline.ts).
  const outputConfig = (params as { output_config?: { effort?: string } }).output_config
  const adapted: Record<string, unknown> = {
    ...params,
    tool_choice: { type: 'auto' },
    system,
    max_tokens: caps.supportsDisabledThinking
      ? params.max_tokens
      : Math.max(params.max_tokens, ALWAYS_THINKING_MIN_TOKENS),
  }
  // Die Aufrufe liefen bisher ohne Thinking: `low` ist das nächste Äquivalent
  // bei Modellen, die sich nicht abschalten lassen (Default wäre `medium`).
  if (caps.supportsEffort && !outputConfig?.effort) {
    adapted.output_config = { ...outputConfig, effort: 'low' }
  }
  return adapted as unknown as Params
}

export async function createToolCall(
  client: ToolCallClient,
  params: Params,
  options?: Anthropic.RequestOptions,
): Promise<Anthropic.Message> {
  const adapted = adaptForModel(params)
  const res = await client.messages.create(adapted, options)
  if (adapted === params || res.content.some((b) => b.type === 'tool_use')) return res

  console.warn(`[createToolCall] ${params.model} hat unter tool_choice=auto kein Tool aufgerufen — zweiter Versuch`)
  return client.messages.create(adapted, options)
}

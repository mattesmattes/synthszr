import OpenAI from 'openai'
import type { StockSynthszrResult, FetchStockSynthszrOptions } from './types'

const STOCK_SYNTHSZR_SCHEMA = {
  name: 'stock_synthszr',
  schema: {
    type: 'object',
    properties: {
      key_takeaways: {
        type: 'array',
        minItems: 5,
        maxItems: 5,
        items: { type: 'string' },
      },
      action_ideas: {
        type: 'array',
        minItems: 3,
        maxItems: 3,
        items: {
          type: 'object',
          properties: {
            rating: { type: 'string', enum: ['BUY', 'HOLD', 'SELL'] },
            thesis: { type: 'string' },
            time_horizon_months: { type: 'integer' },
            risk_flags: { type: 'array', items: { type: 'string' } },
          },
          required: ['rating', 'thesis', 'time_horizon_months', 'risk_flags'],
          additionalProperties: false,
        },
      },
      contrarian_insights: {
        type: 'array',
        minItems: 2,
        maxItems: 2,
        items: { type: 'string' },
      },
      sources: {
        type: 'array',
        items: { type: 'string' },
      },
      final_recommendation: {
        type: 'object',
        properties: {
          rating: { type: 'string', enum: ['BUY', 'HOLD', 'SELL'] },
          rationale: { type: 'string' },
        },
        required: ['rating', 'rationale'],
        additionalProperties: false,
      },
    },
    required: ['key_takeaways', 'action_ideas', 'contrarian_insights', 'sources', 'final_recommendation'],
    additionalProperties: false,
  },
  strict: true,
}

let openAiClient: OpenAI | null = null

function getOpenAiClient(): OpenAI {
  if (!process.env.OPENAI_API_KEY) {
    throw new Error('OPENAI_API_KEY ist nicht gesetzt.')
  }
  if (!openAiClient) {
    openAiClient = new OpenAI({ apiKey: process.env.OPENAI_API_KEY })
  }
  return openAiClient
}

export async function fetchStockSynthszr({
  company,
  currency = 'EUR',
  recencyDays = 90,
  price = null,
}: FetchStockSynthszrOptions): Promise<StockSynthszrResult> {
  if (!company || typeof company !== 'string') {
    throw new Error('Parameter "company" ist erforderlich.')
  }

  const trimmedCompany = company.trim()
  if (!trimmedCompany) {
    throw new Error('Parameter "company" darf nicht leer sein.')
  }

  const configuredModel = process.env.OPENAI_MODEL?.trim() || null
  const candidateModels = configuredModel ? [configuredModel] : ['gpt-5.2', 'gpt-5', 'gpt-4o']

  const priceSnippet =
    typeof price === 'number' && Number.isFinite(price)
      ? `Aktueller Kurs: ${price.toFixed(2)} ${currency}.`
      : 'Aktueller Kurs unbekannt.'

  const client = getOpenAiClient()
  let lastError: Error | null = null

  for (let i = 0; i < candidateModels.length; i++) {
    const model = candidateModels[i]
    try {
      const response = await client.responses.create({
        model,
        tools: [{ type: 'web_search' }],
        input: [
          {
            role: 'system',
            content:
              'Du bist ein Equity-Analyst. Nutze das Websuche-Tool autonom und antworte ausschließlich auf Deutsch. ' +
              'Liefere AUSSCHLIESSLICH JSON gemäß Schema – ohne zusätzliche Prosa.',
          },
          {
            role: 'user',
            content:
              `Erzeuge eine Stock-Synthszr Analyse zu "${trimmedCompany}" in ${currency}:\n` +
              '- 5 Key Takeaways\n' +
              '- 3 Action-Ideen (BUY/HOLD/SELL; Risiken; Zeithorizont in Monaten)\n' +
              '- 2 Contrarian Insights\n' +
              '- Abschließende Gesamtempfehlung (BUY/HOLD/SELL) mit kurzer Begründung\n' +
              `${priceSnippet}\n` +
              `Nutze verlässliche Quellen der letzten ${recencyDays} Tage und füge 5–8 Links in 'sources' an. ` +
              'Arbeite datenbasiert (Bewertungen/Guidance/Newsflow), keine Halluzinationen. Antworte auf Deutsch.',
          },
        ],
        text: {
          format: {
            type: 'json_schema',
            name: STOCK_SYNTHSZR_SCHEMA.name,
            schema: STOCK_SYNTHSZR_SCHEMA.schema,
            strict: STOCK_SYNTHSZR_SCHEMA.strict,
          },
        },
        temperature: 0.2,
      })

      const jsonString = (response.output_text ?? '').trim()
      if (!jsonString) {
        throw new Error('Das Modell hat keine JSON-Antwort geliefert.')
      }

      try {
        const parsed = JSON.parse(jsonString) as StockSynthszrResult
        if (!parsed.model) {
          parsed.model = model
        }
        parsed.created_at = new Date().toISOString()
        return parsed
      } catch (parseError) {
        console.error('[stock-synthszr] JSON-Parse-Fehler. Roher Output:', jsonString)
        throw parseError
      }
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error))
      const isLastCandidate = i === candidateModels.length - 1
      if (isLastCandidate || configuredModel) {
        break
      }
      console.warn(`[stock-synthszr] Modell ${model} fehlgeschlagen, versuche Fallback.`, error)
    }
  }

  if (lastError) {
    throw lastError
  }
  throw new Error('Stock-Synthszr fehlgeschlagen.')
}

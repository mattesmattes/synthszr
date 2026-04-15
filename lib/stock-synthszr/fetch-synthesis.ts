import OpenAI from 'openai'
import type { StockSynthszrResult, FetchStockSynthszrOptions } from './types'

const STOCK_SYNTHSZR_SCHEMA = {
  name: 'stock_synthszr',
  schema: {
    type: 'object',
    properties: {
      executive_summary: {
        type: 'string',
        description: 'Comprehensive executive summary (300-500 words) covering business model, market position, recent developments, financial metrics and outlook.',
      },
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
    required: ['executive_summary', 'key_takeaways', 'action_ideas', 'contrarian_insights', 'sources', 'final_recommendation'],
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
      ? `Current price: ${price.toFixed(2)} ${currency}.`
      : 'Current price unknown.'

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
              'You are an equity analyst. Use the web search tool autonomously and respond exclusively in English. ' +
              'Return JSON ONLY per schema — no additional prose. ' +
              'Consistently avoid military and war analogies and metaphors — no battles, weapons, mobilization, offensives, artillery or similar imagery, not even in creative variations. ' +
              'Describe observations directly and concretely using economic or technical language.',
          },
          {
            role: 'user',
            content:
              `Generate a comprehensive Stock-Synthszr analysis for "${trimmedCompany}" in ${currency}:\n\n` +
              '1. **Executive Summary** (300-500 words): Comprehensive summary covering:\n' +
              '   - Business model and core competencies\n' +
              '   - Current market position and competitive advantages\n' +
              '   - Key developments of recent months (earnings, news, guidance)\n' +
              '   - Relevant financial metrics (P/E, revenue growth, margins)\n' +
              '   - Short- and medium-term outlook\n\n' +
              '2. **5 Key Takeaways**: The most important points for investors\n\n' +
              '3. **3 Action Ideas**: Concrete action options (BUY/HOLD/SELL) with:\n' +
              '   - Detailed rationale (thesis)\n' +
              '   - Time horizon in months\n' +
              '   - Specific risk factors\n\n' +
              '4. **2 Contrarian Insights**: Perspectives that deviate from market consensus\n\n' +
              '5. **Overall recommendation**: BUY/HOLD/SELL with solid rationale\n\n' +
              `${priceSnippet}\n` +
              `Use reliable sources from the last ${recencyDays} days and include 5–8 links in 'sources'. ` +
              'Work strictly data-driven (valuations, guidance, newsflow, analyst opinions), no speculation. Respond in English.',
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

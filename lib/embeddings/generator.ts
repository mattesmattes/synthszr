/**
 * Embedding Generator using Google's text-embedding-004 model
 * Generates 768-dimensional embeddings for semantic similarity search
 */

import { GoogleGenerativeAI } from '@google/generative-ai'

const genAI = new GoogleGenerativeAI(process.env.GOOGLE_GENERATIVE_AI_API_KEY!)

/**
 * Generate embedding for a single text
 * Uses Google's text-embedding-004 model (768 dimensions)
 */
export async function generateEmbedding(text: string): Promise<number[]> {
  if (!text || text.trim().length === 0) {
    throw new Error('Text cannot be empty')
  }

  const model = genAI.getGenerativeModel({ model: 'text-embedding-004' })

  // Truncate text to avoid token limits (max ~8000 tokens)
  const truncatedText = text.slice(0, 30000)

  const result = await model.embedContent(truncatedText)
  return result.embedding.values
}

/**
 * Generate embeddings for multiple texts in parallel
 * Includes rate limiting to avoid API limits
 */
export async function generateEmbeddings(
  texts: string[],
  options: {
    batchSize?: number
    delayMs?: number
  } = {}
): Promise<number[][]> {
  const { batchSize = 10, delayMs = 100 } = options

  const model = genAI.getGenerativeModel({ model: 'text-embedding-004' })
  const results: number[][] = []

  // Process in batches
  for (let i = 0; i < texts.length; i += batchSize) {
    const batch = texts.slice(i, i + batchSize)

    const batchResults = await Promise.all(
      batch.map(async (text) => {
        if (!text || text.trim().length === 0) {
          return [] // Return empty embedding for empty text
        }
        const truncatedText = text.slice(0, 30000)
        const result = await model.embedContent(truncatedText)
        return result.embedding.values
      })
    )

    results.push(...batchResults)

    // Rate limiting delay between batches
    if (i + batchSize < texts.length) {
      await new Promise((resolve) => setTimeout(resolve, delayMs))
    }
  }

  return results
}

/**
 * Prepare text for embedding by combining title and content
 * Optimizes for semantic search by including key context
 */
export function prepareTextForEmbedding(
  title: string,
  content: string,
  options: {
    maxContentLength?: number
    includeSource?: string
  } = {}
): string {
  const { maxContentLength = 2000, includeSource } = options

  const parts: string[] = []

  if (title) {
    parts.push(`Title: ${title}`)
  }

  if (includeSource) {
    parts.push(`Source: ${includeSource}`)
  }

  if (content) {
    // Take first N characters of content for embedding
    const truncatedContent = content.slice(0, maxContentLength)
    parts.push(`Content: ${truncatedContent}`)
  }

  return parts.join('\n\n')
}

/**
 * Calculate cosine similarity between two embeddings
 * Returns value between -1 and 1 (1 = identical)
 */
export function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length) {
    throw new Error('Embeddings must have same dimension')
  }

  let dotProduct = 0
  let normA = 0
  let normB = 0

  for (let i = 0; i < a.length; i++) {
    dotProduct += a[i] * b[i]
    normA += a[i] * a[i]
    normB += b[i] * b[i]
  }

  return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB))
}

/**
 * Analogy Image Generator
 *
 * Generates surreal editorial images for analogies using Nano Banana
 * (Google Gemini image models) via Vercel AI SDK.
 * Falls back to a typographic layout on generation failure.
 */

import { put } from '@vercel/blob'
import { createAdminClient } from '@/lib/supabase/admin'

interface ImageResult {
  success: boolean
  imageBuffer?: Buffer
  mimeType?: string
  isFallback?: boolean
  error?: string
}

const DEFAULT_MODEL = 'google/gemini-3-pro-image'

// Synthszr brand color — neon green #CCFF00
const BRAND_NEON_GREEN = { r: 0xCC, g: 0xFF, b: 0x00 }

/**
 * Apply a multiply blend with neon green (#CCFF00) over the image.
 * Multiply: output = (source × tint) / 255
 * On B&W images this tints whites → neon green, blacks stay black.
 */
async function applyNeonGreenMultiply(inputBuffer: Buffer): Promise<Buffer> {
  const sharp = (await import('sharp')).default

  const { width, height } = await sharp(inputBuffer).metadata()
  if (!width || !height) return inputBuffer

  // Create a solid #CCFF00 overlay the same size
  const overlay = await sharp({
    create: {
      width,
      height,
      channels: 3,
      background: BRAND_NEON_GREEN,
    }
  }).png().toBuffer()

  // Composite with multiply blend mode
  const result = await sharp(inputBuffer)
    .ensureAlpha()
    .composite([{
      input: overlay,
      blend: 'multiply' as const,
    }])
    .png()
    .toBuffer()

  console.log(`[AnalogyImage] Applied neon green multiply tint`)
  return result
}

/**
 * Get the configured image model from settings.
 *
 * Priority:
 *   1. llm_model_config.image_generation (unified model-config UI)
 *   2. analogy_image_model               (legacy dedicated key)
 *   3. DEFAULT_MODEL
 */
async function getImageModel(): Promise<string> {
  try {
    const supabase = createAdminClient()

    // 1. Unified config from /admin/settings KI-Modelle tab
    const { data: unified } = await supabase
      .from('settings')
      .select('value')
      .eq('key', 'llm_model_config')
      .maybeSingle()
    const fromUnified = (unified?.value as Record<string, string> | null)?.image_generation
    if (fromUnified) return fromUnified

    // 2. Legacy dedicated key (kept for back-compat)
    const { data: legacy } = await supabase
      .from('settings')
      .select('value')
      .eq('key', 'analogy_image_model')
      .maybeSingle()
    const fromLegacy = (legacy?.value as { model?: string } | null)?.model
    if (fromLegacy) return fromLegacy

    return DEFAULT_MODEL
  } catch {
    return DEFAULT_MODEL
  }
}

/**
 * Generate an image with Google models via Vercel AI SDK.
 * Google uses generateText with responseModalities to enable image output.
 */
async function generateWithGoogle(
  model: string,
  prompt: string
): Promise<{ buffer: Buffer; mimeType: string } | { error: string }> {
  const { generateText } = await import('ai')

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const result = await generateText({
    model: model as any,
    providerOptions: {
      google: {
        responseModalities: ['TEXT', 'IMAGE'],
      },
    },
    messages: [
      {
        role: 'user',
        content: [
          {
            type: 'text' as const,
            text: `Generate an image based on this description. Do not include any text, words, or letters in the image.\n\n${prompt}`,
          },
        ],
      },
    ],
  })

  const imageFile = result.files?.find(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (f: any) => f.mediaType?.startsWith('image/') || f.mimeType?.startsWith('image/')
  )

  if (!imageFile) {
    return { error: `No image in Google response. Text: ${result.text?.slice(0, 200)}` }
  }

  let buffer: Buffer
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const file = imageFile as any
  if (file.uint8Array) {
    buffer = Buffer.from(file.uint8Array)
  } else if (file.base64) {
    buffer = Buffer.from(file.base64, 'base64')
  } else {
    return { error: 'Google image file has no data' }
  }

  let mimeType = file.mediaType || file.mimeType
  if (!mimeType || mimeType === 'undefined') {
    const b64Start = buffer.toString('base64').slice(0, 12)
    if (b64Start.startsWith('iVBORw0KGgo')) mimeType = 'image/png'
    else if (b64Start.startsWith('/9j/')) mimeType = 'image/jpeg'
    else mimeType = 'image/png'
  }

  return { buffer, mimeType }
}

/**
 * Generate an image with OpenAI image models (gpt-image-1, gpt-image-2,
 * dall-e-*) via the dedicated images.generate endpoint.
 */
async function generateWithOpenAI(
  modelId: string,
  prompt: string
): Promise<{ buffer: Buffer; mimeType: string } | { error: string }> {
  if (!process.env.OPENAI_API_KEY) {
    return { error: 'OPENAI_API_KEY not configured' }
  }

  const { default: OpenAI } = await import('openai')
  const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY })

  const fullPrompt = `${prompt}\n\nDo not include any text, words, or letters in the image.`

  // gpt-image-* returns b64_json by default; dall-e-* needs response_format.
  // Pass response_format only for dall-e to avoid "unknown parameter" errors
  // on the gpt-image series.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const params: any = {
    model: modelId,
    prompt: fullPrompt,
    n: 1,
    size: '1024x1024',
  }
  if (modelId.startsWith('dall-e')) {
    params.response_format = 'b64_json'
  }

  const response = await client.images.generate(params)
  const b64 = response.data?.[0]?.b64_json

  if (!b64) {
    return { error: 'OpenAI response had no b64_json image data' }
  }

  return { buffer: Buffer.from(b64, 'base64'), mimeType: 'image/png' }
}

/**
 * Generate an image for an analogy. Routes to the right provider based on
 * the configured model's namespace prefix (google/... or openai/...).
 * The prompt should already include the style suffix.
 */
export async function generateAnalogyImage(prompt: string): Promise<ImageResult> {
  const model = await getImageModel()

  console.log(`[AnalogyImage] Generating with ${model}...`)

  try {
    const isOpenAI = model.startsWith('openai/')
    const isGoogle = model.startsWith('google/') || !model.includes('/') // legacy unprefixed = Google

    let raw: { buffer: Buffer; mimeType: string } | { error: string }

    if (isOpenAI) {
      raw = await generateWithOpenAI(model.replace(/^openai\//, ''), prompt)
    } else if (isGoogle) {
      // The Vercel AI SDK accepts both "google/gemini-..." and bare
      // "gemini-..." for Google models. Pass the full id as-is.
      raw = await generateWithGoogle(model, prompt)
    } else {
      return { success: false, error: `Unsupported image model namespace: ${model}` }
    }

    if ('error' in raw) {
      console.log(`[AnalogyImage] Provider returned no image: ${raw.error}`)
      return { success: false, error: raw.error }
    }

    console.log(`[AnalogyImage] Generated successfully (${raw.mimeType}, ${raw.buffer.length} bytes)`)

    const tintedBuffer = await applyNeonGreenMultiply(raw.buffer)

    return {
      success: true,
      imageBuffer: tintedBuffer,
      mimeType: 'image/png',
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    console.error('[AnalogyImage] Generation failed:', message)
    return { success: false, error: message }
  }
}

/**
 * Generate a typographic fallback image when AI image generation fails.
 * Creates a dark background with the analogy text in large white type.
 */
export async function generateFallbackImage(
  analogyText: string,
  contextText: string
): Promise<ImageResult> {
  try {
    // Use @vercel/og-style ImageResponse for SVG-to-PNG
    // Fallback: generate a simple SVG and convert
    // 9:16 portrait for TikTok/Reels
    const width = 1080
    const height = 1920

    // Truncate text for layout
    const displayText = analogyText.length > 200
      ? analogyText.slice(0, 197) + '...'
      : analogyText

    // 9:16 portrait layout — text centered vertically
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
  <rect width="${width}" height="${height}" fill="#111111"/>
  <text x="80" y="700" fill="#ffffff" font-family="Inter, system-ui, sans-serif" font-size="44" font-weight="700" text-anchor="start">
    ${escapeXml(displayText).split(/(?<=\S)\s+/).reduce((lines: string[], word: string) => {
      const lastLine = lines[lines.length - 1] || ''
      if ((lastLine + ' ' + word).length > 28) {
        lines.push(word)
      } else {
        lines[lines.length - 1] = (lastLine + ' ' + word).trim()
      }
      return lines
    }, ['']).map((line: string, i: number) =>
      `<tspan x="80" dy="${i === 0 ? 0 : 58}">${line}</tspan>`
    ).join('')}
  </text>
  <text x="80" y="${height - 200}" fill="#888888" font-family="Inter, system-ui, sans-serif" font-size="28">
    ${escapeXml(contextText)}
  </text>
  <text x="${width - 80}" y="${height - 100}" fill="#CCFF00" font-family="Inter, system-ui, sans-serif" font-size="24" font-weight="700" text-anchor="end">
    synthszr
  </text>
</svg>`

    // Convert SVG to PNG via sharp (already a project dependency)
    const sharp = (await import('sharp')).default
    const imageBuffer = await sharp(Buffer.from(svg))
      .png()
      .toBuffer()

    console.log(`[AnalogyImage] Fallback generated (${imageBuffer.length} bytes)`)

    return {
      success: true,
      imageBuffer,
      mimeType: 'image/png',
      isFallback: true,
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    console.error('[AnalogyImage] Fallback generation failed:', message)
    return { success: false, error: `Fallback failed: ${message}` }
  }
}

function escapeXml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
}

/**
 * Upload an image buffer to Vercel Blob.
 */
export async function uploadAnalogyImage(
  videoId: string,
  imageBuffer: Buffer,
  mimeType: string,
  isFallback: boolean = false
): Promise<string> {
  const extension = mimeType.split('/')[1] || 'png'
  const suffix = isFallback ? 'fallback' : 'image'
  const fileName = `analogy-videos/${videoId}/${suffix}.${extension}`

  const blob = await put(fileName, imageBuffer, {
    access: 'public',
    contentType: mimeType,
    allowOverwrite: true,
  })

  return blob.url
}

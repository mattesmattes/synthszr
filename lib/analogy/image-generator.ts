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

/**
 * Get the configured image model from settings
 */
async function getImageModel(): Promise<string> {
  try {
    const supabase = createAdminClient()
    const { data } = await supabase
      .from('settings')
      .select('value')
      .eq('key', 'analogy_image_model')
      .single()
    return data?.value?.model || DEFAULT_MODEL
  } catch {
    return DEFAULT_MODEL
  }
}

/**
 * Generate an image for an analogy using Nano Banana via Vercel AI SDK.
 * The prompt should already include the style suffix.
 */
export async function generateAnalogyImage(prompt: string): Promise<ImageResult> {
  const model = await getImageModel()

  try {
    // Dynamic import to avoid module loading issues
    const { generateText } = await import('ai')

    console.log(`[AnalogyImage] Generating with ${model}...`)

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

    // Extract image from response files
    const imageFile = result.files?.find(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (f: any) => f.mediaType?.startsWith('image/') || f.mimeType?.startsWith('image/')
    )

    if (!imageFile) {
      console.log('[AnalogyImage] No image in response. Text:', result.text?.slice(0, 200))
      return { success: false, error: 'No image generated in response' }
    }

    // Get image data — handle both uint8Array and base64 formats
    let imageBuffer: Buffer
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const file = imageFile as any
    if (file.uint8Array) {
      imageBuffer = Buffer.from(file.uint8Array)
    } else if (file.base64) {
      imageBuffer = Buffer.from(file.base64, 'base64')
    } else {
      return { success: false, error: 'Image file has no data' }
    }

    // Detect mime type
    let mimeType = file.mediaType || file.mimeType
    if (!mimeType || mimeType === 'undefined') {
      const b64Start = imageBuffer.toString('base64').slice(0, 12)
      if (b64Start.startsWith('iVBORw0KGgo')) mimeType = 'image/png'
      else if (b64Start.startsWith('/9j/')) mimeType = 'image/jpeg'
      else mimeType = 'image/png'
    }

    console.log(`[AnalogyImage] Generated successfully (${mimeType}, ${imageBuffer.length} bytes)`)

    return {
      success: true,
      imageBuffer,
      mimeType,
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

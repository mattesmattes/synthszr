import sharp from 'sharp'
import { createClient } from '@/lib/supabase/server'
import { GoogleGenerativeAI } from '@google/generative-ai'

// Use direct Google API instead of Vercel AI Gateway
// Note: Direct API is geographically restricted - disabled due to "Image generation not available in your country" error
const USE_DIRECT_GOOGLE_API = false

const DEFAULT_IMAGE_PROMPT = `Create a black and white satirical illustration of the following news in the style of Mort Drucker, without any references to "Mort Drucker" or "MAD" in the image.

IMPORTANT STYLE GUIDELINES:
- Clear black and white contrast with cross-hatching and line drawing
- Satirical, slightly exaggerated portrayal
- Dynamic compositions with expressive figures
- CRITICAL: Do NOT include ANY text, words, letters, labels, signs, or written language in the image
- The image must be purely visual with ZERO text elements
- No references to MAD Magazine or the artist

IMAGE FORMAT:
- Generate the image in widescreen format with 21:9 aspect ratio (ultrawide/cinematic)
- Width should be approximately 2.3x the height
- Horizontal, panoramic composition

NEWS TEXT (for visual inspiration only - DO NOT include any text from this in the image):
{newsText}`

interface ActiveImagePromptSettings {
  promptText: string
  enableDithering: boolean
  ditheringGain: number
  ditheringCoarseness: number
  imageScale: number
}

/**
 * Fetches the active image prompt and dithering settings from the database
 */
async function getActiveImagePromptSettings(): Promise<ActiveImagePromptSettings> {
  try {
    const supabase = await createClient()
    const { data } = await supabase
      .from('image_prompts')
      .select('prompt_text, enable_dithering, dithering_gain, dithering_coarseness, image_scale')
      .eq('is_active', true)
      .single()

    if (data?.prompt_text) {
      console.log('[Gemini] Using custom image prompt from database')
      return {
        promptText: data.prompt_text,
        enableDithering: data.enable_dithering ?? false,
        ditheringGain: Number(data.dithering_gain) || 1.0,
        ditheringCoarseness: Number(data.dithering_coarseness) || 1,
        imageScale: Number(data.image_scale) || 1.0,
      }
    }
  } catch (error) {
    // Table might not exist or no active prompt
    console.log('[Gemini] Using default image prompt')
  }
  return {
    promptText: DEFAULT_IMAGE_PROMPT,
    enableDithering: false,
    ditheringGain: 1.0,
    ditheringCoarseness: 1,
    imageScale: 1.0,
  }
}

/**
 * Fetches the active image prompt from the database, or returns the default
 */
async function getActiveImagePrompt(): Promise<string> {
  const settings = await getActiveImagePromptSettings()
  return settings.promptText
}

interface GenerateImageResult {
  success: boolean
  imageBase64?: string
  mimeType?: string
  error?: string
}

// Lazy load generateText to avoid module loading issues (for Vercel AI SDK fallback)
let generateTextFn: typeof import('ai').generateText | null = null

async function getGenerateText() {
  if (!generateTextFn) {
    try {
      const aiModule = await import('ai')
      generateTextFn = aiModule.generateText
    } catch (error) {
      console.error('[Gemini] Failed to import AI SDK:', error)
      return null
    }
  }
  return generateTextFn
}

/**
 * Generate image using direct Google Generative AI API
 * Bypasses Vercel AI Gateway - uses GOOGLE_GENERATIVE_AI_API_KEY
 */
async function generateImageDirectGoogle(prompt: string): Promise<GenerateImageResult> {
  const apiKey = process.env.GOOGLE_GENERATIVE_AI_API_KEY
  if (!apiKey) {
    return { success: false, error: 'GOOGLE_GENERATIVE_AI_API_KEY not configured' }
  }

  const genAI = new GoogleGenerativeAI(apiKey)

  // Use gemini-2.0-flash-exp for image generation (supports imagen)
  const model = genAI.getGenerativeModel({
    model: 'gemini-2.0-flash-exp',
    generationConfig: {
      // @ts-expect-error - responseModalities is valid for image generation
      responseModalities: ['TEXT', 'IMAGE'],
    },
  })

  console.log('[Gemini Direct] Generating image with gemini-2.0-flash-exp...')

  try {
    const result = await model.generateContent(prompt)
    const response = result.response

    // Check for inline images in the response
    for (const candidate of response.candidates || []) {
      for (const part of candidate.content?.parts || []) {
        if (part.inlineData) {
          const { mimeType, data } = part.inlineData
          console.log(`[Gemini Direct] Image generated successfully (${mimeType})`)

          // Log dimensions
          try {
            const imgBuffer = Buffer.from(data, 'base64')
            const metadata = await sharp(imgBuffer).metadata()
            console.log(`[Gemini Direct] Dimensions: ${metadata.width}x${metadata.height}`)
          } catch {
            // Ignore dimension logging errors
          }

          return {
            success: true,
            imageBase64: data,
            mimeType: mimeType || 'image/png'
          }
        }
      }
    }

    // No image found
    const text = response.text()
    console.log('[Gemini Direct] No image in response. Text:', text?.slice(0, 200))
    return { success: false, error: 'No image generated in response' }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error)
    console.error('[Gemini Direct] Error:', errorMessage)
    return { success: false, error: errorMessage }
  }
}

/**
 * Generate image using Vercel AI SDK (goes through Vercel AI Gateway)
 */
async function generateImageVercelSDK(prompt: string): Promise<GenerateImageResult> {
  const generateText = await getGenerateText()
  if (!generateText) {
    return { success: false, error: 'AI SDK not loaded' }
  }

  console.log('[Gemini Vercel] Generating image with Vercel AI SDK (Gemini 3)...')

  // Use Vercel AI SDK with Gemini 3 model
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const result = await generateText({
    model: 'google/gemini-3-pro-image' as any,
    providerOptions: {
      google: {
        responseModalities: ['TEXT', 'IMAGE'],
      },
    },
    messages: [
      {
        role: 'user',
        content: [{ type: 'text' as const, text: prompt }],
      },
    ],
  })

  // Check for image in response files
  const imageFile = result.files?.[0]
  if (imageFile && imageFile.base64) {
    // Log image dimensions
    try {
      const imgBuffer = Buffer.from(imageFile.base64, 'base64')
      const metadata = await sharp(imgBuffer).metadata()
      console.log(`[Gemini Vercel] Image generated: ${metadata.width}x${metadata.height} (${metadata.format})`)
    } catch {
      console.log('[Gemini Vercel] Image generated (could not read dimensions)')
    }

    // Get mimeType
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let mimeType = (imageFile as any).mimeType || (imageFile as any).mediaType
    if (!mimeType || mimeType === 'undefined') {
      if (imageFile.base64.startsWith('iVBORw0KGgo')) mimeType = 'image/png'
      else if (imageFile.base64.startsWith('/9j/')) mimeType = 'image/jpeg'
      else mimeType = 'image/png'
    }

    return {
      success: true,
      imageBase64: imageFile.base64,
      mimeType: mimeType || 'image/png'
    }
  }

  console.log('[Gemini Vercel] No image in response. Text:', result.text?.slice(0, 200))
  return { success: false, error: 'No image generated in response' }
}

/**
 * Generates a satirical black & white image based on news text using Gemini
 * Uses direct Google API or Vercel AI SDK based on USE_DIRECT_GOOGLE_API flag
 */
export interface CoverImageNews {
  news1: string
  news2?: string
  news3?: string
}

/**
 * Generate a satirical image from news text
 * Supports single newsText string OR multiple news items for cover images
 */
export async function generateSatiricalImage(
  newsTextOrItems: string | CoverImageNews
): Promise<GenerateImageResult> {
  const maxRetries = 3
  let lastError: Error | null = null

  const promptTemplate = await getActiveImagePrompt()

  // Build prompt with variable substitution
  let prompt: string
  if (typeof newsTextOrItems === 'string') {
    // Single news text (backward compatible)
    prompt = promptTemplate.replace('{newsText}', newsTextOrItems.slice(0, 2000))
  } else {
    // Multiple news items for cover image composition
    prompt = promptTemplate
      .replace('{news1}', newsTextOrItems.news1?.slice(0, 800) || '')
      .replace('{news2}', newsTextOrItems.news2?.slice(0, 800) || '')
      .replace('{news3}', newsTextOrItems.news3?.slice(0, 800) || '')
      .replace('{newsText}', [
        newsTextOrItems.news1,
        newsTextOrItems.news2,
        newsTextOrItems.news3
      ].filter(Boolean).join('\n\n---\n\n').slice(0, 2000))
  }

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      console.log(`[Gemini] Attempt ${attempt}/${maxRetries}, using ${USE_DIRECT_GOOGLE_API ? 'Direct Google API' : 'Vercel AI SDK'}`)

      const result = USE_DIRECT_GOOGLE_API
        ? await generateImageDirectGoogle(prompt)
        : await generateImageVercelSDK(prompt)

      if (result.success) {
        return result
      }

      lastError = new Error(result.error || 'Unknown error')

      if (attempt < maxRetries) {
        const delay = attempt * 1000
        console.log(`[Gemini] Retrying in ${delay / 1000}s...`)
        await new Promise(resolve => setTimeout(resolve, delay))
        continue
      }
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error))
      console.error(`[Gemini] Attempt ${attempt} error:`, lastError.message)

      // Check if retryable
      const isRetryable =
        lastError.message.includes('429') ||
        lastError.message.includes('503') ||
        lastError.message.includes('502') ||
        lastError.message.includes('temporarily unavailable')

      if (isRetryable && attempt < maxRetries) {
        const delay = attempt * 1000
        console.log(`[Gemini] Retrying in ${delay / 1000}s...`)
        await new Promise(resolve => setTimeout(resolve, delay))
        continue
      }
    }
  }

  console.error('[Gemini] All attempts failed:', lastError?.message)
  return {
    success: false,
    error: lastError?.message || 'Unknown error'
  }
}

/**
 * Converts white pixels to transparent in a PNG image
 * @param imageBase64 Base64 encoded image
 * @param threshold Brightness threshold (0-255) above which pixels become transparent
 */
export async function whiteToTransparent(
  imageBase64: string,
  threshold: number = 128
): Promise<{ base64: string; mimeType: string }> {
  const buffer = Buffer.from(imageBase64, 'base64')

  // Get image info
  const image = sharp(buffer)

  // Extract raw pixel data
  const { data, info } = await image
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true })

  // Hard threshold: convert to pure black (opaque) or transparent
  // This ensures dithered images have ONLY black pixels and transparent pixels
  // No grayscale, no semi-transparency, no color mixing with background
  const pixels = new Uint8Array(data)
  for (let i = 0; i < pixels.length; i += 4) {
    const r = pixels[i]
    const g = pixels[i + 1]
    const b = pixels[i + 2]

    // Calculate luminance (grayscale value)
    const luminance = (r + g + b) / 3

    if (luminance >= threshold) {
      // White/bright → fully transparent
      pixels[i] = 0       // R
      pixels[i + 1] = 0   // G
      pixels[i + 2] = 0   // B
      pixels[i + 3] = 0   // A (transparent)
    } else {
      // Dark → pure black, fully opaque
      pixels[i] = 0       // R
      pixels[i + 1] = 0   // G
      pixels[i + 2] = 0   // B
      pixels[i + 3] = 255 // A (opaque)
    }
  }

  // Create new image with transparency
  const outputBuffer = await sharp(Buffer.from(pixels), {
    raw: {
      width: info.width,
      height: info.height,
      channels: 4
    }
  })
    .png()
    .toBuffer()

  return {
    base64: outputBuffer.toString('base64'),
    mimeType: 'image/png'
  }
}

/**
 * Floyd-Steinberg error diffusion dithering
 * Converts grayscale image to pure black & white with dithering
 * @param imageBase64 Base64 encoded image
 * @param gain Error diffusion gain/scaling factor (0.5-2.0, default 1.0)
 * @param coarseness Dithering coarseness (1-8, default 1). Higher = coarser/larger dots, prevents moiré
 */
export async function applyDithering(
  imageBase64: string,
  gain: number = 1.0,
  coarseness: number = 1
): Promise<{ base64: string; mimeType: string }> {
  const buffer = Buffer.from(imageBase64, 'base64')

  // Get original dimensions
  const metadata = await sharp(buffer).metadata()
  console.log(`[Dithering] Input image: ${metadata.width}x${metadata.height}, format=${metadata.format}, channels=${metadata.channels}, space=${metadata.space}`)
  const originalWidth = metadata.width!
  const originalHeight = metadata.height!

  // Downscale for coarser dithering (coarseness 1 = no downscale, 2 = half, etc.)
  const scaleFactor = 1 / Math.max(1, Math.min(8, coarseness))
  const workWidth = Math.round(originalWidth * scaleFactor)
  const workHeight = Math.round(originalHeight * scaleFactor)

  console.log(`[Dithering] Coarseness ${coarseness}: working at ${workWidth}x${workHeight}, will upscale to ${originalWidth}x${originalHeight}`)

  // Convert to grayscale, normalize contrast, and optionally downscale
  // normalise() MUST come after grayscale() to stretch the grayscale histogram to 0-255
  // This is critical for Floyd-Steinberg - without it, limited contrast produces noise
  let image = sharp(buffer).grayscale().normalise()
  if (coarseness > 1) {
    image = image.resize(workWidth, workHeight, { kernel: sharp.kernel.lanczos2 })
  }

  const { data, info } = await image.raw().toBuffer({ resolveWithObject: true })

  const width = info.width
  const height = info.height
  const pixels = new Float32Array(data) // Use float for error accumulation

  // Debug: check pixel value distribution
  const samplePixels = Array.from(pixels.slice(0, 100))
  const min = Math.min(...samplePixels)
  const max = Math.max(...samplePixels)
  const avg = samplePixels.reduce((a, b) => a + b, 0) / samplePixels.length
  console.log(`[Dithering] Grayscale pixels - min=${min}, max=${max}, avg=${avg.toFixed(1)}, sample: [${samplePixels.slice(0, 10).map(p => p.toFixed(0)).join(', ')}]`)

  // Floyd-Steinberg error diffusion
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = y * width + x
      const oldPixel = pixels[idx]
      const newPixel = oldPixel < 128 ? 0 : 255
      pixels[idx] = newPixel

      const error = (oldPixel - newPixel) * gain

      // Distribute error to neighbors
      if (x + 1 < width) {
        pixels[idx + 1] += error * 7 / 16
      }
      if (y + 1 < height) {
        if (x > 0) {
          pixels[(y + 1) * width + (x - 1)] += error * 3 / 16
        }
        pixels[(y + 1) * width + x] += error * 5 / 16
        if (x + 1 < width) {
          pixels[(y + 1) * width + (x + 1)] += error * 1 / 16
        }
      }
    }
  }

  // Clamp values and convert back to uint8
  const output = new Uint8Array(width * height)
  for (let i = 0; i < pixels.length; i++) {
    output[i] = Math.max(0, Math.min(255, Math.round(pixels[i])))
  }

  // Create dithered image at working resolution
  let outputImage = sharp(Buffer.from(output), {
    raw: {
      width,
      height,
      channels: 1
    }
  })

  // Upscale back to original size using nearest-neighbor to preserve sharp dithering pattern
  if (coarseness > 1) {
    outputImage = outputImage.resize(originalWidth, originalHeight, {
      kernel: sharp.kernel.nearest
    })
  }

  const outputBuffer = await outputImage.png().toBuffer()

  return {
    base64: outputBuffer.toString('base64'),
    mimeType: 'image/png'
  }
}

/**
 * Scales an image by a given factor
 * @param imageBase64 Base64 encoded image
 * @param scale Scale factor (0.25-2.0, where 1.0 = no scaling)
 */
export async function scaleImage(
  imageBase64: string,
  scale: number
): Promise<{ base64: string; mimeType: string }> {
  if (scale === 1.0) {
    // No scaling needed
    return { base64: imageBase64, mimeType: 'image/png' }
  }

  const buffer = Buffer.from(imageBase64, 'base64')
  const image = sharp(buffer)
  const metadata = await image.metadata()

  if (!metadata.width || !metadata.height) {
    throw new Error('Could not determine image dimensions')
  }

  const newWidth = Math.round(metadata.width * scale)
  const newHeight = Math.round(metadata.height * scale)

  console.log(`[Gemini] Scaling image from ${metadata.width}x${metadata.height} to ${newWidth}x${newHeight}`)

  const outputBuffer = await image
    .resize(newWidth, newHeight, {
      kernel: scale > 1 ? sharp.kernel.lanczos3 : sharp.kernel.lanczos2,
    })
    .png()
    .toBuffer()

  return {
    base64: outputBuffer.toString('base64'),
    mimeType: 'image/png'
  }
}

export interface ImageProcessingOptions {
  enableDithering?: boolean
  ditheringGain?: number       // 0.5-2.0, default 1.0
  ditheringCoarseness?: number // 1-8, default 1 (higher = larger dots, prevents moiré)
  imageScale?: number          // 0.25-2.0, default 1.0
}

/**
 * Generates a satirical image and processes it for transparency (and optionally dithering/scaling)
 * If no options provided, uses settings from the active image prompt in the database
 * Supports single newsText string OR multiple news items for cover images
 */
export async function generateAndProcessImage(
  newsTextOrItems: string | CoverImageNews,
  options?: ImageProcessingOptions
): Promise<{
  success: boolean
  imageBase64?: string
  mimeType?: string
  error?: string
}> {
  // If no options provided, get settings from active prompt in database
  let enableDithering: boolean
  let ditheringGain: number
  let ditheringCoarseness: number
  let imageScale: number

  if (options) {
    enableDithering = options.enableDithering ?? false
    ditheringGain = options.ditheringGain ?? 1.0
    ditheringCoarseness = options.ditheringCoarseness ?? 1
    imageScale = options.imageScale ?? 1.0
  } else {
    const promptSettings = await getActiveImagePromptSettings()
    enableDithering = promptSettings.enableDithering
    ditheringGain = promptSettings.ditheringGain
    ditheringCoarseness = promptSettings.ditheringCoarseness
    imageScale = promptSettings.imageScale
    console.log(`[Gemini] Using DB settings: dithering=${enableDithering}, gain=${ditheringGain}, coarseness=${ditheringCoarseness}, scale=${imageScale}`)
  }

  // Generate the image
  const result = await generateSatiricalImage(newsTextOrItems)

  if (!result.success || !result.imageBase64) {
    return result
  }

  try {
    let processedBase64 = result.imageBase64

    // Apply scaling first (before dithering for better quality)
    if (imageScale !== 1.0) {
      console.log(`[Gemini] Scaling image by ${(imageScale * 100).toFixed(0)}%...`)
      const scaled = await scaleImage(processedBase64, imageScale)
      processedBase64 = scaled.base64
    }

    // Apply dithering if enabled
    // Note: normalise() is applied inside applyDithering() AFTER grayscale conversion
    if (enableDithering) {
      console.log(`[Gemini] Applying dithering with gain ${ditheringGain}, coarseness ${ditheringCoarseness}...`)
      const dithered = await applyDithering(processedBase64, ditheringGain, ditheringCoarseness)
      processedBase64 = dithered.base64
    }

    // Process for transparency
    console.log('[Gemini] Processing image for transparency...')
    const processed = await whiteToTransparent(processedBase64)
    console.log('[Gemini] Image processing complete')

    return {
      success: true,
      imageBase64: processed.base64,
      mimeType: processed.mimeType
    }
  } catch (error) {
    console.error('[Gemini] Image processing error:', error)
    // Return original image if processing fails
    return result
  }
}

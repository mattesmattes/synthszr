import sharp from 'sharp'

const IMAGE_PROMPT_TEMPLATE = `Visualisiere in Schwarz-Weiß die folgende News satirisch im Stil von Mort Drucker ohne in der Visualisierung auf "Mort Drucker" oder "MAD" hinzuweisen.

WICHTIGE STILRICHTLINIEN:
- Klarer Schwarz-Weiß-Kontrast mit Schraffuren und Linienzeichnung
- Satirische, leicht überzeichnete Darstellung
- Dynamische Kompositionen mit ausdrucksstarken Figuren
- Keine Text-Elemente oder Beschriftungen im Bild
- Keine Referenzen auf MAD Magazine oder den Künstler

NEWS TEXT:
{newsText}`

interface GenerateImageResult {
  success: boolean
  imageBase64?: string
  mimeType?: string
  error?: string
}

// Lazy load generateText to avoid module loading issues (same as tbos)
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
 * Generates a satirical black & white image based on news text using Gemini 3
 * Uses the same approach as tbos with AI SDK 5.x
 */
export async function generateSatiricalImage(newsText: string): Promise<GenerateImageResult> {
  const apiKey = process.env.GOOGLE_GENERATIVE_AI_API_KEY

  if (!apiKey) {
    return {
      success: false,
      error: 'GOOGLE_GENERATIVE_AI_API_KEY is not configured'
    }
  }

  const maxRetries = 3
  let lastError: Error | null = null

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const generateText = await getGenerateText()
      if (!generateText) {
        return {
          success: false,
          error: 'AI SDK not loaded'
        }
      }

      const prompt = IMAGE_PROMPT_TEMPLATE.replace('{newsText}', newsText.slice(0, 2000))

      console.log(`[Gemini] Generating image with gemini-3-pro-image, attempt ${attempt}/${maxRetries}`)

      // Use Gemini 3 Pro Image - same approach as tbos
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
            content: [
              {
                type: 'text' as const,
                text: prompt,
              },
            ],
          },
        ],
      })

      // Check for image in response files
      const imageFile = result.files?.[0]
      if (imageFile && imageFile.base64) {
        console.log('[Gemini] Image generation successful')

        // Get mimeType - could be mimeType or mediaType depending on SDK version
        let mimeType = (imageFile as any).mimeType || (imageFile as any).mediaType
        if (!mimeType || mimeType === 'undefined') {
          // Detect from base64 signature
          if (imageFile.base64.startsWith('iVBORw0KGgo')) {
            mimeType = 'image/png'
          } else if (imageFile.base64.startsWith('/9j/')) {
            mimeType = 'image/jpeg'
          } else if (imageFile.base64.startsWith('R0lGOD')) {
            mimeType = 'image/gif'
          } else if (imageFile.base64.startsWith('UklGR')) {
            mimeType = 'image/webp'
          } else {
            mimeType = 'image/png'
          }
          console.log('[Gemini] Detected mimeType:', mimeType)
        }

        return {
          success: true,
          imageBase64: imageFile.base64,
          mimeType: mimeType || 'image/png'
        }
      }

      // Log what we got instead
      console.log('[Gemini] No image in response. Text:', result.text?.slice(0, 200))

      if (attempt < maxRetries) {
        const delay = attempt * 1000
        console.log(`[Gemini] Retrying in ${delay / 1000}s...`)
        await new Promise(resolve => setTimeout(resolve, delay))
        continue
      }

      return {
        success: false,
        error: 'No image generated in response'
      }
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error))
      const errorMessage = lastError.message

      console.error(`[Gemini] Attempt ${attempt} error:`, errorMessage)

      // Check if retryable
      const isRetryable =
        errorMessage.includes('Gateway') ||
        errorMessage.includes('gateway') ||
        errorMessage.includes('temporarily unavailable') ||
        errorMessage.includes('service is currently unavailable') ||
        errorMessage.includes('503') ||
        errorMessage.includes('502') ||
        errorMessage.includes('429')

      if (isRetryable && attempt < maxRetries) {
        const delay = attempt * 1000
        console.log(`[Gemini] Retrying in ${delay / 1000}s...`)
        await new Promise(resolve => setTimeout(resolve, delay))
        continue
      }

      break
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
  threshold: number = 250
): Promise<{ base64: string; mimeType: string }> {
  const buffer = Buffer.from(imageBase64, 'base64')

  // Get image info
  const image = sharp(buffer)

  // Extract raw pixel data
  const { data, info } = await image
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true })

  // Process pixels: make white/near-white pixels transparent
  const pixels = new Uint8Array(data)
  for (let i = 0; i < pixels.length; i += 4) {
    const r = pixels[i]
    const g = pixels[i + 1]
    const b = pixels[i + 2]

    // Check if pixel is white/near-white
    if (r >= threshold && g >= threshold && b >= threshold) {
      pixels[i + 3] = 0 // Set alpha to 0 (transparent)
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
 * Generates a satirical image and processes it for transparency
 */
export async function generateAndProcessImage(newsText: string): Promise<{
  success: boolean
  imageBase64?: string
  mimeType?: string
  error?: string
}> {
  // Generate the image
  const result = await generateSatiricalImage(newsText)

  if (!result.success || !result.imageBase64) {
    return result
  }

  try {
    // Process for transparency
    console.log('[Gemini] Processing image for transparency...')
    const processed = await whiteToTransparent(result.imageBase64)
    console.log('[Gemini] Transparency processing complete')
    return {
      success: true,
      imageBase64: processed.base64,
      mimeType: processed.mimeType
    }
  } catch (error) {
    console.error('[Gemini] Transparency processing error:', error)
    // Return original image if processing fails
    return result
  }
}

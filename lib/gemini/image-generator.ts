import { GoogleGenerativeAI } from '@google/generative-ai'
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

/**
 * Generates a satirical black & white image based on news text using Gemini
 */
export async function generateSatiricalImage(newsText: string): Promise<GenerateImageResult> {
  const apiKey = process.env.GOOGLE_GENERATIVE_AI_API_KEY

  if (!apiKey) {
    return {
      success: false,
      error: 'GOOGLE_GENERATIVE_AI_API_KEY is not configured'
    }
  }

  try {
    const genAI = new GoogleGenerativeAI(apiKey)

    // Use Gemini 2.0 Flash with image generation capabilities
    const model = genAI.getGenerativeModel({
      model: 'gemini-2.0-flash-exp',
      generationConfig: {
        responseModalities: ['TEXT', 'IMAGE'] as unknown as undefined,
      } as unknown as undefined,
    })

    const prompt = IMAGE_PROMPT_TEMPLATE.replace('{newsText}', newsText.slice(0, 2000))

    console.log('Generating image with prompt length:', prompt.length)

    const result = await model.generateContent(prompt)
    const response = result.response

    console.log('Gemini response received')

    // Check for image parts in the response
    const parts = response.candidates?.[0]?.content?.parts || []

    for (const part of parts) {
      // Check if part has inline data (image)
      if ('inlineData' in part && part.inlineData) {
        const inlineData = part.inlineData as { data: string; mimeType: string }
        console.log('Found image in response, mimeType:', inlineData.mimeType)
        return {
          success: true,
          imageBase64: inlineData.data,
          mimeType: inlineData.mimeType || 'image/png'
        }
      }
    }

    // Log what we got instead
    const textParts = parts.filter(p => 'text' in p).map(p => (p as { text: string }).text)
    console.log('No image found. Text response:', textParts.join('\n').slice(0, 500))

    return {
      success: false,
      error: 'No image generated in response. Model may not support image generation.'
    }
  } catch (error) {
    console.error('Gemini image generation error:', error)
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error'
    }
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
    const processed = await whiteToTransparent(result.imageBase64)
    return {
      success: true,
      imageBase64: processed.base64,
      mimeType: processed.mimeType
    }
  } catch (error) {
    console.error('Image processing error:', error)
    // Return original image if processing fails
    return result
  }
}

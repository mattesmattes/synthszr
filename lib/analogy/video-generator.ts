/**
 * Video Generator for Analogy Machine
 *
 * Uses Google Veo 3.1 to generate animated videos from still images.
 * The generated marble statue image becomes a starting frame,
 * and Veo animates it with cinematic camera movement.
 *
 * Fallback: FFmpeg compositing (image + audio → static MP4)
 */

import { put } from '@vercel/blob'
import { createAdminClient } from '@/lib/supabase/admin'

const DEFAULT_VEO_MODEL = 'veo-3.1-generate-preview'
const POLL_INTERVAL_MS = 10000
const MAX_POLL_ATTEMPTS = 120 // ~20 minutes

/**
 * Get Veo model from settings
 */
async function getVeoModel(): Promise<string> {
  try {
    const supabase = createAdminClient()
    const { data } = await supabase
      .from('settings')
      .select('value')
      .eq('key', 'analogy_veo_model')
      .single()
    return data?.value?.model || DEFAULT_VEO_MODEL
  } catch {
    return DEFAULT_VEO_MODEL
  }
}

interface VideoInput {
  imageUrl: string
  audioUrl: string
  analogyText: string
  contextText: string
}

interface VideoResult {
  success: boolean
  videoBuffer?: Buffer
  durationSeconds?: number
  error?: string
}

/**
 * Download a URL to a Buffer
 */
async function downloadToBuffer(url: string): Promise<Buffer> {
  const res = await fetch(url)
  if (!res.ok) throw new Error(`Download failed: ${res.status} ${url}`)
  return Buffer.from(await res.arrayBuffer())
}

/**
 * Generate a video using Veo 3.1 (Image-to-Video).
 * Takes the generated marble statue image as starting frame
 * and creates a cinematic 8-second animation.
 */
export async function generateAnalogyVideo(input: VideoInput): Promise<VideoResult> {
  try {
    const model = await getVeoModel()
    const { GoogleGenAI } = await import('@google/genai')

    const ai = new GoogleGenAI({})

    // Download the source image
    console.log('[VideoGen] Downloading source image...')
    const imageBuffer = await downloadToBuffer(input.imageUrl)
    const imageBase64 = imageBuffer.toString('base64')

    // Build a cinematic prompt for the animation
    const videoPrompt = buildVideoPrompt(input.analogyText, input.contextText)

    console.log(`[VideoGen] Starting Veo generation (${model})...`)

    // Start video generation with image as starting frame
    let operation = await ai.models.generateVideos({
      model,
      prompt: videoPrompt,
      image: {
        imageBytes: imageBase64,
        mimeType: 'image/png',
      },
      config: {
        aspectRatio: '9:16',
        durationSeconds: 8,
      },
    })

    // Poll until complete
    let attempts = 0
    while (!operation.done && attempts < MAX_POLL_ATTEMPTS) {
      console.log(`[VideoGen] Polling... (attempt ${attempts + 1})`)
      await new Promise(resolve => setTimeout(resolve, POLL_INTERVAL_MS))
      operation = await ai.operations.getVideosOperation({ operation })
      attempts++
    }

    if (!operation.done) {
      return { success: false, error: `Veo generation timeout after ${attempts} polls` }
    }

    // Get the generated video
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const response = operation.response as any
    const generatedVideo = response?.generatedVideos?.[0]?.video

    if (!generatedVideo) {
      return { success: false, error: 'No video in Veo response' }
    }

    // Download the video file
    console.log('[VideoGen] Downloading generated video...')
    let videoBuffer: Buffer

    if (generatedVideo.uri) {
      // Download from URI
      videoBuffer = await downloadToBuffer(generatedVideo.uri)
    } else if (generatedVideo.videoBytes) {
      // Direct bytes
      videoBuffer = Buffer.from(generatedVideo.videoBytes, 'base64')
    } else {
      // Try file download API
      const tempPath = `/tmp/veo-${Date.now()}.mp4`
      await ai.files.download({
        file: generatedVideo,
        downloadPath: tempPath,
      })
      const { readFile, unlink } = await import('fs/promises')
      videoBuffer = await readFile(tempPath)
      await unlink(tempPath).catch(() => {})
    }

    console.log(`[VideoGen] Veo video generated: ${videoBuffer.length} bytes`)

    return {
      success: true,
      videoBuffer,
      durationSeconds: 8,
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    console.error('[VideoGen] Veo generation failed:', message)
    return { success: false, error: message }
  }
}

/**
 * Build a cinematic prompt for Veo animation
 */
function buildVideoPrompt(analogyText: string, contextText: string): string {
  return `Slow cinematic camera movement around 3D marble statues from Greek mythology.
The statues subtly come alive with minimal, deliberate motion — a slight head turn,
fingers tightening around an object, eyes shifting. Dramatic lighting with deep shadows.
High contrast black and white with a slight greenish tint.
Museum atmosphere, dust particles floating in light beams.
The scene conveys: ${analogyText.slice(0, 200)}
Style: hyper-photorealistic, cinematic, 9:16 portrait, no text or words in the video.`
}


/**
 * Upload video to Vercel Blob
 */
export async function uploadAnalogyVideo(
  videoId: string,
  videoBuffer: Buffer
): Promise<string> {
  const fileName = `analogy-videos/${videoId}/video.mp4`
  const blob = await put(fileName, videoBuffer, {
    access: 'public',
    contentType: 'video/mp4',
    allowOverwrite: true,
  })
  return blob.url
}

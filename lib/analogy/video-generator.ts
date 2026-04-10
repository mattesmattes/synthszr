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

    // Now merge Veo video with TTS audio using ffmpeg
    const finalVideo = await mergeVideoWithAudio(videoBuffer, input.audioUrl)

    return {
      success: true,
      videoBuffer: finalVideo.buffer,
      durationSeconds: finalVideo.durationSeconds,
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    console.error('[VideoGen] Veo generation failed:', message)

    // Fallback: try ffmpeg static composition
    console.log('[VideoGen] Falling back to ffmpeg static composition...')
    return generateStaticVideo(input)
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
 * Merge Veo-generated video with TTS audio using ffmpeg
 */
async function mergeVideoWithAudio(
  videoBuffer: Buffer,
  audioUrl: string
): Promise<{ buffer: Buffer; durationSeconds: number }> {
  const { execFile } = await import('child_process')
  const { promisify } = await import('util')
  const { writeFile, readFile, unlink } = await import('fs/promises')
  const execFileAsync = promisify(execFile)

  const ffmpeg = await getFfmpegPath()
  const tmpDir = `/tmp/veo-merge-${Date.now()}`
  const { mkdtemp } = await import('fs/promises')
  const { tmpdir } = await import('os')
  const { join } = await import('path')
  const dir = await mkdtemp(join(tmpdir(), 'veo-merge-'))

  const videoPath = join(dir, 'video.mp4')
  const audioPath = join(dir, 'audio.mp3')
  const outputPath = join(dir, 'output.mp4')

  try {
    const audioBuffer = await downloadToBuffer(audioUrl)
    await Promise.all([
      writeFile(videoPath, videoBuffer),
      writeFile(audioPath, audioBuffer),
    ])

    // Merge: use Veo video, replace audio with TTS
    const { stderr } = await execFileAsync(ffmpeg, [
      '-y',
      '-i', videoPath,
      '-i', audioPath,
      '-c:v', 'copy',         // Keep Veo video as-is
      '-c:a', 'aac',
      '-b:a', '128k',
      '-map', '0:v:0',        // Video from Veo
      '-map', '1:a:0',        // Audio from TTS
      '-shortest',
      '-movflags', '+faststart',
      outputPath,
    ], { timeout: 60000 })

    const durationMatch = stderr.match(/time=(\d+):(\d+):(\d+\.\d+)/)
    let durationSeconds = 8
    if (durationMatch) {
      durationSeconds = parseInt(durationMatch[1]) * 3600 +
        parseInt(durationMatch[2]) * 60 +
        parseFloat(durationMatch[3])
    }

    const buffer = await readFile(outputPath)
    return { buffer, durationSeconds }
  } finally {
    await Promise.all([
      unlink(videoPath).catch(() => {}),
      unlink(audioPath).catch(() => {}),
      unlink(outputPath).catch(() => {}),
    ])
  }
}

/**
 * Fallback: generate a static video using ffmpeg (image + audio + text overlay)
 */
async function generateStaticVideo(input: VideoInput): Promise<VideoResult> {
  const { execFile } = await import('child_process')
  const { promisify } = await import('util')
  const { writeFile, readFile, unlink, mkdtemp } = await import('fs/promises')
  const { tmpdir } = await import('os')
  const { join } = await import('path')
  const execFileAsync = promisify(execFile)

  const ffmpeg = await getFfmpegPath()
  const dir = await mkdtemp(join(tmpdir(), 'analogy-video-'))

  const imagePath = join(dir, 'image.png')
  const audioPath = join(dir, 'audio.mp3')
  const outputPath = join(dir, 'output.mp4')

  try {
    const [imageBuffer, audioBuffer] = await Promise.all([
      downloadToBuffer(input.imageUrl),
      downloadToBuffer(input.audioUrl),
    ])

    await Promise.all([
      writeFile(imagePath, imageBuffer),
      writeFile(audioPath, audioBuffer),
    ])

    const escapedAnalogy = escapeDrawtext(wrapText(input.analogyText, 30))
    const escapedContext = escapeDrawtext(input.contextText || '')

    const filters = [
      `[0:v]scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920,setsar=1,`,
      `zoompan=z='1+0.0005*in':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=1:s=1080x1920:fps=30,`,
      `drawbox=x=0:y=ih*0.55:w=iw:h=ih*0.45:color=black@0.6:t=fill,`,
      `drawtext=text='${escapedAnalogy}':fontsize=38:fontcolor=white:x=(w-text_w)/2:y=h*0.62:line_spacing=12:font=Arial,`,
      ...(escapedContext ? [
        `drawtext=text='${escapedContext}':fontsize=24:fontcolor=0x888888:x=(w-text_w)/2:y=h*0.88:font=Arial,`,
      ] : []),
      `drawtext=text='synthszr':fontsize=20:fontcolor=0xCCFF00:x=w-text_w-40:y=h-60:font=Arial`,
      `[v]`,
    ].join('')

    const { stderr } = await execFileAsync(ffmpeg, [
      '-y', '-loop', '1', '-i', imagePath, '-i', audioPath,
      '-filter_complex', filters,
      '-map', '[v]', '-map', '1:a',
      '-c:v', 'libx264', '-preset', 'fast', '-crf', '23',
      '-c:a', 'aac', '-b:a', '128k',
      '-shortest', '-pix_fmt', 'yuv420p', '-movflags', '+faststart',
      outputPath,
    ], { timeout: 120000 })

    const durationMatch = stderr.match(/time=(\d+):(\d+):(\d+\.\d+)/)
    let durationSeconds = 0
    if (durationMatch) {
      durationSeconds = parseInt(durationMatch[1]) * 3600 +
        parseInt(durationMatch[2]) * 60 +
        parseFloat(durationMatch[3])
    }

    const videoBuffer = await readFile(outputPath)
    console.log(`[VideoGen] FFmpeg fallback video: ${videoBuffer.length} bytes, ${durationSeconds.toFixed(1)}s`)

    return { success: true, videoBuffer, durationSeconds }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    console.error('[VideoGen] FFmpeg fallback failed:', message)
    return { success: false, error: message }
  } finally {
    await Promise.all([
      unlink(imagePath).catch(() => {}),
      unlink(audioPath).catch(() => {}),
      unlink(outputPath).catch(() => {}),
    ])
  }
}

/**
 * Find ffmpeg binary on system PATH
 */
function getFfmpegPath(): string {
  return 'ffmpeg'
}

function wrapText(text: string, maxChars: number = 30): string {
  const words = text.split(/\s+/)
  const lines: string[] = []
  let current = ''
  for (const word of words) {
    if ((current + ' ' + word).trim().length > maxChars && current) {
      lines.push(current.trim())
      current = word
    } else {
      current = (current + ' ' + word).trim()
    }
  }
  if (current) lines.push(current.trim())
  return lines.join('\n')
}

function escapeDrawtext(text: string): string {
  return text
    .replace(/\\/g, '\\\\')
    .replace(/'/g, "'\\\\\\''")
    .replace(/:/g, '\\:')
    .replace(/%/g, '%%')
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

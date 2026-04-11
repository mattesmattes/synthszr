/**
 * Video Generator for Analogy Machine
 *
 * Uses Veo 3.1 via Vercel AI SDK (experimental_generateVideo) to animate
 * the marble statue image into a cinematic 8-second video.
 * Audio merge via ffmpeg-static (pre-compiled binary, works on Vercel).
 */

import { put } from '@vercel/blob'
import { createAdminClient } from '@/lib/supabase/admin'

const DEFAULT_VEO_MODEL = 'google/veo-3.1-generate-001'

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

async function downloadToBuffer(url: string): Promise<Buffer> {
  const res = await fetch(url)
  if (!res.ok) throw new Error(`Download failed: ${res.status} ${url}`)
  return Buffer.from(await res.arrayBuffer())
}

/**
 * Generate a video using Veo 3.1 via Vercel AI SDK.
 * Image-to-video: marble statue becomes starting frame.
 * Then merges TTS audio via ffmpeg-static.
 */
export async function generateAnalogyVideo(input: VideoInput): Promise<VideoResult> {
  try {
    const model = await getVeoModel()
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { experimental_generateVideo: generateVideo } = await import('ai') as any

    const videoPrompt = buildVideoPrompt(input.analogyText, input.contextText)

    console.log(`[VideoGen] Starting Veo (${model}) via AI SDK...`)

    const result = await generateVideo({
      model,
      prompt: {
        image: input.imageUrl,
        text: videoPrompt,
      },
      providerOptions: {
        vertex: {
          resizeMode: 'crop',
          generateAudio: true,
          negativePrompt: 'text, words, letters, writing, subtitles, captions, titles, labels, signs, watermarks, logos, numbers on screen',
          pollIntervalMs: 10000,
          pollTimeoutMs: 600000,
        },
      },
    })

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const video = (result as any).videos?.[0]
    if (!video?.uint8Array) {
      return { success: false, error: 'No video in Veo response' }
    }

    const veoBuffer = Buffer.from(video.uint8Array)
    console.log(`[VideoGen] Veo video: ${veoBuffer.length} bytes`)

    // Merge Veo video with TTS audio
    console.log('[VideoGen] Merging TTS audio...')
    const audioBuffer = await downloadToBuffer(input.audioUrl)
    const merged = await mergeVideoWithAudio(veoBuffer, audioBuffer)

    if (merged.success && merged.buffer) {
      console.log(`[VideoGen] Final video: ${merged.buffer.length} bytes`)
      return { success: true, videoBuffer: merged.buffer, durationSeconds: merged.durationSeconds }
    }

    // If merge fails, return Veo video as-is (has ambient audio from Veo)
    console.warn(`[VideoGen] Audio merge failed (${merged.error}), using Veo audio`)
    return { success: true, videoBuffer: veoBuffer, durationSeconds: 8 }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    console.error('[VideoGen] Veo failed:', message)
    return { success: false, error: message }
  }
}

/**
 * Merge video + audio using FFmpeg WASM (no native binary needed, runs on Vercel).
 */
async function mergeVideoWithAudio(
  videoBuffer: Buffer,
  audioBuffer: Buffer
): Promise<{ success: boolean; buffer?: Buffer; durationSeconds?: number; error?: string }> {
  try {
    const { FFmpeg } = await import('@ffmpeg/ffmpeg')
    const { toBlobURL } = await import('@ffmpeg/util')

    const ffmpeg = new FFmpeg()

    // Load FFmpeg WASM core from CDN
    const baseURL = 'https://unpkg.com/@ffmpeg/core@0.12.10/dist/umd'
    await ffmpeg.load({
      coreURL: await toBlobURL(`${baseURL}/ffmpeg-core.js`, 'text/javascript'),
      wasmURL: await toBlobURL(`${baseURL}/ffmpeg-core.wasm`, 'application/wasm'),
    })

    // Write input files to virtual filesystem
    await ffmpeg.writeFile('video.mp4', new Uint8Array(videoBuffer))
    await ffmpeg.writeFile('audio.mp3', new Uint8Array(audioBuffer))

    // Merge: keep Veo video, replace audio with TTS, use shortest stream
    await ffmpeg.exec([
      '-i', 'video.mp4',
      '-i', 'audio.mp3',
      '-c:v', 'copy',
      '-c:a', 'aac',
      '-b:a', '128k',
      '-map', '0:v:0',
      '-map', '1:a:0',
      '-shortest',
      '-movflags', '+faststart',
      '-y',
      'output.mp4',
    ])

    // Read merged output
    const outputData = await ffmpeg.readFile('output.mp4')
    const outputBuffer = Buffer.from(outputData as Uint8Array)

    console.log(`[VideoGen] FFmpeg WASM merge done: ${outputBuffer.length} bytes`)
    return { success: true, buffer: outputBuffer, durationSeconds: 8 }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    console.error('[VideoGen] FFmpeg WASM merge failed:', message)
    return { success: false, error: message }
  }
}

function buildVideoPrompt(analogyText: string, contextText: string): string {
  return `Slow cinematic camera movement around 3D marble statues from Greek mythology.
The statues subtly come alive with minimal, deliberate motion — a slight head turn,
fingers tightening around an object, eyes shifting. Dramatic lighting with deep shadows.
High contrast black and white with a slight greenish tint.
Museum atmosphere, dust particles floating in light beams.
The scene conveys: ${analogyText.slice(0, 200)}
Style: hyper-photorealistic, cinematic, 9:16 portrait.
CRITICAL: The video must contain ZERO text, ZERO words, ZERO letters, ZERO writing of any kind. Pure visual imagery only.`
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

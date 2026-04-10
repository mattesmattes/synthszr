/**
 * Machine Video Generator
 *
 * Uses Veo 3.1 to generate terminal-style "AI processing" videos
 * for The Machine concept. Veo generates:
 * - Dark terminal aesthetic with glowing text
 * - Processing animation atmosphere
 * - Native ambient audio (keyboard clicks, processing sounds)
 *
 * The script_data JSON drives the video prompt.
 */

import { put } from '@vercel/blob'
import { createAdminClient } from '@/lib/supabase/admin'
import type { MachineScript, MachineStep } from './machine-extractor'

const DEFAULT_VEO_MODEL = 'veo-3.1-generate-preview'
const POLL_INTERVAL_MS = 10000
const MAX_POLL_ATTEMPTS = 120

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

interface MachineVideoResult {
  success: boolean
  videoBuffer?: Buffer
  durationSeconds?: number
  error?: string
}

/**
 * Generate a Machine-style video using Veo 3.1.
 * Veo creates a terminal atmosphere video with native audio.
 */
export async function generateMachineVideo(script: MachineScript): Promise<MachineVideoResult> {
  try {
    const model = await getVeoModel()
    const { GoogleGenAI } = await import('@google/genai')
    const ai = new GoogleGenAI({})

    const videoPrompt = buildMachinePrompt(script)

    console.log(`[MachineVideo] Starting Veo generation (${model})...`)

    let operation = await ai.models.generateVideos({
      model,
      prompt: videoPrompt,
      config: {
        aspectRatio: '9:16',
        durationSeconds: 8,
      },
    })

    // Poll until complete
    let attempts = 0
    while (!operation.done && attempts < MAX_POLL_ATTEMPTS) {
      console.log(`[MachineVideo] Polling... (attempt ${attempts + 1})`)
      await new Promise(resolve => setTimeout(resolve, POLL_INTERVAL_MS))
      operation = await ai.operations.getVideosOperation({ operation })
      attempts++
    }

    if (!operation.done) {
      return { success: false, error: `Veo timeout after ${attempts} polls` }
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const response = operation.response as any
    const generatedVideo = response?.generatedVideos?.[0]?.video

    if (!generatedVideo) {
      return { success: false, error: 'No video in Veo response' }
    }

    // Download video
    let videoBuffer: Buffer
    if (generatedVideo.uri) {
      const res = await fetch(generatedVideo.uri)
      if (!res.ok) throw new Error(`Download failed: ${res.status}`)
      videoBuffer = Buffer.from(await res.arrayBuffer())
    } else if (generatedVideo.videoBytes) {
      videoBuffer = Buffer.from(generatedVideo.videoBytes, 'base64')
    } else {
      const tempPath = `/tmp/machine-${Date.now()}.mp4`
      await ai.files.download({ file: generatedVideo, downloadPath: tempPath })
      const { readFile, unlink } = await import('fs/promises')
      videoBuffer = await readFile(tempPath)
      await unlink(tempPath).catch(() => {})
    }

    console.log(`[MachineVideo] Generated: ${videoBuffer.length} bytes`)

    return {
      success: true,
      videoBuffer,
      durationSeconds: 8,
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    console.error('[MachineVideo] Generation failed:', message)
    return { success: false, error: message }
  }
}

/**
 * Build a cinematic prompt for Veo that describes the terminal animation.
 * Veo generates both video and native audio.
 */
function buildMachinePrompt(script: MachineScript): string {
  // Extract key visual elements from the script
  const highlights = script.steps
    .filter((s: MachineStep) => s.type === 'highlight')
    .map((s: MachineStep) => s.text)
    .slice(0, 3)

  const strikes = script.steps
    .filter((s: MachineStep) => s.type === 'strike')
    .map((s: MachineStep) => s.text)
    .slice(0, 2)

  const takeLines = script.steps
    .filter((s: MachineStep) => s.type === 'build_take')
    .map((s: MachineStep) => s.text)

  return `A dark terminal screen, black background, monospace green text like a hacker terminal.
Text rapidly streams in from the top, scrolling down like a code terminal output.
Key phrases suddenly glow bright cyan and green as they are detected by the AI.
${highlights.length > 0 ? `Words that light up: "${highlights.join('", "')}"` : ''}
Some text lines get struck through with a red flash and fade out — the AI discarding noise.
${strikes.length > 0 ? `Discarded phrases dissolve: "${strikes.join('", "')}"` : ''}
Then the screen clears. A blinking cursor appears. The distilled output types itself slowly,
character by character, in bright green monospace text:
${takeLines.length > 0 ? `"${takeLines.join(' / ')}"` : `"${script.take}"`}

Visual style: Pure terminal aesthetic. Black screen, green and cyan monospace text,
occasional white flashes. No faces, no humans. Just text and light.
CRT monitor glow effect. Slight screen flicker. Scanlines.
Portrait 9:16 format. Cinematic quality.

Audio: Mechanical keyboard typing sounds. Soft ambient electronic hum.
Subtle processing beeps when text highlights. A satisfying "click" when
irrelevant text is struck through. Quiet, ASMR-like sound design.
No music, no voice, no narration.`
}

/**
 * Upload Machine video to Vercel Blob
 */
export async function uploadMachineVideo(
  videoId: string,
  videoBuffer: Buffer
): Promise<string> {
  const fileName = `analogy-videos/${videoId}/machine-video.mp4`
  const blob = await put(fileName, videoBuffer, {
    access: 'public',
    contentType: 'video/mp4',
    allowOverwrite: true,
  })
  return blob.url
}

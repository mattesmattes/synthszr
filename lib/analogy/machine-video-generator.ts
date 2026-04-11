/**
 * Machine Video Generator
 *
 * Uses Veo 3.1 via Vercel AI SDK to generate terminal-style videos
 * for The Machine concept. Text-to-video with native audio.
 */

import { put } from '@vercel/blob'
import { createAdminClient } from '@/lib/supabase/admin'
import type { MachineScript, MachineStep } from './machine-extractor'

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

interface MachineVideoResult {
  success: boolean
  videoBuffer?: Buffer
  durationSeconds?: number
  error?: string
}

/**
 * Generate a Machine-style video using Veo 3.1 via Vercel AI SDK.
 * Text-to-video: terminal atmosphere with native audio.
 */
export async function generateMachineVideo(script: MachineScript): Promise<MachineVideoResult> {
  try {
    const model = await getVeoModel()
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { experimental_generateVideo: generateVideo } = await import('ai') as any

    const videoPrompt = buildMachinePrompt(script)

    console.log(`[MachineVideo] Starting Veo (${model}) via AI SDK...`)

    const result = await generateVideo({
      model,
      prompt: videoPrompt,
      aspectRatio: '9:16',
      providerOptions: {
        vertex: {
          generateAudio: true,
          negativePrompt: 'readable text, real words, actual letters, human faces, people',
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

    const videoBuffer = Buffer.from(video.uint8Array)
    console.log(`[MachineVideo] Generated: ${videoBuffer.length} bytes`)

    return { success: true, videoBuffer, durationSeconds: 8 }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    console.error('[MachineVideo] Veo failed:', message)
    return { success: false, error: message }
  }
}

function buildMachinePrompt(script: MachineScript): string {
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

  return `A dark computer terminal in a dimly lit room. The screen glows with green and cyan light,
reflecting off the walls. Abstract digital data streams flow across the screen as blurred,
unreadable patterns — NOT actual text, just light and motion suggesting data processing.
Bright flashes of cyan and green pulse rhythmically as the AI processes information.
${highlights.length > 0 ? `The processing intensifies, with ${highlights.length} key moments of bright illumination.` : ''}
${strikes.length > 0 ? `Red flashes appear as data is discarded, then the screen dims briefly.` : ''}
Finally, a single bright green glow fills the center of the screen — the result is ready.

Visual style: Dark, moody, cinematic. Black room with a glowing monitor as the only light source.
Abstract data visualization — flowing particles, light trails, pulsing grids.
NO readable text, NO actual words or letters on screen. Only light patterns and abstract shapes.
CRT monitor glow effect. Slight screen flicker. Dust particles in the monitor light.
Portrait 9:16 format. Cinematic quality.

Audio: Mechanical keyboard typing sounds. Soft ambient electronic hum.
Subtle processing beeps synced to the visual pulses. A satisfying click sound
during the red flashes. Quiet, ASMR-like sound design.
No music, no voice, no narration.`
}

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

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

  return `A dark terminal screen, black background, monospace green text like a hacker terminal.
Text rapidly streams in from the top, scrolling down like code terminal output.
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
Subtle processing beeps when text highlights. A satisfying click when
irrelevant text is struck through. Quiet, ASMR-like sound design.
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

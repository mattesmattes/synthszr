/**
 * Video Generator for Analogy Machine
 *
 * Composites image + audio + text overlay into a 9:16 MP4 for TikTok/Reels.
 * Uses ffmpeg via child_process (no fluent-ffmpeg dependency).
 */

import { execFile } from 'child_process'
import { promisify } from 'util'
import { writeFile, unlink, mkdtemp } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import { readFile } from 'fs/promises'
import { put } from '@vercel/blob'

const execFileAsync = promisify(execFile)

/**
 * Find ffmpeg binary: try @ffmpeg-installer first, then system PATH
 */
async function getFfmpegPath(): Promise<string> {
  try {
    const installer = await import('@ffmpeg-installer/ffmpeg')
    return installer.path
  } catch {
    return 'ffmpeg' // Fall back to system PATH
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
 * Wrap text for ffmpeg drawtext (approximate line breaking)
 */
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

/**
 * Escape text for ffmpeg drawtext filter
 */
function escapeDrawtext(text: string): string {
  return text
    .replace(/\\/g, '\\\\')
    .replace(/'/g, "'\\\\\\''")
    .replace(/:/g, '\\:')
    .replace(/%/g, '%%')
}

/**
 * Composite image + audio into a 9:16 MP4 with text overlay.
 *
 * Layout (1080x1920):
 * - Background: image scaled to fill, slight zoom
 * - Bottom third: semi-transparent dark overlay
 * - Analogy text: white, bold, centered in bottom third
 * - Context text: smaller, muted, below analogy
 * - Synthszr branding: bottom corner
 */
export async function generateAnalogyVideo(input: VideoInput): Promise<VideoResult> {
  const ffmpeg = await getFfmpegPath()
  const tmpDir = await mkdtemp(join(tmpdir(), 'analogy-video-'))

  const imagePath = join(tmpDir, 'image.png')
  const audioPath = join(tmpDir, 'audio.mp3')
  const outputPath = join(tmpDir, 'output.mp4')

  try {
    // Download assets
    console.log('[VideoGen] Downloading assets...')
    const [imageBuffer, audioBuffer] = await Promise.all([
      downloadToBuffer(input.imageUrl),
      downloadToBuffer(input.audioUrl),
    ])

    await Promise.all([
      writeFile(imagePath, imageBuffer),
      writeFile(audioPath, audioBuffer),
    ])

    // Prepare text
    const wrappedAnalogy = wrapText(input.analogyText, 30)
    const escapedAnalogy = escapeDrawtext(wrappedAnalogy)
    const escapedContext = escapeDrawtext(input.contextText || '')

    // Build ffmpeg filter complex:
    // 1. Scale image to 1080x1920 (cover crop)
    // 2. Loop image for audio duration
    // 3. Add semi-transparent overlay at bottom
    // 4. Add text overlays
    // 5. Slow zoom (Ken Burns) effect
    const filterComplex = [
      // Scale and crop image to 9:16
      `[0:v]scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920,setsar=1,`,
      // Ken Burns: slow zoom from 1.0 to 1.05 over the duration
      `zoompan=z='1+0.0005*in':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=1:s=1080x1920:fps=30,`,
      // Dark gradient overlay at bottom
      `drawbox=x=0:y=ih*0.55:w=iw:h=ih*0.45:color=black@0.6:t=fill,`,
      // Analogy text — bold white, centered
      `drawtext=text='${escapedAnalogy}':fontsize=38:fontcolor=white:x=(w-text_w)/2:y=h*0.62:line_spacing=12:font=Arial,`,
      // Context text — smaller, muted
      ...(escapedContext ? [
        `drawtext=text='${escapedContext}':fontsize=24:fontcolor=0x888888:x=(w-text_w)/2:y=h*0.88:font=Arial,`
      ] : []),
      // Synthszr branding — bottom right, neon green
      `drawtext=text='synthszr':fontsize=20:fontcolor=0xCCFF00:x=w-text_w-40:y=h-60:font=Arial`,
      `[v]`,
    ].join('')

    // FFmpeg command
    const args = [
      '-y',
      '-loop', '1',           // Loop still image
      '-i', imagePath,
      '-i', audioPath,
      '-filter_complex', filterComplex,
      '-map', '[v]',
      '-map', '1:a',
      '-c:v', 'libx264',
      '-preset', 'fast',
      '-crf', '23',
      '-c:a', 'aac',
      '-b:a', '128k',
      '-shortest',            // End when audio ends
      '-pix_fmt', 'yuv420p',  // Compatibility
      '-movflags', '+faststart', // Web streaming
      outputPath,
    ]

    console.log('[VideoGen] Running ffmpeg...')
    const { stderr } = await execFileAsync(ffmpeg, args, { timeout: 120000 })

    // Extract duration from ffmpeg output
    const durationMatch = stderr.match(/time=(\d+):(\d+):(\d+\.\d+)/)
    let durationSeconds = 0
    if (durationMatch) {
      durationSeconds = parseInt(durationMatch[1]) * 3600 +
        parseInt(durationMatch[2]) * 60 +
        parseFloat(durationMatch[3])
    }

    const videoBuffer = await readFile(outputPath)
    console.log(`[VideoGen] Video generated: ${videoBuffer.length} bytes, ${durationSeconds.toFixed(1)}s`)

    return {
      success: true,
      videoBuffer,
      durationSeconds,
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    console.error('[VideoGen] Failed:', message)
    return { success: false, error: message }
  } finally {
    // Cleanup temp files
    await Promise.all([
      unlink(imagePath).catch(() => {}),
      unlink(audioPath).catch(() => {}),
      unlink(outputPath).catch(() => {}),
    ])
  }
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

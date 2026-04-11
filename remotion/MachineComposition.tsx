import React from 'react'
import { AbsoluteFill, useCurrentFrame, useVideoConfig, interpolate, spring, Sequence } from 'remotion'

/**
 * Terminal animation composition for "The Machine".
 * Renders a pixel-perfect terminal with monospace text,
 * driven by a MachineScript JSON.
 */

interface MachineStep {
  type: 'stream_in' | 'highlight' | 'extract_number' | 'strike' | 'build_take' | 'pause'
  text: string
  color?: string
  delay_ms?: number
}

interface MachineProps {
  sourceText: string
  steps: MachineStep[]
  take: string
}

const COLORS: Record<string, string> = {
  green: '#00FF00',
  cyan: '#00FFFF',
  yellow: '#FFFF00',
  red: '#FF4444',
}

const FONT = `'JetBrains Mono', 'Fira Code', 'SF Mono', 'Consolas', monospace`

export const MachineComposition: React.FC<MachineProps> = ({ sourceText, steps, take }) => {
  const frame = useCurrentFrame()
  const { fps } = useVideoConfig()

  // Calculate cumulative timing for each step
  const stepTimings: Array<{ startFrame: number; endFrame: number; step: MachineStep }> = []
  let currentFrame = Math.round(0.5 * fps) // 0.5s initial delay

  for (const step of steps) {
    const durationMs = step.delay_ms || 400
    const durationFrames = Math.round((durationMs / 1000) * fps)
    stepTimings.push({
      startFrame: currentFrame,
      endFrame: currentFrame + durationFrames,
      step,
    })
    currentFrame += durationFrames
  }

  // Determine what's visible at the current frame
  const visibleStreamText = getStreamedText(frame, fps, stepTimings)
  const activeHighlights = getActiveHighlights(frame, stepTimings)
  const activeStrikes = getActiveStrikes(frame, stepTimings)
  const takeLines = getTakeLines(frame, fps, stepTimings)
  const showTake = takeLines.length > 0

  // CRT scanline effect
  const scanlineOpacity = 0.08

  return (
    <AbsoluteFill style={{ backgroundColor: '#0a0a0a', fontFamily: FONT }}>
      {/* CRT Scanlines */}
      <AbsoluteFill style={{
        backgroundImage: `repeating-linear-gradient(0deg, rgba(0,255,0,${scanlineOpacity}) 0px, transparent 1px, transparent 3px)`,
        pointerEvents: 'none',
        zIndex: 10,
      }} />

      {/* Screen glow */}
      <AbsoluteFill style={{
        boxShadow: 'inset 0 0 120px rgba(0, 255, 0, 0.05)',
        pointerEvents: 'none',
        zIndex: 5,
      }} />

      {/* Terminal header */}
      <div style={{
        padding: '40px 40px 20px 40px',
        color: '#00FF00',
        fontSize: 14,
        opacity: 0.5,
      }}>
        <span style={{ marginRight: 8 }}>$</span>
        <span>synthszr --process</span>
        <Cursor frame={frame} fps={fps} />
      </div>

      {/* Main content area */}
      <div style={{
        padding: '0 40px',
        flex: 1,
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
      }}>
        {/* Source text streaming in */}
        {!showTake && (
          <div style={{
            color: '#888888',
            fontSize: 18,
            lineHeight: 1.6,
            whiteSpace: 'pre-wrap',
            wordBreak: 'break-word',
          }}>
            <HighlightedText
              text={visibleStreamText}
              highlights={activeHighlights}
              strikes={activeStrikes}
              frame={frame}
              fps={fps}
            />
          </div>
        )}

        {/* Take output */}
        {showTake && (
          <div style={{
            flex: 1,
            display: 'flex',
            flexDirection: 'column',
            justifyContent: 'center',
            gap: 4,
          }}>
            <div style={{
              color: '#00FF00',
              fontSize: 12,
              opacity: 0.6,
              marginBottom: 16,
              borderTop: '1px solid #1a3a1a',
              paddingTop: 16,
            }}>
              OUTPUT:
            </div>
            {takeLines.map((line, i) => (
              <div key={i} style={{
                color: '#00FF00',
                fontSize: 24,
                fontWeight: 700,
                lineHeight: 1.5,
                opacity: interpolate(
                  frame - (line.startFrame || 0),
                  [0, 8],
                  [0, 1],
                  { extrapolateRight: 'clamp', extrapolateLeft: 'clamp' }
                ),
                transform: `translateY(${interpolate(
                  frame - (line.startFrame || 0),
                  [0, 8],
                  [10, 0],
                  { extrapolateRight: 'clamp', extrapolateLeft: 'clamp' }
                )}px)`,
              }}>
                {line.text}
                {i === takeLines.length - 1 && <Cursor frame={frame} fps={fps} />}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Synthszr branding */}
      <div style={{
        position: 'absolute',
        bottom: 40,
        right: 40,
        color: '#CCFF00',
        fontSize: 16,
        fontWeight: 700,
        opacity: 0.7,
      }}>
        synthszr
      </div>
    </AbsoluteFill>
  )
}

// --- Helper components ---

const Cursor: React.FC<{ frame: number; fps: number }> = ({ frame, fps }) => {
  const blink = Math.floor(frame / (fps / 2)) % 2 === 0
  return (
    <span style={{
      display: 'inline-block',
      width: 10,
      height: 20,
      backgroundColor: '#00FF00',
      marginLeft: 2,
      opacity: blink ? 1 : 0,
      verticalAlign: 'text-bottom',
    }} />
  )
}

interface HighlightedTextProps {
  text: string
  highlights: Array<{ text: string; color: string; active: boolean }>
  strikes: Array<{ text: string; progress: number }>
  frame: number
  fps: number
}

const HighlightedText: React.FC<HighlightedTextProps> = ({ text, highlights, strikes }) => {
  let result = text

  // Build spans with highlights and strikes
  const parts: Array<{ text: string; style: React.CSSProperties }> = []
  let remaining = result

  // Simple approach: split by highlighted words
  const allMarkers = [
    ...highlights.filter(h => h.active).map(h => ({ text: h.text, type: 'highlight' as const, color: h.color })),
    ...strikes.filter(s => s.progress > 0).map(s => ({ text: s.text, type: 'strike' as const, color: '', progress: s.progress })),
  ]

  if (allMarkers.length === 0) {
    return <>{text}</>
  }

  // Find and highlight each marker in order
  let pos = 0
  for (const marker of allMarkers) {
    const idx = remaining.toLowerCase().indexOf(marker.text.toLowerCase())
    if (idx === -1) continue

    // Text before marker
    if (idx > 0) {
      parts.push({ text: remaining.slice(0, idx), style: {} })
    }

    // Marker itself
    if (marker.type === 'highlight') {
      parts.push({
        text: remaining.slice(idx, idx + marker.text.length),
        style: {
          color: COLORS[marker.color] || '#00FFFF',
          fontWeight: 700,
          textShadow: `0 0 10px ${COLORS[marker.color] || '#00FFFF'}40`,
        },
      })
    } else {
      const strikeMarker = marker as { progress: number; text: string }
      parts.push({
        text: remaining.slice(idx, idx + marker.text.length),
        style: {
          textDecoration: 'line-through',
          color: '#FF4444',
          opacity: 1 - strikeMarker.progress * 0.7,
        },
      })
    }

    remaining = remaining.slice(idx + marker.text.length)
  }

  // Remaining text
  if (remaining) {
    parts.push({ text: remaining, style: {} })
  }

  return (
    <>
      {parts.map((part, i) => (
        <span key={i} style={part.style}>{part.text}</span>
      ))}
    </>
  )
}

// --- Timing helpers ---

function getStreamedText(
  frame: number,
  fps: number,
  stepTimings: Array<{ startFrame: number; endFrame: number; step: MachineStep }>
): string {
  const streamSteps = stepTimings.filter(t => t.step.type === 'stream_in')
  if (streamSteps.length === 0) return ''

  let text = ''
  for (const timing of streamSteps) {
    const progress = interpolate(
      frame,
      [timing.startFrame, timing.endFrame],
      [0, 1],
      { extrapolateRight: 'clamp', extrapolateLeft: 'clamp' }
    )
    const chars = Math.floor(progress * timing.step.text.length)
    text += timing.step.text.slice(0, chars)
  }

  return text
}

function getActiveHighlights(
  frame: number,
  stepTimings: Array<{ startFrame: number; endFrame: number; step: MachineStep }>
): Array<{ text: string; color: string; active: boolean }> {
  return stepTimings
    .filter(t => t.step.type === 'highlight')
    .map(t => ({
      text: t.step.text,
      color: t.step.color || 'cyan',
      active: frame >= t.startFrame,
    }))
}

function getActiveStrikes(
  frame: number,
  stepTimings: Array<{ startFrame: number; endFrame: number; step: MachineStep }>
): Array<{ text: string; progress: number }> {
  return stepTimings
    .filter(t => t.step.type === 'strike')
    .map(t => ({
      text: t.step.text,
      progress: interpolate(
        frame,
        [t.startFrame, t.endFrame],
        [0, 1],
        { extrapolateRight: 'clamp', extrapolateLeft: 'clamp' }
      ),
    }))
}

function getTakeLines(
  frame: number,
  fps: number,
  stepTimings: Array<{ startFrame: number; endFrame: number; step: MachineStep }>
): Array<{ text: string; startFrame: number }> {
  const takeSteps = stepTimings.filter(t => t.step.type === 'build_take' && frame >= t.startFrame)
  return takeSteps.map(t => ({
    text: t.step.text,
    startFrame: t.startFrame,
  }))
}

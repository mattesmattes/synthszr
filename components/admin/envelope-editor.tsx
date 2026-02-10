'use client'

import { useState, useRef } from 'react'
import type { AudioEnvelope, EnvelopePoint } from '@/lib/audio/envelope'
import { defaultBezierControlPoints } from '@/lib/audio/envelope'

interface EnvelopeEditorProps {
  envelope: AudioEnvelope
  onChange: (envelope: AudioEnvelope) => void
  timeRange: number        // Total X-axis in seconds
  color: string            // CSS color (hex or tailwind)
  label?: string
  height?: number          // Default 40 (half of 80px SVG)
}

const W = 600
const PAD = 4

type DragTarget =
  | { type: 'point'; index: number }
  | { type: 'cp1'; segIndex: number }
  | { type: 'cp2'; segIndex: number }

export function EnvelopeEditor({ envelope, onChange, timeRange, color, label, height = 40 }: EnvelopeEditorProps) {
  const svgRef = useRef<SVGSVGElement>(null)
  const [dragging, setDragging] = useState<DragTarget | null>(null)
  const H = height

  if (timeRange <= 0 || envelope.points.length < 2) return null

  const toX = (sec: number) => PAD + (sec / timeRange) * (W - PAD * 2)
  const toY = (vol: number) => PAD + (1 - vol) * (H - PAD * 2)
  const xToSec = (x: number) => Math.max(0, Math.min(timeRange, ((x - PAD) / (W - PAD * 2)) * timeRange))
  const yToVol = (y: number) => Math.max(0, Math.min(1, 1 - (y - PAD) / (H - PAD * 2)))

  function svgPoint(clientX: number, clientY: number) {
    const svg = svgRef.current!
    const rect = svg.getBoundingClientRect()
    return {
      x: ((clientX - rect.left) / rect.width) * W,
      y: ((clientY - rect.top) / rect.height) * H,
    }
  }

  // Build SVG path commands
  function buildPath(): { fillPath: string; strokePath: string; segmentPaths: string[] } {
    const { points, segments } = envelope
    const segPaths: string[] = []

    let strokeD = `M ${toX(points[0].sec)} ${toY(points[0].vol)}`

    for (let i = 0; i < segments.length; i++) {
      const p0 = points[i]
      const p1 = points[i + 1]
      const seg = segments[i]
      let segCmd: string

      if (seg.curve === 'bezier' && seg.cp1 && seg.cp2) {
        segCmd = `C ${toX(seg.cp1.sec)} ${toY(seg.cp1.vol)}, ${toX(seg.cp2.sec)} ${toY(seg.cp2.vol)}, ${toX(p1.sec)} ${toY(p1.vol)}`
      } else {
        segCmd = `L ${toX(p1.sec)} ${toY(p1.vol)}`
      }

      strokeD += ` ${segCmd}`
      // Individual segment path for hit detection
      segPaths.push(`M ${toX(p0.sec)} ${toY(p0.vol)} ${segCmd}`)
    }

    // Fill path: close to bottom
    const fillD = strokeD + ` L ${toX(points[points.length - 1].sec)} ${toY(0)} L ${toX(points[0].sec)} ${toY(0)} Z`

    return { fillPath: fillD, strokePath: strokeD, segmentPaths: segPaths }
  }

  function handlePointerDown(e: React.PointerEvent, target: DragTarget) {
    ;(e.target as Element).setPointerCapture(e.pointerId)
    setDragging(target)
    e.preventDefault()
    e.stopPropagation()
  }

  function handlePointerMove(e: React.PointerEvent) {
    if (!dragging) return
    const pt = svgPoint(e.clientX, e.clientY)
    const sec = xToSec(pt.x)
    const vol = yToVol(pt.y)

    const newEnv = structuredClone(envelope)

    if (dragging.type === 'point') {
      const idx = dragging.index
      const prevSec = idx > 0 ? newEnv.points[idx - 1].sec : 0
      const nextSec = idx < newEnv.points.length - 1 ? newEnv.points[idx + 1].sec : timeRange

      // First and last points: keep X fixed
      if (idx === 0 || idx === newEnv.points.length - 1) {
        newEnv.points[idx].vol = vol
      } else {
        // Clamp X between neighbors (maintain monotonic time)
        newEnv.points[idx].sec = Math.max(prevSec + 0.01, Math.min(nextSec - 0.01, sec))
        newEnv.points[idx].vol = vol
      }
    } else if (dragging.type === 'cp1') {
      const segIdx = dragging.segIndex
      const seg = newEnv.segments[segIdx]
      if (seg.cp1) {
        const p0 = newEnv.points[segIdx]
        const p1 = newEnv.points[segIdx + 1]
        seg.cp1.sec = Math.max(p0.sec, Math.min(p1.sec, sec))
        seg.cp1.vol = vol
      }
    } else if (dragging.type === 'cp2') {
      const segIdx = dragging.segIndex
      const seg = newEnv.segments[segIdx]
      if (seg.cp2) {
        const p0 = newEnv.points[segIdx]
        const p1 = newEnv.points[segIdx + 1]
        seg.cp2.sec = Math.max(p0.sec, Math.min(p1.sec, sec))
        seg.cp2.vol = vol
      }
    }

    onChange(newEnv)
  }

  function handlePointerUp(e: React.PointerEvent) {
    if (dragging) {
      ;(e.target as Element).releasePointerCapture(e.pointerId)
      setDragging(null)
    }
  }

  function handleSegmentDoubleClick(segIndex: number) {
    const newEnv = structuredClone(envelope)
    const seg = newEnv.segments[segIndex]

    if (seg.curve === 'linear') {
      // Toggle to bezier with default CPs
      const p0 = newEnv.points[segIndex]
      const p1 = newEnv.points[segIndex + 1]
      const cps = defaultBezierControlPoints(p0, p1)
      seg.curve = 'bezier'
      seg.cp1 = cps.cp1
      seg.cp2 = cps.cp2
    } else {
      // Toggle to linear, remove CPs
      seg.curve = 'linear'
      delete seg.cp1
      delete seg.cp2
    }

    onChange(newEnv)
  }

  const { fillPath, strokePath, segmentPaths } = buildPath()
  const { points, segments } = envelope

  return (
    <svg
      ref={svgRef}
      viewBox={`0 0 ${W} ${H}`}
      className="w-full select-none"
      style={{ cursor: dragging ? 'grabbing' : 'default' }}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
    >
      {/* Filled envelope area */}
      <path d={fillPath} fill={color} opacity={0.2} />
      {/* Stroke on top edge */}
      <path d={strokePath} fill="none" stroke={color} strokeWidth={1.5} />

      {/* Invisible fat-stroke paths per segment for double-click detection */}
      {segmentPaths.map((d, i) => (
        <path
          key={`hit-${i}`}
          d={d}
          fill="none"
          stroke="transparent"
          strokeWidth={14}
          pointerEvents="stroke"
          style={{ cursor: 'pointer' }}
          onDoubleClick={() => handleSegmentDoubleClick(i)}
        />
      ))}

      {/* Bezier CP handles and lines */}
      {segments.map((seg, i) => {
        if (seg.curve !== 'bezier' || !seg.cp1 || !seg.cp2) return null
        const p0 = points[i]
        const p1 = points[i + 1]
        return (
          <g key={`cp-${i}`}>
            {/* Lines from breakpoints to CPs */}
            <line
              x1={toX(p0.sec)} y1={toY(p0.vol)}
              x2={toX(seg.cp1.sec)} y2={toY(seg.cp1.vol)}
              stroke={color} strokeWidth={0.5} opacity={0.4}
              pointerEvents="none"
            />
            <line
              x1={toX(p1.sec)} y1={toY(p1.vol)}
              x2={toX(seg.cp2.sec)} y2={toY(seg.cp2.vol)}
              stroke={color} strokeWidth={0.5} opacity={0.4}
              pointerEvents="none"
            />
            {/* CP1 handle */}
            <circle
              cx={toX(seg.cp1.sec)} cy={toY(seg.cp1.vol)}
              r={3.5}
              fill={color} stroke="white" strokeWidth={1.5}
              style={{ cursor: dragging?.type === 'cp1' && (dragging as { segIndex: number }).segIndex === i ? 'grabbing' : 'grab' }}
              onPointerDown={(e) => handlePointerDown(e, { type: 'cp1', segIndex: i })}
            />
            {/* CP2 handle */}
            <circle
              cx={toX(seg.cp2.sec)} cy={toY(seg.cp2.vol)}
              r={3.5}
              fill={color} stroke="white" strokeWidth={1.5}
              style={{ cursor: dragging?.type === 'cp2' && (dragging as { segIndex: number }).segIndex === i ? 'grabbing' : 'grab' }}
              onPointerDown={(e) => handlePointerDown(e, { type: 'cp2', segIndex: i })}
            />
          </g>
        )
      })}

      {/* Breakpoint handles */}
      {points.map((pt, i) => (
        <circle
          key={`pt-${i}`}
          cx={toX(pt.sec)} cy={toY(pt.vol)}
          r={5}
          fill={color} stroke="white" strokeWidth={2}
          style={{ cursor: dragging?.type === 'point' && (dragging as { index: number }).index === i ? 'grabbing' : 'grab' }}
          onPointerDown={(e) => handlePointerDown(e, { type: 'point', index: i })}
        />
      ))}

      {/* Time labels at breakpoints */}
      {points.map((pt, i) => {
        // Skip labels for points too close together
        if (i > 0 && Math.abs(toX(pt.sec) - toX(points[i - 1].sec)) < 20) return null
        return (
          <text
            key={`lbl-${i}`}
            x={toX(pt.sec)}
            y={H - 1}
            textAnchor={i === 0 ? 'start' : i === points.length - 1 ? 'end' : 'middle'}
            fontSize={8}
            fill="hsl(var(--muted-foreground))"
            opacity={0.5}
            pointerEvents="none"
            style={{ fontFamily: 'var(--font-mono, monospace)' }}
          >
            {pt.sec.toFixed(pt.sec % 1 === 0 ? 0 : 1)}s
          </text>
        )
      })}

      {/* Label */}
      {label && (
        <text
          x={PAD + 2} y={12}
          fontSize={9}
          fill={color}
          opacity={0.7}
          pointerEvents="none"
          style={{ fontFamily: 'var(--font-mono, monospace)' }}
        >
          {label}
        </text>
      )}
    </svg>
  )
}

/**
 * Envelope Data Model & Math
 *
 * DAW-style envelope system for podcast audio mixing.
 * Supports linear and cubic bezier segments with free breakpoint editing.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface EnvelopePoint {
  sec: number
  vol: number  // 0..1
}

export interface EnvelopeSegment {
  curve: 'linear' | 'bezier'
  cp1?: EnvelopePoint  // Bezier control point 1 (near start)
  cp2?: EnvelopePoint  // Bezier control point 2 (near end)
}

export interface AudioEnvelope {
  points: EnvelopePoint[]       // N breakpoints
  segments: EnvelopeSegment[]   // N-1 segments
}

// ---------------------------------------------------------------------------
// Bezier Math
// ---------------------------------------------------------------------------

/** Evaluate cubic Bezier at parameter t (0..1) for a single axis */
function cubicBezier1D(p0: number, p1: number, p2: number, p3: number, t: number): number {
  const mt = 1 - t
  return mt * mt * mt * p0 + 3 * mt * mt * t * p1 + 3 * mt * t * t * p2 + t * t * t * p3
}

/** Derivative of cubic Bezier at parameter t */
function cubicBezierDeriv1D(p0: number, p1: number, p2: number, p3: number, t: number): number {
  const mt = 1 - t
  return 3 * mt * mt * (p1 - p0) + 6 * mt * t * (p2 - p1) + 3 * t * t * (p3 - p2)
}

/**
 * Find Bezier parameter t for a given sec value using Newton-Raphson iteration.
 * Assumes monotonically increasing sec values along the curve.
 */
function findBezierT(secStart: number, cp1Sec: number, cp2Sec: number, secEnd: number, targetSec: number): number {
  // Initial guess: linear interpolation
  let t = (targetSec - secStart) / (secEnd - secStart)
  t = Math.max(0, Math.min(1, t))

  for (let i = 0; i < 8; i++) {
    const currentSec = cubicBezier1D(secStart, cp1Sec, cp2Sec, secEnd, t)
    const error = currentSec - targetSec
    if (Math.abs(error) < 0.0001) break

    const deriv = cubicBezierDeriv1D(secStart, cp1Sec, cp2Sec, secEnd, t)
    if (Math.abs(deriv) < 1e-10) break

    t = t - error / deriv
    t = Math.max(0, Math.min(1, t))
  }

  return t
}

// ---------------------------------------------------------------------------
// Envelope Sampling
// ---------------------------------------------------------------------------

/** Sample envelope gain value at a given time in seconds */
export function sampleEnvelope(envelope: AudioEnvelope, timeSec: number): number {
  const { points, segments } = envelope
  if (points.length === 0) return 0

  // Before first point
  if (timeSec <= points[0].sec) return points[0].vol
  // After last point
  if (timeSec >= points[points.length - 1].sec) return points[points.length - 1].vol

  // Find which segment we're in
  for (let i = 0; i < segments.length; i++) {
    const p0 = points[i]
    const p1 = points[i + 1]

    if (timeSec >= p0.sec && timeSec <= p1.sec) {
      const seg = segments[i]

      if (seg.curve === 'linear' || !seg.cp1 || !seg.cp2) {
        // Linear interpolation
        const t = (timeSec - p0.sec) / (p1.sec - p0.sec)
        return p0.vol + (p1.vol - p0.vol) * t
      }

      // Cubic bezier: find t from sec, then evaluate vol
      const t = findBezierT(p0.sec, seg.cp1.sec, seg.cp2.sec, p1.sec, timeSec)
      return cubicBezier1D(p0.vol, seg.cp1.vol, seg.cp2.vol, p1.vol, t)
    }
  }

  return points[points.length - 1].vol
}

/** Convert envelope to a gain array for sample-level processing */
export function envelopeToGainArray(envelope: AudioEnvelope, sampleRate: number, durationSec: number): Float32Array {
  const numSamples = Math.ceil(durationSec * sampleRate)
  const gains = new Float32Array(numSamples)

  for (let i = 0; i < numSamples; i++) {
    const timeSec = i / sampleRate
    gains[i] = sampleEnvelope(envelope, timeSec)
  }

  return gains
}

// ---------------------------------------------------------------------------
// Default Control Points
// ---------------------------------------------------------------------------

/** Generate sensible default CPs when toggling linear → bezier */
export function defaultBezierControlPoints(p0: EnvelopePoint, p1: EnvelopePoint): { cp1: EnvelopePoint; cp2: EnvelopePoint } {
  return {
    cp1: {
      sec: p0.sec + (p1.sec - p0.sec) / 3,
      vol: p0.vol + (p1.vol - p0.vol) / 3,
    },
    cp2: {
      sec: p0.sec + (p1.sec - p0.sec) * 2 / 3,
      vol: p0.vol + (p1.vol - p0.vol) * 2 / 3,
    },
  }
}

// ---------------------------------------------------------------------------
// Default Envelopes
// ---------------------------------------------------------------------------

export const DEFAULT_INTRO_MUSIC: AudioEnvelope = {
  points: [
    { sec: 0, vol: 1.0 },
    { sec: 3, vol: 1.0 },
    { sec: 3, vol: 0.2 },
    { sec: 10, vol: 0.2 },
    { sec: 13, vol: 0 },
  ],
  segments: [
    { curve: 'linear' },
    { curve: 'linear' },
    { curve: 'linear' },
    { curve: 'bezier', cp1: { sec: 11, vol: 0.14 }, cp2: { sec: 12.1, vol: 0.004 } },
  ],
}

export const DEFAULT_INTRO_DIALOG: AudioEnvelope = {
  points: [
    { sec: 0, vol: 0 },
    { sec: 3, vol: 0 },
    { sec: 4, vol: 1.0 },
    { sec: 13, vol: 1.0 },
  ],
  segments: [
    { curve: 'linear' },
    { curve: 'bezier', cp1: { sec: 3.3, vol: 0.5 }, cp2: { sec: 3.8, vol: 0.9 } },
    { curve: 'linear' },
  ],
}

export const DEFAULT_OUTRO_MUSIC: AudioEnvelope = {
  points: [
    { sec: 0, vol: 0 },
    { sec: 3, vol: 0.2 },
    { sec: 7, vol: 0.2 },
    { sec: 10, vol: 1.0 },
  ],
  segments: [
    { curve: 'bezier', cp1: { sec: 0.9, vol: 0.06 }, cp2: { sec: 2.1, vol: 0.16 } },
    { curve: 'linear' },
    { curve: 'bezier', cp1: { sec: 7.9, vol: 0.35 }, cp2: { sec: 9.3, vol: 0.9 } },
  ],
}

export const DEFAULT_OUTRO_DIALOG: AudioEnvelope = {
  points: [
    { sec: 0, vol: 1.0 },
    { sec: 7, vol: 1.0 },
    { sec: 10, vol: 0 },
  ],
  segments: [
    { curve: 'linear' },
    { curve: 'bezier', cp1: { sec: 7.8, vol: 0.6 }, cp2: { sec: 9.2, vol: 0.1 } },
  ],
}

// ---------------------------------------------------------------------------
// Legacy Converters
// ---------------------------------------------------------------------------

interface LegacyMixing {
  intro_full_sec?: number
  intro_bed_sec?: number
  intro_bed_volume?: number  // 0-100 percentage
  intro_fadeout_sec?: number
  intro_dialog_fadein_sec?: number
  intro_fadeout_curve?: 'linear' | 'exponential'
  intro_dialog_curve?: 'linear' | 'exponential'
  outro_crossfade_sec?: number
  outro_rise_sec?: number
  outro_bed_volume?: number  // 0-100 percentage
  outro_final_start_sec?: number
  outro_rise_curve?: 'linear' | 'exponential'
  outro_final_curve?: 'linear' | 'exponential'
}

/** Convert legacy parametric intro settings to envelope pair */
export function legacyIntroToEnvelopes(mixing: LegacyMixing): { music: AudioEnvelope; dialog: AudioEnvelope } {
  const fullSec = mixing.intro_full_sec ?? 3
  const bedSec = mixing.intro_bed_sec ?? 7
  const bedV = (mixing.intro_bed_volume ?? 20) / 100
  const fadeoutSec = mixing.intro_fadeout_sec ?? 3
  const dialogFadeInSec = mixing.intro_dialog_fadein_sec ?? 1
  const fadeoutCurve = mixing.intro_fadeout_curve ?? 'exponential'
  const dialogCurve = mixing.intro_dialog_curve ?? 'exponential'

  const total = fullSec + bedSec + fadeoutSec

  const music: AudioEnvelope = {
    points: [
      { sec: 0, vol: 1.0 },
      { sec: fullSec, vol: 1.0 },
      { sec: fullSec, vol: bedV },
      { sec: fullSec + bedSec, vol: bedV },
      { sec: total, vol: 0 },
    ],
    segments: [
      { curve: 'linear' },
      { curve: 'linear' },
      { curve: 'linear' },
      fadeoutCurve === 'exponential'
        ? {
            curve: 'bezier',
            cp1: { sec: fullSec + bedSec + fadeoutSec * 0.3, vol: bedV * 0.5 },
            cp2: { sec: fullSec + bedSec + fadeoutSec * 0.7, vol: 0.02 },
          }
        : { curve: 'linear' },
    ],
  }

  const dialog: AudioEnvelope = {
    points: [
      { sec: 0, vol: 0 },
      { sec: fullSec, vol: 0 },
      { sec: fullSec + dialogFadeInSec, vol: 1.0 },
      { sec: total, vol: 1.0 },
    ],
    segments: [
      { curve: 'linear' },
      dialogCurve === 'exponential'
        ? {
            curve: 'bezier',
            cp1: { sec: fullSec + dialogFadeInSec * 0.3, vol: 0.5 },
            cp2: { sec: fullSec + dialogFadeInSec * 0.8, vol: 0.9 },
          }
        : { curve: 'linear' },
      { curve: 'linear' },
    ],
  }

  return { music, dialog }
}

/** Convert legacy parametric outro settings to envelope pair */
export function legacyOutroToEnvelopes(mixing: LegacyMixing): { music: AudioEnvelope; dialog: AudioEnvelope } {
  const crossfadeSec = mixing.outro_crossfade_sec ?? 10
  const riseSec = mixing.outro_rise_sec ?? 3
  const bedV = (mixing.outro_bed_volume ?? 20) / 100
  const finalStartSec = Math.max(mixing.outro_final_start_sec ?? 7, riseSec)
  const riseCurve = mixing.outro_rise_curve ?? 'exponential'
  const finalCurve = mixing.outro_final_curve ?? 'exponential'

  const music: AudioEnvelope = {
    points: [
      { sec: 0, vol: 0 },
      { sec: riseSec, vol: bedV },
      { sec: finalStartSec, vol: bedV },
      { sec: crossfadeSec, vol: 1.0 },
    ],
    segments: [
      riseCurve === 'exponential'
        ? {
            curve: 'bezier',
            cp1: { sec: riseSec * 0.3, vol: bedV * 0.3 },
            cp2: { sec: riseSec * 0.7, vol: bedV * 0.8 },
          }
        : { curve: 'linear' },
      { curve: 'linear' },
      finalCurve === 'exponential'
        ? {
            curve: 'bezier',
            cp1: { sec: finalStartSec + (crossfadeSec - finalStartSec) * 0.3, vol: bedV + 0.3 },
            cp2: { sec: finalStartSec + (crossfadeSec - finalStartSec) * 0.7, vol: 0.9 },
          }
        : { curve: 'linear' },
    ],
  }

  const dialog: AudioEnvelope = {
    points: [
      { sec: 0, vol: 1.0 },
      { sec: finalStartSec, vol: 1.0 },
      { sec: crossfadeSec, vol: 0 },
    ],
    segments: [
      { curve: 'linear' },
      {
        curve: 'bezier',
        cp1: { sec: finalStartSec + (crossfadeSec - finalStartSec) * 0.4, vol: 0.6 },
        cp2: { sec: finalStartSec + (crossfadeSec - finalStartSec) * 0.8, vol: 0.1 },
      },
    ],
  }

  return { music, dialog }
}

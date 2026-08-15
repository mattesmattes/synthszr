import { marked } from 'marked'
import { generateJSON } from '@tiptap/core'
import StarterKit from '@tiptap/starter-kit'
import Link from '@tiptap/extension-link'
import { normalizeQuotes } from '@/lib/utils/typography'
import { HeadingWithQueueId } from '@/lib/tiptap/heading-with-queue-id'
import type { BundleType } from '@/lib/i18n/bundle-labels'

export interface BundleMarker {
  /** 0-based index among ALL heading lines in the markdown (in document order). */
  headingIndex: number
  bundleType: BundleType
}

const HEADING_LINE_RE = /^\s*#{1,6}\s/
const BUNDLE_MARKER_RE = /\s*<!--\s*data-bundle-type:(topic|recap)\s*-->\s*$/

/**
 * Scans markdown for `<!-- data-bundle-type:topic|recap -->` markers appended
 * to H1-H6 heading lines (written by writeBundleSection/ensureBundleMarker in
 * ghostwriter-pipeline.ts), strips them from the visible heading text, and
 * records which heading (by 0-based ordinal among all headings) carried which
 * bundleType. The ordinal is later matched against the heading nodes produced
 * by marked+generateJSON (applyBundleMarkers), since markdown headings map
 * 1:1, in order, to top-level `heading` nodes in the resulting TipTap JSON.
 */
export function extractBundleMarkers(markdown: string): { cleaned: string; markers: BundleMarker[] } {
  const markers: BundleMarker[] = []
  let headingIndex = 0
  const cleanedLines = markdown.split('\n').map((line) => {
    if (!HEADING_LINE_RE.test(line)) return line
    const idx = headingIndex
    headingIndex++
    const match = line.match(BUNDLE_MARKER_RE)
    if (!match) return line
    markers.push({ headingIndex: idx, bundleType: match[1] as BundleType })
    return line.replace(BUNDLE_MARKER_RE, '')
  })
  return { cleaned: cleanedLines.join('\n'), markers }
}

/** Marker der Überschriften-Varianten, gesetzt in lib/claude/headline-variants.ts.
 *  NICHT ans Zeilenende verankert: der Bundle-Marker steht dahinter und braucht
 *  seinerseits das `$` in BUNDLE_MARKER_RE. */
const HEADLINE_MARKER_RE = /\s*<!--\s*hl-alts:([A-Za-z0-9+/=]+)\s*-->/

export interface HeadlineMarker {
  headingIndex: number
  varianten: string[]
}

/**
 * Löst `<!-- hl-alts:BASE64 -->` aus den Überschriftenzeilen — dieselbe Bauart
 * wie extractBundleMarkers, und aus demselben Grund: ein HTML-Kommentar
 * überlebt weder marked() noch das DOM-Parsen, der Marker muss vorher heraus
 * und danach als Attribut nachgetragen werden.
 *
 * Die Ordinalzählung MUSS über alle Überschriften laufen, nicht nur über die
 * markierten — sonst verschiebt sich die Zuordnung, sobald eine Überschrift
 * ohne Varianten dazwischenliegt (z.B. nach einem fehlgeschlagenen Call).
 */
export function extractHeadlineMarkers(markdown: string): { cleaned: string; markers: HeadlineMarker[] } {
  const markers: HeadlineMarker[] = []
  let headingIndex = 0
  const cleanedLines = markdown.split('\n').map((line) => {
    if (!HEADING_LINE_RE.test(line)) return line
    const idx = headingIndex
    headingIndex++
    const match = line.match(HEADLINE_MARKER_RE)
    if (!match) return line
    const ohne = line.replace(HEADLINE_MARKER_RE, '')
    try {
      const roh = JSON.parse(Buffer.from(match[1], 'base64').toString('utf8'))
      if (Array.isArray(roh) && roh.every((x) => typeof x === 'string') && roh.length > 0) {
        markers.push({ headingIndex: idx, varianten: roh as string[] })
      }
    } catch {
      // Kaputter Marker: Zeile wird trotzdem gesäubert, damit der Kommentar
      // nicht als sichtbarer Text im Artikel landet.
    }
    return ohne
  })
  return { cleaned: cleanedLines.join('\n'), markers }
}

/** Schreibt `headlineAlts` auf den N-ten Heading-Knoten. Spiegelbild zu
 *  applyBundleMarkers. */
export function applyHeadlineMarkers(json: Record<string, unknown>, markers: HeadlineMarker[]): void {
  if (!markers.length) return
  const content = (json as { content?: unknown }).content
  if (!Array.isArray(content)) return
  const byIndex = new Map(markers.map((m) => [m.headingIndex, m.varianten]))
  let headingIndex = 0
  for (const node of content) {
    if (!node || typeof node !== 'object' || (node as { type?: unknown }).type !== 'heading') continue
    const varianten = byIndex.get(headingIndex)
    if (varianten) {
      const n = node as { attrs?: Record<string, unknown> }
      n.attrs = { ...(n.attrs || {}), headlineAlts: varianten }
    }
    headingIndex++
  }
}

/**
 * Writes `bundleType` onto the Nth top-level heading node (N = marker.headingIndex),
 * mutating the TipTap JSON in place. No-op if there are no markers.
 */
export function applyBundleMarkers(json: Record<string, unknown>, markers: BundleMarker[]): void {
  if (!markers.length) return
  const content = (json as { content?: unknown }).content
  if (!Array.isArray(content)) return
  const byIndex = new Map(markers.map((m) => [m.headingIndex, m.bundleType]))
  let headingIndex = 0
  for (const node of content) {
    if (!node || typeof node !== 'object' || (node as { type?: unknown }).type !== 'heading') continue
    const bundleType = byIndex.get(headingIndex)
    if (bundleType) {
      const n = node as { attrs?: Record<string, unknown> }
      n.attrs = { ...(n.attrs || {}), bundleType }
    }
    headingIndex++
  }
}

/**
 * Converts markdown string to TipTap JSON format
 * Includes Link extension to properly handle markdown links
 * Normalizes quotes to German typographic quotes (source language is German)
 */
export function markdownToTiptap(markdown: string): Record<string, unknown> {
  // Normalize quotes to German typographic quotes before processing
  // Source content is always German
  const normalizedMarkdown = normalizeQuotes(markdown, 'de')

  // Extract data-bundle-type markers from heading lines before marked() runs —
  // marked would keep the HTML comment as literal text, and TipTap's DOM
  // parser silently drops HTML comment nodes, losing the signal either way.
  const { cleaned: ohneBundle, markers } = extractBundleMarkers(normalizedMarkdown)
  // Nach den Bundle-Markern: der hl-alts-Marker steht VOR ihnen auf der Zeile
  // (s. embedHeadlineVariants), die Reihenfolge der beiden Extraktionen ist
  // deshalb frei — diese hier zuerst zu machen wäre genauso richtig.
  const { cleaned, markers: headlineMarkers } = extractHeadlineMarkers(ohneBundle)

  // Convert markdown to HTML
  const html = marked.parse(cleaned, { async: false }) as string

  // Convert HTML to TipTap JSON with Link extension for proper link handling
  // Use HeadingWithQueueId to preserve queueItemId attributes
  const json = generateJSON(html, [
    StarterKit.configure({
      heading: false,
    }),
    HeadingWithQueueId.configure({
      levels: [1, 2, 3, 4, 5, 6],
    }),
    Link.configure({
      openOnClick: false,
    }),
  ])

  applyBundleMarkers(json, markers)
  applyHeadlineMarkers(json, headlineMarkers)

  return json
}

/**
 * Converts TipTap JSON to HTML string
 */
export function tiptapToHtml(json: Record<string, unknown>): string {
  const { generateHTML } = require('@tiptap/core')
  return generateHTML(json, [
    StarterKit.configure({
      heading: false,
    }),
    HeadingWithQueueId.configure({
      levels: [1, 2, 3, 4, 5, 6],
    }),
    Link.configure({
      openOnClick: false,
    }),
  ])
}

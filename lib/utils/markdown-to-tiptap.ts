import { marked } from 'marked'
import { generateJSON } from '@tiptap/core'
import StarterKit from '@tiptap/starter-kit'
import Link from '@tiptap/extension-link'
import { normalizeQuotes } from '@/lib/utils/typography'
import { HeadingWithQueueId } from '@/lib/tiptap/heading-with-queue-id'

export interface BundleMarker {
  /** 0-based index among ALL heading lines in the markdown (in document order). */
  headingIndex: number
  bundleType: 'topic' | 'recap'
}

const HEADING_LINE_RE = /^\s*#{1,6}\s/
const BUNDLE_MARKER_RE = /\s*<!--\s*data-bundle-type:(topic|recap)\s*-->\s*$/

/**
 * Scans markdown for `<!-- data-bundle-type:topic|recap -->` markers appended
 * to H1-H6 heading lines (written by writeBundleSection/injectBundleMarker in
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
    markers.push({ headingIndex: idx, bundleType: match[1] as 'topic' | 'recap' })
    return line.replace(BUNDLE_MARKER_RE, '')
  })
  return { cleaned: cleanedLines.join('\n'), markers }
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
  const { cleaned, markers } = extractBundleMarkers(normalizedMarkdown)

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

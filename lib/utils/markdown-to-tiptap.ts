import { marked } from 'marked'
import { generateJSON } from '@tiptap/core'
import StarterKit from '@tiptap/starter-kit'
import Link from '@tiptap/extension-link'
import { normalizeQuotes } from '@/lib/utils/typography'
import { HeadingWithQueueId } from '@/lib/tiptap/heading-with-queue-id'

/**
 * Converts markdown string to TipTap JSON format
 * Includes Link extension to properly handle markdown links
 * Normalizes quotes to German typographic quotes (source language is German)
 */
export function markdownToTiptap(markdown: string): Record<string, unknown> {
  // Normalize quotes to German typographic quotes before processing
  // Source content is always German
  const normalizedMarkdown = normalizeQuotes(markdown, 'de')

  // Convert markdown to HTML
  const html = marked.parse(normalizedMarkdown, { async: false }) as string

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

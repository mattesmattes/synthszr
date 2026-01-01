import { marked } from 'marked'
import { generateJSON } from '@tiptap/core'
import StarterKit from '@tiptap/starter-kit'
import Link from '@tiptap/extension-link'

/**
 * Converts markdown string to TipTap JSON format
 * Includes Link extension to properly handle markdown links
 */
export function markdownToTiptap(markdown: string): Record<string, unknown> {
  // Convert markdown to HTML
  const html = marked.parse(markdown, { async: false }) as string

  // Convert HTML to TipTap JSON with Link extension for proper link handling
  const json = generateJSON(html, [
    StarterKit,
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
    StarterKit,
    Link.configure({
      openOnClick: false,
    }),
  ])
}

'use client'

import { useEffect } from 'react'
import { useSearchParams } from 'next/navigation'

/**
 * Reads the `q` URL parameter and highlights every match inside the
 * given DOM container by wrapping text fragments in <mark> tags.
 *
 * Mounted as a sibling of the article body. Once after hydration, walks
 * the article subtree, splits text nodes around case-insensitive query
 * matches, replaces them with text + <mark> + text fragments, then
 * scrolls the first match into view.
 *
 * Idempotent against re-runs: only walks if not already highlighted.
 */
export function PostSearchHighlight({ targetId }: { targetId: string }) {
  const params = useSearchParams()
  const rawQuery = params.get('q')?.trim() || ''

  useEffect(() => {
    if (!rawQuery || rawQuery.length < 2) return
    const root = document.getElementById(targetId)
    if (!root) return
    if (root.dataset.highlighted === rawQuery) return

    const escaped = rawQuery.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    const regex = new RegExp(escaped, 'gi')

    // Collect all text nodes inside the root, skipping <script>, <style>,
    // and any node already inside an existing <mark>. Iterating during
    // mutation is unsafe, so collect first, then mutate.
    const candidates: Text[] = []
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
      acceptNode(node) {
        if (!node.nodeValue || !node.nodeValue.trim()) return NodeFilter.FILTER_REJECT
        const parent = node.parentElement
        if (!parent) return NodeFilter.FILTER_REJECT
        const tag = parent.tagName
        if (tag === 'SCRIPT' || tag === 'STYLE' || tag === 'NOSCRIPT') return NodeFilter.FILTER_REJECT
        if (parent.closest('mark[data-search-mark]')) return NodeFilter.FILTER_REJECT
        return regex.test(node.nodeValue) ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT
      },
    })
    let n: Node | null
    while ((n = walker.nextNode())) candidates.push(n as Text)

    let firstMark: HTMLElement | null = null
    for (const textNode of candidates) {
      const value = textNode.nodeValue || ''
      regex.lastIndex = 0
      const fragment = document.createDocumentFragment()
      let lastIdx = 0
      let match: RegExpExecArray | null
      while ((match = regex.exec(value))) {
        if (match.index > lastIdx) {
          fragment.appendChild(document.createTextNode(value.slice(lastIdx, match.index)))
        }
        const mark = document.createElement('mark')
        mark.dataset.searchMark = '1'
        mark.className = 'bg-neon-cyan/70 text-foreground rounded-sm px-0.5'
        mark.textContent = match[0]
        fragment.appendChild(mark)
        if (!firstMark) firstMark = mark
        lastIdx = match.index + match[0].length
        // Guard against zero-width matches (shouldn't happen with this regex but safety)
        if (match.index === regex.lastIndex) regex.lastIndex++
      }
      if (lastIdx < value.length) {
        fragment.appendChild(document.createTextNode(value.slice(lastIdx)))
      }
      textNode.parentNode?.replaceChild(fragment, textNode)
    }

    root.dataset.highlighted = rawQuery

    if (firstMark) {
      firstMark.scrollIntoView({ behavior: 'smooth', block: 'center' })
    }
  }, [rawQuery, targetId])

  return null
}

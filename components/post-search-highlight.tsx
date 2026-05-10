'use client'

import { useEffect } from 'react'
import { useSearchParams } from 'next/navigation'

/**
 * Reads the `q` URL parameter and highlights every match inside the
 * given DOM container by wrapping text fragments in <mark> tags.
 *
 * The container is rendered by TiptapRenderer (a client component that
 * may keep mounting async portals — company badges, thumbnails, etc.)
 * so a single useEffect pass is unreliable: TipTap can rewrite parts
 * of the subtree after our highlight runs. We solve this two ways:
 *   1. Retry the highlight a few times on a short timer until we
 *      actually find matches (handles late hydration).
 *   2. After we hit, install a MutationObserver that re-runs the
 *      highlight on subsequent DOM mutations — but only on subtrees
 *      that lost their marks.
 */
export function PostSearchHighlight({ targetId }: { targetId: string }) {
  const params = useSearchParams()
  const rawQuery = params.get('q')?.trim() || ''

  useEffect(() => {
    if (!rawQuery || rawQuery.length < 2) return
    const root = document.getElementById(targetId)
    if (!root) return

    const escaped = rawQuery.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

    function applyHighlight(): number {
      if (!root) return 0
      const regex = new RegExp(escaped, 'gi')
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
      let count = 0
      for (const textNode of candidates) {
        const value = textNode.nodeValue || ''
        const localRegex = new RegExp(escaped, 'gi')
        const fragment = document.createDocumentFragment()
        let lastIdx = 0
        let match: RegExpExecArray | null
        while ((match = localRegex.exec(value))) {
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
          count++
          if (match.index === localRegex.lastIndex) localRegex.lastIndex++
        }
        if (lastIdx < value.length) {
          fragment.appendChild(document.createTextNode(value.slice(lastIdx)))
        }
        textNode.parentNode?.replaceChild(fragment, textNode)
      }

      if (firstMark && count > 0 && !root.dataset.scrolledTo) {
        firstMark.scrollIntoView({ behavior: 'smooth', block: 'center' })
        root.dataset.scrolledTo = '1'
      }
      return count
    }

    // Try once immediately, then retry a few times if TipTap hasn't
    // hydrated yet. Each pass is idempotent — already-marked subtrees
    // are skipped via the closest('mark[data-search-mark]') guard.
    let retries = 0
    const MAX_RETRIES = 8
    const retry = () => {
      const found = applyHighlight()
      if (found === 0 && retries < MAX_RETRIES) {
        retries++
        setTimeout(retry, 200)
      }
    }
    retry()

    // Observer: when TipTap mounts late content (badges, etc.) it can
    // wipe our marks. Re-run on each significant mutation, debounced.
    let mutationTimer: ReturnType<typeof setTimeout> | null = null
    const observer = new MutationObserver(() => {
      if (mutationTimer) clearTimeout(mutationTimer)
      mutationTimer = setTimeout(() => {
        applyHighlight()
      }, 100)
    })
    observer.observe(root, { childList: true, subtree: true, characterData: true })

    return () => {
      observer.disconnect()
      if (mutationTimer) clearTimeout(mutationTimer)
    }
  }, [rawQuery, targetId])

  return null
}

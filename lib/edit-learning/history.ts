import { SupabaseClient } from '@supabase/supabase-js'

// Security-Stufe 2 (Welle 1c): DB-Zugriff läuft jetzt über die authentifizierte
// Server-Route /api/admin/edit-history (service_role) statt über den direkten
// Browser-anon-Client. Der `supabase`-Parameter bleibt in der Signatur, damit
// bestehende Aufrufer (create-article/page.tsx, edit/[id]/page.tsx) unverändert
// weiter kompilieren — er wird intern nicht mehr für DB-Zugriffe genutzt.

/**
 * Create the initial edit history entry when a post is first opened for editing.
 * This stores the original AI-generated content for future diff analysis.
 */
export async function ensureInitialEditHistory(
  postId: string,
  content: Record<string, unknown>,
  aiModel?: string | null,
  supabase?: SupabaseClient
): Promise<{ version: number; isNew: boolean }> {
  void supabase

  // Check if there's already an edit history for this post
  const existingRes = await fetch(`/api/admin/edit-history?postId=${postId}&select=version`, {
    credentials: 'include',
  })
  const existingJson = existingRes.ok ? await existingRes.json() : { data: null, error: 'request failed' }

  if (!existingRes.ok) {
    console.error('[EditHistory] Error checking existing history:', existingJson.error)
  }

  const existing = existingJson.data as { version: number } | null
  if (existing) {
    return { version: existing.version, isNew: false }
  }

  // Create initial history entry (version 1 = original AI output)
  const wordCount = countWordsInContent(content)

  const res = await fetch('/api/admin/edit-history', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify({
      post_id: postId,
      version: 1,
      content_before: content,
      content_after: content, // Same initially
      ai_model: aiModel,
      word_count_before: wordCount,
      word_count_after: wordCount,
    }),
  })

  if (!res.ok) {
    const err = await res.json().catch(() => ({}))
    console.error('[EditHistory] Failed to create initial entry:', err.error)
  } else {
    console.log('[EditHistory] Created initial version for post:', postId)
  }

  return { version: 1, isNew: true }
}

/**
 * Record a new edit version when saving changes.
 * Compares current content with previous version to detect actual changes.
 */
export async function recordEditVersion(
  postId: string,
  newContent: Record<string, unknown>,
  supabase?: SupabaseClient
): Promise<{ version: number; hasChanges: boolean } | null> {
  void supabase

  // Get the latest version
  const latestRes = await fetch(
    `/api/admin/edit-history?postId=${postId}&select=${encodeURIComponent('version, content_after')}`,
    { credentials: 'include' }
  )
  const latestJson = latestRes.ok ? await latestRes.json() : { data: null, error: 'request failed' }

  if (!latestRes.ok) {
    console.error('[EditHistory] Error fetching latest version:', latestJson.error)
  }

  const latest = latestJson.data as { version: number; content_after: Record<string, unknown> } | null
  if (!latest) {
    console.warn('[EditHistory] No existing history found for post:', postId)
    return null
  }

  // Compare content to check if there are actual changes
  const previousContent = latest.content_after
  const hasChanges = !deepEqual(previousContent, newContent)

  if (!hasChanges) {
    console.log('[EditHistory] No content changes detected, skipping version')
    return { version: latest.version, hasChanges: false }
  }

  // Create new version
  const newVersion = latest.version + 1
  const wordCountBefore = countWordsInContent(previousContent)
  const wordCountAfter = countWordsInContent(newContent)

  const res = await fetch('/api/admin/edit-history', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify({
      post_id: postId,
      version: newVersion,
      content_before: previousContent,
      content_after: newContent,
      word_count_before: wordCountBefore,
      word_count_after: wordCountAfter,
    }),
  })

  if (!res.ok) {
    const err = await res.json().catch(() => ({}))
    console.error('[EditHistory] Failed to create version:', err.error)
    return null
  }

  console.log(`[EditHistory] Created version ${newVersion} for post:`, postId)
  return { version: newVersion, hasChanges: true }
}

/**
 * Count words in TipTap content
 */
function countWordsInContent(content: Record<string, unknown>): number {
  const text = extractTextFromTipTap(content)
  return text.split(/\s+/).filter(w => w.length > 0).length
}

/**
 * Extract plain text from TipTap JSON
 */
function extractTextFromTipTap(node: Record<string, unknown>): string {
  if (!node) return ''

  let text = ''

  // Handle text nodes
  if (node.type === 'text' && typeof node.text === 'string') {
    text += node.text
  }

  // Recursively process content array
  if (Array.isArray(node.content)) {
    for (const child of node.content) {
      text += extractTextFromTipTap(child as Record<string, unknown>)
      // Add space after block-level elements
      if (isBlockElement(child as Record<string, unknown>)) {
        text += ' '
      }
    }
  }

  return text
}

function isBlockElement(node: Record<string, unknown>): boolean {
  const blockTypes = ['paragraph', 'heading', 'blockquote', 'listItem', 'bulletList', 'orderedList']
  return blockTypes.includes(node.type as string)
}

/**
 * Deep equality check for objects
 */
function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true
  if (typeof a !== typeof b) return false
  if (a === null || b === null) return a === b
  if (typeof a !== 'object') return a === b

  const aObj = a as Record<string, unknown>
  const bObj = b as Record<string, unknown>

  const keysA = Object.keys(aObj)
  const keysB = Object.keys(bObj)

  if (keysA.length !== keysB.length) return false

  for (const key of keysA) {
    if (!keysB.includes(key)) return false
    if (!deepEqual(aObj[key], bObj[key])) return false
  }

  return true
}

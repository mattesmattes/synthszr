/**
 * POST /api/admin/mattes/upload-zip
 *
 * Accepts a multipart/form-data upload with a `archive` field (a .zip
 * of the Mattes repo.md folder). Extracts the archive in memory,
 * iterates every .md file, chunks and embeds, and upserts into
 * mattes_corpus_chunks.
 *
 * This is the production path for syncing the corpus from anywhere
 * (the original /backfill endpoint can only read from a local Dropbox
 * path that Vercel functions can't reach).
 *
 * Form fields:
 *   archive  (File, required)        — .zip
 *   force    ('true' | 'false')      — re-embed unchanged files too
 *
 * Returns JSON summary with per-file status. Soft deadline 8 minutes;
 * remaining files are reported as 'pending' if we hit it.
 */

import { NextRequest, NextResponse } from 'next/server'
import crypto from 'node:crypto'
import JSZip from 'jszip'
import { createAdminClient } from '@/lib/supabase/admin'
import { getSession } from '@/lib/auth/session'
import { generateEmbedding } from '@/lib/embeddings/generator'

export const runtime = 'nodejs'
export const maxDuration = 600

const CHUNK_CHARS = 2400
const OVERLAP_CHARS = 320
const SOFT_DEADLINE_MS = 8 * 60 * 1000
const BETWEEN_EMBEDS_MS = 120
const MAX_UPLOAD_BYTES = 30 * 1024 * 1024 // 30 MB safety cap

function sha256(s: string): string {
  return crypto.createHash('sha256').update(s).digest('hex')
}

function chunkText(text: string): string[] {
  const chunks: string[] = []
  const cleaned = text.replace(/\r\n/g, '\n').replace(/\n{4,}/g, '\n\n\n')
  let cursor = 0
  while (cursor < cleaned.length) {
    let end = Math.min(cleaned.length, cursor + CHUNK_CHARS)
    if (end < cleaned.length) {
      const lookback = cleaned.slice(end - 400, end)
      const lastBreak = lookback.lastIndexOf('\n\n')
      if (lastBreak > 0) end = end - 400 + lastBreak
    }
    const chunk = cleaned.slice(cursor, end).trim()
    if (chunk.length > 100) chunks.push(chunk)
    if (end >= cleaned.length) break
    cursor = end - OVERLAP_CHARS
    if (cursor < 0) cursor = 0
  }
  return chunks
}

interface FileResult {
  file: string
  status: 'skipped' | 'processed' | 'failed' | 'pending'
  chunks?: number
  reason?: string
}

export async function POST(request: NextRequest) {
  const session = await getSession()
  if (!session?.isAdmin) {
    return NextResponse.json({ error: 'Nicht autorisiert' }, { status: 401 })
  }

  const contentType = request.headers.get('content-type') || ''
  if (!contentType.includes('multipart/form-data')) {
    return NextResponse.json(
      { error: 'Erwarte multipart/form-data mit "archive" Feld' },
      { status: 400 }
    )
  }

  const formData = await request.formData()
  const archive = formData.get('archive')
  const force = formData.get('force') === 'true'

  if (!(archive instanceof File)) {
    return NextResponse.json({ error: 'archive (.zip) Feld fehlt' }, { status: 400 })
  }
  if (archive.size === 0) {
    return NextResponse.json({ error: 'Archiv ist leer' }, { status: 400 })
  }
  if (archive.size > MAX_UPLOAD_BYTES) {
    return NextResponse.json(
      { error: `Archiv zu groß (${(archive.size / 1024 / 1024).toFixed(1)} MB > 30 MB)` },
      { status: 400 }
    )
  }

  // Unzip in memory
  let zip: JSZip
  try {
    const buf = Buffer.from(await archive.arrayBuffer())
    zip = await JSZip.loadAsync(buf)
  } catch (err) {
    return NextResponse.json(
      { error: `ZIP konnte nicht entpackt werden: ${err instanceof Error ? err.message : String(err)}` },
      { status: 400 }
    )
  }

  // Accept any plain-text source: .md, .markdown, .txt. Strip directory
  // prefix so "repo.md/Code Crash Q2.md" and "Code Crash Q2.md" both end
  // up with the same source_file value.
  const TEXT_EXTENSIONS = ['.md', '.markdown', '.txt']
  const mdEntries: Array<{ filename: string; text: string }> = []
  await Promise.all(
    Object.values(zip.files)
      .filter((entry) => {
        if (entry.dir) return false
        const lower = entry.name.toLowerCase()
        return TEXT_EXTENSIONS.some((ext) => lower.endsWith(ext))
      })
      .map(async (entry) => {
        // Skip macOS metadata
        if (entry.name.includes('__MACOSX') || entry.name.split('/').pop()?.startsWith('._')) return
        const text = await entry.async('string')
        if (text.trim().length === 0) return
        const filename = entry.name.split('/').pop() || entry.name
        mdEntries.push({ filename, text })
      })
  )

  if (mdEntries.length === 0) {
    return NextResponse.json(
      { error: 'Keine Textdateien (.md/.markdown/.txt) im Archiv gefunden' },
      { status: 400 }
    )
  }

  mdEntries.sort((a, b) => a.filename.localeCompare(b.filename))

  const supabase = createAdminClient()
  const startedAt = Date.now()
  const results: FileResult[] = []

  for (let idx = 0; idx < mdEntries.length; idx++) {
    const { filename, text } = mdEntries[idx]

    if (Date.now() - startedAt > SOFT_DEADLINE_MS) {
      // Mark the rest as pending
      for (let j = idx; j < mdEntries.length; j++) {
        results.push({ file: mdEntries[j].filename, status: 'pending', reason: 'soft deadline hit' })
      }
      break
    }

    const newHash = sha256(text)
    const { data: existing } = await supabase
      .from('mattes_corpus_chunks')
      .select('id, source_sha, is_active')
      .eq('source_file', filename)
      .limit(1)
    const sameHash = existing && existing.length > 0 && existing[0].source_sha === newHash
    if (sameHash && !force) {
      results.push({ file: filename, status: 'skipped', reason: 'sha unchanged' })
      continue
    }

    // Preserve the user's enable/disable choice across re-embeds: if
    // any prior chunk for this file existed, carry its is_active over.
    const preservedActive = existing && existing.length > 0 ? existing[0].is_active !== false : true

    if (existing && existing.length > 0) {
      await supabase.from('mattes_corpus_chunks').delete().eq('source_file', filename)
    }

    const chunks = chunkText(text)
    let inserted = 0
    let failed = false
    for (let i = 0; i < chunks.length; i++) {
      if (Date.now() - startedAt > SOFT_DEADLINE_MS) {
        results.push({
          file: filename,
          status: 'processed',
          chunks: inserted,
          reason: 'partial — deadline hit',
        })
        // Remaining files as pending
        for (let j = idx + 1; j < mdEntries.length; j++) {
          results.push({ file: mdEntries[j].filename, status: 'pending', reason: 'soft deadline hit' })
        }
        return NextResponse.json({
          ok: true,
          archiveName: archive.name,
          force,
          totalFiles: mdEntries.length,
          summary: results,
          deadlineHit: true,
          elapsedMs: Date.now() - startedAt,
        })
      }
      try {
        const vec = await generateEmbedding(chunks[i])
        if (vec.length === 0) continue
        const { error: insErr } = await supabase.from('mattes_corpus_chunks').insert({
          source_file: filename,
          chunk_index: i,
          total_chunks: chunks.length,
          chunk_text: chunks[i],
          embedding: vec as unknown as string,
          source_sha: newHash,
          is_active: preservedActive,
        })
        if (insErr) {
          console.error(`[mattes-upload] insert failed ${filename}#${i}:`, insErr.message)
          failed = true
        } else {
          inserted++
        }
      } catch (err) {
        console.error(`[mattes-upload] embed failed ${filename}#${i}:`, err)
        failed = true
      }
      await new Promise((r) => setTimeout(r, BETWEEN_EMBEDS_MS))
    }
    results.push({
      file: filename,
      status: inserted > 0 ? 'processed' : 'failed',
      chunks: inserted,
      reason: failed && inserted > 0 ? 'partial — some chunks errored' : undefined,
    })
  }

  return NextResponse.json({
    ok: true,
    archiveName: archive.name,
    force,
    totalFiles: mdEntries.length,
    summary: results,
    deadlineHit: false,
    elapsedMs: Date.now() - startedAt,
  })
}

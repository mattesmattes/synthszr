/**
 * POST /api/admin/mattes/backfill
 * GET  /api/admin/mattes/backfill
 *
 * Server-side backfill of the Mattes corpus into mattes_corpus_chunks.
 * Reads .md files from the Dropbox repo location, chunks them, embeds
 * with gemini-embedding-001, and upserts into the table.
 *
 * GET returns a status snapshot:
 *   { fileCount, chunkCount, lastUpdated, sourceFiles: [...] }
 *
 * POST runs the backfill. Optional body: { force: boolean }. When force
 * is true, re-embeds every file regardless of sha. Otherwise files whose
 * source_sha matches the current file content are skipped.
 *
 * Admin-only. Soft deadline of 8 minutes per request (well below the
 * 10-minute Vercel maxDuration).
 */

import { NextRequest, NextResponse } from 'next/server'
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { createAdminClient } from '@/lib/supabase/admin'
import { getSession } from '@/lib/auth/session'
import { generateEmbedding } from '@/lib/embeddings/generator'

export const runtime = 'nodejs'
export const maxDuration = 600

const DEFAULT_DIR =
  '/Users/mattes/Library/CloudStorage/Dropbox/_Mattes Kram/04_Projekte/Repos/___Mattes Repo/repo.md'
const SOURCE_DIR = process.env.MATTES_REPO_DIR || DEFAULT_DIR

const CHUNK_CHARS = 2400
const OVERLAP_CHARS = 320
const SOFT_DEADLINE_MS = 8 * 60 * 1000
const BETWEEN_EMBEDS_MS = 120

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

export async function GET() {
  const session = await getSession()
  if (!session?.isAdmin) {
    return NextResponse.json({ error: 'Nicht autorisiert' }, { status: 401 })
  }

  const supabase = createAdminClient()
  const { data, error } = await supabase
    .from('mattes_corpus_chunks')
    .select('source_file, chunk_index, updated_at, is_active')
    .order('updated_at', { ascending: false })

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  type Row = { source_file: string; updated_at: string; is_active: boolean | null }
  const rows = (data || []) as Row[]

  // Aggregate per file: count chunks, find latest updated_at, and decide
  // active flag. A file counts as "enabled" when any of its chunks is
  // active — disabled requires every chunk to be off.
  const perFile = new Map<string, { chunks: number; lastUpdated: string; activeChunks: number }>()
  for (const row of rows) {
    const existing = perFile.get(row.source_file)
    if (!existing) {
      perFile.set(row.source_file, {
        chunks: 1,
        lastUpdated: row.updated_at,
        activeChunks: row.is_active === false ? 0 : 1,
      })
    } else {
      existing.chunks += 1
      if (row.updated_at > existing.lastUpdated) existing.lastUpdated = row.updated_at
      if (row.is_active !== false) existing.activeChunks += 1
    }
  }

  const sourceFiles = Array.from(perFile.entries())
    .map(([file, info]) => ({
      file,
      chunks: info.chunks,
      lastUpdated: info.lastUpdated,
      active: info.activeChunks > 0,
    }))
    .sort((a, b) => a.file.localeCompare(b.file))

  const activeChunkCount = rows.filter((r) => r.is_active !== false).length

  return NextResponse.json({
    fileCount: sourceFiles.length,
    chunkCount: rows.length,
    activeChunkCount,
    lastUpdated: sourceFiles[0]?.lastUpdated ?? null,
    sourceDir: SOURCE_DIR,
    sourceDirExists: fs.existsSync(SOURCE_DIR),
    sourceFiles,
  })
}

export async function POST(request: NextRequest) {
  const session = await getSession()
  if (!session?.isAdmin) {
    return NextResponse.json({ error: 'Nicht autorisiert' }, { status: 401 })
  }

  const body = await request.json().catch(() => ({}))
  const force = body?.force === true

  if (!fs.existsSync(SOURCE_DIR)) {
    return NextResponse.json(
      { error: `Source directory not found: ${SOURCE_DIR}. Set MATTES_REPO_DIR env to override.` },
      { status: 400 }
    )
  }

  const files = fs
    .readdirSync(SOURCE_DIR)
    .filter((f) => f.endsWith('.md'))
    .sort()

  const supabase = createAdminClient()
  const startedAt = Date.now()
  const summary: Array<{ file: string; status: 'skipped' | 'processed' | 'failed'; chunks?: number; reason?: string }> = []

  for (const file of files) {
    if (Date.now() - startedAt > SOFT_DEADLINE_MS) {
      summary.push({ file: '(remaining)', status: 'skipped', reason: 'soft deadline hit' })
      break
    }

    const full = path.join(SOURCE_DIR, file)
    const raw = fs.readFileSync(full, 'utf8')
    if (!raw.trim()) {
      summary.push({ file, status: 'skipped', reason: 'empty' })
      continue
    }
    const newHash = sha256(raw)

    const { data: existing } = await supabase
      .from('mattes_corpus_chunks')
      .select('id, source_sha, is_active')
      .eq('source_file', file)
      .limit(1)
    const sameHash = existing && existing.length > 0 && existing[0].source_sha === newHash
    if (sameHash && !force) {
      summary.push({ file, status: 'skipped', reason: 'sha unchanged' })
      continue
    }

    const preservedActive = existing && existing.length > 0 ? existing[0].is_active !== false : true

    if (existing && existing.length > 0) {
      await supabase.from('mattes_corpus_chunks').delete().eq('source_file', file)
    }

    const chunks = chunkText(raw)
    let inserted = 0
    for (let i = 0; i < chunks.length; i++) {
      if (Date.now() - startedAt > SOFT_DEADLINE_MS) {
        summary.push({ file, status: 'processed', chunks: inserted, reason: 'partial — deadline hit' })
        return NextResponse.json({ ok: true, summary, deadlineHit: true, elapsedMs: Date.now() - startedAt })
      }
      try {
        const vec = await generateEmbedding(chunks[i])
        if (vec.length === 0) continue
        await supabase.from('mattes_corpus_chunks').insert({
          source_file: file,
          chunk_index: i,
          total_chunks: chunks.length,
          chunk_text: chunks[i],
          embedding: vec as unknown as string,
          source_sha: newHash,
          is_active: preservedActive,
        })
        inserted++
      } catch (err) {
        console.error(`[mattes-backfill] embed/insert failed for ${file}#${i}:`, err)
      }
      await new Promise((r) => setTimeout(r, BETWEEN_EMBEDS_MS))
    }
    summary.push({ file, status: 'processed', chunks: inserted })
  }

  return NextResponse.json({
    ok: true,
    summary,
    deadlineHit: false,
    elapsedMs: Date.now() - startedAt,
  })
}

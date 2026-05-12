// Backfill the Mattes corpus into mattes_corpus_chunks for the
// retrieval-augmented Synthszr Take pipeline.
//
// Reads every .md file under
//   /Users/mattes/Library/CloudStorage/Dropbox/_Mattes Kram/04_Projekte/Repos/___Mattes Repo/repo.md/
// (skipping files that haven't changed since last sync), chunks the text
// into ~600-token overlapping windows, embeds each chunk with
// gemini-embedding-001 (768-dim), and upserts into the table.
//
// Re-runnable: existing chunks are deleted and re-inserted only for
// files whose sha256 changed since the last sync. Pass --force to
// re-embed everything.
//
// Usage:
//   NEXT_PUBLIC_SUPABASE_URL=… \
//   SUPABASE_SERVICE_ROLE_KEY=… \
//   GOOGLE_GENERATIVE_AI_API_KEY=… \
//   node scripts/backfill-mattes-corpus.mjs [--force] [--dir /custom/path]

import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { createClient } from '@supabase/supabase-js'
import { GoogleGenAI } from '@google/genai'

const SUPABASE_URL = (process.env.NEXT_PUBLIC_SUPABASE_URL || '').trim()
const SUPABASE_KEY = (process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim()
const GOOGLE_KEY = (process.env.GOOGLE_GENERATIVE_AI_API_KEY || '').trim()

if (!SUPABASE_URL || !SUPABASE_KEY || !GOOGLE_KEY) {
  console.error('Missing env. Need NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, GOOGLE_GENERATIVE_AI_API_KEY')
  process.exit(1)
}

const args = process.argv.slice(2)
const FORCE = args.includes('--force')
const DIR_ARG = args.find((a) => a.startsWith('--dir='))?.slice(6)
const DEFAULT_DIR =
  '/Users/mattes/Library/CloudStorage/Dropbox/_Mattes Kram/04_Projekte/Repos/___Mattes Repo/repo.md'
const SOURCE_DIR = DIR_ARG || DEFAULT_DIR

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY)
const genAI = new GoogleGenAI({ apiKey: GOOGLE_KEY })

const EMBEDDING_MODEL = 'gemini-embedding-001'
const EMBEDDING_DIMENSIONS = 768

// Chunking: ~600 tokens per chunk with ~80 token overlap.
// 1 token ≈ 4 chars for German, so target ~2400 chars per chunk.
const CHUNK_CHARS = 2400
const OVERLAP_CHARS = 320

function sha256(s) {
  return crypto.createHash('sha256').update(s).digest('hex')
}

function chunkText(text) {
  const chunks = []
  const cleaned = text.replace(/\r\n/g, '\n').replace(/\n{4,}/g, '\n\n\n')
  let cursor = 0
  while (cursor < cleaned.length) {
    let end = Math.min(cleaned.length, cursor + CHUNK_CHARS)
    // Try to break at paragraph boundary inside the last 400 chars of the window
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

async function embed(text) {
  const trimmed = text.slice(0, 8000)
  const result = await genAI.models.embedContent({
    model: EMBEDDING_MODEL,
    contents: trimmed,
    config: { outputDimensionality: EMBEDDING_DIMENSIONS },
  })
  return result.embeddings?.[0]?.values || []
}

async function ingestFile(file) {
  const full = path.join(SOURCE_DIR, file)
  const raw = fs.readFileSync(full, 'utf8')
  if (!raw.trim()) {
    console.log(`[skip] ${file} — empty`)
    return { skipped: true, processed: 0 }
  }
  const newHash = sha256(raw)

  // Check existing chunks for this file
  const { data: existing, error: existErr } = await supabase
    .from('mattes_corpus_chunks')
    .select('id, source_sha')
    .eq('source_file', file)
    .limit(1)
  if (existErr) {
    console.warn(`[warn] could not query existing for ${file}: ${existErr.message}`)
  }

  const sameHash = existing && existing.length > 0 && existing[0].source_sha === newHash
  if (sameHash && !FORCE) {
    console.log(`[skip] ${file} — sha unchanged (${existing.length} chunks already in DB)`)
    return { skipped: true, processed: 0 }
  }

  // Delete previous chunks for this file
  if (existing && existing.length > 0) {
    const { error: delErr } = await supabase
      .from('mattes_corpus_chunks')
      .delete()
      .eq('source_file', file)
    if (delErr) {
      console.error(`[err] could not delete old chunks for ${file}: ${delErr.message}`)
      return { skipped: false, processed: 0, failed: true }
    }
  }

  const chunks = chunkText(raw)
  console.log(`[work] ${file} → ${chunks.length} chunks`)

  let inserted = 0
  for (let i = 0; i < chunks.length; i++) {
    const chunk = chunks[i]
    try {
      const vec = await embed(chunk)
      if (vec.length === 0) {
        console.warn(`  [skip] chunk ${i} — empty embedding`)
        continue
      }
      const { error: insErr } = await supabase.from('mattes_corpus_chunks').insert({
        source_file: file,
        chunk_index: i,
        total_chunks: chunks.length,
        chunk_text: chunk,
        embedding: vec,
        source_sha: newHash,
      })
      if (insErr) {
        console.error(`  [err] insert chunk ${i}: ${insErr.message}`)
      } else {
        inserted++
      }
    } catch (err) {
      console.error(`  [err] embed chunk ${i}: ${err.message}`)
    }
    // Pacing
    await new Promise((r) => setTimeout(r, 120))
  }
  console.log(`  done. ${inserted}/${chunks.length} chunks inserted.`)
  return { skipped: false, processed: inserted }
}

async function main() {
  if (!fs.existsSync(SOURCE_DIR)) {
    console.error(`Source dir not found: ${SOURCE_DIR}`)
    process.exit(1)
  }
  const files = fs
    .readdirSync(SOURCE_DIR)
    .filter((f) => f.endsWith('.md'))
    .sort()
  console.log(`Found ${files.length} .md files in ${SOURCE_DIR}`)
  console.log(`Force re-embed: ${FORCE}`)

  let totalChunks = 0
  let totalSkipped = 0
  let totalFiles = 0
  for (const file of files) {
    const result = await ingestFile(file)
    totalFiles++
    totalChunks += result.processed
    if (result.skipped) totalSkipped++
  }

  console.log('')
  console.log(`Done. files=${totalFiles} skipped=${totalSkipped} chunks_inserted=${totalChunks}`)
}

main().catch((err) => {
  console.error('Fatal:', err)
  process.exit(1)
})

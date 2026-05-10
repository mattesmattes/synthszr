import { createClient } from '@supabase/supabase-js'

const url = (process.env.NEXT_PUBLIC_SUPABASE_URL || '').trim()
const key = (process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim()
const s = createClient(url, key)

// Two-part DDL:
//   1. Add a vector(768) column to generated_posts for content embeddings.
//      Index uses ivfflat with cosine ops — same shape used by edit_diffs.
//   2. RPC match_generated_posts(query_embedding, match_threshold, match_count)
//      so /api/search can run semantic similarity in one round-trip.

const sql = `
-- 1. Embedding column
ALTER TABLE generated_posts
  ADD COLUMN IF NOT EXISTS content_embedding vector(768);

CREATE INDEX IF NOT EXISTS idx_generated_posts_content_embedding
  ON generated_posts USING ivfflat (content_embedding vector_cosine_ops)
  WITH (lists = 50);

-- 2. RPC for semantic search over published posts
CREATE OR REPLACE FUNCTION match_generated_posts(
  query_embedding vector(768),
  match_threshold float DEFAULT 0.4,
  match_count int DEFAULT 30
)
RETURNS TABLE (
  id uuid,
  title text,
  slug text,
  excerpt text,
  content jsonb,
  created_at timestamptz,
  similarity float
)
LANGUAGE sql STABLE
AS $$
  SELECT
    p.id, p.title, p.slug, p.excerpt, p.content, p.created_at,
    1 - (p.content_embedding <=> query_embedding) AS similarity
  FROM generated_posts p
  WHERE p.published = true
    AND p.content_embedding IS NOT NULL
    AND 1 - (p.content_embedding <=> query_embedding) > match_threshold
  ORDER BY p.content_embedding <=> query_embedding
  LIMIT match_count;
$$;
`

console.log('Applying migration via Supabase…')
console.log('SQL to run:')
console.log(sql)
console.log('')
console.log('--- IMPORTANT ---')
console.log('Supabase JS client cannot DDL directly. Run the SQL above via:')
console.log('  - Supabase Studio → SQL Editor, OR')
console.log(`  - psql against ${url.replace('https://', '').replace('.supabase.co', '')}.pooler.supabase.com`)
console.log('')

// Probe: does the column exist already?
const { error } = await s
  .from('generated_posts')
  .select('id, content_embedding')
  .limit(1)

if (error) {
  console.error('Probe failed (column probably missing):', error.message)
  process.exit(1)
}
console.log('OK — content_embedding column reachable. Migration appears applied.')

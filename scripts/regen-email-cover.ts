/**
 * Regenerate the cover_email asset (now 2× = 1208px) from the stored raw image
 * for a given post, or for all posts published on a given date.
 *
 * Existing cover_email assets were generated at 604px and look coarse/mushy in
 * the newsletter on Retina (see generateEmailCover). The code fix only affects
 * newly generated covers, so older episodes that get re-sent need this backfill.
 *
 * Usage:
 *   npx tsx scripts/regen-email-cover.ts <postId>
 *   npx tsx scripts/regen-email-cover.ts --date 2026-06-06
 *
 * Loads production secrets from .env.backfill.local (BLOB_READ_WRITE_TOKEN +
 * SUPABASE_SERVICE_ROLE_KEY). Delete that file after use — never commit it.
 */
import { config } from 'dotenv'
config({ path: '.env.backfill.local' })

import { put } from '@vercel/blob'
import { generateEmailCover } from '@/lib/gemini/image-generator'
import { createAdminClient } from '@/lib/supabase/admin'

async function regenForPost(postId: string): Promise<string> {
  const supabase = createAdminClient()

  // Find the ACTIVE cover image (via cover_image_id) — there can be several
  // generated cover options; only the selected one carries the shown raw image.
  const { data: post } = await supabase
    .from('generated_posts')
    .select('cover_image_id')
    .eq('id', postId)
    .maybeSingle()

  let q = supabase.from('post_images').select('raw_image_url')
  q = post?.cover_image_id
    ? q.eq('id', post.cover_image_id)
    : q.eq('post_id', postId).or('image_type.is.null,image_type.eq.cover').not('raw_image_url', 'is', null).limit(1)
  const { data: cover } = await q.maybeSingle()

  if (!cover?.raw_image_url) return `post ${postId}: no raw_image_url → skip`

  // Generate the new 2× email cover from raw
  const rawBuffer = Buffer.from(await (await fetch(cover.raw_image_url)).arrayBuffer())
  const emailCover = await generateEmailCover(rawBuffer.toString('base64'))

  // Replace the cover_email DB record + blob
  await supabase.from('post_images').delete().eq('post_id', postId).eq('image_type', 'cover_email')
  const { data: rec } = await supabase
    .from('post_images')
    .insert({ post_id: postId, image_url: '', generation_status: 'generating', image_type: 'cover_email' })
    .select()
    .single()
  if (!rec) return `post ${postId}: failed to insert record`

  const blob = await put(
    `post-images/${postId}/${rec.id}-cover-email.png`,
    Buffer.from(emailCover.base64, 'base64'),
    { access: 'public', contentType: 'image/png' }
  )
  await supabase
    .from('post_images')
    .update({ image_url: blob.url, generation_status: 'completed' })
    .eq('id', rec.id)

  return `post ${postId}: cover_email regenerated → ${blob.url}`
}

async function main() {
  const arg = process.argv[2]
  if (!arg) {
    console.error('Usage: regen-email-cover.ts <postId> | --date <YYYY-MM-DD>')
    process.exit(1)
  }

  let postIds: string[]
  if (arg === '--date') {
    const date = process.argv[3]
    const supabase = createAdminClient()
    const { data } = await supabase
      .from('generated_posts')
      .select('id')
      .gte('created_at', `${date}T00:00:00`)
      .lt('created_at', `${date}T23:59:59`)
    postIds = (data ?? []).map((r) => r.id)
    console.log(`Found ${postIds.length} post(s) for ${date}.`)
  } else {
    postIds = [arg]
  }

  for (const id of postIds) {
    try {
      console.log(await regenForPost(id))
    } catch (e) {
      console.error(`post ${id}: ERROR`, e)
    }
  }
  console.log('Done.')
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})

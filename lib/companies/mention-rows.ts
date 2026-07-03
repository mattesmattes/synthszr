import type { SupabaseClient } from '@supabase/supabase-js'

export interface CompanyMentionRow {
  company_name: string
  company_slug: string
  company_type: 'public' | 'premarket'
  created_at: string
}

/** Lädt ALLE Company-Mentions veröffentlichter Posts — paginiert übers
 *  PostgREST-1000er-Cap mit stabilem ORDER BY. Ohne Pagination fehlten
 *  ~34% der Companies (3884 Rows, Cap bei 1000) und die Teilmenge
 *  wechselte zwischen Requests (kein ORDER BY = instabile Reihenfolge). */
export async function fetchAllCompanyMentions(supabase: SupabaseClient): Promise<CompanyMentionRow[]> {
  const rows: CompanyMentionRow[] = []
  for (let off = 0; ; off += 1000) {
    const { data, error } = await supabase
      .from('post_company_mentions')
      .select('company_name, company_slug, company_type, created_at, post:generated_posts!inner(status)')
      .eq('post.status', 'published')
      .order('created_at', { ascending: false })
      .order('company_slug', { ascending: true })
      .range(off, off + 999)
    if (error) throw new Error(`company mentions: ${error.message}`)
    if (!data?.length) break
    rows.push(...(data as unknown as CompanyMentionRow[]))
    if (data.length < 1000) break
  }
  return rows
}

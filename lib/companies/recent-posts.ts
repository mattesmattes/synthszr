/**
 * Verknüpfung Unternehmen ↔ eigene Artikel, in beide Richtungen:
 *   - getRecentPostsForCompany: „die letzten N News, in denen die Firma vorkam"
 *     für die Stocks- und Companies-Seiten.
 *   - getCompanyMentionsForPost: „welche Unternehmen kommen in diesem Artikel
 *     vor" für den Block unter einem Artikel.
 *
 * Datenquelle ist post_company_mentions (Migration 20260117140000): pro Artikel
 * und Firma eine Zeile, mit company_type 'public' | 'premarket'. Beide Typen
 * haben eine öffentliche Seite unter /[lang]/companies/[slug] — die Premarket-
 * Firmen sind also nicht bloß Daten ohne Ziel.
 *
 * SERVICE_ROLE PFLICHT: post_company_mentions ist RLS-gesperrt. Mit dem
 * anon-Key liefert die Abfrage stillschweigend null, nicht einen Fehler — der
 * Block wäre dann einfach unsichtbar. Deshalb erwarten beide Funktionen einen
 * Admin-Client, wie es die Companies-Detailseite auch tut.
 *
 * FEHLER SIND HIER NICHT FATAL: beide Funktionen geben im Fehlerfall eine leere
 * Liste zurück. Der Block ist eine Ergänzung; ihn wegzulassen ist richtig, eine
 * Artikel- oder Aktienseite deswegen auf 500 zu schicken wäre falsch.
 */
import type { SupabaseClient } from '@supabase/supabase-js'

export interface CompanyPostRef {
  slug: string
  title: string
  createdAt: string
}

export interface CompanyMentionRef {
  name: string
  slug: string
  type: 'public' | 'premarket'
}

interface JoinedRow {
  post?: { slug?: string; title?: string; created_at?: string } | null
}

/**
 * Höchstens so viele Mention-Zeilen werden je angefordertem Post geladen.
 *
 * AN PROD-DATEN GEMESSEN, nicht geschätzt (2026-08-04): für „nvidia" waren acht
 * Mention-Zeilen nur fünf verschiedene Posts — ein Sammelartikel führt dieselbe
 * Firma über article_index mehrfach. Mit limit(7) lieferte der Block deshalb
 * regelmäßig vier oder fünf News statt sieben.
 *
 * 4 ist der beobachtete Höchstwert an Zeilen pro Post plus Reserve. Bewusst ein
 * fester kleiner Faktor und nicht „alles laden und in JS kürzen": das wäre die
 * Egress-Falle, die beim history-JSONB der Rankings 359 GB/Monat gekostet hat.
 */
const ROWS_PER_POST = 4

/**
 * Die neuesten veröffentlichten Artikel, die diese Firma nennen.
 *
 * Das Limit geht IN die Abfrage, nicht nachträglich ins Array: eine oft genannte
 * Firma wie Nvidia hat hunderte Zeilen, und die alle zu laden, um sieben zu
 * zeigen, wäre verschwenderisch. Wegen der Mehrfachnennungen wird aber mit
 * Aufschlag geladen und nach dem Deduplizieren auf `limit` gekürzt.
 *
 * Sortiert wird nach created_at der MENTION-Zeile, nicht des Posts. An echten
 * Daten geprüft: die Mention entsteht rund 50 Minuten nach dem Post und die
 * Reihenfolge ist dieselbe — die Extraktion läuft beim Speichern, es gibt keinen
 * Backfill, der die Ordnung durcheinanderbrächte.
 */
export async function getRecentPostsForCompany(
  supabase: SupabaseClient,
  companySlug: string,
  limit: number,
): Promise<CompanyPostRef[]> {
  const { data, error } = await supabase
    .from('post_company_mentions')
    // !inner statt eines normalen Joins: ohne das liefert PostgREST auch Zeilen,
    // deren Post den status-Filter NICHT erfüllt, mit post = null.
    .select('company_slug, post:generated_posts!inner(slug, title, created_at, status)')
    .ilike('company_slug', companySlug)
    .eq('post.status', 'published')
    .order('created_at', { ascending: false })
    .limit(limit * ROWS_PER_POST)

  if (error || !data) {
    if (error) console.error(`[Companies] Posts für "${companySlug}": ${error.message}`)
    return []
  }

  const seen = new Set<string>()
  const out: CompanyPostRef[] = []
  for (const row of data as unknown as JoinedRow[]) {
    const post = row.post
    if (!post?.slug || seen.has(post.slug)) continue
    seen.add(post.slug)
    out.push({ slug: post.slug, title: post.title ?? post.slug, createdAt: post.created_at ?? '' })
    if (out.length === limit) break
  }
  return out
}

/**
 * Die Unternehmen, die in diesem Artikel vorkommen — public und premarket.
 *
 * Dedupliziert case-insensitiv über den Slug: in post_company_mentions steht die
 * Schreibweise gemischt ("Nvidia" und "nvidia"), und zwei Links auf dieselbe
 * Seite wären sichtbarer Murks.
 */
export async function getCompanyMentionsForPost(
  supabase: SupabaseClient,
  postId: string,
): Promise<CompanyMentionRef[]> {
  const { data, error } = await supabase
    .from('post_company_mentions')
    .select('company_name, company_slug, company_type')
    .eq('post_id', postId)
    // Börsennotierte zuerst, dann alphabetisch — eine stabile Reihenfolge, damit
    // der Block bei jedem Rendern gleich aussieht (ISR cacht ihn).
    .order('company_type', { ascending: true })

  if (error || !data) {
    if (error) console.error(`[Companies] Mentions für Post ${postId}: ${error.message}`)
    return []
  }

  const seen = new Set<string>()
  const out: CompanyMentionRef[] = []
  for (const row of data as Array<{ company_name?: string; company_slug?: string; company_type?: string }>) {
    const slug = row.company_slug?.toLowerCase()
    if (!slug || seen.has(slug)) continue
    seen.add(slug)
    out.push({
      name: row.company_name ?? slug,
      slug,
      type: row.company_type === 'premarket' ? 'premarket' : 'public',
    })
  }
  return out
}

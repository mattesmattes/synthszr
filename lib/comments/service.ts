/**
 * „Eure Takes" — Kommentar-Service (Design 2026-08-09).
 *
 * Server-only: nutzt den Service-Role-Client. Alle öffentlichen Zugriffe
 * laufen über die API-Routen, die VOR diesem Modul Origin-Check, Rate-Limit
 * und Zod-Validierung erledigen — hier beginnt die Fachlogik.
 *
 * Identitäts-Modell: Kommentieren ist ein Abo-Privileg. Ein Kommentar entsteht
 * entweder mit bereits belegter Identität (Reader-Cookie oder Newsletter-Token)
 * und läuft sofort durch die Moderation — oder er wird als `pending_verify`
 * geparkt und der Magic-Link entscheidet.
 */
import { createAdminClient } from '@/lib/supabase/admin'
import { moderateComment } from '@/lib/comments/moderation'
import { AUTHOR } from '@/lib/data/author'
import {
  hashSubscriberToken,
  mintSubscriberToken,
  resolveSubscriberToken,
} from '@/lib/newsletter/access-tokens'

type AdminClient = ReturnType<typeof createAdminClient>

/**
 * Verhindert, dass ein Kommentar sich als der Seiten-Autor ausgibt. Der
 * angezeigte Name ist frei wählbar (Pseudonyme sind ok), aber er landet im
 * schema.org-Person-Author des JSON-LD — ein Kommentar unter „Matthias
 * Schrader" ließe die strukturierten Daten eine Identität bezeugen, die nie
 * verifiziert wurde (Review-Befund 2). Kollisionen (auch mit Zusätzen wie
 * „Matthias Schrader (Team)") werden mit einem sichtbaren Marker entschärft,
 * statt den Kommentar zu blockieren.
 */
export function guardDisplayName(name: string): string {
  const norm = (s: string) => s.toLowerCase().replace(/\s+/g, ' ').trim()
  const author = norm(AUTHOR.name)
  const candidate = norm(name)
  if (candidate === author || candidate.includes(author)) {
    return `${name.trim()} (Leser:in)`
  }
  return name.trim()
}

export type PostSource = 'posts' | 'generated_posts'

export interface CommentInput {
  postSource: PostSource
  postId: string
  body: string
  displayName: string
  sectionAnchor: string | null
  sectionHeadline: string | null
}

export interface PublicComment {
  id: string
  displayName: string
  body: string
  sectionHeadline: string | null
  publishedAt: string
}

/** Titel des Artikels für den Moderations-Kontext. Fehlschlag ist unkritisch —
 *  die Moderation funktioniert auch ohne Titel. */
async function postTitle(supabase: AdminClient, source: PostSource, postId: string): Promise<string> {
  const { data } = await supabase.from(source).select('title').eq('id', postId).maybeSingle()
  return (data as { title?: string } | null)?.title ?? ''
}

/** Existiert der Artikel und ist er veröffentlicht? Kommentare an unveröffentlichte
 *  oder erfundene Post-IDs wären eine Spam-Halde, die nie jemand sieht — und ein
 *  Enumerations-Werkzeug für Draft-IDs. */
export async function postExists(supabase: AdminClient, source: PostSource, postId: string): Promise<boolean> {
  if (source === 'posts') {
    const { data } = await supabase.from('posts').select('id').eq('id', postId).eq('published', true).maybeSingle()
    return !!data
  }
  const { data } = await supabase.from('generated_posts').select('id').eq('id', postId).eq('status', 'published').maybeSingle()
  return !!data
}

/**
 * ISR-Kopien der Artikelseite erneuern — über ALLE öffentlichen Locales
 * (Review-Befund 8). Die Seite ist unter jedem Locale erreichbar, nicht nur
 * unter /de:
 *  - Manuelle Posts (source 'posts') tragen denselben Slug in jeder Sprache.
 *  - Generierte Posts sind unter ihrem deutschen Slug in JEDEM Locale
 *    erreichbar (die Seite fällt ohne Übersetzung auf den deutschen Inhalt
 *    zurück), UND zusätzlich unter dem je Sprache abweichenden Übersetzungs-
 *    Slug.
 * Ein einzelnes revalidatePath('/de/…') ließe die übrigen Locale-Kopien bis zu
 * 60 s mit veraltetem Kommentarstand stehen.
 *
 * Best-effort: schlägt die Revalidation fehl, läuft die ISR-Uhr (60 s) sie
 * ohnehin ein — der Kommentar erscheint dann eine Minute später im SSR-HTML.
 */
export async function revalidatePostPaths(
  supabase: AdminClient,
  source: PostSource,
  postId: string,
): Promise<void> {
  try {
    const { revalidatePath } = await import('next/cache')
    const { PUBLIC_LOCALES } = await import('@/lib/i18n/config')

    const paths = new Set<string>()
    if (source === 'posts') {
      const { data } = await supabase.from('posts').select('slug').eq('id', postId).maybeSingle()
      const slug = (data as { slug?: string } | null)?.slug
      if (slug) for (const locale of PUBLIC_LOCALES) paths.add(`/${locale}/posts/${slug}`)
    } else {
      const { data } = await supabase.from('generated_posts').select('slug').eq('id', postId).maybeSingle()
      const slug = (data as { slug?: string } | null)?.slug
      // Der deutsche Slug rendert unter JEDEM Locale (Fallback auf DE-Inhalt).
      if (slug) for (const locale of PUBLIC_LOCALES) paths.add(`/${locale}/posts/${slug}`)
      // Zusätzlich die je Sprache abweichenden Übersetzungs-Slugs.
      const { data: translations } = await supabase
        .from('content_translations')
        .select('slug, language_code')
        .eq('generated_post_id', postId)
        .eq('translation_status', 'completed')
      for (const t of (translations ?? []) as Array<{ slug: string | null; language_code: string }>) {
        if (t.slug) paths.add(`/${t.language_code}/posts/${t.slug}`)
      }
    }
    for (const path of paths) revalidatePath(path)
  } catch (err) {
    console.error('[Comments] Revalidation fehlgeschlagen (unkritisch):', err)
  }
}

/**
 * Kommentar mit BELEGTER Identität: sofort moderieren, Status aus dem Verdict.
 * Liefert den Status zurück, damit die UI ehrlich sagen kann, ob der Beitrag
 * live ist oder in der Prüfung.
 */
export async function submitVerifiedComment(
  supabase: AdminClient,
  subscriberId: string,
  input: CommentInput,
): Promise<{ status: 'published' | 'pending' | 'rejected' }> {
  const title = await postTitle(supabase, input.postSource, input.postId)
  const moderation = await moderateComment(input.body, title)
  const status = moderation.verdict === 'publish' ? 'published'
    : moderation.verdict === 'reject' ? 'rejected'
    : 'pending'

  const { error } = await supabase.from('post_comments').insert({
    post_source: input.postSource,
    post_id: input.postId,
    subscriber_id: subscriberId,
    display_name: guardDisplayName(input.displayName),
    body: input.body,
    section_anchor: input.sectionAnchor,
    section_headline: input.sectionHeadline,
    status,
    moderation_verdict: moderation.verdict,
    moderation_reason: moderation.reason,
    published_at: status === 'published' ? new Date().toISOString() : null,
  })
  if (error) throw new Error(`Kommentar nicht speicherbar: ${error.message}`)

  if (status === 'published') {
    await revalidatePostPaths(supabase, input.postSource, input.postId)
  }
  return { status }
}

/**
 * Web-Flow ohne belegte Identität: Kommentar parken, Magic-Link an die
 * Abo-Adresse.
 *
 * ANTI-ENUMERATION: Der Rückgabewert ist für „Adresse ist Abonnent" und
 * „Adresse ist unbekannt" IDENTISCH. Bei unbekannten Adressen wird weder
 * gespeichert noch gemailt — eine Einladungs-Mail an beliebige fremde Adressen
 * wäre ein Spam-Vektor über unseren Absender. Die Abo-Einladung übernimmt die
 * UI für alle ohne Cookie.
 */
/** Frist, innerhalb derer einem Abonnenten keine zweite Bestätigungsmail
 *  geschickt wird. Bremst das Mail-Bombing über bekannte Abo-Adressen: ohne
 *  sie feuert jeder Web-Flow-Request eine Mail über unseren Absender, per-IP
 *  gedrosselt aber per-Ziel unbegrenzt (Review-Befund 1/5). */
const VERIFY_MAIL_COOLDOWN_MS = 10 * 60 * 1000

export async function submitUnverifiedComment(
  supabase: AdminClient,
  email: string,
  input: CommentInput,
): Promise<{ verifyMail: { subscriberId: string; rawToken: string } | null }> {
  const { data: subscriber } = await supabase
    .from('subscribers')
    .select('id, status')
    .eq('email', email.toLowerCase().trim())
    .maybeSingle()

  const sub = subscriber as { id: string; status: string } | null
  if (!sub || sub.status !== 'active') return { verifyMail: null }

  // Throttle je ZIEL-Abonnent (nicht je IP): existiert bereits ein frischer,
  // noch unbestätigter Kommentar dieses Abonnenten, wird kein weiterer geparkt
  // und keine weitere Mail ausgelöst. So kann ein Angreifer die Adresse eines
  // Abonnenten nicht mit Bestätigungsmails fluten.
  const { data: recent } = await supabase
    .from('post_comments')
    .select('created_at')
    .eq('subscriber_id', sub.id)
    .eq('status', 'pending_verify')
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()
  const recentAt = (recent as { created_at?: string } | null)?.created_at
  if (recentAt && Date.now() - new Date(recentAt).getTime() < VERIFY_MAIL_COOLDOWN_MS) {
    return { verifyMail: null }
  }

  const minted = mintSubscriberToken(sub.id, 'comment', new Date(Date.now() + 7 * 24 * 60 * 60 * 1000))
  const { error: tokenError } = await supabase.from('subscriber_action_tokens').insert(minted.row)
  if (tokenError) throw new Error(`Token nicht speicherbar: ${tokenError.message}`)

  const { error } = await supabase.from('post_comments').insert({
    post_source: input.postSource,
    post_id: input.postId,
    subscriber_id: sub.id,
    display_name: guardDisplayName(input.displayName),
    body: input.body,
    section_anchor: input.sectionAnchor,
    section_headline: input.sectionHeadline,
    // Bindet DIESEN Kommentar an DIESEN Magic-Link: verifyAndPublishComments
    // veröffentlicht nur den Kommentar mit passendem Hash, nicht pauschal alle
    // pending_verify des Abonnenten (Review-Befund 6).
    verify_token_hash: minted.row.token_hash,
    status: 'pending_verify',
  })
  if (error) throw new Error(`Kommentar nicht speicherbar: ${error.message}`)

  return { verifyMail: { subscriberId: sub.id, rawToken: minted.rawToken } }
}

/**
 * Magic-Link-Einlösung: alle geparkten Kommentare des Abonnenten durch die
 * Moderation schicken.
 *
 * `consume: false` — der Token ist MEHRFACH nutzbar (7 Tage): derselbe Link
 * dient als Reader-Ausweis für weitere Kommentare, und Newsletter-Links tragen
 * dieselbe Purpose. Die Sicherheit hängt nicht am Einmal-Gebrauch, sondern an
 * Moderation + Rate-Limit (der Cookie ist Komfort, kein Privileg).
 */
export async function verifyAndPublishComments(
  rawToken: string,
): Promise<{ subscriberId: string; published: number; pending: number } | null> {
  const resolved = await resolveSubscriberToken(rawToken, 'comment', { consume: false })
  if (!resolved) return null

  const supabase = createAdminClient()
  const { data: parked } = await supabase
    .from('post_comments')
    .select('id, post_source, post_id, body')
    .eq('subscriber_id', resolved.subscriberId)
    .eq('status', 'pending_verify')
    // NUR die Kommentare, die MIT DIESEM Token geparkt wurden — nicht alle
    // pending_verify des Abonnenten. Sonst würden fremd untergeschobene
    // Kommentare bei der Verifizierung mit veröffentlicht (Review-Befund 6).
    // Newsletter-?ct=-Token tragen keinen geparkten Kommentar → matcht nichts,
    // die Einlösung eines solchen Tokens veröffentlicht damit gar nichts.
    .eq('verify_token_hash', hashSubscriberToken(rawToken))
    .order('created_at', { ascending: true })
    .limit(10)

  let published = 0
  let pending = 0
  for (const row of (parked ?? []) as Array<{ id: string; post_source: PostSource; post_id: string; body: string }>) {
    const title = await postTitle(supabase, row.post_source, row.post_id)
    const moderation = await moderateComment(row.body, title)
    const status = moderation.verdict === 'publish' ? 'published'
      : moderation.verdict === 'reject' ? 'rejected'
      : 'pending'
    await supabase.from('post_comments').update({
      status,
      moderation_verdict: moderation.verdict,
      moderation_reason: moderation.reason,
      published_at: status === 'published' ? new Date().toISOString() : null,
    }).eq('id', row.id).eq('status', 'pending_verify')
    if (status === 'published') {
      published++
      await revalidatePostPaths(supabase, row.post_source, row.post_id)
    } else if (status === 'pending') {
      pending++
    }
  }
  return { subscriberId: resolved.subscriberId, published, pending }
}

/** Veröffentlichte Kommentare eines Posts, neueste zuerst. Für SSR und die
 *  Client-Auffrischung — dieselbe Auswahl, damit beide dasselbe zeigen. */
export async function listPublishedComments(
  supabase: AdminClient,
  source: PostSource,
  postId: string,
  limit = 50,
): Promise<PublicComment[]> {
  const { data } = await supabase
    .from('post_comments')
    .select('id, display_name, body, section_headline, published_at')
    .eq('post_source', source)
    .eq('post_id', postId)
    .eq('status', 'published')
    .order('published_at', { ascending: false })
    .limit(limit)
  return ((data ?? []) as Array<Record<string, unknown>>).map((r) => ({
    id: r.id as string,
    displayName: r.display_name as string,
    body: r.body as string,
    sectionHeadline: (r.section_headline as string | null) ?? null,
    publishedAt: r.published_at as string,
  }))
}

/** Prüft, ob ein roher Token (aus ?ct= im Newsletter-Link) eine gültige
 *  Kommentar-Identität trägt — ohne ihn zu verbrauchen. */
export async function resolveCommentToken(rawToken: string): Promise<string | null> {
  const resolved = await resolveSubscriberToken(rawToken, 'comment', { consume: false })
  return resolved?.subscriberId ?? null
}

// Re-Export für die Verify-Route, die den Hash für Logging-Zwecke nie braucht —
// aber der Import-Pfad soll einheitlich über den Service laufen.
export { hashSubscriberToken }

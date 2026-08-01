# Security-Audit — offener Rest (Stufe 2: anon-Server-Pfade + Klasse-A-RLS)

**Kontext:** RLS war projektweit aus; der öffentliche anon-Key (im Browser-Bundle) konnte alle Tabellen lesen/schreiben. Auth ist **custom JWT** (`synthszr_session`), **kein** Supabase-Auth → RLS-Policies können NICHT `auth.uid()`/`authenticated` nutzen. Absicherung nur über: alle App-Zugriffe auf `createAdminClient` (service_role, bypasst RLS) + RLS aktiviert (anon deny), bzw. für öffentlich lesbare Tabellen eine `TO anon FOR SELECT`-Policy mit dem öffentlichen Filter.

## ✅ Erledigt & deployed
- **Stufe 1/3/4**: gmail_tokens, subscribers, subscriber_language_changes, settings, edit_history*, article_jobs, discovered_companies, post_company_mentions, excluded_senders, news_queue_filter_tags, podcast_audio_files, podcast_jobs, podcast_personality_state, podcast_episode_memory, tip_promos, ad_promos, **paid_subscriptions** → RLS aktiv (anon count=0 verifiziert). 4 Views `security_invoker` + anon-REVOKE. 2 Podcast-Routes auth/rate-limit. (*edit_history steht in Stufe-1-SQL, ist aber Klasse A — siehe unten; RLS darauf erst nach anon-Fix.)
- **Stufe 2 Browser (9 Seiten)**: subscriptions, daily-repo, why, post-form, digests, admin/page, create-article, edit/[id], newsletter-send → alle Browser-Writes auf `/api/admin/*`-Routes (getSession + createAdminClient). Muster: `app/api/admin/subscriptions/route.ts`. Neue Routes: subscriptions, daily-repo, static-pages, posts, generated-posts, daily-digests, post-images, news-queue, post-podcasts, ghostwriter-prompts, vocabulary, edit-history, content-translations, languages-admin, translation-queue, newsletter-settings.
- paid_subscriptions cancel-Route Regression (anon→service_role) gefixt.

## ✅ ABGESCHLOSSEN (2026-08-01) — alle Stufen live & prod-verifiziert
- **anon-Server-Fix** (`1e9f544`): 16 Content-/Bild-/Übersetzungs-Routes → service_role.
- **newsletters-Seite** (`8a4d4b9`): war die 11., übersehene Browser-Schreibseite (`newsletter_sources`-CRUD) → authentifizierte Route `/api/admin/newsletter-sources`.
- **Klasse-A-RLS** (`712fca0`, SQL im Supabase-Editor ausgeführt): 9 ADMIN-ONLY anon-deny + 7 PUBLIC-READ anon-SELECT-Policies.
- **Verifikation** (`scripts/_sec_klasse_a_verify.ts`): ADMIN-ONLY alle `anon=0`; PUBLIC-READ zeigen nur published-Teilmenge (generated_posts −26 Drafts, languages −5 inaktiv, newsletter_sources −7 disabled; `posts anon=0` korrekt = nur Halde-Drafts). Öffentliche Seiten DE+EN Artikel/Home/sources/sitemap/feed alle **200**. Cron-/Pipeline-Schreibpfade komplett service_role.
- **Einziger offener Punkt:** Gmail-Token rotieren (User).

---

## ⏳ ~~OFFEN 1~~ (ERLEDIGT) — anon-Server-Pfade auf service_role umstellen (VOR Klasse-A-RLS!)
`createClient` aus `@/lib/supabase/server` und `createAnonClient` aus `@/lib/supabase/admin` laufen als **anon** → brechen bei RLS. Ersetzen durch `createAdminClient` (service_role; NICHT async — `await` entfernen). **Regel:** ADMIN-ONLY-Tabelle → jeder anon-Zugriff FIX. PUBLIC-READ → nur Writes + SELECTs ohne öffentlichen Filter FIX; öffentliche `.eq(<public-filter>)`-Reads BLEIBEN anon.

**FIX-Dateien (aus vollständigem Audit; Zeilen re-grep, Dropbox-Drift ±4):**
- `app/api/admin/ghostwriter-prompts/route.ts` (ALLE), `app/api/admin/vocabulary/route.ts` (ALLE), `app/api/admin/vocabulary/batch/route.ts`
- `app/api/admin/translations/route.ts` (ALLE — translation_queue/generated_posts/content_translations), `app/api/admin/languages/route.ts` (languages :14/:74, translation_queue :201, content_translations :130/:162, generated_posts NUR wo ohne status-Filter)
- `app/api/admin/crawl-url/route.ts`, `app/api/admin/debug-synthesis/route.ts`, `app/api/admin/news-queue/route.ts` (news_queue :68/79/86/92/137/178/215, daily_repo :157/371)
- `app/api/admin/generated-posts/route.ts` (:64 join zieht daily_digests+ghostwriter_prompts, :77 daily_repo, :253/261/291/329/367), `app/api/admin/posts/route.ts` (:58 generated_posts ohne status)
- `app/api/ghostwriter/route.ts` (daily_repo :212/219, daily_digests :192, ghostwriter_prompts :343/351, vocabulary :360)
- `app/api/podcast/generate-script/route.ts` (posts :481, generated_posts :444; content_translations :456 BLEIBT)
- **Bild-Pipeline (komplett FIX, sorgfältig):** `app/api/post-images/route.ts` (alle post_images + generated_posts :78/210), `app/api/generate-image/route.ts` (alle post_images + generated_posts :182/432/642), `app/api/generate-article-thumbnails/route.ts` (post_images :112/139/150/179/212/231/286/328 — :286 ist der öffentliche GET, liest alle Status → FIX)
- `app/admin/edit/[id]/page.tsx:9` posts SELECT (drafts) — verifizieren ob server-import

**BLEIBT (anon-SELECT, öffentliche Reader mit Filter):** app/page.tsx, app/[lang]/**, app/posts/**, app/archive/**, app/feed.xml, app/api/search, app/api/posts/[slug]/markdown, app/api/languages, app/[lang]/sources — alle mit `.eq('published',true)`/`status='published'`/`translation_status='completed'`/`generation_status='completed'`/`is_active=true`/`enabled=true`. Borderline (cover-lookup by id ohne completed-Filter auf published Reader-Seite): app/page.tsx:61, app/[lang]/page.tsx:124/225, app/posts/[slug]/page.tsx:66, app/[lang]/posts/[slug]/page.tsx:96/154/233 — optional härten.

## ⏳ OFFEN 2 — Klasse-A-RLS (NACH anon-Fix + Deploy)
**ADMIN-ONLY → anon komplett deny (RLS enable, keine Policy):**
```sql
ALTER TABLE public.daily_repo         ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.daily_digests      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.news_queue         ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ghostwriter_prompts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.vocabulary_dictionary ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.newsletter_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.translation_queue  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.edit_history       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.post_podcasts      ENABLE ROW LEVEL SECURITY;
```
**PUBLIC-READ → RLS + anon-SELECT-Policy mit öffentlichem Filter (Beispiele):**
```sql
ALTER TABLE public.posts ENABLE ROW LEVEL SECURITY;
CREATE POLICY posts_public_read ON public.posts FOR SELECT TO anon USING (published = true);
ALTER TABLE public.generated_posts ENABLE ROW LEVEL SECURITY;
CREATE POLICY genposts_public_read ON public.generated_posts FOR SELECT TO anon USING (status = 'published');
ALTER TABLE public.content_translations ENABLE ROW LEVEL SECURITY;
CREATE POLICY ct_public_read ON public.content_translations FOR SELECT TO anon USING (translation_status = 'completed');
ALTER TABLE public.post_images ENABLE ROW LEVEL SECURITY;
CREATE POLICY pi_public_read ON public.post_images FOR SELECT TO anon USING (generation_status = 'completed');
ALTER TABLE public.static_pages ENABLE ROW LEVEL SECURITY;
CREATE POLICY sp_public_read ON public.static_pages FOR SELECT TO anon USING (true);
ALTER TABLE public.languages ENABLE ROW LEVEL SECURITY;
CREATE POLICY lang_public_read ON public.languages FOR SELECT TO anon USING (is_active = true);
ALTER TABLE public.newsletter_sources ENABLE ROW LEVEL SECURITY;
CREATE POLICY ns_public_read ON public.newsletter_sources FOR SELECT TO anon USING (enabled = true);
```
(SELECT-only Policy → keine anon-Writes; service_role bypasst alles.)

## Verifikation
`scripts/_sec_anon_probe.ts` (anon-Key `select('*')`): **count=0 = gesperrt ✓**, echte Daten = offen. Nach RLS jede Tabelle prüfen + Admin-Panel + öffentliche Reader-Seiten (200) + Content-Pipeline (Bild-/Podcast-Generierung, Übersetzung).

## TODO Mattes
- **Gmail-Token rotieren** (war öffentlich abrufbar → kompromittiert behandeln).
- Admin-Panel gegenchecken (die 9 umgestellten Seiten funktionieren via Routes).

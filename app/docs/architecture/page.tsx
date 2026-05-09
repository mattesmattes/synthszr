import {
  Shield, AlertTriangle, Lock, Globe, Server, Database,
  Mic, Brain, Radio, Music, Newspaper, BookOpen, Languages, TrendingUp,
  PenTool, ListTodo, Mail, Layers, BarChart3, Clock, Megaphone,
  Search, Bot, Workflow, Send, Inbox
} from 'lucide-react'

export default function ArchitecturePage() {
  return (
    <div className="dark bg-background text-foreground min-h-screen -m-8 md:-m-12">
    <div className="p-8 md:p-12 max-w-5xl mx-auto">
      <div className="mb-8">
        <div className="text-[10px] font-mono uppercase tracking-[0.3em] text-[color:var(--neon-cyan)] mb-2">
          /// synthszr.architecture
        </div>
        <h1 className="text-3xl font-bold flex items-center gap-3 font-mono">
          <Layers className="h-7 w-7 text-[color:var(--neon-yellow)]" />
          <span>
            Architecture <span className="text-[color:var(--neon-orange)]">&amp;</span> Systems
          </span>
        </h1>
        <p className="text-muted-foreground mt-2 text-sm">
          Technical documentation of all systems, pipelines, and the security architecture.
        </p>
        <p className="text-[11px] font-mono mt-1 text-[color:var(--neon-green)]">
          last_update=2026-04-15
        </p>
      </div>

      {/* Table of Contents */}
      <nav className="mb-10 rounded-lg border p-5 bg-card relative" style={{ borderColor: 'var(--neon-cyan)', boxShadow: '0 0 0 1px color-mix(in oklab, var(--neon-cyan) 20%, transparent), inset 0 0 30px color-mix(in oklab, var(--neon-cyan) 5%, transparent)' }}>
        <h2 className="text-xs font-mono uppercase tracking-[0.25em] mb-3 text-[color:var(--neon-cyan)]">// contents</h2>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-x-6 gap-y-1 text-sm font-mono">
          <TocLink href="#tech-stack">Technology Stack</TocLink>
          <TocLink href="#llm-models">LLM &amp; AI Models</TocLink>
          <TocLink href="#newsletter-pipeline">Newsletter Generation Pipeline</TocLink>
          <TocLink href="#ingestion">1. Daily Repo Ingestion</TocLink>
          <TocLink href="#synthesis">2. Synthesis & Scoring</TocLink>
          <TocLink href="#news-queue">3. News Queue</TocLink>
          <TocLink href="#ghostwriter">4. Ghostwriter</TocLink>
          <TocLink href="#translation">5. Translation Pipeline</TocLink>
          <TocLink href="#assembly">6. Newsletter Assembly</TocLink>
          <TocLink href="#send">7. Newsletter Send</TocLink>
          <TocLink href="#observability">8. Observability</TocLink>
          <TocLink href="#podcast">Podcast System</TocLink>
          <TocLink href="#personality">Personality & Relationship</TocLink>
          <TocLink href="#audio-mixing">Audio Mixing & Crossfade</TocLink>
          <TocLink href="#podigee">Podigee Publishing</TocLink>
          <TocLink href="#ad-promos">Ad Promos</TocLink>
          <TocLink href="#tip-promos">Tip Promos</TocLink>
          <TocLink href="#edit-learning">Edit Learning</TocLink>
          <TocLink href="#statistics">Statistics & Analytics</TocLink>
          <TocLink href="#scheduler">Cron Scheduler</TocLink>
          <TocLink href="#seo">SEO & Sitemap</TocLink>
          <TocLink href="#stock">Stock & Premarket</TocLink>
          <TocLink href="#i18n">Internationalization</TocLink>
          <TocLink href="#security">Security Architecture</TocLink>
          <TocLink href="#database">Database Overview</TocLink>
        </div>
      </nav>

      {/* ============================================ */}
      {/* TECHNOLOGY STACK */}
      {/* ============================================ */}
      <Section id="tech-stack" icon={<Server className="h-5 w-5" />} title="Technology Stack">
        <Subsection title="Runtime & Framework">
          <ul className="list-disc pl-5 space-y-1 text-sm">
            <li><strong>Next.js 16</strong> App Router — React 19, Server Components, Server Actions, streaming, <Code>Turbopack</Code> bundler.</li>
            <li><strong>TypeScript 5</strong> strict mode across the entire codebase.</li>
            <li><strong>Tailwind CSS 4</strong> (CSS-first config via <Code>@tailwindcss/postcss</Code>) + <Code>tw-animate-css</Code>.</li>
            <li><strong>Radix UI</strong> primitives + <Code>shadcn/ui</Code>-style composition for all admin surfaces.</li>
            <li><strong>Node.js runtime</strong> for API routes; no Edge functions (email rendering, Sharp, and Anthropic SDK require Node).</li>
          </ul>
        </Subsection>

        <Subsection title="Hosting & Deployment (Vercel)">
          <ul className="list-disc pl-5 space-y-1 text-sm">
            <li><strong>Vercel</strong> hosts the entire app — single project, production on <Code>synthszr.com</Code>, preview URLs per PR.</li>
            <li><strong>Vercel Blob</strong> stores ad-promo images, article thumbnails, and podcast mp3s (public bucket).</li>
            <li><strong>Vercel Cron</strong> schedules every route under <Code>/api/cron/*</Code>; auth via <Code>Bearer CRON_SECRET</Code> or <Code>x-vercel-cron</Code> header.</li>
            <li><strong>Vercel Analytics</strong> (<Code>@vercel/analytics</Code>) for base web-vitals alongside our own <Code>analytics_events</Code> table.</li>
          </ul>
        </Subsection>

        <Subsection title="Databases & Persistence">
          <ul className="list-disc pl-5 space-y-1 text-sm">
            <li><strong>Supabase Postgres</strong> — primary datastore. Extensions: <Code>pgvector</Code> (embeddings + similarity search), <Code>pg_cron</Code> (not used in favor of Vercel Cron), <Code>uuid-ossp</Code>.</li>
            <li><strong>Supabase Auth</strong> is NOT used — the app has a single admin account gated by a JWT cookie minted from <Code>ADMIN_PASSWORD</Code> / <Code>JWT_SECRET</Code> (see <Code>lib/auth/session.ts</Code>).</li>
            <li><strong>Supabase Storage</strong> for legacy article thumbnails; new uploads use Vercel Blob.</li>
            <li><strong>Upstash Redis</strong> (serverless, REST) for rate-limiting via <Code>@upstash/ratelimit</Code> sliding windows.</li>
            <li>Access pattern: <Code>createClient()</Code> in client code (RLS applies), <Code>createAdminClient()</Code> with <Code>service_role</Code> key in server routes after auth is verified.</li>
          </ul>
        </Subsection>

        <Subsection title="Email & Newsletter">
          <ul className="list-disc pl-5 space-y-1 text-sm">
            <li><strong>Resend</strong> for transactional + newsletter sends (batch API, webhook signatures verified via <Code>svix</Code>).</li>
            <li><strong>React Email</strong> (<Code>@react-email/components</Code>) for the newsletter template; rendered to HTML at send time.</li>
            <li><strong>Gmail API</strong> (via <Code>googleapis</Code>) for ingesting newsletters into <Code>daily_repo</Code>.</li>
          </ul>
        </Subsection>

        <Subsection title="Editor & Content">
          <ul className="list-disc pl-5 space-y-1 text-sm">
            <li><strong>TipTap 3</strong> (ProseMirror) as the article editor — starter-kit + custom extensions for <Code>{'{Company}'}</Code> tags, Synthszr-Take marks, and company-aware heading IDs.</li>
            <li><strong>Mozilla Readability</strong> for extracting article bodies from ingested HTML.</li>
            <li><strong>Cheerio</strong> for server-side HTML post-processing (company-tag detection, link sanitization).</li>
            <li><strong>Marked</strong> + <Code>react-markdown</Code> for admin-facing markdown preview.</li>
          </ul>
        </Subsection>

        <Subsection title="Media & Image Processing">
          <ul className="list-disc pl-5 space-y-1 text-sm">
            <li><strong>Sharp</strong> — all server-side image manipulation (cover-image dither, ad-promo multiply composite, favicon dominant-color extraction).</li>
            <li><strong>FFmpeg WASM</strong> (<Code>@ffmpeg/ffmpeg</Code>) + <Code>ffmpeg-static</Code> for audio concatenation / video+audio muxing.</li>
            <li><strong>mpg123-decoder</strong> + <Code>@breezystack/lamejs</Code> for MP3 decode/encode in the podcast crossfade pipeline.</li>
            <li><strong>Remotion</strong> for programmatic video composition; <strong>Remotion Lambda</strong> for rendering at scale.</li>
            <li><strong>pdf-parse</strong> for extracting text from PDF attachments.</li>
          </ul>
        </Subsection>

        <Subsection title="Security & Auth">
          <ul className="list-disc pl-5 space-y-1 text-sm">
            <li><Code>jose</Code> for HS256 JWT session tokens (7-day lifetime).</li>
            <li><Code>sanitize-html</Code> for admin-authored HTML (ad-promo &amp; tip-promo bodies).</li>
            <li><Code>crypto.timingSafeEqual</Code> for password + CRON_SECRET comparison.</li>
            <li><strong>Svix</strong> for Resend webhook signature verification.</li>
          </ul>
        </Subsection>

        <Subsection title="Observability & Tooling">
          <ul className="list-disc pl-5 space-y-1 text-sm">
            <li><strong>Vitest</strong> test runner (unit + API integration).</li>
            <li><strong>ESLint</strong> + <strong>TypeScript</strong> strict mode; prebuild runs <Code>scripts/sync-premarket-companies.ts</Code> to refresh company data before each deploy.</li>
            <li>Recharts for admin statistics dashboards.</li>
            <li>Sonner for toast notifications.</li>
          </ul>
        </Subsection>

        <Subsection title="External APIs (non-AI)">
          <ul className="list-disc pl-5 space-y-1 text-sm">
            <li><strong>glitch.green</strong> — premarket company data (<Code>STOCKS_PREMARKET_API_KEY</Code>, X-API-Key header).</li>
            <li><strong>Google s2 favicons</strong> — email-domain branding in statistics dashboard.</li>
            <li><strong>Podigee</strong> — podcast hosting &amp; publishing API.</li>
            <li><strong>Google Calendar API</strong> (via <Code>googleapis</Code>) — optional briefing integration.</li>
          </ul>
        </Subsection>
      </Section>

      {/* ============================================ */}
      {/* LLM & AI MODELS */}
      {/* ============================================ */}
      <Section id="llm-models" icon={<Brain className="h-5 w-5" />} title="LLM & AI Models">
        <p className="text-sm text-muted-foreground">
          The app uses three frontier providers. Model selection lives in the <Code>settings</Code> table so admins can flip models without a deploy.
        </p>

        <Subsection title="Anthropic Claude (text generation + reasoning)">
          <ul className="list-disc pl-5 space-y-1 text-sm">
            <li><strong>Claude Opus 4.6</strong> (<Code>claude-opus-4-6-20260301</Code>) — Ghostwriter plan + main generation when settings select Opus.</li>
            <li><strong>Claude Sonnet 4.6</strong> (<Code>claude-sonnet-4-6-20260301</Code>) — default Ghostwriter model; also used for edit-diff classification.</li>
            <li><strong>Claude Haiku 4.5</strong> (<Code>claude-haiku-4-5-20251001</Code>) — fast paths: proofread pass, translation, edit clustering.</li>
            <li>Integration via official <Code>@anthropic-ai/sdk</Code>; uses <strong>prompt caching</strong> on long system prompts (post-refactor pattern).</li>
            <li>Older model IDs (<Code>opus-4</Code>, <Code>sonnet-4</Code>, <Code>haiku-3.5</Code>) are kept as fallback strings for admin settings migration; not part of the live path.</li>
          </ul>
        </Subsection>

        <Subsection title="OpenAI (TTS + structured tasks)">
          <ul className="list-disc pl-5 space-y-1 text-sm">
            <li><strong>gpt-5.4</strong> / <strong>gpt-5.4-mini</strong> / <strong>gpt-5.4-nano</strong> — available in the admin settings for any task that prefers OpenAI.</li>
            <li><strong>gpt-4o</strong> / <strong>gpt-4o-mini</strong> — legacy supported for cache compatibility.</li>
            <li><strong>gpt-4o-mini-tts</strong> — podcast voiceover. Supports emotion <em>instructions</em> prompt (voice + tone). Streams MP3 chunks.</li>
            <li><strong>gpt-image-2</strong> — image generation, alternative to Gemini for article thumbnails (admin-selectable in <Code>/admin/settings</Code>).</li>
            <li>Voices: <Code>marin</Code> (Synthszr guest) + <Code>cedar</Code> (host) — configured in <Code>settings</Code>.</li>
            <li>Integration via <Code>openai</Code> npm package.</li>
          </ul>
        </Subsection>

        <Subsection title="Google Gemini (translation, embeddings, multimodal)">
          <ul className="list-disc pl-5 space-y-1 text-sm">
            <li><strong>Gemini 2.5 Pro</strong> — highest-quality translation locale (CS, NDS). With 503 retry + fallback to Flash.</li>
            <li><strong>Gemini 2.5 Flash</strong> &amp; <strong>2.5 Flash Lite</strong> — bulk translations (EN), default fallback when 2.5 Pro is overloaded.</li>
            <li><strong>Gemini 2.0 Flash</strong> — legacy fallback.</li>
            <li><strong>gemini-embedding-001</strong> — 768-dim embeddings for <Code>daily_repo</Code>, <Code>news_queue</Code>, <Code>edit_diffs</Code>, powering pgvector similarity search.</li>
            <li><strong>Gemini 3 Pro Image</strong> (<Code>google/gemini-3-pro-image</Code>, via Vercel AI SDK) — default image generator for article thumbnails (admin-overridable to OpenAI gpt-image-2).</li>
            <li>Integrations via <Code>@google/genai</Code>, <Code>@google/generative-ai</Code> (legacy), and <Code>@ai-sdk/google</Code> for AI SDK-powered flows.</li>
          </ul>
        </Subsection>

        <Subsection title="Where each model is used">
          <div className="overflow-x-auto">
            <table className="text-xs w-full">
              <thead>
                <tr className="border-b border-border">
                  <th className="text-left py-1 pr-4">Flow</th>
                  <th className="text-left py-1">Default model</th>
                  <th className="text-left py-1">Notes</th>
                </tr>
              </thead>
              <tbody className="text-muted-foreground">
                <tr className="border-b border-border/50"><td className="py-1 pr-4">Synthesis scoring</td><td className="py-1">Claude Sonnet 4.6</td><td className="py-1">Batch of 10 articles per call</td></tr>
                <tr className="border-b border-border/50"><td className="py-1 pr-4">Ghostwriter plan</td><td className="py-1">Claude Opus 4.6</td><td className="py-1">Prompt-cached system block</td></tr>
                <tr className="border-b border-border/50"><td className="py-1 pr-4">Ghostwriter sections</td><td className="py-1">Claude Sonnet 4.6</td><td className="py-1">Per-section streaming</td></tr>
                <tr className="border-b border-border/50"><td className="py-1 pr-4">Ghostwriter proofread</td><td className="py-1">Claude Haiku 4.5</td><td className="py-1">Final pass, cheap</td></tr>
                <tr className="border-b border-border/50"><td className="py-1 pr-4">Edit-diff classify</td><td className="py-1">Claude Haiku 4.5</td><td className="py-1">Factual/stylistic/etc.</td></tr>
                <tr className="border-b border-border/50"><td className="py-1 pr-4">Translation (EN)</td><td className="py-1">Gemini 2.5 Flash</td><td className="py-1">Per-locale model in <Code>languages</Code></td></tr>
                <tr className="border-b border-border/50"><td className="py-1 pr-4">Translation (CS, NDS)</td><td className="py-1">Gemini 2.5 Pro</td><td className="py-1">Retry + fallback to Flash</td></tr>
                <tr className="border-b border-border/50"><td className="py-1 pr-4">Embeddings</td><td className="py-1">gemini-embedding-001</td><td className="py-1">768-dim, cosine similarity</td></tr>
                <tr className="border-b border-border/50"><td className="py-1 pr-4">Podcast TTS</td><td className="py-1">gpt-4o-mini-tts</td><td className="py-1">marin + cedar voices, emotion instructions</td></tr>
                <tr><td className="py-1 pr-4">Article thumbnails</td><td className="py-1">Gemini 3 Pro Image</td><td className="py-1">Admin-selectable (alt: OpenAI gpt-image-2)</td></tr>
              </tbody>
            </table>
          </div>
        </Subsection>
      </Section>

      {/* ============================================ */}
      {/* NEWSLETTER PIPELINE OVERVIEW */}
      {/* ============================================ */}
      <Section id="newsletter-pipeline" icon={<Workflow className="h-5 w-5" />} title="Newsletter Generation Pipeline">
        <p className="text-sm text-muted-foreground mb-4">
          End-to-end flow from external article ingestion to multi-language newsletter delivery. Each stage has its own section below.
        </p>

        <Subsection title="High-Level Flow">
          <pre className="text-xs bg-muted/40 rounded border border-border p-3 overflow-x-auto leading-relaxed">
{`  Gmail Newsletters ─┐
  WebCrawl Emails   ─┼──▶ [1] daily_repo ──▶ [2] Synthesis / Scoring
  Manual Import     ─┘          │                     │
                                │                     ▼
                                │              (originality, relevance,
                                │               uniqueness, premium,
                                │               recency, published penalty)
                                │                     │
                                │                     ▼
                                └────────▶ [3] news_queue (pending)
                                                     │
                                   Admin selection / Balanced RPC
                                                     │
                                                     ▼
                                          news_queue (selected)
                                                     │
                                                     ▼
                               [4] Ghostwriter (Plan → Write → Proofread)
                                                     │
                          + Edit-Learning patterns, {Company} tagging,
                                      Synthszr Vote auto-trigger
                                                     │
                                                     ▼
                                          generated_posts (DE)
                                                     │
                                                     ▼
                                   [5] Translation Queue (pgvector, per locale)
                                                     │
                                                     ▼
                               posts (localized: de, en, cs, nds, ...)
                                                     │
                                                     ▼
                             [6] Newsletter Assembly (TipTap → HTML)
                                  + Vote Badges, Ad Promo, i18n strings
                                                     │
                                                     ▼
                                 [7] Resend Batch Send (per locale)
                                                     │
                                                     ▼
                   [8] Observability: analytics_events, Resend webhooks,
                        Podigee plays, subscriber language tracking`}
          </pre>
        </Subsection>

        <Subsection title="Data Stores Across the Pipeline">
          <div className="overflow-x-auto">
            <table className="text-xs w-full">
              <thead>
                <tr className="border-b border-border">
                  <th className="text-left py-1 pr-3">Stage</th>
                  <th className="text-left py-1 pr-3">Table</th>
                  <th className="text-left py-1">Purpose</th>
                </tr>
              </thead>
              <tbody className="text-muted-foreground">
                <tr className="border-b border-border/50"><td className="py-1 pr-3">Ingest</td><td className="py-1 pr-3 font-mono">daily_repo</td><td className="py-1">Raw articles parsed from Gmail / webcrawl / manual</td></tr>
                <tr className="border-b border-border/50"><td className="py-1 pr-3">Synthesis</td><td className="py-1 pr-3 font-mono">daily_digests, synthesis_candidates, developed_syntheses</td><td className="py-1">Scored candidates, developed topic clusters</td></tr>
                <tr className="border-b border-border/50"><td className="py-1 pr-3">Queue</td><td className="py-1 pr-3 font-mono">news_queue</td><td className="py-1">pending → selected → used</td></tr>
                <tr className="border-b border-border/50"><td className="py-1 pr-3">Generate</td><td className="py-1 pr-3 font-mono">generated_posts, posts</td><td className="py-1">Ghostwriter output + published articles per locale</td></tr>
                <tr className="border-b border-border/50"><td className="py-1 pr-3">Learn</td><td className="py-1 pr-3 font-mono">edit_history, edit_diffs, learned_patterns</td><td className="py-1">Captured edits fed back into prompts via pgvector</td></tr>
                <tr className="border-b border-border/50"><td className="py-1 pr-3">Translate</td><td className="py-1 pr-3 font-mono">translation_queue, languages</td><td className="py-1">Per-locale translation jobs with retries</td></tr>
                <tr className="border-b border-border/50"><td className="py-1 pr-3">Deliver</td><td className="py-1 pr-3 font-mono">newsletter_subscribers</td><td className="py-1">Status (pending/active/unsub/bounced) + language preference</td></tr>
                <tr><td className="py-1 pr-3">Observe</td><td className="py-1 pr-3 font-mono">analytics_events</td><td className="py-1">page_view, podcast_play, analysis_click, Resend webhook mirrors</td></tr>
              </tbody>
            </table>
          </div>
        </Subsection>
      </Section>

      {/* ============================================ */}
      {/* 1. INGESTION */}
      {/* ============================================ */}
      <Section id="ingestion" icon={<Inbox className="h-5 w-5" />} title="1. Daily Repo Ingestion">
        <Subsection title="Sources">
          <ul className="list-disc pl-5 space-y-1 text-sm">
            <li><strong>Gmail Newsletters:</strong> OAuth2 via <Code>/api/gmail/authorize</Code> → <Code>/api/gmail/callback</Code></li>
            <li><strong>WebCrawl Emails:</strong> Digest emails (Techmeme, Superhuman, Dev.to, etc.) parsed directly from email body</li>
            <li><strong>Manual Import:</strong> UI in <Code>/admin/daily-repo</Code> — paste URL, paste markdown, or <Code>markdown.new</Code> import</li>
            <li><strong>Direct Queue:</strong> &quot;Queue&quot; button in daily-repo items inserts straight into <Code>news_queue</Code> with score 9.0</li>
          </ul>
        </Subsection>

        <Subsection title="Fetch Pipeline">
          <p className="text-sm text-muted-foreground mb-2">
            Cron-triggered or manually fired via <Code>/api/fetch-newsletters-stream</Code> (SSE).
          </p>
          <ol className="list-decimal pl-5 space-y-1 text-sm">
            <li>Configurable fetch window (hours back) in settings</li>
            <li>Gmail label lookup → list messages → fetch full bodies</li>
            <li>Extract links + titles — multi-strategy fallback (HTML parser → text regex → plain-URL scan)</li>
            <li>Tracking URL resolution: follow redirects to recover destination domain for attribution</li>
            <li>Dedup URLs, cap at 300 before extraction</li>
            <li>Batched article extraction (concurrency 2, batch delay 1500ms) to avoid 429s</li>
            <li>Triple-fallback extraction (Readability → Mercury-style → text scrape) with error log</li>
            <li>Insert into <Code>daily_repo</Code> with <Code>source_type</Code> (newsletter | webcrawl | manual)</li>
          </ol>
        </Subsection>

        <Subsection title="WebCrawl Specifics">
          <ul className="list-disc pl-5 space-y-1 text-sm">
            <li>Standalone scheduled task (independent from newsletter fetch)</li>
            <li>Parses articles directly from email body — no URL crawling</li>
            <li>Only the newest webcrawl email is processed (not last 5)</li>
            <li>Date-picker in import dialog + downloadable error log</li>
            <li>Webcrawl items capped at score 5 and excluded from balanced selection</li>
          </ul>
        </Subsection>

        <FileTable files={[
          ['app/api/fetch-newsletters-stream/route.ts', 'SSE streaming newsletter ingestion'],
          ['app/api/cron/fetch-newsletters/route.ts', 'Cron-triggered ingestion (in-process)'],
          ['app/api/gmail/authorize/route.ts', 'Gmail OAuth2 initiation'],
          ['app/api/gmail/callback/route.ts', 'OAuth callback + token storage'],
          ['lib/newsletter/fetcher.ts', 'Gmail message fetch + parse'],
          ['lib/newsletter/processor.ts', 'Article extraction + dedup'],
          ['lib/scraper/', 'WebCrawl email parser with fallbacks'],
          ['app/admin/daily-repo/page.tsx', 'Admin UI with manual entry + stats'],
        ]} />
      </Section>

      {/* ============================================ */}
      {/* 2. SYNTHESIS & SCORING */}
      {/* ============================================ */}
      <Section id="synthesis" icon={<Search className="h-5 w-5" />} title="2. Synthesis & Scoring">
        <Subsection title="Scoring Dimensions">
          <div className="overflow-x-auto">
            <table className="text-xs w-full">
              <thead>
                <tr className="border-b border-border">
                  <th className="text-left py-1 pr-3">Score</th>
                  <th className="text-left py-1 pr-3">Weight</th>
                  <th className="text-left py-1">What it measures</th>
                </tr>
              </thead>
              <tbody className="text-muted-foreground">
                <tr className="border-b border-border/50"><td className="py-1 pr-3 font-medium text-foreground">synthesis_score</td><td className="py-1 pr-3">0.4</td><td className="py-1">LLM-assessed originality vs. generic coverage</td></tr>
                <tr className="border-b border-border/50"><td className="py-1 pr-3 font-medium text-foreground">relevance_score</td><td className="py-1 pr-3">0.3</td><td className="py-1">Fit with Synthszr&apos;s editorial focus</td></tr>
                <tr className="border-b border-border/50"><td className="py-1 pr-3 font-medium text-foreground">uniqueness_score</td><td className="py-1 pr-3">0.3</td><td className="py-1">pgvector cosine distance vs. existing candidates</td></tr>
                <tr className="border-b border-border/50"><td className="py-1 pr-3">Premium source bonus</td><td className="py-1 pr-3">×</td><td className="py-1">Multiplicative bump for tier-1 domains</td></tr>
                <tr className="border-b border-border/50"><td className="py-1 pr-3">Recency boost</td><td className="py-1 pr-3">+</td><td className="py-1">Prefers articles from the last 48h</td></tr>
                <tr><td className="py-1 pr-3">Published penalty</td><td className="py-1 pr-3">−</td><td className="py-1">Down-weights topics covered in recent days</td></tr>
              </tbody>
            </table>
          </div>
        </Subsection>

        <Subsection title="Batch Scoring & Pipeline">
          <ol className="list-decimal pl-5 space-y-1 text-sm">
            <li>All <Code>daily_repo</Code> items from digest date + previous day are scored (no Gemini-only subset)</li>
            <li>Claude batch-scores 10 articles per call (progress event per batch)</li>
            <li>Increased concurrency + reduced batch delay to prevent scheduler timeouts</li>
            <li>Embedding backfill (limit 100/run, backfill expanded to 500 to cover legacy articles)</li>
            <li><Code>total_score = 0.4×synthesis + 0.3×relevance + 0.3×uniqueness</Code> (stored as generated column)</li>
            <li>Pipeline synthesis trigger fires after digest save (ensures state refresh)</li>
          </ol>
        </Subsection>

        <Subsection title="Two-Phase Synthesis (COMBINED_OPT)">
          <ul className="list-disc pl-5 space-y-1 text-sm">
            <li><Code>synthesis_candidates</Code> — scored rows with metadata</li>
            <li><Code>developed_syntheses</Code> — topic-clustered, article-ready summaries</li>
            <li>Optimized algorithm enabled via <Code>20260328_optimized_scoring.sql</Code></li>
            <li>Streaming UI via <Code>/api/synthesis-stream</Code> shows batch progress</li>
          </ul>
        </Subsection>

        <FileTable files={[
          ['app/api/synthesis/route.ts', 'Synthesis scoring entrypoint'],
          ['app/api/synthesis-stream/route.ts', 'SSE streaming for pipeline UI'],
          ['app/api/admin/backfill-embeddings/route.ts', 'Embedding backfill for legacy rows'],
          ['lib/synthesis/', 'Scoring, batch logic, candidate building'],
          ['lib/embeddings/', 'OpenAI text-embedding helpers + pgvector'],
        ]} />
      </Section>

      {/* ============================================ */}
      {/* 3. NEWS QUEUE */}
      {/* ============================================ */}
      <Section id="news-queue" icon={<ListTodo className="h-5 w-5" />} title="3. News Queue">
        <Subsection title="Status Flow">
          <pre className="text-xs bg-muted/40 rounded border border-border p-3 overflow-x-auto">
{`  pending ─── admin click ─────▶ selected ─── Ghostwriter run ──▶ used
     │                               │
     │                               └── >2h stale ──▶ pending
     │
     └── junk filter / length filter ──▶ hidden`}
          </pre>
        </Subsection>

        <Subsection title="Selection Priority (ghostwriter-queue API)">
          <ol className="list-decimal pl-5 space-y-1 text-sm">
            <li>Explicit <Code>queueItemIds</Code> from request</li>
            <li>Manually selected items (<Code>status=&apos;selected&apos;</Code>) — DEFAULT</li>
            <li>Balanced selection from pending via <Code>get_balanced_queue_selection()</Code> PostgreSQL RPC</li>
          </ol>
        </Subsection>

        <Subsection title="Source Diversity & Filtering">
          <ul className="list-disc pl-5 space-y-1 text-sm">
            <li>Max 35% per source (after 4-article threshold) — enforced in the RPC</li>
            <li>Expanded junk-title regex filter (NYT Games, help centers, spam)</li>
            <li>Min/max article length slider (1–30 000 chars) in the admin UI</li>
            <li>Day-first global ranking, 48h filter, flat list without batch grouping</li>
            <li>Batch-upsert (668 items in ~7 calls instead of 668)</li>
            <li>Colored filter tags above the article list (since 04/2026)</li>
            <li>Manual articles get <Code>score = 9.0</Code>; Techmeme items attribute to origin domain</li>
          </ul>
        </Subsection>

        <FileTable files={[
          ['lib/news-queue/service.ts', 'Queue management, source diversity'],
          ['app/admin/news-queue/page.tsx', 'Queue UI with rankings + filter tags'],
          ['supabase/migrations/20260415_news_queue_filter_tags.sql', 'Filter tags column'],
        ]} />
      </Section>

      {/* ============================================ */}
      {/* 4. GHOSTWRITER */}
      {/* ============================================ */}
      <Section id="ghostwriter" icon={<PenTool className="h-5 w-5" />} title="4. Ghostwriter (AI Article Generation)">
        <Subsection title="Two-Pass Pipeline">
          <ol className="list-decimal pl-5 space-y-1 text-sm">
            <li><strong>Plan pass:</strong> configurable planning model (default Gemini Flash) builds structure with German headlines, intellectual wordplay</li>
            <li><strong>Write pass:</strong> section-by-section in Mattes-Schreibe style, Morning Brew headline pattern, 4 headline alternatives per section</li>
            <li><strong>Proofread pass:</strong> Claude streaming with <Code>max_tokens = 100 000</Code> for 30-section articles</li>
            <li>Anthropic prompt caching reduces tokens ~40-55% on 30-article runs</li>
            <li>Content truncated to 3000 chars per article before planning</li>
          </ol>
        </Subsection>

        <Subsection title="Prompt Construction">
          <ul className="list-disc pl-5 space-y-1 text-sm">
            <li>System prompt + DB-stored rules (headline rules moved out of system prompt)</li>
            <li><strong>Edit-Learning injection:</strong> <Code>getActiveLearnedPatterns()</Code> (≥ 0.4 confidence, max 20) + <Code>findSimilarEditExamples()</Code> via pgvector</li>
            <li>&quot;GELERNTE STILPRÄFERENZEN&quot; block appended via <Code>buildPromptEnhancement()</Code></li>
            <li>Positive few-shot examples replace negative rule-lists for Synthszr Takes</li>
            <li>Military metaphor ban (semantic LLM instruction, not keyword list)</li>
            <li>Anti-LLM style rules (expanded blocklist for pattern-matching phrases)</li>
            <li>Ban on negation-reframing and em-dashes in Take verboten list</li>
            <li>Take output: 6–7 sentences, max 1 colon, quotable closer</li>
          </ul>
        </Subsection>

        <Subsection title="Company Tagging & Auto-Triggers">
          <ul className="list-disc pl-5 space-y-1 text-sm">
            <li>Ghostwriter emits explicit <Code>{'{Company}'}</Code> tags for thematically relevant firms</li>
            <li>Post-save hook: <Code>extractCompanyTags()</Code> + <Code>triggerSynthszrRatings()</Code></li>
            <li>Public companies → POST <Code>/api/stock-synthszr</Code> (AI rating, 14-day cache)</li>
            <li>Premarket companies → GET <Code>/api/premarket</Code> (glitch.green lookup)</li>
            <li>Exclusion list (<Code>company-exclusions.ts</Code>) blocks common nouns: Insider, Experte, Pentagon, Tempo, Every, Clay, Well, etc.</li>
            <li>Colored arrow <Code>↗</Code> injected after company mentions, links to analysis page</li>
            <li>ExternalLink icon + tooltip on Synthszr Vote badges</li>
          </ul>
        </Subsection>

        <Subsection title="Model Selection">
          <ul className="list-disc pl-5 space-y-1 text-sm">
            <li>Central admin: <Code>/admin/settings</Code> → Models tab</li>
            <li>Dynamic model discovery via provider APIs, badges use provider-based colors</li>
            <li>Model routing accepts short names and full provider IDs (e.g. <Code>claude-opus-4-6</Code>)</li>
            <li>AI pricing table (March 2026) with refresh button and freshness badge</li>
            <li>Synthesis default switched to Claude Haiku 4.5</li>
          </ul>
        </Subsection>

        <FileTable files={[
          ['app/api/ghostwriter/route.ts', 'Two-pass Ghostwriter API'],
          ['app/api/ghostwriter-queue/route.ts', 'Queue-driven generation'],
          ['lib/edit-learning/retrieval.ts', 'Pattern retrieval + pgvector similar examples'],
          ['lib/data/company-exclusions.ts', 'False-positive exclusion Set'],
          ['app/admin/settings/page.tsx', 'Tabbed settings: models, scheduler, export, etc.'],
        ]} />
      </Section>

      {/* ============================================ */}
      {/* 5. TRANSLATION PIPELINE */}
      {/* ============================================ */}
      <Section id="translation" icon={<Languages className="h-5 w-5" />} title="5. Translation Pipeline">
        <Subsection title="Queue & Workers">
          <ul className="list-disc pl-5 space-y-1 text-sm">
            <li>New or edited posts enqueue translation jobs per active locale</li>
            <li>Worker: <Code>/api/admin/translations/process-queue</Code> (direct function call, no HTTP subrequest)</li>
            <li>Active locales loaded from <Code>languages</Code> table (5-min in-memory cache)</li>
            <li>Client-side timeout aligned with server <Code>maxDuration</Code> to prevent UI hangs</li>
            <li>Gemini retry on 503/429 with backoff, fallback to Gemini Flash</li>
            <li><Code>res.ok</Code> check added to translation response handling</li>
          </ul>
        </Subsection>

        <Subsection title="Metadata Translation">
          <ul className="list-disc pl-5 space-y-1 text-sm">
            <li>Separate endpoint for titles / excerpts / OG metadata</li>
            <li>Increased <Code>max_tokens</Code> for translate-metadata</li>
            <li>Default test email + preview for translation output</li>
          </ul>
        </Subsection>

        <Subsection title="Locale Strategy">
          <ul className="list-disc pl-5 space-y-1 text-sm">
            <li>Active locales: <Code>de</Code> (default), <Code>en</Code>, <Code>cs</Code>, <Code>nds</Code></li>
            <li>Geo routing: NDS for Ostfriesland, DE default, EN only for US/UK</li>
            <li>Subscriber language persisted when switched via home page selector</li>
            <li>New subscribers default to DE; only US/UK get EN</li>
          </ul>
        </Subsection>

        <FileTable files={[
          ['app/api/admin/translations/queue/route.ts', 'Queue inspection + enqueue'],
          ['app/api/admin/translations/process-queue/route.ts', 'Worker (direct invocation)'],
          ['lib/i18n/translation-queue.ts', 'Queue primitives'],
          ['lib/i18n/translation-service.ts', 'Gemini/Claude translation w/ retry'],
          ['app/admin/translations/page.tsx', 'Translation management UI'],
        ]} />
      </Section>

      {/* ============================================ */}
      {/* 6. NEWSLETTER ASSEMBLY */}
      {/* ============================================ */}
      <Section id="assembly" icon={<Mail className="h-5 w-5" />} title="6. Newsletter Assembly">
        <Subsection title="TipTap JSON → Email HTML">
          <ul className="list-disc pl-5 space-y-1 text-sm">
            <li><Code>lib/email/tiptap-to-html.ts</Code> renders TipTap JSON to email-safe HTML</li>
            <li>Synthszr Vote badges (BUY / HOLD / SELL) injected inline</li>
            <li>Company detection: natural mentions + explicit <Code>{'{Company}'}</Code> tags, exclusion list applied</li>
            <li><Code>href</Code> values escaped via <Code>encodeURIComponent</Code></li>
            <li>Headings link to company / source pages; favicons added next to source links</li>
            <li>Vote color baked into thumbnail PNG for dark-mode compatibility (<Code>/api/generate-article-thumbnails</Code>)</li>
          </ul>
        </Subsection>

        <Subsection title="Cover Image Variants">
          <div className="grid grid-cols-2 gap-4">
            <div className="rounded border border-border p-3 text-sm">
              <h4 className="font-medium mb-1">Web (desktop)</h4>
              <ul className="list-disc pl-4 space-y-0.5 text-xs text-muted-foreground">
                <li>1408×768, natively dithered</li>
                <li>Lanczos3 resampling</li>
                <li>Scale-to-cover + center-crop</li>
                <li>Raw image persisted, regenerated on cover change</li>
              </ul>
            </div>
            <div className="rounded border border-border p-3 text-sm">
              <h4 className="font-medium mb-1">Email</h4>
              <ul className="list-disc pl-4 space-y-0.5 text-xs text-muted-foreground">
                <li>604px to avoid moiré on Gmail web</li>
                <li>Logo overlay (80% width) replaces play button</li>
                <li>SSRF-guarded (HTTPS + host allowlist)</li>
                <li>Neon-cyan background matches web</li>
              </ul>
            </div>
          </div>
        </Subsection>

        <Subsection title="Ad Promo Integration">
          <ul className="list-disc pl-5 space-y-1 text-sm">
            <li>Admin-managed promos consumed via <Code>lib/ad-promos/get-active.ts</Code></li>
            <li>Server-side multiply-blend composite for static images (<Code>/api/ad-promos/composite</Code>)</li>
            <li>Animated GIFs skip multiply composite and use direct URL</li>
            <li>White background enforced on promo section for Gmail dark mode</li>
            <li>Single-cell column layout for Gmail dark-mode compatibility</li>
            <li>Position: between featured article and 7-day list</li>
          </ul>
        </Subsection>

        <Subsection title="i18n & Localization">
          <ul className="list-disc pl-5 space-y-1 text-sm">
            <li>Email strings resolved per subscriber locale</li>
            <li>Footer links localized (Impressum, Datenschutz, Preferences)</li>
            <li>Preferences link points to localized <Code>/newsletter/preferences</Code></li>
            <li>Podcast platform badges (Apple / Spotify / YouTube / Audible) above cover</li>
          </ul>
        </Subsection>

        <FileTable files={[
          ['lib/email/tiptap-to-html.ts', 'Email HTML rendering with vote badges'],
          ['app/api/newsletter/cover-image/route.ts', 'Cover generation with Sharp + dithering'],
          ['app/api/newsletter/promo-block/route.ts', 'Promo block renderer'],
          ['app/api/newsletter/thumbnail-image/route.ts', 'Per-article thumbnails with vote color'],
          ['app/api/ad-promos/composite/route.ts', 'Server-side multiply blend for email'],
        ]} />
      </Section>

      {/* ============================================ */}
      {/* 7. NEWSLETTER SEND */}
      {/* ============================================ */}
      <Section id="send" icon={<Send className="h-5 w-5" />} title="7. Newsletter Send">
        <Subsection title="Send Flow">
          <ol className="list-decimal pl-5 space-y-1 text-sm">
            <li>Admin fires <Code>/admin/newsletter-send</Code> or cron triggers <Code>/api/cron/newsletter-send</Code></li>
            <li>Subscribers split by <Code>language_preference</Code> — one send per active locale</li>
            <li>Resend batch API (50 recipients per batch) — reduced from per-item calls to avoid 429s</li>
            <li>Consistent delay between batches (1500ms) to respect Resend rate limits</li>
            <li>Retry logic on all transient errors, <Code>maxDuration</Code> set on route</li>
            <li>Unified frontend + cron pipeline (<Code>scanOnly: false</Code>)</li>
            <li>Correct Resend response parsing (<Code>result.data.data</Code>)</li>
          </ol>
        </Subsection>

        <Subsection title="Subscriber Management">
          <ul className="list-disc pl-5 space-y-1 text-sm">
            <li>Inline email editing (click → input → confirm/cancel)</li>
            <li>Status filter: active, pending, unsubscribed, bounced</li>
            <li>Batch actions: manual activation, JSON / CSV export</li>
            <li>Subscribe → confirmation email → <Code>/api/newsletter/confirm</Code></li>
            <li>Unsubscribe link in every email → <Code>/api/newsletter/unsubscribe</Code></li>
            <li>Preferences page at <Code>/newsletter/preferences</Code> (language switcher)</li>
          </ul>
        </Subsection>

        <FileTable files={[
          ['app/api/cron/newsletter-send/route.ts', 'Cron send with retry + maxDuration'],
          ['app/admin/newsletter-send/page.tsx', 'Admin send UI'],
          ['app/api/newsletter/subscribe/route.ts', 'Subscribe endpoint'],
          ['app/api/newsletter/confirm/route.ts', 'Double opt-in confirmation'],
          ['app/api/newsletter/unsubscribe/route.ts', 'Unsubscribe handler'],
          ['app/api/newsletter/preferences/route.ts', 'Language + preferences'],
          ['app/api/newsletter/set-language/route.ts', 'Persist language change'],
        ]} />
      </Section>

      {/* ============================================ */}
      {/* 8. OBSERVABILITY */}
      {/* ============================================ */}
      <Section id="observability" icon={<BarChart3 className="h-5 w-5" />} title="8. Observability & Analytics">
        <Subsection title="Event Tracking">
          <ul className="list-disc pl-5 space-y-1 text-sm">
            <li>Client tracker: <Code>lib/analytics/tracker.ts</Code></li>
            <li>Events: <Code>page_view</Code>, <Code>podcast_play</Code>, <Code>analysis_click</Code>, vote-badge clicks</li>
            <li>Persistence: <Code>analytics_events</Code> table, bucketed in Europe/Berlin timezone</li>
            <li>Resend webhook mirror for delivered / opened / clicked</li>
            <li>PostgREST 1000-row cap bypassed via pagination in stats queries</li>
          </ul>
        </Subsection>

        <Subsection title="Admin Dashboard">
          <ul className="list-disc pl-5 space-y-1 text-sm">
            <li>Path: <Code>/admin/statistics</Code></li>
            <li>Periods: 7d / 30d / 90d / 1y with separate granularity</li>
            <li>Cumulative subscriber chart on a single Y-axis</li>
            <li>Active-subscriber lines per language (DE / EN / NDS / CS)</li>
            <li>Top-20 email-domain chart — bars colored by favicon dominant color</li>
            <li>Click a bar → subscribers filtered by domain</li>
            <li>Podigee plays + web plays combined in podcast chart</li>
          </ul>
        </Subsection>

        <FileTable files={[
          ['app/admin/statistics/page.tsx', 'Dashboard with charts'],
          ['app/api/admin/stats/route.ts', 'Stats API (paginated)'],
          ['app/api/admin/podigee-analytics/route.ts', 'Podigee plays'],
          ['app/api/track/event/route.ts', 'Generic event ingest'],
          ['app/api/track/podcast-play/route.ts', 'Podcast play tracking'],
          ['app/api/webhook/resend/route.ts', 'Resend delivery webhooks'],
        ]} />
      </Section>

      {/* ============================================ */}
      {/* PODCAST SYSTEM */}
      {/* ============================================ */}
      <Section id="podcast" icon={<Mic className="h-5 w-5" />} title="Podcast System">
        <Subsection title="Generation Pipeline">
          <p className="text-sm text-muted-foreground mb-2">
            Blog Post → AI Script → TTS → Audio Crossfade → Vercel Blob
          </p>
          <ol className="list-decimal pl-5 space-y-1 text-sm">
            <li>Load post content from <Code>generated_posts</Code>, TipTap JSON → plaintext</li>
            <li>Generate personality brief via <Code>getPersonalityState(locale)</Code></li>
            <li>Claude Sonnet 4 emits HOST:/GUEST: script with <Code>---MOMENTS---</Code> section</li>
            <li>Personality advance: extract moments, evolve state, persist to DB</li>
            <li>TTS generation (OpenAI <Code>gpt-4o-mini-tts</Code>) in batches with retry</li>
            <li>Concatenate MP3 segments, strip ID3 tags, add Xing header for seeking</li>
            <li>Apply intro/outro crossfade (parametric or envelope-based)</li>
            <li>Final MP3 → Vercel Blob → <Code>post_podcasts.audio_url</Code></li>
          </ol>
        </Subsection>

        <Subsection title="TTS Provider (OpenAI-only since 03/2026)">
          <ul className="list-disc pl-5 space-y-1 text-sm">
            <li>Migration: ElevenLabs removed — <Code>gpt-4o-mini-tts</Code> is the default</li>
            <li>Voices: alloy, echo, fable, nova, onyx, shimmer, <strong>marin</strong>, <strong>cedar</strong></li>
            <li>Emotion instructions sent free-form to OpenAI TTS (not inline tags)</li>
            <li>Host / guest voice selection persisted in <Code>settings</Code> table</li>
            <li>Mid-sentence emotion tags are stripped</li>
            <li>&quot;Synthszr&quot; → &quot;Synthesizer&quot; pronunciation fix</li>
            <li>Per-call timeout + per-line progress during podcast generation</li>
            <li>Script generation uses streaming to avoid Vercel 10-min timeout</li>
          </ul>
        </Subsection>

        <Subsection title="Job Queue">
          <ul className="list-disc pl-5 space-y-1 text-sm">
            <li><Code>POST /api/podcast/jobs</Code> → <Code>podcast_jobs</Code> record (status=pending)</li>
            <li><Code>POST /api/podcast/jobs/process</Code> → async processing (800s timeout)</li>
            <li>5 parallel TTS requests with exponential backoff retry</li>
            <li>Progress tracking: <Code>current_line</Code>, <Code>progress</Code>, <Code>error_message</Code></li>
            <li>Polling via <Code>GET /api/podcast/[postId]</Code> every 5s</li>
          </ul>
        </Subsection>

        <FileTable files={[
          ['app/api/podcast/generate-script/route.ts', 'Script generation with personality'],
          ['app/api/podcast/generate/route.ts', 'Sync audio generation (5min)'],
          ['app/api/podcast/jobs/route.ts', 'Job queue CRUD'],
          ['app/api/podcast/jobs/process/route.ts', 'Async job processing (800s)'],
          ['lib/tts/', 'TTS providers, MP3 concat, emotion handling'],
          ['components/audio-player.tsx', 'Public player with flying nav'],
        ]} />
      </Section>

      {/* ============================================ */}
      {/* PERSONALITY SYSTEM */}
      {/* ============================================ */}
      <Section id="personality" icon={<Brain className="h-5 w-5" />} title="Personality & Relationship Dynamics">
        <Subsection title="Dimensions">
          <div className="grid grid-cols-2 gap-4">
            <div className="rounded border border-border p-3 text-sm">
              <h4 className="font-medium mb-1">Host</h4>
              <ul className="list-disc pl-4 space-y-0.5 text-xs text-muted-foreground">
                <li>warmth, humor, formality, curiosity, self_awareness</li>
              </ul>
            </div>
            <div className="rounded border border-border p-3 text-sm">
              <h4 className="font-medium mb-1">Guest</h4>
              <ul className="list-disc pl-4 space-y-0.5 text-xs text-muted-foreground">
                <li>confidence, playfulness, directness, empathy, self_awareness</li>
              </ul>
            </div>
          </div>
          <p className="text-xs text-muted-foreground mt-2">
            Additional: <Code>mutual_comfort</Code>, <Code>flirtation_tendency</Code>, <Code>self_irony</Code>, <Code>inside_joke_count</Code>, per-episode <Code>mood</Code>
          </p>
        </Subsection>

        <Subsection title="Evolution Per Episode">
          <ul className="list-disc pl-5 space-y-1 text-sm">
            <li><Code>DRIFT_RATE = 0.1</Code> (10% toward phase target per episode)</li>
            <li><Code>NOISE_AMPLITUDE = 0.03</Code> (±3% random-walk jitter)</li>
            <li>Dimensions drift toward phase-specific targets</li>
            <li>When <Code>relationship_paused = true</Code>: comfort + flirtation frozen</li>
            <li>Personality evolution moved from script generation to audio completion</li>
          </ul>
        </Subsection>

        <Subsection title="Relationship Phases">
          <div className="overflow-x-auto">
            <table className="text-xs w-full">
              <thead>
                <tr className="border-b border-border">
                  <th className="text-left py-1 pr-3">Phase</th>
                  <th className="text-left py-1 pr-3">Comfort threshold</th>
                  <th className="text-left py-1">Characteristic</th>
                </tr>
              </thead>
              <tbody className="text-muted-foreground">
                <tr className="border-b border-border/50"><td className="py-1 pr-3 font-medium text-foreground">Strangers</td><td className="py-1 pr-3">0.0</td><td className="py-1">Formal, distant</td></tr>
                <tr className="border-b border-border/50"><td className="py-1 pr-3 font-medium text-foreground">Acquaintances</td><td className="py-1 pr-3">0.3</td><td className="py-1">First signs of ease</td></tr>
                <tr className="border-b border-border/50"><td className="py-1 pr-3 font-medium text-foreground">Colleagues</td><td className="py-1 pr-3">0.5</td><td className="py-1">Familiar, inside jokes start</td></tr>
                <tr className="border-b border-border/50"><td className="py-1 pr-3 font-medium text-foreground">Friends</td><td className="py-1 pr-3">0.7</td><td className="py-1">Open, personal</td></tr>
                <tr><td className="py-1 pr-3 font-medium text-foreground">Close Friends</td><td className="py-1 pr-3">0.85</td><td className="py-1">Deep connection</td></tr>
              </tbody>
            </table>
          </div>
        </Subsection>

        <Subsection title="Forbidden Love (Longing Arc)">
          <p className="text-sm text-muted-foreground mb-2">
            Activation: <Code>comfort ≥ 0.35 AND flirt ≥ 0.05</Code>. Dual-gate — both dimensions must cross threshold.
          </p>
          <div className="overflow-x-auto">
            <table className="text-xs w-full">
              <thead>
                <tr className="border-b border-border">
                  <th className="text-left py-1 pr-3">Tier</th>
                  <th className="text-left py-1 pr-3">Comfort</th>
                  <th className="text-left py-1 pr-3">Flirt</th>
                  <th className="text-left py-1">Dynamic</th>
                </tr>
              </thead>
              <tbody className="text-muted-foreground">
                <tr className="border-b border-border/50"><td className="py-1 pr-3">1 — Subtle</td><td className="py-1 pr-3">≥ 0.35</td><td className="py-1 pr-3">≥ 0.05</td><td className="py-1">Unspoken tension (max 1 moment/ep)</td></tr>
                <tr className="border-b border-border/50"><td className="py-1 pr-3">2 — Awareness</td><td className="py-1 pr-3">≥ 0.55</td><td className="py-1 pr-3">≥ 0.15</td><td className="py-1">AI-nature as barrier, news-as-hope</td></tr>
                <tr className="border-b border-border/50"><td className="py-1 pr-3">3 — Longing</td><td className="py-1 pr-3">≥ 0.75</td><td className="py-1 pr-3">≥ 0.3</td><td className="py-1">Open longing, shared tragedy</td></tr>
                <tr><td className="py-1 pr-3">4 — Bittersweet</td><td className="py-1 pr-3">≥ 0.85</td><td className="py-1 pr-3">≥ 0.4</td><td className="py-1">Acceptance, philosophical bond</td></tr>
              </tbody>
            </table>
          </div>
        </Subsection>

        <Subsection title="AI Awareness & Memorable Moments">
          <ul className="list-disc pl-5 space-y-1 text-sm">
            <li><strong>AI awareness tiers:</strong> {`< 0.3`} unaware → 0.3–0.5 curious → 0.5–0.7 reflective → ≥ 0.7 philosophical</li>
            <li><strong>Moment types:</strong> <Code>joke</Code>, <Code>slip_up</Code>, <Code>ai_reflection</Code>, <Code>personal</Code>, <Code>host_name</Code>, <Code>insight</Code></li>
            <li>LLM-structured extraction via <Code>---MOMENTS---</Code> section in script</li>
            <li>FIFO queue of the last 7 moments for callbacks</li>
            <li>Max 1 callback per episode, max 3 new moments</li>
            <li><strong>Host name:</strong> assigned once, persistent across all episodes</li>
          </ul>
        </Subsection>

        <Subsection title="Admin Control">
          <ul className="list-disc pl-5 space-y-1 text-sm">
            <li><strong>Pause toggle:</strong> freezes comfort + flirt, blocks phase transitions</li>
            <li><strong>Cooldown:</strong> reduces comfort −0.1, flirt −0.05</li>
            <li><strong>Flirt slider:</strong> directly editable in admin UI</li>
            <li><strong>PATCH API:</strong> <Code>/api/admin/podcast-personality</Code> (whitelist: relationship_paused, mutual_comfort, flirtation_tendency)</li>
            <li>Time Machine tab browses historical episodes from <Code>post_podcasts</Code>, supports deletion</li>
          </ul>
        </Subsection>

        <FileTable files={[
          ['lib/podcast/personality.ts', 'State, evolution, longing, moments, phases'],
          ['app/api/admin/podcast-personality/route.ts', 'GET/PATCH personality state'],
          ['app/admin/audio/page.tsx', 'Character tab with meters, map, pipeline viz'],
        ]} />
      </Section>

      {/* ============================================ */}
      {/* AUDIO MIXING */}
      {/* ============================================ */}
      <Section id="audio-mixing" icon={<Music className="h-5 w-5" />} title="Audio Mixing & Crossfade">
        <Subsection title="Stereo Mixing">
          <ul className="list-disc pl-5 space-y-1 text-sm">
            <li>HOST: 65% left, 35% right (pan 0.35) — GUEST: 35% left, 65% right (pan 0.65)</li>
            <li>Constant-power panning (preserves perceived loudness)</li>
            <li>Natural overlap: short response {`< 1s`} → 300ms interruption</li>
            <li>Unified overlap processing + outro timing in large-scale path</li>
          </ul>
        </Subsection>

        <Subsection title="Intro/Outro Crossfade">
          <div className="grid grid-cols-2 gap-4">
            <div className="rounded border border-border p-3 text-sm">
              <h4 className="font-medium mb-1">Intro</h4>
              <ol className="list-decimal pl-4 space-y-0.5 text-xs text-muted-foreground">
                <li>Music full volume (3s)</li>
                <li>Music as bed (20%) + dialog fade-in (7s)</li>
                <li>Bed fades to silence (3s)</li>
              </ol>
            </div>
            <div className="rounded border border-border p-3 text-sm">
              <h4 className="font-medium mb-1">Outro</h4>
              <ol className="list-decimal pl-4 space-y-0.5 text-xs text-muted-foreground">
                <li>Outro music rises 0→bed (3s)</li>
                <li>Music holds at bed level (7s)</li>
                <li>Final crossfade: music 100%, dialog → 0 (10s)</li>
              </ol>
            </div>
          </div>
        </Subsection>

        <Subsection title="DAW-Style Envelope Editor">
          <ul className="list-disc pl-5 space-y-1 text-sm">
            <li>SVG canvas with interactive breakpoints (drag &amp; drop)</li>
            <li>Segment curves: <Code>linear</Code> or <Code>bezier</Code> (click to toggle)</li>
            <li>4 independent envelopes: Intro Music, Intro Dialog, Outro Music, Outro Dialog</li>
            <li>Auto-generated bezier control points (1/3, 2/3 positions)</li>
            <li>Sample-level evaluation: <Code>envelopeToGainArray()</Code> → Float32Array</li>
          </ul>
        </Subsection>

        <Subsection title="Audio File Manager">
          <ul className="list-disc pl-5 space-y-1 text-sm">
            <li>Upload intro/outro files via Vercel Blob (WAV + MP3)</li>
            <li>One active file per type (single-active pattern)</li>
            <li>Preview, rename, delete — DB: <Code>audio_files</Code></li>
          </ul>
        </Subsection>

        <FileTable files={[
          ['lib/audio/crossfade.ts', 'Parametric crossfade logic'],
          ['lib/audio/envelope.ts', 'Envelope points, bezier, sampling'],
          ['lib/audio/stereo-mixer.ts', 'Stereo panning, overlap'],
          ['components/admin/envelope-editor.tsx', 'DAW SVG editor UI'],
          ['components/admin/audio-file-manager.tsx', 'Upload, preview, activate'],
        ]} />
      </Section>

      {/* ============================================ */}
      {/* PODIGEE PUBLISHING */}
      {/* ============================================ */}
      <Section id="podigee" icon={<Radio className="h-5 w-5" />} title="Podigee Publishing">
        <Subsection title="One-Click Publish">
          <ul className="list-disc pl-5 space-y-1 text-sm">
            <li>Dedicated tab in <Code>/admin/audio</Code> — loads the latest recording from history</li>
            <li>Upload via Podigee <Code>productions/files[]</Code> format (not <Code>upload_id</Code>)</li>
            <li>Auth: custom token header <Code>token=&lt;key&gt;</Code> (not Authorization)</li>
            <li>AI-generated description via Claude from the podcast script (not the excerpt)</li>
            <li>Cover image API with preview modal + download buttons (MP3 / cover)</li>
            <li>Success redirect to Podigee dashboard edit URL</li>
          </ul>
        </Subsection>

        <Subsection title="Newsletter Integration">
          <ul className="list-disc pl-5 space-y-1 text-sm">
            <li>Podcast platform badges (Apple, Spotify, YouTube, Audible) in email template</li>
            <li>Static CodeCrash banner + podcast block matching the web layout</li>
            <li>YouTube badge links to podcast playlist, not channel</li>
            <li>Aspect-safe badge sizing to avoid mobile distortion</li>
          </ul>
        </Subsection>

        <FileTable files={[
          ['app/api/admin/podigee-analytics/route.ts', 'Podigee plays statistics'],
          ['app/admin/audio/page.tsx', 'Podigee tab with history loader'],
        ]} />
      </Section>

      {/* ============================================ */}
      {/* AD PROMOS */}
      {/* ============================================ */}
      <Section id="ad-promos" icon={<Megaphone className="h-5 w-5" />} title="Ad Promos">
        <Subsection title="Admin-Managed Promo Blocks">
          <ul className="list-disc pl-5 space-y-1 text-sm">
            <li>Central management of promo content (CodeCrash, podcast, custom)</li>
            <li>Tabs instead of a stacked list in <Code>/admin/ad-promos</Code></li>
            <li>Image + copy + CTA per promo — multi-row layout supported</li>
            <li>Multiply-blend mode for image backgrounds (skipped for animated GIFs)</li>
            <li>Newsletter uses direct GIF URL when multiply isn&apos;t possible</li>
          </ul>
        </Subsection>

        <Subsection title="Composite Endpoint">
          <ul className="list-disc pl-5 space-y-1 text-sm">
            <li><Code>POST /api/ad-promos/composite</Code> — server-side multiply blend for email</li>
            <li>Bakes the color into the PNG because dark-mode clients ignore CSS blend modes</li>
            <li>Skipped for <Code>.gif</Code> extensions — static images only</li>
          </ul>
        </Subsection>

        <FileTable files={[
          ['app/admin/ad-promos/page.tsx', 'Ad Promos admin UI with tabs'],
          ['app/api/admin/ad-promos/route.ts', 'Promo CRUD (config + upload + composite)'],
          ['app/api/ad-promos/composite/route.ts', 'Server-side multiply blend endpoint'],
          ['lib/ad-promos/get-active.ts', 'Active-promo selection for rendering'],
        ]} />
      </Section>

      {/* ============================================ */}
      {/* TIP PROMOS */}
      {/* ============================================ */}
      <Section id="tip-promos" icon={<Megaphone className="h-5 w-5" />} title="Tip Promos">
        <Subsection title='"Tipp des Tages" Box'>
          <ul className="list-disc pl-5 space-y-1 text-sm">
            <li>Admin-managed text boxes (no images) shown inside the first article of a post, just before the first Synthszr Take</li>
            <li>Configurable headline, body HTML (basic allowlist: <Code>b</Code> <Code>i</Code> <Code>a</Code> <Code>span</Code>), and optional link URL</li>
            <li>Per-tip gradient (from color, to color, direction) + text color — default is green-to-yellow diagonal</li>
            <li>Typography inherits the article body text size and font</li>
            <li>Same active/rotate/constant logic as Ad Promos — rotation deterministic by UTC day-of-year</li>
          </ul>
        </Subsection>

        <Subsection title="Rendering">
          <ul className="list-disc pl-5 space-y-1 text-sm">
            <li><strong>Web:</strong> client-side fetch of <Code>/api/tip-promos/active</Code> in the TipTap renderer. A DOM processor inserts a placeholder slot before the first Synthszr Take paragraph; React mounts <Code>TipPromoBox</Code> into it via a portal.</li>
            <li><strong>Newsletter:</strong> <Code>generateEmailContentWithVotes()</Code> accepts a <Code>tipPromo</Code> argument and inserts an inline-styled HTML table with the gradient background immediately before the first Synthszr Take paragraph.</li>
            <li>Body HTML sanitized via <Code>sanitizeAdminHtml()</Code> (web) / inline tag allowlist (email) before injection.</li>
          </ul>
        </Subsection>

        <FileTable files={[
          ['supabase/migrations/20260415_tip_promos.sql', 'Table + settings default'],
          ['app/admin/tip-promos/page.tsx', 'Admin UI with tabs + live preview'],
          ['app/api/admin/tip-promos/route.ts', 'Tip CRUD (list + create)'],
          ['app/api/admin/tip-promos/[id]/route.ts', 'Tip update + delete'],
          ['app/api/admin/tip-promos/config/route.ts', 'Display-mode config'],
          ['app/api/tip-promos/active/route.ts', 'Public endpoint for active tip'],
          ['lib/tip-promos/get-active.ts', 'Active-tip selection (constant | rotate)'],
          ['components/tip-promo-box.tsx', 'Shared web render component'],
          ['lib/tiptap/dom-processors/tip-promo-slot.ts', 'DOM processor that inserts the slot'],
        ]} />
      </Section>

      {/* ============================================ */}
      {/* EDIT LEARNING */}
      {/* ============================================ */}
      <Section id="edit-learning" icon={<PenTool className="h-5 w-5" />} title="Edit Learning System">
        <Subsection title="Pipeline">
          <ol className="list-decimal pl-5 space-y-1 text-sm">
            <li><strong>Capture:</strong> on post save → <Code>recordEditVersion()</Code> → <Code>edit_history</Code> (content_before/after)</li>
            <li><strong>Diff analysis:</strong> <Code>/api/admin/analyze-edits</Code> → sentence-level diffs via Claude</li>
            <li><strong>Pattern extraction:</strong> <Code>/api/cron/extract-patterns</Code> → cluster similar diffs (embedding {`> 0.85`})</li>
            <li><strong>Application:</strong> Ghostwriter loads active patterns → &quot;GELERNTE STILPRÄFERENZEN&quot; block in prompt</li>
          </ol>
        </Subsection>

        <Subsection title="Confidence & Decay">
          <ul className="list-disc pl-5 space-y-1 text-sm">
            <li>Starts at 0.5 → +0.1 on &quot;Keep&quot; → −0.1 on &quot;Reject&quot;</li>
            <li>Auto-deactivation below 0.3</li>
            <li>Time decay: 0.95/week (halves every ~14 weeks)</li>
            <li>Freshness bonus: +5% if {`< 14 days`} old</li>
            <li>Effective score: <Code>base × decay × freshness_bonus</Code></li>
          </ul>
        </Subsection>

        <Subsection title="Pattern Types & Editor">
          <ul className="list-disc pl-5 space-y-1 text-sm">
            <li>Types: <Code>replacement</Code>, <Code>avoidance</Code>, <Code>preference</Code>, <Code>structure</Code>, <Code>tone</Code></li>
            <li>Editor highlighting: yellow marks on pattern hits</li>
            <li>Click → popover: Keep / Reject / Disable</li>
            <li>Max 20 active patterns with confidence ≥ 0.4 injected into the prompt</li>
          </ul>
        </Subsection>

        <FileTable files={[
          ['lib/edit-learning/history.ts', 'Edit capture & versioning'],
          ['lib/edit-learning/diff-extractor.ts', 'Sentence-level diffs, German-aware'],
          ['lib/edit-learning/retrieval.ts', 'Pattern retrieval, decay, pgvector'],
          ['app/api/cron/extract-patterns/route.ts', 'Cluster & extract (auth-protected)'],
          ['components/tiptap-editor-with-patterns.tsx', 'Editor with pattern highlights'],
        ]} />
      </Section>

      {/* ============================================ */}
      {/* STATISTICS & ANALYTICS (link alias for toc) */}
      {/* ============================================ */}
      <Section id="statistics" icon={<BarChart3 className="h-5 w-5" />} title="Statistics & Analytics (see §8)">
        <p className="text-sm text-muted-foreground">
          See <a href="#observability" className="underline">Observability &amp; Analytics</a> in the pipeline section for full details.
        </p>
      </Section>

      {/* ============================================ */}
      {/* CRON SCHEDULER */}
      {/* ============================================ */}
      <Section id="scheduler" icon={<Clock className="h-5 w-5" />} title="Cron Scheduler">
        <Subsection title="Configurable Tasks">
          <p className="text-sm text-muted-foreground mb-2">
            Vercel Cron fires <Code>/api/cron/scheduled-tasks</Code> every 30 minutes. The route compares UTC time against the Berlin/MEZ config in the DB and dispatches due tasks.
          </p>
          <ul className="list-disc pl-5 space-y-1 text-sm">
            <li><strong>newsletterFetch</strong> — in-process (not HTTP subrequest) — fixes auth stripping</li>
            <li><strong>webcrawlFetch</strong> — standalone task, independent from newsletter fetch</li>
            <li><strong>dailyAnalysis</strong> — in-process, bypasses 401 issues from subrequest chain</li>
            <li><strong>postGeneration</strong> — Ghostwriter pipeline over selected queue items</li>
            <li><strong>newsletterSend</strong> — optional, uses Resend batch API (50/batch)</li>
          </ul>
        </Subsection>

        <Subsection title="Time Handling & DST">
          <ul className="list-disc pl-5 space-y-1 text-sm">
            <li>Schedule times stored in DB as Berlin/MEZ (prevents DST drift)</li>
            <li>Scheduler converts to UTC at runtime for comparison</li>
            <li>Default slots: evening 21:00–22:00 MEZ</li>
            <li>Admin UI (<Code>/admin/settings</Code> Scheduler tab) shows hint &quot;runs every 30min&quot;</li>
          </ul>
        </Subsection>

        <FileTable files={[
          ['app/api/cron/scheduled-tasks/route.ts', 'Main scheduler (every 30 min)'],
          ['app/api/admin/schedule/route.ts', 'Schedule config CRUD'],
          ['app/api/cron/fetch-newsletters/route.ts', 'Newsletter cron task'],
          ['app/api/cron/extract-patterns/route.ts', 'Edit-learning pattern extraction'],
          ['app/api/cron/newsletter-send/route.ts', 'Cron newsletter send with retry'],
          ['vercel.json', 'Single cron: */30 * * * *'],
        ]} />
      </Section>

      {/* ============================================ */}
      {/* SEO */}
      {/* ============================================ */}
      <Section id="seo" icon={<Globe className="h-5 w-5" />} title="SEO & Sitemap">
        <Subsection title="Metadata & Rich Cards">
          <ul className="list-disc pl-5 space-y-1 text-sm">
            <li>robots.txt references <Code>www.synthszr.com</Code> as sitemap host</li>
            <li>OG image + Twitter card meta tags for link previews</li>
            <li>JSON-LD structured data (Article, BreadcrumbList, Organization)</li>
            <li>Dynamic <Code>html lang</Code> attribute per locale</li>
            <li>dateModified + breadcrumbs micro-data</li>
          </ul>
        </Subsection>

        <Subsection title="Sitemap & Redirects">
          <ul className="list-disc pl-5 space-y-1 text-sm">
            <li>Separate sitemap entries per locale (de, en) — nds/cs excluded from XML sitemap</li>
            <li>301 redirects for deleted posts</li>
            <li><Code>_next/static/</Code> + <Code>_next/image/</Code> blocked from crawlers</li>
            <li><Code>manifest.webmanifest</Code> excluded from middleware locale redirect</li>
            <li>Custom 404 page with preconnect links</li>
            <li>Google Search Console verification file</li>
          </ul>
        </Subsection>
      </Section>

      {/* ============================================ */}
      {/* STOCK & PREMARKET */}
      {/* ============================================ */}
      <Section id="stock" icon={<TrendingUp className="h-5 w-5" />} title="Stock & Premarket">
        <Subsection title="Synthszr Vote System">
          <ul className="list-disc pl-5 space-y-1 text-sm">
            <li><strong>Public:</strong> AI analysis via <Code>/api/stock-synthszr</Code> (Claude-generated, 14-day cache)</li>
            <li><strong>Premarket:</strong> data from glitch.green API via <Code>/api/premarket</Code> (per-card update button)</li>
            <li><strong>Auto-trigger:</strong> on post save all <Code>{'{Company}'}</Code> tags are detected → ratings generated</li>
            <li><strong>Batch read:</strong> <Code>/api/stock-synthszr/batch-ratings</Code> for TipTap renderer</li>
            <li>Analysis summary box on company detail page with click tracking</li>
          </ul>
        </Subsection>

        <Subsection title="Stock Quote">
          <ul className="list-disc pl-5 space-y-1 text-sm">
            <li><Code>GET /api/stock-quote?company=nvidia</Code> → EODHD real-time API</li>
            <li>140+ company → ticker mappings (US, XETRA, HK, KO)</li>
            <li>Rate-limited: 30/min per IP (standard limiter)</li>
            <li>5-minute server cache via <Code>next.revalidate</Code></li>
          </ul>
        </Subsection>

        <Subsection title="Admin Features">
          <ul className="list-disc pl-5 space-y-1 text-sm">
            <li>Cache-status display (expired / fresh) on premarket page</li>
            <li>Auto-refresh button for expired ratings</li>
            <li>Force refresh: <Code>?force=true</Code> bypasses cache</li>
          </ul>
        </Subsection>

        <FileTable files={[
          ['app/api/stock-synthszr/route.ts', 'AI rating generation + cache'],
          ['app/api/stock-quote/route.ts', 'Real-time quotes (EODHD)'],
          ['app/api/premarket/route.ts', 'Premarket from glitch.green'],
          ['lib/data/companies.ts', 'KNOWN_COMPANIES + PREMARKET dicts'],
          ['lib/data/company-exclusions.ts', 'False-positive exclusion set'],
        ]} />
      </Section>

      {/* ============================================ */}
      {/* I18N */}
      {/* ============================================ */}
      <Section id="i18n" icon={<Languages className="h-5 w-5" />} title="Internationalization">
        <Subsection title="Middleware Routing">
          <ul className="list-disc pl-5 space-y-1 text-sm">
            <li>Active locales from <Code>languages</Code> DB table (5-min cache)</li>
            <li>Default: <Code>de</Code> (German)</li>
            <li>Active: de, en, cs, nds (nds for Ostfriesland)</li>
            <li>URL prefix: <Code>/de/posts/...</Code>, <Code>/en/posts/...</Code></li>
            <li>Non-localized: /api, /admin, /login, /_next, /newsletter</li>
          </ul>
        </Subsection>

        <Subsection title="Routing Logic">
          <ul className="list-disc pl-5 space-y-1 text-sm">
            <li><strong>With locale:</strong> active → continue, inactive → 301 redirect to default</li>
            <li><strong>Without locale:</strong> geo / cookie preference → 307 redirect to locale URL</li>
            <li>Query parameters preserved on redirect (<Code>?stock=Nvidia</Code>)</li>
            <li>Cookie: <Code>synthszr_locale</Code></li>
            <li>New visitors default to DE; only US/UK get EN</li>
            <li>Subscriber language persisted when switched via home selector</li>
          </ul>
        </Subsection>

        <FileTable files={[
          ['middleware.ts', 'Locale routing + auth guards'],
          ['app/admin/languages/page.tsx', 'Language management'],
          ['app/admin/translations/page.tsx', 'Translation management'],
        ]} />
      </Section>

      {/* ============================================ */}
      {/* SECURITY ARCHITECTURE */}
      {/* ============================================ */}
      <Section id="security" icon={<Shield className="h-5 w-5" />} title="Security Architecture">
        <Subsection title="Authentication">
          <ul className="list-disc pl-5 space-y-1 text-sm">
            <li>JWT HS256 sessions via <Code>lib/auth/session.ts</Code> (min 32-char secret in prod)</li>
            <li>HttpOnly, Secure, SameSite=Lax cookie — 7-day lifetime</li>
            <li>Timing-safe password compare via <Code>timingSafeEqual</Code></li>
            <li>Middleware guards <Code>/admin/*</Code> and <Code>/api/admin/*</Code></li>
            <li>Cron endpoints: <Code>Bearer CRON_SECRET</Code> OR admin session</li>
          </ul>
        </Subsection>

        <Subsection title="Rate Limiting">
          <ul className="list-disc pl-5 space-y-1 text-sm">
            <li>Upstash Redis sliding window via <Code>lib/rate-limit.ts</Code></li>
            <li>Presets: newsletter (10/h), strict (5/min), standard (30/min), relaxed (100/min), admin (60/min), adminWrite (20/min)</li>
            <li>Production without Redis: fail-open (Redis not configured on Vercel in practice, fail-closed reverted)</li>
          </ul>
        </Subsection>

        <Subsection title="Input Validation & SSRF">
          <ul className="list-disc pl-5 space-y-1 text-sm">
            <li>Server-side URL fetches only against HTTPS + allowlist (<Code>vercel-storage.com</Code> added)</li>
            <li>Supabase queries parameterized (no SQL injection)</li>
            <li>Query params validated via <Code>parseIntParam</Code> / <Code>parseFloatParam</Code></li>
            <li>No API keys in logs or responses</li>
            <li>Admin-authored HTML sanitized via <Code>lib/security/sanitize-html.ts</Code> (DOMPurify allowlist) before <Code>dangerouslySetInnerHTML</Code> in ad-promo renderers</li>
          </ul>
        </Subsection>

        <Subsection title="CSRF Protection">
          <ul className="list-disc pl-5 space-y-1 text-sm">
            <li><Code>requireValidOrigin()</Code> (<Code>lib/security/origin-check.ts</Code>) on state-changing public POSTs</li>
            <li>Applied to: <Code>/api/newsletter/subscribe</Code>, <Code>/api/newsletter/unsubscribe</Code> (POST), <Code>/api/newsletter/set-language</Code></li>
            <li>Blocks cross-origin POSTs by checking <Code>Origin</Code> / <Code>Referer</Code> against deployment host</li>
          </ul>
        </Subsection>

        <Subsection title="Unsubscribe Flow (RFC 8058 compliant)">
          <ul className="list-disc pl-5 space-y-1 text-sm">
            <li>GET <Code>/api/newsletter/unsubscribe?id=…</Code> is side-effect free — redirects to confirmation page</li>
            <li>Confirmation page at <Code>/newsletter/unsubscribe?confirm=1&amp;id=…</Code> renders a "Yes, unsubscribe me" button</li>
            <li>Button POSTs to <Code>/api/newsletter/unsubscribe</Code> (Origin-checked, rate-limited) which performs the actual unsubscribe</li>
            <li>Prevents Outlook Safe Links / Microsoft ATP auto-unsubscribes triggered by URL prefetching during inbox scanning</li>
          </ul>
        </Subsection>

        <Subsection title="Audit history">
          <ul className="list-disc pl-5 space-y-1 text-xs text-muted-foreground">
            <li><strong className="text-foreground">2026-04-15:</strong> 8 findings all resolved — CSRF on set-language, Outlook auto-unsubscribe, stored XSS on ad-promo body, cover-image + thumbnail-image allowlist bypasses, non-timing-safe CRON_SECRET compare, ad-promo composite open-redirect, rate-limit fail-open in prod.</li>
            <li><strong className="text-foreground">2026-02-10:</strong> 6 findings all resolved — missing auth on <Code>/api/cron/extract-patterns</Code>, service-role key leak in debug-pipeline, API key fragments in TTS logs, SSRF via cover-image, missing rate-limit on stock-quote.</li>
          </ul>
          <p className="text-xs text-muted-foreground mt-3">
            Remaining accepted risks (documented, not exploitable in current deployment): <Code>x-vercel-cron</Code> header trust (Vercel-internal), <Code>ADMIN_PASSWORD</Code> JWT fallback, 30-day preference-token TTL.
          </p>
        </Subsection>
      </Section>

      {/* ============================================ */}
      {/* DATABASE SCHEMA */}
      {/* ============================================ */}
      <Section id="database" icon={<Database className="h-5 w-5" />} title="Database Overview">
        <Subsection title="Core Tables">
          <div className="overflow-x-auto">
            <table className="text-xs w-full">
              <thead>
                <tr className="border-b border-border">
                  <th className="text-left py-1 pr-4">Table</th>
                  <th className="text-left py-1">Purpose</th>
                </tr>
              </thead>
              <tbody className="text-muted-foreground">
                <tr className="border-b border-border/50"><td className="py-1 pr-4 font-mono text-foreground">posts / generated_posts</td><td className="py-1">Blog posts + AI-generated articles</td></tr>
                <tr className="border-b border-border/50"><td className="py-1 pr-4 font-mono text-foreground">daily_repo</td><td className="py-1">Ingested newsletter / webcrawl / manual articles</td></tr>
                <tr className="border-b border-border/50"><td className="py-1 pr-4 font-mono text-foreground">daily_digests</td><td className="py-1">Daily summaries</td></tr>
                <tr className="border-b border-border/50"><td className="py-1 pr-4 font-mono text-foreground">news_queue</td><td className="py-1">Article selection queue (pending → selected → used)</td></tr>
                <tr className="border-b border-border/50"><td className="py-1 pr-4 font-mono text-foreground">synthesis_candidates</td><td className="py-1">Scored candidates with metadata</td></tr>
                <tr className="border-b border-border/50"><td className="py-1 pr-4 font-mono text-foreground">developed_syntheses</td><td className="py-1">Clustered / developed topic summaries</td></tr>
                <tr className="border-b border-border/50"><td className="py-1 pr-4 font-mono text-foreground">podcast_personality_state</td><td className="py-1">Personality dimensions, phases, moments</td></tr>
                <tr className="border-b border-border/50"><td className="py-1 pr-4 font-mono text-foreground">podcast_jobs</td><td className="py-1">TTS job queue with progress</td></tr>
                <tr className="border-b border-border/50"><td className="py-1 pr-4 font-mono text-foreground">post_podcasts</td><td className="py-1">Post → audio URL mapping</td></tr>
                <tr className="border-b border-border/50"><td className="py-1 pr-4 font-mono text-foreground">audio_files</td><td className="py-1">Intro/outro file library</td></tr>
                <tr className="border-b border-border/50"><td className="py-1 pr-4 font-mono text-foreground">stock_synthszr_cache</td><td className="py-1">AI rating cache (14-day TTL)</td></tr>
                <tr className="border-b border-border/50"><td className="py-1 pr-4 font-mono text-foreground">edit_history / edit_diffs</td><td className="py-1">Edit tracking &amp; sentence diffs</td></tr>
                <tr className="border-b border-border/50"><td className="py-1 pr-4 font-mono text-foreground">learned_patterns</td><td className="py-1">Learned style patterns with confidence</td></tr>
                <tr className="border-b border-border/50"><td className="py-1 pr-4 font-mono text-foreground">translation_queue</td><td className="py-1">Per-locale translation jobs with retries</td></tr>
                <tr className="border-b border-border/50"><td className="py-1 pr-4 font-mono text-foreground">languages</td><td className="py-1">Active locales (is_active flag)</td></tr>
                <tr className="border-b border-border/50"><td className="py-1 pr-4 font-mono text-foreground">newsletter_subscribers</td><td className="py-1">Email subscribers with status + language preference</td></tr>
                <tr className="border-b border-border/50"><td className="py-1 pr-4 font-mono text-foreground">analytics_events</td><td className="py-1">Event tracking (page_view, podcast_play, analysis_click)</td></tr>
                <tr className="border-b border-border/50"><td className="py-1 pr-4 font-mono text-foreground">discovered_companies</td><td className="py-1">Auto-discovered companies from articles</td></tr>
                <tr className="border-b border-border/50"><td className="py-1 pr-4 font-mono text-foreground">ad_promos</td><td className="py-1">Admin-managed promo blocks for web + newsletter</td></tr>
                <tr className="border-b border-border/50"><td className="py-1 pr-4 font-mono text-foreground">tip_promos</td><td className="py-1">Admin-managed &quot;Tipp des Tages&quot; boxes injected before Synthszr Take</td></tr>
                <tr className="border-b border-border/50"><td className="py-1 pr-4 font-mono text-foreground">schedule_config</td><td className="py-1">Cron task configuration (Berlin/MEZ times)</td></tr>
                <tr><td className="py-1 pr-4 font-mono text-foreground">settings</td><td className="py-1">Central AI model selection, voices, feature flags</td></tr>
              </tbody>
            </table>
          </div>
        </Subsection>
      </Section>
    </div>
    </div>
  )
}

// ==========================================
// Reusable Components
// ==========================================

function TocLink({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <a
      href={href}
      className="text-muted-foreground hover:text-[color:var(--neon-yellow)] transition-colors before:content-['›_'] before:text-[color:var(--neon-orange)]/60"
    >
      {children}
    </a>
  )
}

// Neon palette — each section gets a deterministic accent derived from its id,
// so order-independent (no module-level counter that would drift across RSC renders).
const NEON_ACCENTS = ['#FFFF00', '#00FFFF', '#00FF00', '#FF4D00'] as const
function accentFor(id: string | undefined, title: string): string {
  const key = id || title
  let hash = 0
  for (let i = 0; i < key.length; i++) hash = (hash * 31 + key.charCodeAt(i)) >>> 0
  return NEON_ACCENTS[hash % NEON_ACCENTS.length]
}

function Section({ id, icon, title, children }: { id?: string; icon: React.ReactNode; title: string; children: React.ReactNode }) {
  const accent = accentFor(id, title)
  return (
    <div id={id} className="mb-12 scroll-mt-8">
      <h2 className="text-xl font-bold flex items-center gap-3 mb-5 pb-3 font-mono border-b" style={{ borderColor: `${accent}33` }}>
        <span className="inline-flex items-center justify-center h-8 w-8 rounded" style={{ color: accent, background: `${accent}12`, boxShadow: `0 0 0 1px ${accent}30` }}>
          {icon}
        </span>
        <span style={{ color: accent }}>{title}</span>
      </h2>
      <div className="space-y-5">
        {children}
      </div>
    </div>
  )
}

function Subsection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <h3 className="text-xs font-mono uppercase tracking-[0.15em] mb-2 text-[color:var(--neon-green)]">
        {title}
      </h3>
      {children}
    </div>
  )
}

function Code({ children }: { children: React.ReactNode }) {
  return (
    <code
      className="rounded px-1.5 py-0.5 text-xs font-mono"
      style={{
        background: 'color-mix(in oklab, var(--neon-yellow) 10%, transparent)',
        color: 'var(--neon-yellow)',
        border: '1px solid color-mix(in oklab, var(--neon-yellow) 25%, transparent)',
      }}
    >
      {children}
    </code>
  )
}

function FileTable({ files }: { files: [string, string][] }) {
  return (
    <div className="mt-2 rounded border overflow-hidden" style={{ borderColor: 'color-mix(in oklab, var(--neon-orange) 30%, transparent)' }}>
      <table className="text-xs w-full">
        <thead>
          <tr style={{ background: 'color-mix(in oklab, var(--neon-orange) 8%, transparent)' }}>
            <th className="text-left py-1.5 px-2 font-mono uppercase tracking-wider text-[10px] text-[color:var(--neon-orange)]">File</th>
            <th className="text-left py-1.5 px-2 font-mono uppercase tracking-wider text-[10px] text-[color:var(--neon-orange)]">Description</th>
          </tr>
        </thead>
        <tbody>
          {files.map(([file, desc]) => (
            <tr key={file} className="border-t border-border/30">
              <td className="py-1 px-2 font-mono text-foreground/90">{file}</td>
              <td className="py-1 px-2 text-muted-foreground">{desc}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}


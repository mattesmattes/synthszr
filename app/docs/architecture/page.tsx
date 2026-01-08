import { Metadata } from 'next'

export const metadata: Metadata = {
  title: 'Architecture | Synthszr',
  description: 'Technical architecture documentation for the Synthszr content automation platform',
  robots: 'noindex, nofollow',
}

export default function ArchitecturePage() {
  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-100">
      <div className="mx-auto max-w-4xl px-6 py-16">
        {/* Header */}
        <header className="mb-16">
          <div className="mb-4 font-mono text-sm text-zinc-500">
            docs / architecture
          </div>
          <h1 className="mb-4 text-4xl font-bold tracking-tight">
            Synthszr Architecture
          </h1>
          <p className="text-lg text-zinc-400">
            Technical documentation for the automated content creation pipeline.
            This document covers the system architecture, data flow, and scheduled processes.
          </p>
        </header>

        {/* Table of Contents */}
        <nav className="mb-16 rounded-lg border border-zinc-800 bg-zinc-900/50 p-6">
          <h2 className="mb-4 font-mono text-sm font-semibold uppercase tracking-wider text-zinc-500">
            Contents
          </h2>
          <ul className="space-y-2 text-sm">
            <li><a href="#overview" className="text-zinc-300 hover:text-white">1. System Overview</a></li>
            <li><a href="#pipeline" className="text-zinc-300 hover:text-white">2. Content Pipeline</a></li>
            <li><a href="#scheduler" className="text-zinc-300 hover:text-white">3. Scheduler & Cron Jobs</a></li>
            <li><a href="#newsletter-fetch" className="text-zinc-300 hover:text-white">4. Newsletter Fetching</a></li>
            <li><a href="#analysis" className="text-zinc-300 hover:text-white">5. Daily Analysis & Synthesis</a></li>
            <li><a href="#post-generation" className="text-zinc-300 hover:text-white">6. AI Post Generation</a></li>
            <li><a href="#data-model" className="text-zinc-300 hover:text-white">7. Data Model</a></li>
            <li><a href="#api-routes" className="text-zinc-300 hover:text-white">8. API Routes</a></li>
          </ul>
        </nav>

        {/* Section 1: Overview */}
        <section id="overview" className="mb-16">
          <h2 className="mb-6 text-2xl font-bold">1. System Overview</h2>
          <p className="mb-6 text-zinc-400">
            Synthszr is an automated content creation platform that transforms newsletter content
            into synthesized blog posts. The system runs on a daily schedule, collecting content
            from various newsletter sources, analyzing trends, generating syntheses, and producing
            AI-written blog posts.
          </p>

          <div className="mb-6 overflow-x-auto rounded-lg border border-zinc-800 bg-zinc-900 p-4">
            <pre className="font-mono text-xs text-zinc-300">{`
┌─────────────────────────────────────────────────────────────────────────┐
│                        SYNTHSZR ARCHITECTURE                            │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│   ┌─────────────┐     ┌─────────────┐     ┌─────────────┐              │
│   │  Gmail API  │     │  Article    │     │   Supabase  │              │
│   │  (Newsletters)│    │  Scraper    │     │  (Database) │              │
│   └──────┬──────┘     └──────┬──────┘     └──────┬──────┘              │
│          │                   │                   │                      │
│          └─────────┬─────────┘                   │                      │
│                    ▼                             │                      │
│          ┌─────────────────┐                     │                      │
│          │   Daily Repo    │◄────────────────────┤                      │
│          │ (Raw Content)   │                     │                      │
│          └────────┬────────┘                     │                      │
│                   │                              │                      │
│                   ▼                              │                      │
│          ┌─────────────────┐                     │                      │
│          │  AI Analysis    │                     │                      │
│          │  (Claude API)   │                     │                      │
│          └────────┬────────┘                     │                      │
│                   │                              │                      │
│                   ▼                              │                      │
│          ┌─────────────────┐                     │                      │
│          │  Daily Digest   │─────────────────────┤                      │
│          │  + Syntheses    │                     │                      │
│          └────────┬────────┘                     │                      │
│                   │                              │                      │
│                   ▼                              │                      │
│          ┌─────────────────┐                     │                      │
│          │  Ghostwriter    │                     │                      │
│          │  (Blog Post)    │                     │                      │
│          └────────┬────────┘                     │                      │
│                   │                              │                      │
│                   ▼                              │                      │
│          ┌─────────────────┐     ┌─────────────┐│                      │
│          │ Generated Post  │────▶│  Vercel Blob ││                      │
│          │ (Draft/Published)│     │  (Images)   ││                      │
│          └─────────────────┘     └─────────────┘│                      │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
            `}</pre>
          </div>

          <h3 className="mb-3 text-lg font-semibold">Tech Stack</h3>
          <ul className="mb-6 space-y-2 text-zinc-400">
            <li><span className="text-zinc-200">Framework:</span> Next.js 16 (App Router)</li>
            <li><span className="text-zinc-200">Database:</span> Supabase (PostgreSQL)</li>
            <li><span className="text-zinc-200">AI Models:</span> Claude (Anthropic), GPT-4 (OpenAI)</li>
            <li><span className="text-zinc-200">Storage:</span> Vercel Blob</li>
            <li><span className="text-zinc-200">Email:</span> Gmail API (fetch), Resend (send)</li>
            <li><span className="text-zinc-200">Hosting:</span> Vercel</li>
          </ul>
        </section>

        {/* Section 2: Pipeline */}
        <section id="pipeline" className="mb-16">
          <h2 className="mb-6 text-2xl font-bold">2. Content Pipeline</h2>
          <p className="mb-6 text-zinc-400">
            The content pipeline runs daily and consists of four sequential stages.
            Each stage depends on the successful completion of the previous one.
          </p>

          <div className="mb-6 overflow-x-auto rounded-lg border border-zinc-800 bg-zinc-900 p-4">
            <pre className="font-mono text-xs text-zinc-300">{`
DAILY CONTENT PIPELINE (04:00 UTC)
══════════════════════════════════════════════════════════════════════════

  Stage 1                Stage 2                Stage 3                Stage 4
┌──────────────┐    ┌──────────────┐    ┌──────────────┐    ┌──────────────┐
│  NEWSLETTER  │    │    DAILY     │    │     POST     │    │  NEWSLETTER  │
│    FETCH     │───▶│   ANALYSIS   │───▶│  GENERATION  │───▶│    SEND      │
│              │    │  + SYNTHESES │    │              │    │  (optional)  │
└──────────────┘    └──────────────┘    └──────────────┘    └──────────────┘
       │                   │                   │                   │
       ▼                   ▼                   ▼                   ▼
  ┌─────────┐        ┌─────────┐        ┌─────────┐        ┌─────────┐
  │daily_repo│        │daily_   │        │generated│        │ Resend  │
  │         │        │digests  │        │_posts   │        │  API    │
  └─────────┘        └─────────┘        └─────────┘        └─────────┘


DEPENDENCY CHAIN:
─────────────────
  Newsletter Fetch ──┬─▶ Daily Analysis ──┬─▶ Post Generation
                     │                    │
                     │   (requires        │   (requires
                     │    completed       │    completed
                     │    or skipped)     │    or already_ran)

STATUS VALUES:
──────────────
  ✓ completed              - Task finished successfully
  ✓ already_ran            - Task ran earlier (within 60 min)
  ✓ skipped                - Task was skipped (not scheduled)
  ✗ error                  - Task failed
  ⊘ skipped_dependency_failed - Skipped due to previous failure
            `}</pre>
          </div>
        </section>

        {/* Section 3: Scheduler */}
        <section id="scheduler" className="mb-16">
          <h2 className="mb-6 text-2xl font-bold">3. Scheduler & Cron Jobs</h2>
          <p className="mb-6 text-zinc-400">
            The scheduler is triggered by Vercel Cron at 04:00 UTC daily. It orchestrates
            all content pipeline tasks in sequence, ensuring proper dependency handling.
          </p>

          <div className="mb-6 overflow-x-auto rounded-lg border border-zinc-800 bg-zinc-900 p-4">
            <pre className="font-mono text-xs text-zinc-300">{`
vercel.json
───────────────────────────────────────────────────
{
  "crons": [
    {
      "path": "/api/cron/scheduled-tasks?runAll=true",
      "schedule": "0 4 * * *"
    }
  ]
}


SCHEDULER FLOW (/api/cron/scheduled-tasks)
───────────────────────────────────────────────────

   Vercel Cron (04:00 UTC)
          │
          ▼
┌─────────────────────────────────────────────────┐
│           scheduled-tasks Handler               │
│                                                 │
│  1. Verify CRON_SECRET                          │
│  2. Load schedule_config from DB                │
│  3. Check hasRunRecently for each task          │
│                                                 │
│  for each task in [fetch, analysis, post]:     │
│    ├─ if dependency failed → skip              │
│    ├─ if recently ran → skip                   │
│    └─ else → execute directly (no HTTP call)   │
│                                                 │
│  4. Return results JSON                         │
└─────────────────────────────────────────────────┘


CONFIGURATION (settings.schedule_config)
───────────────────────────────────────────────────
{
  "newsletterFetch": { "enabled": true,  "hour": 4, "minute": 0  },
  "dailyAnalysis":   { "enabled": true,  "hour": 4, "minute": 20 },
  "postGeneration":  { "enabled": true,  "hour": 4, "minute": 50 },
  "newsletterSend":  { "enabled": false, "hour": 8, "minute": 30 }
}
            `}</pre>
          </div>

          <div className="rounded-lg border border-amber-900/50 bg-amber-950/20 p-4">
            <h4 className="mb-2 font-semibold text-amber-400">Note: runAll Mode</h4>
            <p className="text-sm text-zinc-400">
              When <code className="rounded bg-zinc-800 px-1">runAll=true</code> is passed,
              all enabled tasks run regardless of their scheduled time. This is used for the
              daily cron on Vercel Hobby plan (which only allows 1 cron invocation per day).
            </p>
          </div>
        </section>

        {/* Section 4: Newsletter Fetch */}
        <section id="newsletter-fetch" className="mb-16">
          <h2 className="mb-6 text-2xl font-bold">4. Newsletter Fetching</h2>
          <p className="mb-6 text-zinc-400">
            The newsletter fetching process collects emails from configured sources via Gmail API,
            extracts article links, and stores both newsletters and articles in the daily_repo table.
          </p>

          <div className="mb-6 overflow-x-auto rounded-lg border border-zinc-800 bg-zinc-900 p-4">
            <pre className="font-mono text-xs text-zinc-300">{`
NEWSLETTER FETCH PROCESS (lib/newsletter/processor.ts)
═══════════════════════════════════════════════════════════════════════════

                    ┌────────────────────┐
                    │  Gmail API         │
                    │  (OAuth2 Refresh)  │
                    └─────────┬──────────┘
                              │
              ┌───────────────┴───────────────┐
              ▼                               ▼
    ┌─────────────────┐             ┌─────────────────┐
    │ Fetch by Sender │             │ Fetch by Subject│
    │ (50 max)        │             │ "+dailyrepo" tag│
    └────────┬────────┘             └────────┬────────┘
             │                               │
             └───────────┬───────────────────┘
                         │
                         ▼
              ┌─────────────────────┐
              │   Deduplicate by    │
              │   Message ID        │
              └─────────┬───────────┘
                        │
                        ▼
           ┌────────────────────────┐
           │  For each email:       │
           │  ├─ Check if exists    │
           │  ├─ Parse HTML content │
           │  ├─ Extract article    │
           │  │   links             │
           │  └─ Store in daily_repo│
           └────────────┬───────────┘
                        │
                        ▼
           ┌────────────────────────┐
           │  Process article URLs  │
           │  (25 max per run):     │
           │  ├─ Check if exists    │
           │  ├─ Fetch & extract    │
           │  │   (readability.js)  │
           │  ├─ Resolve redirects  │
           │  └─ Store in daily_repo│
           └────────────────────────┘


DATA STORED (daily_repo table)
═══════════════════════════════════════════════════════════════════════════

  source_type     │ 'newsletter' or 'article'
  source_email    │ Sender email (for newsletters)
  source_url      │ Article URL / primary link
  title           │ Subject or article title
  content         │ Full text content
  raw_html        │ Original HTML (newsletters only)
  newsletter_date │ Date of the source
            `}</pre>
          </div>
        </section>

        {/* Section 5: Analysis */}
        <section id="analysis" className="mb-16">
          <h2 className="mb-6 text-2xl font-bold">5. Daily Analysis & Synthesis</h2>
          <p className="mb-6 text-zinc-400">
            The analysis phase uses AI to summarize collected content and generate
            synthesized insights ("Synthszr Takes") that are stored for later use.
          </p>

          <div className="mb-6 overflow-x-auto rounded-lg border border-zinc-800 bg-zinc-900 p-4">
            <pre className="font-mono text-xs text-zinc-300">{`
ANALYSIS PIPELINE
═══════════════════════════════════════════════════════════════════════════

  ┌─────────────────────────────────────────────────────────────────────┐
  │  runDailyAnalysisAndSynthesis()                                      │
  └─────────────────────────────────────────────────────────────────────┘
                                    │
       ┌────────────────────────────┼────────────────────────────────┐
       ▼                            ▼                                ▼
  ┌─────────┐               ┌─────────────┐                  ┌─────────────┐
  │ Check   │               │ Fetch items │                  │ Check for   │
  │ existing│               │ from        │                  │ existing    │
  │ digest  │               │ daily_repo  │                  │ syntheses   │
  └────┬────┘               └──────┬──────┘                  └──────┬──────┘
       │                           │                                │
       │ exists?                   │                                │
       ├─── yes ──────────────────▶├────────────────────────────────┘
       │                           │
       │ no                        ▼
       │                  ┌─────────────────┐
       └─────────────────▶│  /api/analyze   │
                          │  (Claude API)   │
                          │                 │
                          │  SSE Stream:    │
                          │  ├─ sources     │
                          │  └─ text chunks │
                          └────────┬────────┘
                                   │
                                   ▼
                          ┌─────────────────┐
                          │  Save to        │
                          │  daily_digests  │
                          │                 │
                          │  ├─ digest_date │
                          │  ├─ analysis_   │
                          │  │   content    │
                          │  └─ sources_used│
                          └────────┬────────┘
                                   │
                                   ▼
                          ┌─────────────────┐
                          │ runSynthesis-   │
                          │ Pipeline()      │
                          │                 │
                          │ For each topic: │
                          │ ├─ Generate     │
                          │ │   synthesis   │
                          │ ├─ Create rating│
                          │ │   (Stock-     │
                          │ │    Synthszr)  │
                          │ └─ Store in     │
                          │    developed_   │
                          │    syntheses    │
                          └─────────────────┘


SYNTHESIS OUTPUT (developed_syntheses table)
═══════════════════════════════════════════════════════════════════════════

  Each synthesis includes:
  ├─ topic_name      │ "OpenAI", "Microsoft", etc.
  ├─ synthesis_text  │ AI-generated insight (markdown)
  ├─ source_refs     │ Array of source IDs
  └─ rating_data     │ Stock-Synthszr recommendation (if applicable)
            `}</pre>
          </div>
        </section>

        {/* Section 6: Post Generation */}
        <section id="post-generation" className="mb-16">
          <h2 className="mb-6 text-2xl font-bold">6. AI Post Generation</h2>
          <p className="mb-6 text-zinc-400">
            The Ghostwriter transforms the daily digest into a polished blog post,
            applying vocabulary replacements and generating accompanying images.
          </p>

          <div className="mb-6 overflow-x-auto rounded-lg border border-zinc-800 bg-zinc-900 p-4">
            <pre className="font-mono text-xs text-zinc-300">{`
POST GENERATION (generateDailyPost)
═══════════════════════════════════════════════════════════════════════════

  ┌─────────────────┐
  │  Latest Digest  │
  │  (daily_digests)│
  └────────┬────────┘
           │
           ▼
  ┌─────────────────┐     ┌─────────────────────────────────────────────┐
  │  Check if post  │     │  If exists → return early                   │
  │  already exists │     │  (prevent duplicate generation)             │
  └────────┬────────┘     └─────────────────────────────────────────────┘
           │
           │ new
           ▼
  ┌─────────────────┐     ┌─────────────────────────────────────────────┐
  │  Load prompts   │     │  ├─ ghostwriter_prompts (active)            │
  │  and vocabulary │     │  └─ vocabulary (enabled words)              │
  └────────┬────────┘     └─────────────────────────────────────────────┘
           │
           ▼
  ┌─────────────────┐
  │  /api/ghostwriter│
  │  (Claude API)    │
  │                  │
  │  Input:          │
  │  ├─ digest       │
  │  ├─ custom prompt│
  │  └─ vocab rules  │
  │                  │
  │  Output:         │
  │  └─ SSE stream   │
  │     (markdown)   │
  └────────┬─────────┘
           │
           ▼
  ┌─────────────────┐
  │  Post-process   │
  │  ├─ Apply vocab │
  │  │   replacements│
  │  ├─ Extract     │
  │  │   title      │
  │  └─ Convert to  │
  │     TipTap JSON │
  └────────┬────────┘
           │
           ▼
  ┌─────────────────┐
  │  Save to        │
  │  generated_posts│
  │                 │
  │  ├─ digest_id   │
  │  ├─ title       │
  │  ├─ content     │
  │  ├─ word_count  │
  │  └─ status:draft│
  └────────┬────────┘
           │
           ▼
  ┌─────────────────┐
  │  /api/generate- │
  │  image (async)  │
  │                 │
  │  For 3 sections:│
  │  └─ Generate    │
  │     AI image    │
  │     (Gemini)    │
  └─────────────────┘


POST STATUSES
═══════════════════════════════════════════════════════════════════════════

  draft     │ Generated, not reviewed
  published │ Ready for public, can be sent via newsletter
  archived  │ Removed from public view
            `}</pre>
          </div>
        </section>

        {/* Section 7: Data Model */}
        <section id="data-model" className="mb-16">
          <h2 className="mb-6 text-2xl font-bold">7. Data Model</h2>
          <p className="mb-6 text-zinc-400">
            The system uses Supabase (PostgreSQL) with the following core tables
            for content management.
          </p>

          <div className="mb-6 overflow-x-auto rounded-lg border border-zinc-800 bg-zinc-900 p-4">
            <pre className="font-mono text-xs text-zinc-300">{`
DATABASE SCHEMA (Core Tables)
═══════════════════════════════════════════════════════════════════════════

┌─────────────────────────────────────────────────────────────────────────┐
│  daily_repo                                                             │
├─────────────────────────────────────────────────────────────────────────┤
│  id               UUID PRIMARY KEY                                      │
│  source_type      TEXT ('newsletter' | 'article')                       │
│  source_email     TEXT                                                  │
│  source_url       TEXT                                                  │
│  title            TEXT                                                  │
│  content          TEXT                                                  │
│  raw_html         TEXT                                                  │
│  newsletter_date  DATE                                                  │
│  collected_at     TIMESTAMPTZ DEFAULT NOW()                             │
│  embedding        VECTOR(1536)                                          │
└─────────────────────────────────────────────────────────────────────────┘
                                    │
                                    │ analyzed into
                                    ▼
┌─────────────────────────────────────────────────────────────────────────┐
│  daily_digests                                                          │
├─────────────────────────────────────────────────────────────────────────┤
│  id               UUID PRIMARY KEY                                      │
│  digest_date      DATE UNIQUE                                           │
│  analysis_content TEXT                                                  │
│  word_count       INTEGER                                               │
│  sources_used     UUID[]                                                │
│  created_at       TIMESTAMPTZ DEFAULT NOW()                             │
└─────────────────────────────────────────────────────────────────────────┘
          │                                      │
          │ generates                            │ creates
          ▼                                      ▼
┌──────────────────────────┐    ┌─────────────────────────────────────────┐
│  generated_posts         │    │  developed_syntheses                    │
├──────────────────────────┤    ├─────────────────────────────────────────┤
│  id          UUID PK     │    │  id            UUID PK                  │
│  digest_id   UUID FK     │    │  digest_id     UUID FK                  │
│  title       TEXT        │    │  topic_name    TEXT                     │
│  content     JSONB       │    │  synthesis_text TEXT                    │
│  word_count  INTEGER     │    │  source_refs   UUID[]                   │
│  status      TEXT        │    │  rating_data   JSONB                    │
│  created_at  TIMESTAMPTZ │    │  created_at    TIMESTAMPTZ              │
└──────────────────────────┘    └─────────────────────────────────────────┘


SUPPORTING TABLES
═══════════════════════════════════════════════════════════════════════════

  newsletter_sources    │ Email sources to fetch from Gmail
  gmail_tokens          │ OAuth2 refresh tokens for Gmail API
  analysis_prompts      │ Customizable prompts for daily analysis
  ghostwriter_prompts   │ Prompts for blog post generation
  synthesis_prompts     │ Prompts for creating syntheses
  image_prompts         │ Prompts for AI image generation
  vocabulary            │ Word replacements for brand voice
  settings              │ Runtime configuration (schedule, last_run, etc.)
  subscribers           │ Newsletter subscriber list
            `}</pre>
          </div>
        </section>

        {/* Section 8: API Routes */}
        <section id="api-routes" className="mb-16">
          <h2 className="mb-6 text-2xl font-bold">8. API Routes</h2>
          <p className="mb-6 text-zinc-400">
            Key API endpoints for the content pipeline. All cron routes require
            CRON_SECRET authentication in production.
          </p>

          <div className="mb-6 overflow-x-auto rounded-lg border border-zinc-800 bg-zinc-900 p-4">
            <pre className="font-mono text-xs text-zinc-300">{`
API ROUTES
═══════════════════════════════════════════════════════════════════════════

CRON / SCHEDULED TASKS
──────────────────────────────────────────────────────────────────────────
GET  /api/cron/scheduled-tasks   │ Main scheduler (runAll mode)
GET  /api/cron/fetch-newsletters │ Standalone newsletter fetch
POST /api/cron/newsletter-send   │ Send newsletter to subscribers

CONTENT GENERATION
──────────────────────────────────────────────────────────────────────────
POST /api/analyze                │ AI analysis of daily_repo content
                                 │ → SSE stream response
POST /api/ghostwriter            │ Generate blog post from digest
                                 │ → SSE stream response
PUT  /api/generate-image         │ Generate images for post sections
                                 │ → Async (fire-and-forget)

DATA ACCESS
──────────────────────────────────────────────────────────────────────────
GET  /api/stock-quote            │ Fetch stock data for ratings
GET  /api/stock-synthszr         │ Get AI stock recommendations
GET  /api/batch-ratings          │ Batch fetch multiple ratings

ADMIN (Requires Session)
──────────────────────────────────────────────────────────────────────────
POST /api/admin/newsletter-send  │ Manual newsletter send
POST /api/admin/trigger-schedule │ Manual scheduler trigger


AUTHENTICATION
═══════════════════════════════════════════════════════════════════════════

  Cron Routes:      Authorization: Bearer {CRON_SECRET}
  Admin Routes:     Session cookie (JWT via jose)
  Public Routes:    No auth required
            `}</pre>
          </div>
        </section>

        {/* Footer */}
        <footer className="border-t border-zinc-800 pt-8">
          <p className="text-sm text-zinc-500">
            Last updated: {new Date().toLocaleDateString('en-US', {
              year: 'numeric',
              month: 'long',
              day: 'numeric'
            })}
          </p>
        </footer>
      </div>
    </div>
  )
}

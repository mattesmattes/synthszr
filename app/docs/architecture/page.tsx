import { Metadata } from 'next'

export const metadata: Metadata = {
  title: 'Architecture | Synthszr',
  description: 'Technical architecture documentation for the Synthszr content automation platform',
  robots: 'noindex, nofollow',
}

// Diagram Components
function FlowBox({ children, variant = 'default', className = '' }: {
  children: React.ReactNode
  variant?: 'default' | 'primary' | 'success' | 'warning' | 'muted'
  className?: string
}) {
  const variants = {
    default: 'border-zinc-700 bg-zinc-800/80',
    primary: 'border-blue-600 bg-blue-950/50',
    success: 'border-emerald-600 bg-emerald-950/50',
    warning: 'border-amber-600 bg-amber-950/50',
    muted: 'border-zinc-700/50 bg-zinc-900/50 text-zinc-500',
  }
  return (
    <div className={`rounded-lg border p-3 text-center text-sm ${variants[variant]} ${className}`}>
      {children}
    </div>
  )
}

function Arrow({ direction = 'down' }: { direction?: 'down' | 'right' | 'left' }) {
  const arrows = {
    down: '↓',
    right: '→',
    left: '←',
  }
  return <div className="text-zinc-500 text-xl font-light py-1">{arrows[direction]}</div>
}

function DiagramContainer({ children, title }: { children: React.ReactNode; title?: string }) {
  return (
    <div className="mb-8 rounded-xl border border-zinc-800 bg-zinc-900/30 p-6">
      {title && <div className="mb-4 text-xs font-semibold uppercase tracking-wider text-zinc-500">{title}</div>}
      {children}
    </div>
  )
}

export default function ArchitecturePage() {
  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-100">
      <div className="mx-auto max-w-5xl px-6 py-16">
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
            This document covers the system architecture, data flow, scheduled processes,
            stock analysis integration, and security measures.
          </p>
        </header>

        {/* Table of Contents */}
        <nav className="mb-16 rounded-lg border border-zinc-800 bg-zinc-900/50 p-6">
          <h2 className="mb-4 font-mono text-sm font-semibold uppercase tracking-wider text-zinc-500">
            Contents
          </h2>
          <ul className="grid grid-cols-2 gap-2 text-sm">
            <li><a href="#overview" className="text-zinc-300 hover:text-white">1. System Overview</a></li>
            <li><a href="#pipeline" className="text-zinc-300 hover:text-white">2. Content Pipeline</a></li>
            <li><a href="#scheduler" className="text-zinc-300 hover:text-white">3. Scheduler & Cron Jobs</a></li>
            <li><a href="#newsletter-fetch" className="text-zinc-300 hover:text-white">4. Newsletter Fetching</a></li>
            <li><a href="#analysis" className="text-zinc-300 hover:text-white">5. Daily Analysis & Synthesis</a></li>
            <li><a href="#news-queue" className="text-zinc-300 hover:text-white">6. News Queue & Article Selection</a></li>
            <li><a href="#post-generation" className="text-zinc-300 hover:text-white">7. AI Post Generation</a></li>
            <li><a href="#edit-learning" className="text-zinc-300 hover:text-white">8. Edit Learning System</a></li>
            <li><a href="#stock-synthszr" className="text-zinc-300 hover:text-white">9. Stock Values & Stock-Synthszr</a></li>
            <li><a href="#translations" className="text-zinc-300 hover:text-white">10. Translation System (i18n)</a></li>
            <li><a href="#data-model" className="text-zinc-300 hover:text-white">11. Data Model</a></li>
            <li><a href="#security" className="text-zinc-300 hover:text-white">12. Security & Tech Debt</a></li>
            <li><a href="#api-routes" className="text-zinc-300 hover:text-white">13. API Routes</a></li>
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

          <DiagramContainer title="High-Level Architecture">
            <div className="grid grid-cols-5 gap-4 items-center">
              {/* Sources */}
              <div className="space-y-2">
                <FlowBox variant="muted">Gmail API</FlowBox>
                <FlowBox variant="muted">Article Scraper</FlowBox>
                <FlowBox variant="muted">EODHD API</FlowBox>
              </div>

              <div className="flex justify-center">
                <Arrow direction="right" />
              </div>

              {/* Processing */}
              <div className="space-y-2">
                <FlowBox variant="primary">Daily Repo</FlowBox>
                <FlowBox variant="primary">AI Analysis</FlowBox>
                <FlowBox variant="primary">Stock-Synthszr</FlowBox>
              </div>

              <div className="flex justify-center">
                <Arrow direction="right" />
              </div>

              {/* Output */}
              <div className="space-y-2">
                <FlowBox variant="success">Blog Posts</FlowBox>
                <FlowBox variant="success">Digests</FlowBox>
                <FlowBox variant="success">Ratings</FlowBox>
              </div>
            </div>
          </DiagramContainer>

          <h3 className="mb-3 text-lg font-semibold">Tech Stack</h3>
          <div className="grid grid-cols-2 gap-4 text-sm">
            <div className="rounded-lg border border-zinc-800 bg-zinc-900/50 p-4">
              <div className="font-semibold text-zinc-200 mb-2">Core</div>
              <ul className="space-y-1 text-zinc-400">
                <li>• Next.js 16 (App Router)</li>
                <li>• Supabase (PostgreSQL)</li>
                <li>• Vercel (Hosting & Cron)</li>
                <li>• Vercel Blob (Images)</li>
              </ul>
            </div>
            <div className="rounded-lg border border-zinc-800 bg-zinc-900/50 p-4">
              <div className="font-semibold text-zinc-200 mb-2">AI & APIs</div>
              <ul className="space-y-1 text-zinc-400">
                <li>• Claude (Anthropic) - Analysis</li>
                <li>• GPT-5 (OpenAI) - Stock-Synthszr</li>
                <li>• Gemini (Google) - Images</li>
                <li>• EODHD - Stock Quotes</li>
              </ul>
            </div>
          </div>
        </section>

        {/* Section 2: Pipeline */}
        <section id="pipeline" className="mb-16">
          <h2 className="mb-6 text-2xl font-bold">2. Content Pipeline</h2>
          <p className="mb-6 text-zinc-400">
            The content pipeline runs daily at 04:00 UTC and consists of four sequential stages.
            Each stage depends on the successful completion of the previous one.
          </p>

          <DiagramContainer title="Daily Pipeline Flow (04:00 UTC)">
            <div className="flex items-center justify-between gap-2">
              <div className="flex-1">
                <FlowBox variant="primary">
                  <div className="font-semibold">Stage 1</div>
                  <div className="text-xs mt-1">Newsletter Fetch</div>
                </FlowBox>
                <div className="text-xs text-center mt-2 text-zinc-500">→ daily_repo</div>
              </div>

              <div className="text-2xl text-zinc-600">→</div>

              <div className="flex-1">
                <FlowBox variant="primary">
                  <div className="font-semibold">Stage 2</div>
                  <div className="text-xs mt-1">Daily Analysis</div>
                </FlowBox>
                <div className="text-xs text-center mt-2 text-zinc-500">→ daily_digests</div>
              </div>

              <div className="text-2xl text-zinc-600">→</div>

              <div className="flex-1">
                <FlowBox variant="primary">
                  <div className="font-semibold">Stage 3</div>
                  <div className="text-xs mt-1">Post Generation</div>
                </FlowBox>
                <div className="text-xs text-center mt-2 text-zinc-500">→ generated_posts</div>
              </div>

              <div className="text-2xl text-zinc-600">→</div>

              <div className="flex-1">
                <FlowBox variant="muted">
                  <div className="font-semibold">Stage 4</div>
                  <div className="text-xs mt-1">Newsletter Send</div>
                </FlowBox>
                <div className="text-xs text-center mt-2 text-zinc-500">(optional)</div>
              </div>
            </div>
          </DiagramContainer>

          <div className="rounded-lg border border-zinc-800 bg-zinc-900/50 p-4 mb-6">
            <h4 className="font-semibold mb-3">Dependency Chain</h4>
            <div className="grid grid-cols-3 gap-4 text-sm">
              <div className="text-center">
                <div className="text-emerald-400 font-mono">Newsletter Fetch</div>
                <div className="text-zinc-500 text-xs mt-1">Must: completed | skipped | already_ran</div>
              </div>
              <div className="text-center">
                <div className="text-emerald-400 font-mono">Daily Analysis</div>
                <div className="text-zinc-500 text-xs mt-1">Must: completed | already_ran</div>
              </div>
              <div className="text-center">
                <div className="text-emerald-400 font-mono">Post Generation</div>
                <div className="text-zinc-500 text-xs mt-1">Final output</div>
              </div>
            </div>
          </div>

          <h4 className="font-semibold mb-2">Status Values</h4>
          <div className="grid grid-cols-2 gap-2 text-sm">
            <div className="flex items-center gap-2"><span className="text-emerald-400">✓</span> <code className="bg-zinc-800 px-2 py-0.5 rounded">completed</code> Task finished successfully</div>
            <div className="flex items-center gap-2"><span className="text-emerald-400">✓</span> <code className="bg-zinc-800 px-2 py-0.5 rounded">already_ran</code> Task ran earlier (60 min)</div>
            <div className="flex items-center gap-2"><span className="text-amber-400">○</span> <code className="bg-zinc-800 px-2 py-0.5 rounded">skipped</code> Task not scheduled</div>
            <div className="flex items-center gap-2"><span className="text-red-400">✗</span> <code className="bg-zinc-800 px-2 py-0.5 rounded">skipped_dependency_failed</code> Previous failure</div>
          </div>
        </section>

        {/* Section 3: Scheduler */}
        <section id="scheduler" className="mb-16">
          <h2 className="mb-6 text-2xl font-bold">3. Scheduler & Cron Jobs</h2>
          <p className="mb-6 text-zinc-400">
            The scheduler is triggered by Vercel Cron at 04:00 UTC daily. It orchestrates
            all content pipeline tasks in sequence, ensuring proper dependency handling.
          </p>

          <DiagramContainer title="Scheduler Flow">
            <div className="flex flex-col items-center gap-2">
              <FlowBox variant="warning" className="w-64">
                <div className="font-semibold">Vercel Cron</div>
                <div className="text-xs">04:00 UTC daily</div>
              </FlowBox>
              <Arrow />
              <FlowBox variant="default" className="w-64">
                <div className="font-semibold">/api/cron/scheduled-tasks</div>
                <div className="text-xs">?runAll=true</div>
              </FlowBox>
              <Arrow />
              <div className="grid grid-cols-3 gap-4 w-full max-w-xl">
                <FlowBox>1. Verify CRON_SECRET</FlowBox>
                <FlowBox>2. Load schedule_config</FlowBox>
                <FlowBox>3. Check hasRunRecently</FlowBox>
              </div>
              <Arrow />
              <FlowBox variant="success" className="w-64">
                Execute tasks in sequence<br/>
                <span className="text-xs">(direct function calls, no HTTP)</span>
              </FlowBox>
            </div>
          </DiagramContainer>

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

          <DiagramContainer title="Newsletter Fetch Process">
            <div className="flex flex-col items-center gap-2">
              <div className="grid grid-cols-2 gap-4 w-full max-w-md">
                <FlowBox variant="muted">
                  <div className="text-xs">Gmail API</div>
                  <div className="font-semibold">Fetch by Sender</div>
                  <div className="text-xs">50 max</div>
                </FlowBox>
                <FlowBox variant="muted">
                  <div className="text-xs">Gmail API</div>
                  <div className="font-semibold">+dailyrepo Tag</div>
                  <div className="text-xs">User-tagged</div>
                </FlowBox>
              </div>
              <Arrow />
              <FlowBox className="w-48">Deduplicate by ID</FlowBox>
              <Arrow />
              <FlowBox variant="primary" className="w-64">
                <div className="font-semibold">Parse & Extract</div>
                <div className="text-xs">HTML → Text, Extract article links</div>
              </FlowBox>
              <Arrow />
              <div className="grid grid-cols-2 gap-4 w-full max-w-md">
                <FlowBox variant="success">
                  <div className="font-semibold">Newsletters</div>
                  <div className="text-xs">→ daily_repo</div>
                </FlowBox>
                <FlowBox variant="success">
                  <div className="font-semibold">Articles</div>
                  <div className="text-xs">25 max, readability.js</div>
                </FlowBox>
              </div>
            </div>
          </DiagramContainer>
        </section>

        {/* Section 5: Analysis */}
        <section id="analysis" className="mb-16">
          <h2 className="mb-6 text-2xl font-bold">5. Daily Analysis & Synthesis</h2>
          <p className="mb-6 text-zinc-400">
            The analysis phase uses Claude AI to summarize collected content and generate
            synthesized insights (&quot;Synthszr Takes&quot;) that are stored for later use.
          </p>

          <DiagramContainer title="Analysis Pipeline">
            <div className="flex flex-col items-center gap-2">
              <FlowBox variant="muted" className="w-64">
                <div className="font-semibold">daily_repo</div>
                <div className="text-xs">Raw newsletters & articles</div>
              </FlowBox>
              <Arrow />
              <FlowBox variant="primary" className="w-64">
                <div className="font-semibold">/api/analyze</div>
                <div className="text-xs">Claude API (SSE Stream)</div>
              </FlowBox>
              <Arrow />
              <FlowBox variant="success" className="w-64">
                <div className="font-semibold">daily_digests</div>
                <div className="text-xs">analysis_content, sources_used</div>
              </FlowBox>
              <Arrow />
              <FlowBox variant="primary" className="w-64">
                <div className="font-semibold">runSynthesisPipeline()</div>
                <div className="text-xs">For each topic</div>
              </FlowBox>
              <Arrow />
              <FlowBox variant="success" className="w-64">
                <div className="font-semibold">developed_syntheses</div>
                <div className="text-xs">topic_name, synthesis_text, rating_data</div>
              </FlowBox>
            </div>
          </DiagramContainer>
        </section>

        {/* Section 6: News Queue & Article Selection */}
        <section id="news-queue" className="mb-16">
          <h2 className="mb-6 text-2xl font-bold">6. News Queue & Article Selection</h2>
          <p className="mb-6 text-zinc-400">
            The News Queue system manages article selection for AI blog post generation.
            It provides scoring, source diversification, and manual curation capabilities
            to ensure high-quality content selection.
          </p>

          <DiagramContainer title="News Queue Flow">
            <div className="flex flex-col items-center gap-2">
              <FlowBox variant="muted" className="w-64">
                <div className="font-semibold">daily_repo</div>
                <div className="text-xs">Raw newsletters & articles</div>
              </FlowBox>
              <Arrow />
              <FlowBox variant="primary" className="w-64">
                <div className="font-semibold">Add to Queue</div>
                <div className="text-xs">queueFromDailyRepo()</div>
              </FlowBox>
              <Arrow />
              <FlowBox className="w-64">
                <div className="font-semibold">news_queue</div>
                <div className="text-xs">status: pending</div>
              </FlowBox>
              <Arrow />
              <div className="grid grid-cols-2 gap-4 w-full max-w-md">
                <FlowBox variant="warning">
                  <div className="font-semibold">Manual Selection</div>
                  <div className="text-xs">Admin UI ranking</div>
                </FlowBox>
                <FlowBox variant="muted">
                  <div className="font-semibold">Auto Selection</div>
                  <div className="text-xs">getBalancedSelection()</div>
                </FlowBox>
              </div>
              <Arrow />
              <FlowBox variant="success" className="w-64">
                <div className="font-semibold">status: selected</div>
                <div className="text-xs">Ready for Ghostwriter</div>
              </FlowBox>
            </div>
          </DiagramContainer>

          <h3 className="mb-3 text-lg font-semibold">Item Selection Priority</h3>
          <p className="mb-4 text-zinc-400 text-sm">
            The <code className="bg-zinc-800 px-1 rounded">/api/ghostwriter-queue</code> endpoint
            uses the following priority order to select items for blog post generation:
          </p>
          <div className="grid grid-cols-3 gap-3 text-sm mb-6">
            <div className="rounded-lg border border-emerald-600 bg-emerald-950/30 p-3 text-center">
              <div className="font-mono text-emerald-400 font-semibold">1st</div>
              <div className="text-xs text-zinc-300 mt-1">Specific IDs</div>
              <div className="text-xs text-zinc-500">queueItemIds param</div>
            </div>
            <div className="rounded-lg border border-blue-600 bg-blue-950/30 p-3 text-center">
              <div className="font-mono text-blue-400 font-semibold">2nd</div>
              <div className="text-xs text-zinc-300 mt-1">Manual Selection</div>
              <div className="text-xs text-zinc-500">status=&apos;selected&apos;</div>
            </div>
            <div className="rounded-lg border border-zinc-600 bg-zinc-800/30 p-3 text-center">
              <div className="font-mono text-zinc-400 font-semibold">3rd</div>
              <div className="text-xs text-zinc-300 mt-1">Balanced Selection</div>
              <div className="text-xs text-zinc-500">30% source diversity</div>
            </div>
          </div>

          <h3 className="mb-3 text-lg font-semibold">Scoring System</h3>
          <div className="rounded-lg border border-zinc-800 bg-zinc-900/50 p-4 mb-6">
            <div className="font-mono text-sm text-zinc-200 mb-3">
              total_score = 0.4 × synthesis_score + 0.3 × relevance_score + 0.3 × uniqueness_score
            </div>
            <div className="grid grid-cols-3 gap-4 text-sm">
              <div>
                <div className="text-amber-400 font-semibold">Synthesis (40%)</div>
                <div className="text-xs text-zinc-500">How well content can be synthesized</div>
              </div>
              <div>
                <div className="text-blue-400 font-semibold">Relevance (30%)</div>
                <div className="text-xs text-zinc-500">Topic relevance to audience</div>
              </div>
              <div>
                <div className="text-emerald-400 font-semibold">Uniqueness (30%)</div>
                <div className="text-xs text-zinc-500">Novel perspective or insight</div>
              </div>
            </div>
          </div>

          <h3 className="mb-3 text-lg font-semibold">Source Diversification</h3>
          <div className="rounded-lg border border-amber-800/50 bg-amber-950/20 p-4">
            <p className="text-sm text-zinc-400 mb-3">
              The <code className="bg-zinc-800 px-1 rounded">get_balanced_queue_selection()</code> SQL function
              enforces a <strong className="text-amber-400">30% maximum</strong> from any single source
              after the first 4 items are selected. This prevents newsletter bias.
            </p>
            <div className="text-xs text-zinc-500">
              Example: For 10 items, max 3 can be from the same newsletter source.
            </div>
          </div>

          <h4 className="font-semibold mb-2 mt-6">Queue Status Flow</h4>
          <div className="grid grid-cols-5 gap-2 text-sm">
            <div className="rounded-lg border border-zinc-700 bg-zinc-800/50 p-2 text-center">
              <div className="font-mono text-amber-400">pending</div>
              <div className="text-xs text-zinc-500">In queue</div>
            </div>
            <div className="text-zinc-500 flex items-center justify-center">→</div>
            <div className="rounded-lg border border-zinc-700 bg-zinc-800/50 p-2 text-center">
              <div className="font-mono text-blue-400">selected</div>
              <div className="text-xs text-zinc-500">Chosen for article</div>
            </div>
            <div className="text-zinc-500 flex items-center justify-center">→</div>
            <div className="rounded-lg border border-zinc-700 bg-zinc-800/50 p-2 text-center">
              <div className="font-mono text-emerald-400">used</div>
              <div className="text-xs text-zinc-500">In published post</div>
            </div>
          </div>
        </section>

        {/* Section 7: Post Generation */}
        <section id="post-generation" className="mb-16">
          <h2 className="mb-6 text-2xl font-bold">7. AI Post Generation</h2>
          <p className="mb-6 text-zinc-400">
            The Ghostwriter transforms the daily digest into a polished blog post,
            applying vocabulary replacements and generating accompanying images.
          </p>

          <DiagramContainer title="Post Generation Flow">
            <div className="grid grid-cols-3 gap-4">
              {/* Input */}
              <div className="flex flex-col items-center gap-2">
                <div className="text-xs text-zinc-500 uppercase font-semibold mb-2">Input</div>
                <FlowBox variant="muted">daily_digests</FlowBox>
                <FlowBox variant="muted">ghostwriter_prompts</FlowBox>
                <FlowBox variant="muted">vocabulary</FlowBox>
              </div>

              {/* Processing */}
              <div className="flex flex-col items-center gap-2">
                <div className="text-xs text-zinc-500 uppercase font-semibold mb-2">Processing</div>
                <FlowBox variant="primary">/api/ghostwriter</FlowBox>
                <FlowBox>Apply vocab rules</FlowBox>
                <FlowBox>Convert to TipTap</FlowBox>
              </div>

              {/* Output */}
              <div className="flex flex-col items-center gap-2">
                <div className="text-xs text-zinc-500 uppercase font-semibold mb-2">Output</div>
                <FlowBox variant="success">generated_posts</FlowBox>
                <FlowBox variant="success">/api/generate-image</FlowBox>
                <FlowBox variant="muted">status: draft</FlowBox>
              </div>
            </div>
          </DiagramContainer>

          <h4 className="font-semibold mb-2">Post Statuses</h4>
          <div className="grid grid-cols-3 gap-2 text-sm">
            <div className="rounded-lg border border-zinc-800 bg-zinc-900/50 p-3 text-center">
              <div className="font-mono text-amber-400">draft</div>
              <div className="text-xs text-zinc-500 mt-1">Generated, not reviewed</div>
            </div>
            <div className="rounded-lg border border-zinc-800 bg-zinc-900/50 p-3 text-center">
              <div className="font-mono text-emerald-400">published</div>
              <div className="text-xs text-zinc-500 mt-1">Ready for public</div>
            </div>
            <div className="rounded-lg border border-zinc-800 bg-zinc-900/50 p-3 text-center">
              <div className="font-mono text-zinc-500">archived</div>
              <div className="text-xs text-zinc-500 mt-1">Removed from view</div>
            </div>
          </div>
        </section>

        {/* Section 8: Edit Learning System */}
        <section id="edit-learning" className="mb-16">
          <h2 className="mb-6 text-2xl font-bold">8. Edit Learning System</h2>
          <p className="mb-6 text-zinc-400">
            The Edit Learning System enables the Ghostwriter to improve over time by learning from
            manual edits made to AI-generated blog posts. It tracks all changes, extracts patterns,
            and applies learned rules to future content generation.
          </p>

          <DiagramContainer title="Edit Learning Flow">
            <div className="flex flex-col items-center gap-2">
              <FlowBox variant="muted" className="w-64">
                <div className="font-semibold">AI Generated Post</div>
                <div className="text-xs">Ghostwriter output</div>
              </FlowBox>
              <Arrow />
              <FlowBox variant="primary" className="w-64">
                <div className="font-semibold">Manual Editing</div>
                <div className="text-xs">TipTap Editor in /admin</div>
              </FlowBox>
              <Arrow />
              <FlowBox className="w-64">
                <div className="font-semibold">edit_history</div>
                <div className="text-xs">content_before / content_after</div>
              </FlowBox>
              <Arrow />
              <div className="grid grid-cols-2 gap-4 w-full max-w-md">
                <FlowBox variant="warning">
                  <div className="font-semibold">Diff Extraction</div>
                  <div className="text-xs">Sentence-level</div>
                </FlowBox>
                <FlowBox variant="warning">
                  <div className="font-semibold">AI Classification</div>
                  <div className="text-xs">Claude API</div>
                </FlowBox>
              </div>
              <Arrow />
              <FlowBox variant="success" className="w-64">
                <div className="font-semibold">learned_patterns</div>
                <div className="text-xs">Rules for future generation</div>
              </FlowBox>
            </div>
          </DiagramContainer>

          <h3 className="mb-3 text-lg font-semibold">Edit Classification Types</h3>
          <div className="grid grid-cols-4 gap-3 text-sm mb-6">
            <div className="rounded-lg border border-zinc-800 bg-zinc-900/50 p-3 text-center">
              <div className="font-mono text-blue-400">factual</div>
              <div className="text-xs text-zinc-500 mt-1">Content corrections</div>
            </div>
            <div className="rounded-lg border border-zinc-800 bg-zinc-900/50 p-3 text-center">
              <div className="font-mono text-purple-400">stylistic</div>
              <div className="text-xs text-zinc-500 mt-1">Tone & voice changes</div>
            </div>
            <div className="rounded-lg border border-zinc-800 bg-zinc-900/50 p-3 text-center">
              <div className="font-mono text-amber-400">vocabulary</div>
              <div className="text-xs text-zinc-500 mt-1">Word replacements</div>
            </div>
            <div className="rounded-lg border border-zinc-800 bg-zinc-900/50 p-3 text-center">
              <div className="font-mono text-emerald-400">grammar</div>
              <div className="text-xs text-zinc-500 mt-1">Punctuation & syntax</div>
            </div>
          </div>

          <h3 className="mb-3 text-lg font-semibold">Pattern Learning Cycle</h3>
          <div className="rounded-lg border border-zinc-800 bg-zinc-900/50 p-4">
            <ol className="space-y-2 text-sm text-zinc-400">
              <li><span className="text-zinc-200">1.</span> Edit history is recorded when posts are saved (content_before → content_after)</li>
              <li><span className="text-zinc-200">2.</span> <code className="bg-zinc-800 px-1 rounded">/api/admin/analyze-edits</code> extracts sentence-level diffs and classifies them via Claude</li>
              <li><span className="text-zinc-200">3.</span> <code className="bg-zinc-800 px-1 rounded">/api/cron/extract-patterns</code> clusters similar edits (embedding similarity &gt; 0.85)</li>
              <li><span className="text-zinc-200">4.</span> Patterns with 3+ similar edits become <code className="bg-zinc-800 px-1 rounded">learned_patterns</code></li>
              <li><span className="text-zinc-200">5.</span> Ghostwriter retrieves active patterns and applies them during generation</li>
            </ol>
          </div>

          <h3 className="mb-3 mt-6 text-lg font-semibold">Confidence & Decay</h3>
          <div className="grid grid-cols-2 gap-4 text-sm">
            <div className="rounded-lg border border-zinc-800 bg-zinc-900/50 p-4">
              <div className="font-semibold text-zinc-200 mb-2">Confidence Score</div>
              <ul className="space-y-1 text-zinc-400">
                <li>• New patterns start at 0.5</li>
                <li>• User keeps edit → +0.1</li>
                <li>• User reverts edit → -0.1</li>
                <li>• Patterns &lt; 0.3 auto-deactivate</li>
              </ul>
            </div>
            <div className="rounded-lg border border-zinc-800 bg-zinc-900/50 p-4">
              <div className="font-semibold text-zinc-200 mb-2">Time Decay</div>
              <ul className="space-y-1 text-zinc-400">
                <li>• 0.95 decay factor per week</li>
                <li>• Halves every ~14 weeks</li>
                <li>• Keeps patterns current</li>
                <li>• Old unused patterns fade</li>
              </ul>
            </div>
          </div>

          <h3 className="mb-3 mt-6 text-lg font-semibold">Ghostwriter Integration</h3>
          <DiagramContainer title="Pattern Application Flow">
            <div className="flex flex-col items-center gap-2">
              <FlowBox variant="muted" className="w-72">
                <div className="font-semibold">streamGhostwriter()</div>
                <div className="text-xs">lib/claude/ghostwriter.ts</div>
              </FlowBox>
              <Arrow />
              <div className="grid grid-cols-2 gap-4 w-full max-w-lg">
                <FlowBox>
                  <div className="font-semibold text-sm">getActiveLearnedPatterns()</div>
                  <div className="text-xs">min confidence 0.4, limit 20</div>
                </FlowBox>
                <FlowBox>
                  <div className="font-semibold text-sm">findSimilarEditExamples()</div>
                  <div className="text-xs">Embedding similarity search</div>
                </FlowBox>
              </div>
              <Arrow />
              <FlowBox variant="primary" className="w-72">
                <div className="font-semibold">buildPromptEnhancement()</div>
                <div className="text-xs">Adds GELERNTE STILPRÄFERENZEN section</div>
              </FlowBox>
              <Arrow />
              <FlowBox variant="success" className="w-72">
                <div className="font-semibold">Enhanced AI Prompt</div>
                <div className="text-xs">Patterns + Examples → Claude/Gemini</div>
              </FlowBox>
            </div>
          </DiagramContainer>

          <h3 className="mb-3 mt-6 text-lg font-semibold">Editor Pattern Highlighting</h3>
          <DiagramContainer title="Highlight & Feedback Flow">
            <div className="flex flex-col items-center gap-2">
              <FlowBox variant="muted" className="w-64">
                <div className="font-semibold">applied_patterns</div>
                <div className="text-xs">Tracked during generation</div>
              </FlowBox>
              <Arrow />
              <FlowBox className="w-64">
                <div className="font-semibold">TiptapEditorWithPatterns</div>
                <div className="text-xs">PatternHighlightMark extension</div>
              </FlowBox>
              <Arrow />
              <FlowBox variant="warning" className="w-64">
                <div className="font-semibold">Yellow Highlight</div>
                <div className="text-xs">Clickable text segments</div>
              </FlowBox>
              <Arrow />
              <div className="grid grid-cols-3 gap-2 w-full max-w-md">
                <FlowBox variant="success">
                  <div className="text-xs">Behalten</div>
                  <div className="text-xs text-emerald-400">+0.1</div>
                </FlowBox>
                <FlowBox variant="default">
                  <div className="text-xs">Ablehnen</div>
                  <div className="text-xs text-red-400">-0.1</div>
                </FlowBox>
                <FlowBox variant="muted">
                  <div className="text-xs">Deaktivieren</div>
                  <div className="text-xs text-zinc-500">is_active=false</div>
                </FlowBox>
              </div>
            </div>
          </DiagramContainer>
        </section>

        {/* Section 9: Stock-Synthszr */}
        <section id="stock-synthszr" className="mb-16">
          <h2 className="mb-6 text-2xl font-bold">9. Stock Values & Stock-Synthszr</h2>
          <p className="mb-6 text-zinc-400">
            The Stock-Synthszr system provides real-time stock quotes and AI-generated
            investment analysis. It combines market data with GPT-5&apos;s web search capabilities
            to generate actionable insights.
          </p>

          <DiagramContainer title="Stock Data Flow">
            <div className="flex flex-col items-center gap-2">
              <div className="grid grid-cols-2 gap-6 w-full max-w-xl">
                {/* Stock Quotes */}
                <div className="flex flex-col items-center gap-2">
                  <div className="text-xs text-zinc-500 uppercase font-semibold">Real-Time Quotes</div>
                  <FlowBox variant="muted" className="w-full">
                    <div className="font-semibold">Company Name</div>
                    <div className="text-xs">&quot;Apple&quot;, &quot;Microsoft&quot;, etc.</div>
                  </FlowBox>
                  <Arrow />
                  <FlowBox className="w-full">
                    <div className="font-semibold">Ticker Mapping</div>
                    <div className="text-xs">50 companies → symbols</div>
                  </FlowBox>
                  <Arrow />
                  <FlowBox variant="primary" className="w-full">
                    <div className="font-semibold">EODHD API</div>
                    <div className="text-xs">eodhistoricaldata.com</div>
                  </FlowBox>
                  <Arrow />
                  <FlowBox variant="success" className="w-full">
                    <div className="font-semibold">Quote Data</div>
                    <div className="text-xs">price, change, direction</div>
                  </FlowBox>
                </div>

                {/* Stock-Synthszr */}
                <div className="flex flex-col items-center gap-2">
                  <div className="text-xs text-zinc-500 uppercase font-semibold">AI Analysis</div>
                  <FlowBox variant="muted" className="w-full">
                    <div className="font-semibold">/api/stock-synthszr</div>
                    <div className="text-xs">company, currency, price</div>
                  </FlowBox>
                  <Arrow />
                  <FlowBox className="w-full">
                    <div className="font-semibold">Cache Check</div>
                    <div className="text-xs">stock_synthszr_cache (14 days)</div>
                  </FlowBox>
                  <Arrow />
                  <FlowBox variant="warning" className="w-full">
                    <div className="font-semibold">GPT-5 + Web Search</div>
                    <div className="text-xs">OpenAI Responses API</div>
                  </FlowBox>
                  <Arrow />
                  <FlowBox variant="success" className="w-full">
                    <div className="font-semibold">Analysis Result</div>
                    <div className="text-xs">BUY / HOLD / SELL</div>
                  </FlowBox>
                </div>
              </div>
            </div>
          </DiagramContainer>

          <div className="grid grid-cols-2 gap-6">
            <div className="rounded-lg border border-zinc-800 bg-zinc-900/50 p-4">
              <h4 className="font-semibold mb-3">Stock-Synthszr Output</h4>
              <ul className="space-y-2 text-sm text-zinc-400">
                <li>• <span className="text-zinc-200">key_takeaways</span> — 5 bullet points</li>
                <li>• <span className="text-zinc-200">action_ideas</span> — 3 strategies (BUY/HOLD/SELL)</li>
                <li>• <span className="text-zinc-200">contrarian_insights</span> — 2 alternative views</li>
                <li>• <span className="text-zinc-200">sources</span> — 5-8 reference links</li>
                <li>• <span className="text-zinc-200">final_recommendation</span> — Overall rating</li>
              </ul>
            </div>
            <div className="rounded-lg border border-zinc-800 bg-zinc-900/50 p-4">
              <h4 className="font-semibold mb-3">Supported Exchanges</h4>
              <ul className="space-y-2 text-sm text-zinc-400">
                <li>• <span className="text-zinc-200">US</span> — NASDAQ, NYSE</li>
                <li>• <span className="text-zinc-200">XETRA</span> — German stocks</li>
                <li>• <span className="text-zinc-200">HK</span> — Hong Kong (Tencent, BYD)</li>
                <li>• <span className="text-zinc-200">KS</span> — Korea (Samsung)</li>
              </ul>
            </div>
          </div>

          <h3 className="mb-4 mt-8 text-lg font-semibold">Premarket Company Ratings</h3>
          <p className="mb-6 text-zinc-400">
            For pre-IPO and private companies, ratings are fetched from the glitch.green external API.
            These companies are tracked separately from public stocks and displayed with the same
            BUY/HOLD/SELL badge system.
          </p>

          <DiagramContainer title="Premarket Data Flow">
            <div className="grid grid-cols-3 gap-4 items-center">
              {/* Source */}
              <div className="flex flex-col items-center gap-2">
                <div className="text-xs text-zinc-500 uppercase font-semibold">External API</div>
                <FlowBox variant="muted">
                  <div className="font-semibold">glitch.green</div>
                  <div className="text-xs">/api/public/premarket-syntheses</div>
                </FlowBox>
                <FlowBox variant="muted">
                  <div className="text-xs">X-API-Key auth</div>
                </FlowBox>
              </div>

              <div className="flex justify-center">
                <Arrow direction="right" />
              </div>

              {/* Processing */}
              <div className="flex flex-col items-center gap-2">
                <div className="text-xs text-zinc-500 uppercase font-semibold">Local APIs</div>
                <FlowBox variant="primary">
                  <div className="font-semibold">/api/premarket</div>
                  <div className="text-xs">Single company lookup</div>
                </FlowBox>
                <FlowBox variant="primary">
                  <div className="font-semibold">/api/premarket/batch-ratings</div>
                  <div className="text-xs">Multiple companies</div>
                </FlowBox>
              </div>
            </div>
          </DiagramContainer>

          <div className="grid grid-cols-2 gap-6">
            <div className="rounded-lg border border-zinc-800 bg-zinc-900/50 p-4">
              <h4 className="font-semibold mb-3">Premarket Data Structure</h4>
              <ul className="space-y-2 text-sm text-zinc-400">
                <li>• <span className="text-zinc-200">instrument</span> — ISIN, name, currency</li>
                <li>• <span className="text-zinc-200">synthesis.rating</span> — BUY/HOLD/SELL</li>
                <li>• <span className="text-zinc-200">synthesis.rationale</span> — Analysis text</li>
                <li>• <span className="text-zinc-200">synthesis.keyTakeaways</span> — Bullet points</li>
                <li>• <span className="text-zinc-200">synthesis.actionIdeas</span> — Strategies</li>
                <li>• <span className="text-zinc-200">latestPrice</span> — Current valuation</li>
              </ul>
            </div>
            <div className="rounded-lg border border-zinc-800 bg-zinc-900/50 p-4">
              <h4 className="font-semibold mb-3">Company Detection</h4>
              <ul className="space-y-2 text-sm text-zinc-400">
                <li>• <span className="text-zinc-200">KNOWN_PREMARKET_COMPANIES</span> — Map in companies.ts</li>
                <li>• <span className="text-zinc-200">Natural mentions</span> — &quot;OpenAI reported...&quot;</li>
                <li>• <span className="text-zinc-200">Explicit tags</span> — &#123;Company&#125; directives</li>
                <li>• <span className="text-zinc-200">Exclusion list</span> — Filters false positives</li>
                <li>• <span className="text-zinc-200">Sync script</span> — sync-premarket-companies.ts</li>
              </ul>
            </div>
          </div>

          <h4 className="font-semibold mt-6 mb-3">Display Flow (tiptap-renderer.tsx)</h4>
          <div className="rounded-lg border border-zinc-800 bg-zinc-900/50 p-4">
            <ol className="space-y-2 text-sm text-zinc-400">
              <li><span className="text-zinc-200">1.</span> Find all &quot;Synthszr Take&quot; sections in rendered content</li>
              <li><span className="text-zinc-200">2.</span> Extract company mentions using KNOWN_PREMARKET_COMPANIES regex</li>
              <li><span className="text-zinc-200">3.</span> Batch fetch ratings via <code className="bg-zinc-800 px-1 rounded">/api/premarket/batch-ratings</code></li>
              <li><span className="text-zinc-200">4.</span> Inject clickable rating badges (BUY/HOLD/SELL) after section</li>
              <li><span className="text-zinc-200">5.</span> Click opens <code className="bg-zinc-800 px-1 rounded">PremarketSynthszrLayer</code> dialog with full analysis</li>
            </ol>
          </div>
        </section>

        {/* Section 10: Translation System */}
        <section id="translations" className="mb-16">
          <h2 className="mb-6 text-2xl font-bold">10. Translation System (i18n)</h2>
          <p className="mb-6 text-zinc-400">
            The translation system provides multi-language support for blog posts and static pages.
            It uses AI (Claude/Gemini) to generate translations and maintains a queue-based processing
            system for reliable background translation.
          </p>

          <DiagramContainer title="Translation Flow">
            <div className="flex flex-col items-center gap-2">
              <FlowBox variant="muted" className="w-64">
                <div className="font-semibold">Post Published</div>
                <div className="text-xs">status: &apos;published&apos;</div>
              </FlowBox>
              <Arrow />
              <FlowBox variant="primary" className="w-64">
                <div className="font-semibold">queueTranslations()</div>
                <div className="text-xs">lib/translations/queue.ts</div>
              </FlowBox>
              <Arrow />
              <FlowBox className="w-64">
                <div className="font-semibold">translation_queue</div>
                <div className="text-xs">status: pending</div>
              </FlowBox>
              <Arrow />
              <FlowBox variant="warning" className="w-64">
                <div className="font-semibold">process-queue</div>
                <div className="text-xs">Claude/Gemini API</div>
              </FlowBox>
              <Arrow />
              <FlowBox variant="success" className="w-64">
                <div className="font-semibold">content_translations</div>
                <div className="text-xs">Translated content stored</div>
              </FlowBox>
            </div>
          </DiagramContainer>

          <h3 className="mb-3 text-lg font-semibold">Language Configuration</h3>
          <div className="rounded-lg border border-zinc-800 bg-zinc-900/50 p-4 mb-6">
            <p className="text-sm text-zinc-400 mb-3">
              Languages are configured in the <code className="bg-zinc-800 px-1 rounded">languages</code> table.
              Only active, non-default languages receive automatic translations.
            </p>
            <div className="grid grid-cols-3 gap-4 text-sm">
              <div>
                <div className="text-emerald-400 font-semibold">is_active</div>
                <div className="text-xs text-zinc-500">Language enabled for translation</div>
              </div>
              <div>
                <div className="text-blue-400 font-semibold">is_default</div>
                <div className="text-xs text-zinc-500">Source language (German)</div>
              </div>
              <div>
                <div className="text-amber-400 font-semibold">llm_model</div>
                <div className="text-xs text-zinc-500">AI model per language</div>
              </div>
            </div>
          </div>

          <h3 className="mb-3 text-lg font-semibold">Queue Status Flow</h3>
          <div className="grid grid-cols-5 gap-2 text-sm mb-6">
            <div className="rounded-lg border border-zinc-700 bg-zinc-800/50 p-2 text-center">
              <div className="font-mono text-amber-400">pending</div>
              <div className="text-xs text-zinc-500">Queued</div>
            </div>
            <div className="text-zinc-500 flex items-center justify-center">→</div>
            <div className="rounded-lg border border-zinc-700 bg-zinc-800/50 p-2 text-center">
              <div className="font-mono text-blue-400">processing</div>
              <div className="text-xs text-zinc-500">AI translating</div>
            </div>
            <div className="text-zinc-500 flex items-center justify-center">→</div>
            <div className="rounded-lg border border-zinc-700 bg-zinc-800/50 p-2 text-center">
              <div className="font-mono text-emerald-400">completed</div>
              <div className="text-xs text-zinc-500">Done</div>
            </div>
          </div>

          <h3 className="mb-3 text-lg font-semibold">Manual Edit Protection</h3>
          <div className="rounded-lg border border-amber-800/50 bg-amber-950/20 p-4 mb-6">
            <p className="text-sm text-zinc-400 mb-3">
              When a translation is manually edited, it&apos;s marked with <code className="bg-zinc-800 px-1 rounded">is_manually_edited=true</code>.
              These translations are automatically skipped during re-translation to protect human edits.
            </p>
            <div className="text-xs text-zinc-500">
              Use <code className="bg-zinc-800 px-1 rounded">force=true</code> to override and re-translate anyway.
            </div>
          </div>

          <h3 className="mb-3 text-lg font-semibold">Key Implementation Details</h3>
          <div className="grid grid-cols-2 gap-4 text-sm">
            <div className="rounded-lg border border-zinc-800 bg-zinc-900/50 p-4">
              <div className="font-semibold text-zinc-200 mb-2">Admin Client Requirement</div>
              <ul className="space-y-1 text-zinc-400">
                <li>• Uses <code className="bg-zinc-800 px-1 rounded">createAdminClient()</code></li>
                <li>• Required for async fire-and-forget operations</li>
                <li>• Bypasses cookie context limitations</li>
                <li>• Service Role Key authentication</li>
              </ul>
            </div>
            <div className="rounded-lg border border-zinc-800 bg-zinc-900/50 p-4">
              <div className="font-semibold text-zinc-200 mb-2">Supported Content Types</div>
              <ul className="space-y-1 text-zinc-400">
                <li>• <code className="bg-zinc-800 px-1 rounded">generated_post</code> — Blog posts</li>
                <li>• <code className="bg-zinc-800 px-1 rounded">static_page</code> — Static pages</li>
                <li>• TipTap JSON content preserved</li>
                <li>• Metadata (title, excerpt) translated</li>
              </ul>
            </div>
          </div>
        </section>

        {/* Section 11: Data Model */}
        <section id="data-model" className="mb-16">
          <h2 className="mb-6 text-2xl font-bold">11. Data Model</h2>
          <p className="mb-6 text-zinc-400">
            The system uses Supabase (PostgreSQL) with the following core tables
            for content management.
          </p>

          <DiagramContainer title="Core Tables & Relations">
            <div className="flex flex-col gap-4">
              {/* Row 1: Input */}
              <div className="flex justify-center">
                <div className="rounded-lg border-2 border-blue-600 bg-blue-950/30 p-4 w-80">
                  <div className="font-semibold text-blue-400 mb-2">daily_repo</div>
                  <div className="text-xs text-zinc-400 space-y-1">
                    <div>source_type: &apos;newsletter&apos; | &apos;article&apos;</div>
                    <div>source_email, source_url</div>
                    <div>title, content, raw_html</div>
                    <div>newsletter_date, embedding</div>
                  </div>
                </div>
              </div>

              <div className="text-center text-zinc-500">↓ analyzed into</div>

              {/* Row 2: Processing */}
              <div className="flex justify-center">
                <div className="rounded-lg border-2 border-emerald-600 bg-emerald-950/30 p-4 w-80">
                  <div className="font-semibold text-emerald-400 mb-2">daily_digests</div>
                  <div className="text-xs text-zinc-400 space-y-1">
                    <div>digest_date (UNIQUE)</div>
                    <div>analysis_content, word_count</div>
                    <div>sources_used: UUID[]</div>
                  </div>
                </div>
              </div>

              <div className="flex justify-center gap-20 text-zinc-500">
                <span>↓ generates</span>
                <span>↓ creates</span>
              </div>

              {/* Row 3: Output */}
              <div className="flex justify-center gap-6">
                <div className="rounded-lg border-2 border-amber-600 bg-amber-950/30 p-4 w-64">
                  <div className="font-semibold text-amber-400 mb-2">generated_posts</div>
                  <div className="text-xs text-zinc-400 space-y-1">
                    <div>digest_id (FK)</div>
                    <div>title, content (JSONB)</div>
                    <div>word_count, status</div>
                  </div>
                </div>
                <div className="rounded-lg border-2 border-purple-600 bg-purple-950/30 p-4 w-64">
                  <div className="font-semibold text-purple-400 mb-2">developed_syntheses</div>
                  <div className="text-xs text-zinc-400 space-y-1">
                    <div>digest_id (FK)</div>
                    <div>topic_name, synthesis_text</div>
                    <div>source_refs, rating_data</div>
                  </div>
                </div>
              </div>
            </div>
          </DiagramContainer>

          <h4 className="font-semibold mb-3">News Queue Tables</h4>
          <div className="grid grid-cols-2 gap-2 text-sm mb-6">
            <div className="rounded border border-amber-800/50 bg-amber-950/20 px-3 py-2">
              <span className="text-amber-300">news_queue</span>
              <span className="text-zinc-500 ml-2">— Article selection queue with scores</span>
            </div>
            <div className="rounded border border-amber-800/50 bg-amber-950/20 px-3 py-2">
              <span className="text-amber-300">news_queue_source_distribution</span>
              <span className="text-zinc-500 ml-2">— Source stats view</span>
            </div>
            <div className="rounded border border-amber-800/50 bg-amber-950/20 px-3 py-2">
              <span className="text-amber-300">news_queue_selectable</span>
              <span className="text-zinc-500 ml-2">— Items respecting 30% limit</span>
            </div>
            <div className="rounded border border-amber-800/50 bg-amber-950/20 px-3 py-2">
              <span className="text-amber-300">get_balanced_queue_selection()</span>
              <span className="text-zinc-500 ml-2">— SQL function for selection</span>
            </div>
          </div>

          <h4 className="font-semibold mb-3">Supporting Tables</h4>
          <div className="grid grid-cols-2 gap-2 text-sm">
            <div className="rounded border border-zinc-800 bg-zinc-900/50 px-3 py-2">
              <span className="text-zinc-200">newsletter_sources</span>
              <span className="text-zinc-500 ml-2">— Email sources for Gmail fetch</span>
            </div>
            <div className="rounded border border-zinc-800 bg-zinc-900/50 px-3 py-2">
              <span className="text-zinc-200">gmail_tokens</span>
              <span className="text-zinc-500 ml-2">— OAuth2 refresh tokens</span>
            </div>
            <div className="rounded border border-zinc-800 bg-zinc-900/50 px-3 py-2">
              <span className="text-zinc-200">analysis_prompts</span>
              <span className="text-zinc-500 ml-2">— Prompts for daily analysis</span>
            </div>
            <div className="rounded border border-zinc-800 bg-zinc-900/50 px-3 py-2">
              <span className="text-zinc-200">ghostwriter_prompts</span>
              <span className="text-zinc-500 ml-2">— Blog post generation prompts</span>
            </div>
            <div className="rounded border border-zinc-800 bg-zinc-900/50 px-3 py-2">
              <span className="text-zinc-200">stock_synthszr_cache</span>
              <span className="text-zinc-500 ml-2">— Cached AI stock analyses (14 days)</span>
            </div>
            <div className="rounded border border-zinc-800 bg-zinc-900/50 px-3 py-2">
              <span className="text-zinc-200">settings</span>
              <span className="text-zinc-500 ml-2">— Runtime config (schedule, timestamps)</span>
            </div>
          </div>

          <h4 className="font-semibold mb-3 mt-6">Edit Learning Tables</h4>
          <div className="grid grid-cols-2 gap-2 text-sm">
            <div className="rounded border border-purple-800/50 bg-purple-950/20 px-3 py-2">
              <span className="text-purple-300">edit_history</span>
              <span className="text-zinc-500 ml-2">— Content versions (before/after)</span>
            </div>
            <div className="rounded border border-purple-800/50 bg-purple-950/20 px-3 py-2">
              <span className="text-purple-300">edit_diffs</span>
              <span className="text-zinc-500 ml-2">— Sentence-level changes + embeddings</span>
            </div>
            <div className="rounded border border-purple-800/50 bg-purple-950/20 px-3 py-2">
              <span className="text-purple-300">learned_patterns</span>
              <span className="text-zinc-500 ml-2">— Extracted rules with confidence</span>
            </div>
            <div className="rounded border border-purple-800/50 bg-purple-950/20 px-3 py-2">
              <span className="text-purple-300">applied_patterns</span>
              <span className="text-zinc-500 ml-2">— Pattern usage tracking</span>
            </div>
          </div>

          <h4 className="font-semibold mb-3 mt-6">Translation Tables (i18n)</h4>
          <div className="grid grid-cols-2 gap-2 text-sm">
            <div className="rounded border border-cyan-800/50 bg-cyan-950/20 px-3 py-2">
              <span className="text-cyan-300">languages</span>
              <span className="text-zinc-500 ml-2">— Language config (is_active, llm_model)</span>
            </div>
            <div className="rounded border border-cyan-800/50 bg-cyan-950/20 px-3 py-2">
              <span className="text-cyan-300">translation_queue</span>
              <span className="text-zinc-500 ml-2">— Pending/processing translations</span>
            </div>
            <div className="rounded border border-cyan-800/50 bg-cyan-950/20 px-3 py-2">
              <span className="text-cyan-300">content_translations</span>
              <span className="text-zinc-500 ml-2">— Completed translations + manual flag</span>
            </div>
            <div className="rounded border border-cyan-800/50 bg-cyan-950/20 px-3 py-2">
              <span className="text-cyan-300">ui_translations</span>
              <span className="text-zinc-500 ml-2">— UI string translations</span>
            </div>
          </div>
        </section>

        {/* Section 12: Security & Tech Debt */}
        <section id="security" className="mb-16">
          <h2 className="mb-6 text-2xl font-bold">12. Security & Tech Debt</h2>

          <h3 className="mb-4 text-xl font-semibold">Security Measures</h3>
          <p className="mb-6 text-zinc-400">
            The application implements multiple security layers to protect against common attack vectors
            and ensure safe operation of the admin panel and API endpoints.
          </p>

          <DiagramContainer title="Security Architecture">
            <div className="grid grid-cols-3 gap-4">
              {/* Authentication */}
              <div className="rounded-lg border border-zinc-700 bg-zinc-800/50 p-4">
                <div className="font-semibold text-emerald-400 mb-3">Authentication</div>
                <ul className="space-y-2 text-xs text-zinc-400">
                  <li>• JWT sessions via <code className="bg-zinc-700 px-1 rounded">jose</code></li>
                  <li>• HS256 signed tokens</li>
                  <li>• 7-day session duration</li>
                  <li>• HttpOnly, Secure, SameSite cookies</li>
                  <li>• Timing-safe password comparison</li>
                </ul>
              </div>

              {/* Rate Limiting */}
              <div className="rounded-lg border border-zinc-700 bg-zinc-800/50 p-4">
                <div className="font-semibold text-amber-400 mb-3">Rate Limiting</div>
                <ul className="space-y-2 text-xs text-zinc-400">
                  <li>• Upstash Redis backend</li>
                  <li>• Sliding window algorithm</li>
                  <li>• <code className="bg-zinc-700 px-1 rounded">strict</code>: 5 req/min (AI ops)</li>
                  <li>• <code className="bg-zinc-700 px-1 rounded">standard</code>: 30 req/min</li>
                  <li>• <code className="bg-zinc-700 px-1 rounded">relaxed</code>: 100 req/min</li>
                </ul>
              </div>

              {/* API Protection */}
              <div className="rounded-lg border border-zinc-700 bg-zinc-800/50 p-4">
                <div className="font-semibold text-blue-400 mb-3">API Protection</div>
                <ul className="space-y-2 text-xs text-zinc-400">
                  <li>• CRON_SECRET for cron routes</li>
                  <li>• Admin session check for /api/admin/*</li>
                  <li>• IP-based rate limit identifiers</li>
                  <li>• X-RateLimit-* response headers</li>
                  <li>• Input validation (Zod where applicable)</li>
                </ul>
              </div>
            </div>
          </DiagramContainer>

          <h3 className="mb-4 mt-8 text-xl font-semibold">Known Tech Debt</h3>
          <p className="mb-6 text-zinc-400">
            Areas of the codebase that have been identified for future improvement or refactoring.
          </p>

          <div className="space-y-3">
            <div className="rounded-lg border border-amber-800/50 bg-amber-950/20 p-4">
              <div className="flex items-center gap-2 mb-2">
                <span className="text-amber-400 font-semibold">Medium Priority</span>
                <span className="text-xs bg-amber-900/50 px-2 py-0.5 rounded">Consolidation</span>
              </div>
              <ul className="text-sm text-zinc-400 space-y-1">
                <li>• Multiple AI provider integrations (Claude, GPT, Gemini) could share more infrastructure</li>
                <li>• Some prompt templates are duplicated across different components</li>
                <li>• Error handling patterns vary across API routes</li>
              </ul>
            </div>

            <div className="rounded-lg border border-blue-800/50 bg-blue-950/20 p-4">
              <div className="flex items-center gap-2 mb-2">
                <span className="text-blue-400 font-semibold">Low Priority</span>
                <span className="text-xs bg-blue-900/50 px-2 py-0.5 rounded">Enhancement</span>
              </div>
              <ul className="text-sm text-zinc-400 space-y-1">
                <li>• Test coverage could be expanded for newsletter parsing edge cases</li>
                <li>• Some components could benefit from memoization</li>
                <li>• Consider migrating constants to environment-based configuration</li>
              </ul>
            </div>

            <div className="rounded-lg border border-emerald-800/50 bg-emerald-950/20 p-4">
              <div className="flex items-center gap-2 mb-2">
                <span className="text-emerald-400 font-semibold">Completed</span>
                <span className="text-xs bg-emerald-900/50 px-2 py-0.5 rounded">Resolved</span>
              </div>
              <ul className="text-sm text-zinc-400 space-y-1">
                <li>• ✓ Consolidated Supabase clients (was: 3 implementations)</li>
                <li>• ✓ Unified admin auth checks across routes</li>
                <li>• ✓ Extracted TipTap-to-HTML utility to shared module</li>
                <li>• ✓ Replaced magic numbers with named constants</li>
                <li>• ✓ Fixed cron timeout by using direct function calls</li>
              </ul>
            </div>
          </div>

          <h3 className="mb-4 mt-8 text-xl font-semibold">Security Audit Status</h3>
          <div className="rounded-lg border border-zinc-700 bg-zinc-800/50 p-4">
            <div className="grid grid-cols-4 gap-4 text-center text-sm">
              <div>
                <div className="text-2xl font-bold text-emerald-400">0</div>
                <div className="text-xs text-zinc-500">Critical Issues</div>
              </div>
              <div>
                <div className="text-2xl font-bold text-emerald-400">0</div>
                <div className="text-xs text-zinc-500">High Issues</div>
              </div>
              <div>
                <div className="text-2xl font-bold text-emerald-400">0</div>
                <div className="text-xs text-zinc-500">Medium Issues</div>
              </div>
              <div>
                <div className="text-2xl font-bold text-zinc-400">107</div>
                <div className="text-xs text-zinc-500">False Positives</div>
              </div>
            </div>
            <div className="text-xs text-zinc-500 mt-3 text-center">
              Last audit: January 2026 • All package versions up to date
            </div>
          </div>
        </section>

        {/* Section 13: API Routes */}
        <section id="api-routes" className="mb-16">
          <h2 className="mb-6 text-2xl font-bold">13. API Routes</h2>
          <p className="mb-6 text-zinc-400">
            Key API endpoints for the content pipeline. All cron routes require
            CRON_SECRET authentication in production.
          </p>

          <div className="space-y-4">
            <div className="rounded-lg border border-zinc-800 bg-zinc-900/50 p-4">
              <h4 className="font-semibold text-zinc-200 mb-3">Cron / Scheduled Tasks</h4>
              <div className="space-y-2 text-sm font-mono">
                <div className="flex gap-4"><span className="text-emerald-400 w-12">GET</span><span className="text-zinc-400">/api/cron/scheduled-tasks</span><span className="text-zinc-600 ml-auto">Main scheduler</span></div>
                <div className="flex gap-4"><span className="text-emerald-400 w-12">GET</span><span className="text-zinc-400">/api/cron/fetch-newsletters</span><span className="text-zinc-600 ml-auto">Newsletter fetch</span></div>
                <div className="flex gap-4"><span className="text-amber-400 w-12">POST</span><span className="text-zinc-400">/api/cron/newsletter-send</span><span className="text-zinc-600 ml-auto">Send newsletter</span></div>
              </div>
            </div>

            <div className="rounded-lg border border-zinc-800 bg-zinc-900/50 p-4">
              <h4 className="font-semibold text-zinc-200 mb-3">Content Generation</h4>
              <div className="space-y-2 text-sm font-mono">
                <div className="flex gap-4"><span className="text-amber-400 w-12">POST</span><span className="text-zinc-400">/api/analyze</span><span className="text-zinc-600 ml-auto">AI analysis (SSE)</span></div>
                <div className="flex gap-4"><span className="text-amber-400 w-12">POST</span><span className="text-zinc-400">/api/ghostwriter</span><span className="text-zinc-600 ml-auto">Blog post from digest (SSE)</span></div>
                <div className="flex gap-4"><span className="text-amber-400 w-12">POST</span><span className="text-zinc-400">/api/ghostwriter-queue</span><span className="text-zinc-600 ml-auto">Blog post from queue (SSE)</span></div>
                <div className="flex gap-4"><span className="text-blue-400 w-12">PUT</span><span className="text-zinc-400">/api/generate-image</span><span className="text-zinc-600 ml-auto">Image generation</span></div>
              </div>
            </div>

            <div className="rounded-lg border border-zinc-800 bg-zinc-900/50 p-4">
              <h4 className="font-semibold text-zinc-200 mb-3">News Queue</h4>
              <div className="space-y-2 text-sm font-mono">
                <div className="flex gap-4"><span className="text-emerald-400 w-12">GET</span><span className="text-zinc-400">/api/news-queue</span><span className="text-zinc-600 ml-auto">Queue items & stats</span></div>
                <div className="flex gap-4"><span className="text-amber-400 w-12">POST</span><span className="text-zinc-400">/api/news-queue</span><span className="text-zinc-600 ml-auto">Add items to queue</span></div>
                <div className="flex gap-4"><span className="text-amber-400 w-12">POST</span><span className="text-zinc-400">/api/news-queue/select</span><span className="text-zinc-600 ml-auto">Select items (status change)</span></div>
              </div>
            </div>

            <div className="rounded-lg border border-zinc-800 bg-zinc-900/50 p-4">
              <h4 className="font-semibold text-zinc-200 mb-3">Stock Data</h4>
              <div className="space-y-2 text-sm font-mono">
                <div className="flex gap-4"><span className="text-emerald-400 w-12">GET</span><span className="text-zinc-400">/api/stock-quote</span><span className="text-zinc-600 ml-auto">Real-time quotes (EODHD)</span></div>
                <div className="flex gap-4"><span className="text-amber-400 w-12">POST</span><span className="text-zinc-400">/api/stock-synthszr</span><span className="text-zinc-600 ml-auto">AI stock analysis (GPT-5)</span></div>
                <div className="flex gap-4"><span className="text-amber-400 w-12">POST</span><span className="text-zinc-400">/api/stock-synthszr/batch-ratings</span><span className="text-zinc-600 ml-auto">Batch ratings (read-only)</span></div>
                <div className="flex gap-4"><span className="text-amber-400 w-12">POST</span><span className="text-zinc-400">/api/stock-synthszr/batch-quotes</span><span className="text-zinc-600 ml-auto">Quotes + ratings combined</span></div>
              </div>
            </div>

            <div className="rounded-lg border border-zinc-800 bg-zinc-900/50 p-4">
              <h4 className="font-semibold text-zinc-200 mb-3">Edit Learning</h4>
              <div className="space-y-2 text-sm font-mono">
                <div className="flex gap-4"><span className="text-emerald-400 w-12">GET</span><span className="text-zinc-400">/api/admin/analyze-edits</span><span className="text-zinc-600 ml-auto">View edit stats</span></div>
                <div className="flex gap-4"><span className="text-amber-400 w-12">POST</span><span className="text-zinc-400">/api/admin/analyze-edits</span><span className="text-zinc-600 ml-auto">Analyze pending edits</span></div>
                <div className="flex gap-4"><span className="text-amber-400 w-12">POST</span><span className="text-zinc-400">/api/admin/pattern-feedback</span><span className="text-zinc-600 ml-auto">Update pattern confidence</span></div>
                <div className="flex gap-4"><span className="text-emerald-400 w-12">GET</span><span className="text-zinc-400">/api/cron/extract-patterns</span><span className="text-zinc-600 ml-auto">Extract patterns from diffs</span></div>
              </div>
            </div>

            <div className="rounded-lg border border-zinc-800 bg-zinc-900/50 p-4">
              <h4 className="font-semibold text-zinc-200 mb-3">Translations (i18n)</h4>
              <div className="space-y-2 text-sm font-mono">
                <div className="flex gap-4"><span className="text-emerald-400 w-12">GET</span><span className="text-zinc-400">/api/admin/translations</span><span className="text-zinc-600 ml-auto">Queue stats & items</span></div>
                <div className="flex gap-4"><span className="text-amber-400 w-12">POST</span><span className="text-zinc-400">/api/admin/translations</span><span className="text-zinc-600 ml-auto">Actions (retry, cancel, trigger)</span></div>
                <div className="flex gap-4"><span className="text-amber-400 w-12">POST</span><span className="text-zinc-400">/api/admin/translations/queue</span><span className="text-zinc-600 ml-auto">Add items to queue</span></div>
                <div className="flex gap-4"><span className="text-amber-400 w-12">POST</span><span className="text-zinc-400">/api/admin/translations/process-queue</span><span className="text-zinc-600 ml-auto">Process pending translations</span></div>
              </div>
            </div>

            <div className="rounded-lg border border-zinc-800 bg-zinc-900/50 p-4">
              <h4 className="font-semibold text-zinc-200 mb-3">Authentication</h4>
              <div className="text-sm text-zinc-400 space-y-1">
                <div><span className="text-zinc-200">Cron Routes:</span> Authorization: Bearer &#123;CRON_SECRET&#125;</div>
                <div><span className="text-zinc-200">Admin Routes:</span> Session cookie (JWT via jose)</div>
                <div><span className="text-zinc-200">Public Routes:</span> No auth required (rate-limited)</div>
              </div>
            </div>
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

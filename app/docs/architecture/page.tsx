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
            <li><a href="#post-generation" className="text-zinc-300 hover:text-white">6. AI Post Generation</a></li>
            <li><a href="#stock-synthszr" className="text-zinc-300 hover:text-white">7. Stock Values & Stock-Synthszr</a></li>
            <li><a href="#data-model" className="text-zinc-300 hover:text-white">8. Data Model</a></li>
            <li><a href="#security" className="text-zinc-300 hover:text-white">9. Security & Tech Debt</a></li>
            <li><a href="#api-routes" className="text-zinc-300 hover:text-white">10. API Routes</a></li>
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

        {/* Section 6: Post Generation */}
        <section id="post-generation" className="mb-16">
          <h2 className="mb-6 text-2xl font-bold">6. AI Post Generation</h2>
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

        {/* Section 7: Stock-Synthszr */}
        <section id="stock-synthszr" className="mb-16">
          <h2 className="mb-6 text-2xl font-bold">7. Stock Values & Stock-Synthszr</h2>
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
                    <div className="text-xs">100+ companies → symbols</div>
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
        </section>

        {/* Section 8: Data Model */}
        <section id="data-model" className="mb-16">
          <h2 className="mb-6 text-2xl font-bold">8. Data Model</h2>
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
        </section>

        {/* Section 9: Security & Tech Debt */}
        <section id="security" className="mb-16">
          <h2 className="mb-6 text-2xl font-bold">9. Security & Tech Debt</h2>

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

        {/* Section 10: API Routes */}
        <section id="api-routes" className="mb-16">
          <h2 className="mb-6 text-2xl font-bold">10. API Routes</h2>
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
                <div className="flex gap-4"><span className="text-amber-400 w-12">POST</span><span className="text-zinc-400">/api/ghostwriter</span><span className="text-zinc-600 ml-auto">Blog post (SSE)</span></div>
                <div className="flex gap-4"><span className="text-blue-400 w-12">PUT</span><span className="text-zinc-400">/api/generate-image</span><span className="text-zinc-600 ml-auto">Image generation</span></div>
              </div>
            </div>

            <div className="rounded-lg border border-zinc-800 bg-zinc-900/50 p-4">
              <h4 className="font-semibold text-zinc-200 mb-3">Stock Data</h4>
              <div className="space-y-2 text-sm font-mono">
                <div className="flex gap-4"><span className="text-emerald-400 w-12">GET</span><span className="text-zinc-400">/api/stock-quote</span><span className="text-zinc-600 ml-auto">Real-time quotes (EODHD)</span></div>
                <div className="flex gap-4"><span className="text-amber-400 w-12">POST</span><span className="text-zinc-400">/api/stock-synthszr</span><span className="text-zinc-600 ml-auto">AI stock analysis (GPT-5)</span></div>
                <div className="flex gap-4"><span className="text-amber-400 w-12">POST</span><span className="text-zinc-400">/api/stock-synthszr/batch-ratings</span><span className="text-zinc-600 ml-auto">Batch ratings</span></div>
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

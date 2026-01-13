# Synthszr Project

A Next.js 16 application for AI-powered financial analysis and newsletter generation.

## Key Features

### Synthszr Vote Badges
- Display investment ratings (BUY/HOLD/SELL) for companies mentioned in blog posts
- Public companies: Analysis generated via `/api/stock-synthszr` (AI-powered, cached)
- Premarket companies: Data fetched from glitch.green API

### Company Detection
- Natural mentions in text (e.g., "Nvidia reported...")
- Explicit `{Company}` directive tags (e.g., `{Palantir}`)
- Tags are hidden in rendered output but trigger rating display
- Exclusion list prevents false positives (e.g., "Insider", "Experte" are common nouns, not companies)

### Ghostwriter
- AI-powered blog post generation from daily digests
- Automatically adds `{Company}` tags for thematically relevant companies
- Supports multiple AI models (Claude, Gemini)

### Edit Learning System
- Learns from manual edits made to AI-generated blog posts
- Tracks all changes at sentence-level (edit_history → edit_diffs)
- Extracts patterns from recurring edits (learned_patterns)
- Classifies edits: factual, stylistic, vocabulary, grammar
- Confidence-based pattern activation with time decay

## Architecture

### Company Data
- `lib/data/companies.ts` - Auto-generated company dictionaries
- `KNOWN_COMPANIES` - Public companies with stock tickers
- `KNOWN_PREMARKET_COMPANIES` - Premarket companies from glitch.green
- `lib/data/company-exclusions.ts` - Words excluded from company detection
- Sync via: `npx tsx scripts/sync-premarket-companies.ts`

### TipTap Editor
- `components/tiptap-editor.tsx` - Admin editor
- `components/tiptap-renderer.tsx` - Reader component with company detection
- `lib/email/tiptap-to-html.ts` - Email HTML generation with vote badges

### Rating Generation
- `/api/stock-synthszr` - Generate/cache public company analysis
- `/api/stock-synthszr/batch-ratings` - Batch read ratings (read-only)
- `/api/premarket/batch-ratings` - Batch read premarket ratings

### Edit Learning
- `lib/edit-learning/history.ts` - Edit history tracking (ensureInitialEditHistory, recordEditVersion)
- `lib/edit-learning/diff-extractor.ts` - Sentence-level diff extraction
- `lib/edit-learning/retrieval.ts` - Pattern/example retrieval for Ghostwriter
- `app/api/admin/analyze-edits/route.ts` - Analyze pending edits (GET: stats, POST: run analysis)
- `app/api/admin/pattern-feedback/route.ts` - Update pattern confidence (keep/revert)
- `app/api/cron/extract-patterns/route.ts` - Extract patterns from clustered diffs
- Database tables: `edit_history`, `edit_diffs`, `learned_patterns`, `applied_patterns`

## Recent Changes (2026-01-13)

### Edit Learning System
Enables the Ghostwriter to learn from manual edits:
1. **Edit Capture**: When posts are saved, content_before/content_after stored in `edit_history`
2. **Diff Analysis**: `/api/admin/analyze-edits` extracts sentence-level diffs and classifies via Claude
3. **Pattern Extraction**: `/api/cron/extract-patterns` clusters similar edits (embedding > 0.85)
4. **Ghostwriter Integration**: Active patterns retrieved and applied during generation

**Edit Types:** factual, stylistic, vocabulary, grammar, structural
**Confidence:** Starts at 0.5, +0.1 when kept, -0.1 when reverted, auto-deactivate < 0.3
**Decay:** 0.95/week factor keeps patterns current

**Admin UI:** Links on Blog Posts page (`/admin`) for Analyze Edits | Extract Patterns

### Company Exclusion List
Prevents false positive Synthszr Vote badges for common German/English nouns:
- `lib/data/company-exclusions.ts` - Centralized exclusion Set
- Words like "Insider", "Experte", "Analyst", "Manager", "Partner" are excluded
- Applied in both `tiptap-renderer.tsx` (frontend) and `tiptap-to-html.ts` (email)
- To add exclusions: Edit `EXCLUDED_COMPANY_NAMES` Set in `company-exclusions.ts`

## Recent Changes (2026-01-11)

### Auto-trigger Synthszr Ratings on Post Save
When the Ghostwriter adds `{Company}` tags and the article is saved:
1. `extractCompanyTags()` extracts all `{Company}` patterns from TipTap JSON
2. Maps company names to API slugs using `KNOWN_COMPANIES` / `KNOWN_PREMARKET_COMPANIES`
3. `triggerSynthszrRatings()` fires background API calls:
   - Public companies: POST to `/api/stock-synthszr` (generates AI analysis)
   - Premarket companies: GET to `/api/premarket` (fetches from glitch.green)

This ensures Synthszr Vote badges appear when the post is viewed, even for companies not explicitly mentioned in the news.

**Location:** `app/admin/create-article/page.tsx` lines 394-472, 510-511

### Synthszr Take Styling
- Bold + uppercase for "Synthszr Take:" text
- Non-italic rendering in both editor and reader
- Background highlight: `#CCFF00`

### Company Tags Display Fix
- `{Company}` tags are stripped from visible text via `hideExplicitCompanyTags()`
- Tags still detected for rating lookup before removal

## Development

```bash
npm run dev          # Start dev server
npm run build        # Build for production
npm run sync-companies  # Sync premarket companies from glitch.green
```

## Environment Variables

Required:
- `STOCKS_API_BASE_URL` - glitch.green API base (default: https://glitch.green)
- `STOCKS_PREMARKET_API_KEY` - API key for premarket data
- `SUPABASE_URL` / `SUPABASE_ANON_KEY` / `SUPABASE_SERVICE_ROLE_KEY`
- AI model API keys (OpenAI, Anthropic, Google)
